/**
 * Video lecture routes.
 *
 * Serves video metadata, streams, and progress from open educational sources
 * (NCERT DIKSHA, BSE Odisha, CHSE, ICSE YouTube channels, etc.). No video
 * files are stored — we reference YouTube URLs and local thumbnails/subtitles.
 *
 * All endpoints are public (no auth) for the student side; teacher upload/
 * management endpoints would be under /teacher/... (not implemented here).
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LoadedConfig } from '../config.js';
import type { DbPort } from '../db/types.js';

interface VideoParams {
  id: string;
}

const videoSchema = z.object({
  id: z.string().min(1).max(64),
  lesson_id: z.string().max(64).optional(),
  topic_id: z.string().max(64).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  board_id: z.string().min(1).max(40),
  class_id: z.string().min(1).max(40),
  subject: z.string().min(1).max(40),
  source: z.enum(['youtube', 'local', 'diksha', 'other']),
  source_url: z.string().url(),
  youtube_id: z.string().max(20).optional(),
  duration_sec: z.number().int().positive().optional(),
  thumbnail_webp: z.string().optional(),
  subtitles_json: z.string().optional(),
  languages_json: z.string().optional(),
  downloadable: z.boolean().default(true),
});

const listQuery = z.object({
  board_id: z.string().optional(),
  class_id: z.string().optional(),
  subject: z.string().optional(),
  lesson_id: z.string().optional(),
  topic_id: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export interface VideoRouteOptions {
  config: LoadedConfig;
  db: DbPort;
}

export async function registerVideoRoutes(
  app: FastifyInstance,
  options: VideoRouteOptions,
): Promise<void> {
  const { config, db } = options;

  // ------- List videos (with filters) -------
  app.get('/video', async (request, reply) => {
    const query = listQuery.parse(request.query);
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.board_id) { where.push('board_id = ?'); params.push(query.board_id); }
    if (query.class_id) { where.push('class_id = ?'); params.push(query.class_id); }
    if (query.subject) { where.push('subject = ?'); params.push(query.subject); }
    if (query.lesson_id) { where.push('lesson_id = ?'); params.push(query.lesson_id); }
    if (query.topic_id) { where.push('topic_id = ?'); params.push(query.topic_id); }

    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const sql = `SELECT * FROM video_lectures ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(query.limit, query.offset);

    const videos = await db.query(sql, params);
    const total = await db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM video_lectures ${whereSql}`, params.slice(0, -2),
    );

    return { videos, total: total?.cnt ?? 0 };
  });

  // ------- Get single video -------
  app.get('/video/:id', async (request: FastifyRequest<{ Params: VideoParams }>, reply) => {
    const { id } = request.params;
    const video = await db.queryOne(
      'SELECT * FROM video_lectures WHERE id = ?',
      [id],
    );
    if (!video) return reply.code(404).send({ error: 'not_found' });
    return video;
  });

  // ------- Get video subtitles (VTT/SRT) -------
  app.get('/video/:id/subtitles', async (request: FastifyRequest<{ Params: VideoParams; Querystring: { lang?: string } }>, reply) => {
    const { id } = request.params;
    const lang = request.query.lang;

    const video = await db.queryOne<{ subtitles_json: string }>(
      'SELECT subtitles_json FROM video_lectures WHERE id = ?',
      [id],
    );
    if (!video) return reply.code(404).send({ error: 'not_found' });

    const subs = JSON.parse(video.subtitles_json || '[]') as Array<{
      lang: string; label: string; url: string; format: 'vtt' | 'srt'; color?: string; background?: string;
    }>;
    const match = lang ? subs.find(s => s.lang === lang) : subs[0];
    if (!match) return reply.code(404).send({ error: 'subtitle_not_found' });

    // Proxy the subtitle file (same-origin for CORS)
    try {
      const resp = await fetch(match.url, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) throw new Error('upstream');
      const blob = await resp.blob();
      reply.header('content-type', match.format === 'vtt' ? 'text/vtt' : 'text/plain');
      reply.header('cache-control', 'public, max-age=86400');
      return reply.send(await blob.arrayBuffer());
    } catch {
      return reply.code(502).send({ error: 'upstream_error' });
    }
  });

  // ------- Video progress (student) -------
  app.get('/video/:id/progress', async (request: FastifyRequest<{ Params: VideoParams }>, reply) => {
    const student = request.auth?.user;
    if (!student) return reply.code(401).send({ error: 'unauthenticated' });

    const { id } = request.params;
    const prog = await db.queryOne(
      'SELECT * FROM video_progress WHERE student_id = ? AND video_id = ?',
      [student.id, id],
    );
    return prog ?? { position_sec: 0, completed: 0, playback_speed: 1.0 };
  });

  const progressSchema = z.object({
    position_sec: z.number().nonnegative().optional(),
    completed: z.boolean().optional(),
    playback_speed: z.number().min(0.25).max(2).optional(),
    subtitle_lang: z.string().optional(),
    subtitle_color: z.string().optional(),
    subtitle_bg: z.string().optional(),
  });

  app.post('/video/:id/progress', async (request: FastifyRequest<{ Params: VideoParams }>, reply) => {
    const student = request.auth?.user;
    if (!student) return reply.code(401).send({ error: 'unauthenticated' });

    const { id } = request.params;
    const parsed = progressSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const { position_sec, completed, playback_speed, subtitle_lang, subtitle_color, subtitle_bg } = parsed.data;
    await db.execute(
      `INSERT INTO video_progress (student_id, video_id, position_sec, completed, playback_speed, subtitle_lang, subtitle_color, subtitle_bg, last_watched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(student_id, video_id) DO UPDATE SET
         position_sec = COALESCE(?, position_sec),
         completed = COALESCE(?, completed),
         playback_speed = COALESCE(?, playback_speed),
         subtitle_lang = COALESCE(?, subtitle_lang),
         subtitle_color = COALESCE(?, subtitle_color),
         subtitle_bg = COALESCE(?, subtitle_bg),
         last_watched_at = ?`,
      [
        student.id, request.params.id,
        position_sec ?? 0, completed ?? 0, playback_speed ?? 1.0,
        subtitle_lang ?? null, subtitle_color ?? null, subtitle_bg ?? null,
        Date.now(),
        position_sec ?? null, completed ?? null, playback_speed ?? null,
        subtitle_lang ?? null, subtitle_color ?? null, subtitle_bg ?? null,
        Date.now(),
      ],
    );
    return { ok: true };
  });

  // ------- Video download manifest (for client to fetch and cache) -------
  app.get('/video/:id/download', async (request: FastifyRequest<{ Params: VideoParams; Querystring: { quality?: string } }>, reply) => {
    const student = request.auth?.user;
    if (!student) return reply.code(401).send({ error: 'unauthenticated' });

    const { id } = request.params;
    const quality = request.query.quality || '480p';

    const video = await db.queryOne<{ id: string; title: string; source_url: string; youtube_id: string | null; subtitles_json: string }>(
      'SELECT * FROM video_lectures WHERE id = ? AND downloadable = 1',
      [id],
    );
    if (!video) return reply.code(404).send({ error: 'not_found_or_not_downloadable' });

    // In a real deployment, you'd generate signed URLs for a CDN or object store.
    // Here we return the direct source URL with a note — the client will stream
    // and cache it via the Service Worker.
    return {
      video_id: video.id,
      title: video.title,
      source_url: video.source_url,
      youtube_id: video.youtube_id,
      quality,
      subtitles: JSON.parse(video.subtitles_json || '[]'),
      note: 'Stream and cache via Service Worker. No direct file served.',
    };
  });
}