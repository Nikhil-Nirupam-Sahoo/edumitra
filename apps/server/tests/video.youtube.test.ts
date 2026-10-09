import { describe, expect, it } from 'vitest';
import {
  extractYouTubeId,
  isoDurationToSec,
  youtubeThumbnail,
  createYouTubeService,
} from '../src/video/youtube.service.js';
import { loadConfig } from '../src/config.js';

describe('youtube helpers', () => {
  it('extracts a video id from the URL shapes YouTube actually serves', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=nO-N6MmQJ2M')).toBe('nO-N6MmQJ2M');
    expect(extractYouTubeId('https://youtu.be/5cFE7opEnmM')).toBe('5cFE7opEnmM');
    expect(extractYouTubeId('https://www.youtube.com/shorts/DEP0UL_GT2E')).toBe('DEP0UL_GT2E');
    expect(extractYouTubeId('https://example.com/notyoutube')).toBeNull();
    expect(extractYouTubeId('not a url at all')).toBeNull();
  });

  it('builds a compressed thumbnail URL', () => {
    expect(youtubeThumbnail('abc')).toBe('https://i.ytimg.com/vi/abc/mqdefault.jpg');
    expect(youtubeThumbnail('abc', 'hqdefault')).toBe('https://i.ytimg.com/vi/abc/hqdefault.jpg');
  });

  it('converts ISO 8601 durations to seconds', () => {
    expect(isoDurationToSec('PT1H2M3S')).toBe(3723);
    expect(isoDurationToSec('PT45S')).toBe(45);
    expect(isoDurationToSec('PT10M')).toBe(600);
    expect(isoDurationToSec('PT2H')).toBe(7200);
    expect(isoDurationToSec('garbage')).toBe(0);
  });

  it('declines to search without an API key instead of faking results', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DB_DRIVER: 'dev',
      YOUTUBE_API_KEY: undefined,
    } as NodeJS.ProcessEnv);
    const service = createYouTubeService(config);
    const results = await service.searchVideos('life processes class 10');
    // No key => no results, never inventing video ids.
    expect(results).toEqual([]);
    const details = await service.fetchDetails(['nO-N6MmQJ2M']);
    expect(details).toEqual([]);
  });
});
