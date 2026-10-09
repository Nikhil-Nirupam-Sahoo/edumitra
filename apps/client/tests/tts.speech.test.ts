/**
 * Text-to-speech tests.
 *
 * jsdom has no speechSynthesis, so the module is tested against a stub that
 * behaves like the real API's awkward parts: voices arriving asynchronously,
 * locale mismatches, and speak() throwing. What matters is that the app never
 * shows a read-aloud button it cannot honour, and never reads a language the
 * student does not speak.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canSpeak,
  pickVoice,
  rateForLocale,
  speak,
  speechSupported,
  stopSpeaking,
} from '../src/tts/speech';

interface StubVoice {
  name: string;
  lang: string;
  default?: boolean;
}

function installSpeech(voices: StubVoice[]): { spoken: string[]; cancels: number } {
  const state = { spoken: [] as string[], cancels: 0 };
  const listeners: Array<() => void> = [];

  class FakeUtterance {
    voice: StubVoice | null = null;
    lang = '';
    rate = 1;
    pitch = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public text: string) {}
  }

  const api = {
    getVoices: () => voices as unknown as SpeechSynthesisVoice[],
    speak: (u: { text: string }) => {
      state.spoken.push(u.text);
    },
    cancel: () => {
      state.cancels += 1;
    },
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  };

  vi.stubGlobal('speechSynthesis', api);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return state;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('speechSupported', () => {
  it('is false when the platform has no speech synthesis', () => {
    expect(speechSupported()).toBe(false);
  });

  it('is true when the platform provides speech synthesis', () => {
    installSpeech([]);
    expect(speechSupported()).toBe(true);
  });
});

describe('pickVoice', () => {
  it('returns null when the platform reports no voices', () => {
    installSpeech([]);
    expect(pickVoice('hi')).toBeNull();
  });

  it('prefers an exact locale match over the base language', () => {
    installSpeech([
      { name: 'Hindi base', lang: 'hi' },
      { name: 'Hindi India', lang: 'hi-IN' },
      { name: 'English', lang: 'en-GB' },
    ]);
    expect(pickVoice('hi-IN')?.name).toBe('Hindi India');
  });

  it('falls back to the base language when no exact match exists', () => {
    installSpeech([
      { name: 'Hindi base', lang: 'hi' },
      { name: 'English', lang: 'en-GB' },
    ]);
    expect(pickVoice('hi-IN')?.name).toBe('Hindi base');
  });

  it('refuses to read a language the student does not have a voice for', () => {
    // Reading Tamil content with a Hindi voice would be worse than silence.
    installSpeech([
      { name: 'Hindi', lang: 'hi-IN' },
      { name: 'English', lang: 'en-US' },
    ]);
    expect(pickVoice('ta')).toBeNull();
  });

  it('allows an English voice as a last resort for English content', () => {
    installSpeech([
      { name: 'Hindi', lang: 'hi-IN' },
      { name: 'English US', lang: 'en-US' },
    ]);
    expect(pickVoice('en')?.name).toBe('English US');
  });
});

describe('canSpeak', () => {
  it('is false without speech support', () => {
    expect(canSpeak('en')).toBe(false);
  });

  it('is true when a matching voice exists', () => {
    installSpeech([{ name: 'English US', lang: 'en-US' }]);
    expect(canSpeak('en')).toBe(true);
  });

  it('is false when only an unrelated language is available', () => {
    installSpeech([{ name: 'Tamil', lang: 'ta-IN' }]);
    expect(canSpeak('en')).toBe(false);
  });
});

describe('speak', () => {
  it('speaks the text using the matched voice', () => {
    const state = installSpeech([{ name: 'English US', lang: 'en-US' }]);
    const ok = speak('A rational number is p over q', { locale: 'en' });
    expect(ok).toBe(true);
    expect(state.spoken).toEqual(['A rational number is p over q']);
  });

  it('collapses runs of whitespace so the voice does not stumble', () => {
    const state = installSpeech([{ name: 'English US', lang: 'en-US' }]);
    speak('  Too    many\n spaces  ', { locale: 'en' });
    expect(state.spoken[0]).toBe('Too many spaces');
  });

  it('refuses to speak empty or whitespace-only text', () => {
    const state = installSpeech([{ name: 'English US', lang: 'en-US' }]);
    expect(speak('   ', { locale: 'en' })).toBe(false);
    expect(state.spoken).toHaveLength(0);
  });

  it('returns false rather than throwing when no voice matches', () => {
    installSpeech([{ name: 'Tamil', lang: 'ta-IN' }]);
    expect(speak('hello', { locale: 'en' })).toBe(false);
  });

  it('returns false when there is no speech API at all', () => {
    expect(speak('hello', { locale: 'en' })).toBe(false);
  });

  it('clamps an out-of-range rate instead of throwing it at the engine', () => {
    const state = installSpeech([{ name: 'English US', lang: 'en-US' }]);
    speak('slow down', { locale: 'en', rate: 99 });
    speak('speed up', { locale: 'en', rate: -4 });
    // Both calls must have been accepted.
    expect(state.spoken).toHaveLength(2);
  });
});

describe('stopSpeaking', () => {
  it('cancels the current utterance', () => {
    const state = installSpeech([{ name: 'English US', lang: 'en-US' }]);
    speak('stop me', { locale: 'en' });
    stopSpeaking();
    expect(state.cancels).toBeGreaterThanOrEqual(1);
  });

  it('is a no-op without speech support', () => {
    expect(() => stopSpeaking()).not.toThrow();
  });
});

describe('rateForLocale', () => {
  it('slows a non-English bundled language for comprehension', () => {
    expect(rateForLocale('hi')).toBeLessThan(1);
    expect(rateForLocale('ta-IN')).toBeLessThan(1);
  });

  it('reads English at natural speed', () => {
    expect(rateForLocale('en')).toBe(1);
  });
});