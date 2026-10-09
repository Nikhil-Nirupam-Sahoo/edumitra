/**
 * Routing tests.
 *
 * The shell is hash-routed with no router dependency, so `parseRoute` is the
 * single place where a URL becomes a screen. Two things must hold: every route
 * the bottom nav offers has a parser branch (a typo here would silently render
 * Home instead), and an unknown hash never throws.
 */

import { describe, expect, it } from 'vitest';
import { parseRoute } from '../src/App';

/** Every path the bottom nav and the in-app links can produce. */
const NAV_PATHS = [
  '#/',
  '#/lesson/c8-math-linear-equations',
  '#/games',
  '#/reels',
  '#/rewards',
  '#/support',
  '#/settings',
  '#/teacher',
];

describe('parseRoute', () => {
  it('recognises every path the navigation can produce', () => {
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/lesson/c8-math-linear-equations')).toEqual({
      name: 'lesson',
      lessonId: 'c8-math-linear-equations',
    });
    expect(parseRoute('#/games')).toEqual({ name: 'games' });
    expect(parseRoute('#/reels')).toEqual({ name: 'reels' });
    expect(parseRoute('#/rewards')).toEqual({ name: 'rewards' });
    expect(parseRoute('#/support')).toEqual({ name: 'support' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/teacher')).toEqual({ name: 'teacher' });
  });

  it('never returns a lesson route with an empty id', () => {
    // An empty id would render LessonViewer with no lesson — the loading-then-
    // "no lessons" path — instead of Home.
    expect(parseRoute('#/lesson/')).toEqual({ name: 'home' });
    expect(parseRoute('#/lesson')).toEqual({ name: 'home' });
  });

  it('accepts a hash with or without the leading slash', () => {
    expect(parseRoute('#games')).toEqual({ name: 'games' });
    expect(parseRoute('games')).toEqual({ name: 'games' });
  });

  it('decodes a percent-encoded lesson id', () => {
    expect(parseRoute('#/lesson/c8%20math')).toEqual({ name: 'lesson', lessonId: 'c8 math' });
  });

  it('falls back to home for unknown or empty hashes instead of throwing', () => {
    for (const hash of ['', '#', '#/', '#/nope', '#/reels/extra', '#/?x=1']) {
      expect(parseRoute(hash), hash).toEqual({ name: 'home' });
    }
  });

  it('treats a trailing slash as the same route', () => {
    for (const path of NAV_PATHS) {
      expect(parseRoute(`${path}/`), `${path}/`).toEqual(parseRoute(path));
    }
  });
});