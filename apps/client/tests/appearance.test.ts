import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyFontScale,
  loadFontScale,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
} from '../src/appearance';

describe('appearance (text size)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--font-size-base');
  });

  it('defaults to 1 when nothing is saved', () => {
    expect(loadFontScale()).toBe(1);
  });

  it('clamps out-of-range values', () => {
    expect(applyFontScale(5)).toBe(FONT_SCALE_MAX);
    expect(applyFontScale(0)).toBe(FONT_SCALE_MIN);
    expect(applyFontScale(1.1)).toBe(1.1);
    // A NaN scale falls back to the default rather than producing "NaNpx".
    expect(applyFontScale(Number.NaN)).toBe(1);
  });

  it('applies the scale to the document and remembers it', () => {
    applyFontScale(1.3);
    const value = document.documentElement.style.getPropertyValue('--font-size-base');
    expect(value).toBe('22.1px');
    expect(loadFontScale()).toBe(1.3);
  });
});
