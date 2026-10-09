/**
 * Video API + profile-field coverage.
 *
 * Exercises the pieces added on top of the auth and content
 * foundations: the seeded lecture catalogue, board filtering,
 * per-student progress persistence, and the profile fields a
 * student picks at sign-up (board, class, school) and can edit
 * later. Auth gating is checked on the progress route — a
 * student token in, nothing anonymous.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type TestHarness } from './helpers.js';
import { seedVideoLectures, SEED_VIDEOS } from '../src/video/video.seed.js';

let h: TestHarness;

beforeEach(async () => {
  h = await createHarness();
  await seedVideoLectures(h.db);
});

afterEach(async () => {
  await h.close();
});

async function registerStudent(body: Record<string, unknown> = {}) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username: 'student1',
      password: 'password123',
      confirmPassword: 'password123',
      displayName: 'Student One',
      role: 'student',
      ...body,
    },
  });
  return JSON.parse(res.body) as { token: string; user: Record<string, unknown> };
}

describe('video catalogue', () => {
  it('serves every seeded lecture', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/video' });
    const body = JSON.parse(res.body) as { videos: Array<{ id: string }>; total: number };
    expect(body.total).toBe(SEED_VIDEOS.length);
    expect(body.videos.length).toBe(SEED_VIDEOS.length);
  });

  it('filters by board', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/video?board_id=ICSE',
    });
    const body = JSON.parse(res.body) as { videos: Array<{ board_id: string }> };
    expect(body.videos.length).toBeGreaterThan(0);
    expect(body.videos.every((v) => v.board_id === 'ICSE')).toBe(true);
  });

  it('resolves a single lecture by id and 404s a missing one', async () => {
    const first = SEED_VIDEOS[0]!;
    const ok = await h.app.inject({ method: 'GET', url: `/api/v1/video/${first.id}` });
    expect(ok.statusCode).toBe(200);
    const missing = await h.app.inject({ method: 'GET', url: '/api/v1/video/does-not-exist' });
    expect(missing.statusCode).toBe(404);
  });

  it('is idempotent when re-seeding', async () => {
    const added = await seedVideoLectures(h.db);
    expect(added).toBe(0);
  });
});

describe('video progress', () => {
  it('persists and returns a student position', async () => {
    const { token } = await registerStudent();
    const video = SEED_VIDEOS[0]!;

    const put = await h.app.inject({
      method: 'POST',
      url: `/api/v1/video/${video.id}/progress`,
      headers: { authorization: `Bearer ${token}` },
      payload: { position_sec: 90.5, playback_speed: 1.5, subtitle_color: '#ffcc00' },
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/video/${video.id}/progress`,
      headers: { authorization: `Bearer ${token}` },
    });
    const saved = JSON.parse(get.body) as { position_sec: number; playback_speed: number; subtitle_color: string };
    expect(saved.position_sec).toBeCloseTo(90.5);
    expect(saved.playback_speed).toBe(1.5);
    expect(saved.subtitle_color).toBe('#ffcc00');
  });

  it('refuses anonymous progress writes', async () => {
    const video = SEED_VIDEOS[0]!;
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/video/${video.id}/progress`,
      payload: { position_sec: 5 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('profile fields', () => {
  it('stores board, class and school chosen at sign-up', async () => {
    const { user } = await registerStudent({
      classId: 'class-9',
      boardId: 'BSE_ODISHA',
      schoolId: 'Kendriya Vidyalaya',
    });
    expect(user.boardId).toBe('BSE_ODISHA');
    expect(user.classId).toBe('class-9');
    expect(user.schoolId).toBe('Kendriya Vidyalaya');
  });

  it('updates board and font size via PATCH and keeps other fields', async () => {
    const { token } = await registerStudent({ boardId: 'CBSE', classId: 'class-8' });
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { boardId: 'ICSE', fontSize: 1.2 },
    });
    const user = JSON.parse(res.body).user as {
      boardId: string;
      fontSize: number;
      classId: string;
    };
    expect(user.boardId).toBe('ICSE');
    expect(user.fontSize).toBe(1.2);
    expect(user.classId).toBe('class-8'); // untouched
  });

  it('rejects an empty profile patch and an unauthenticated one', async () => {
    const { token } = await registerStudent();
    const empty = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const noAuth = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      payload: { boardId: 'CBSE' },
    });
    expect(noAuth.statusCode).toBe(401);
  });

  it('accepts a compressed profile-picture data URL', async () => {
    const { token } = await registerStudent();
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA=';
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/profile',
      headers: { authorization: `Bearer ${token}` },
      payload: { avatarUrl: dataUrl },
    });
    const user = JSON.parse(res.body).user as { avatarUrl: string | null };
    expect(user.avatarUrl).toBe(dataUrl);
  });
});
