import 'fake-indexeddb/auto';

// Node >= 22 installs a configurable `localStorage` getter on globalThis that
// returns undefined (the experimental storage needs --localstorage-file). In the
// jsdom environment that getter shadows the real window.localStorage, so
// `localStorage.clear()` blows up in any test that touches it. Replace it with
// a small in-memory Storage so tests are deterministic and storage-dependent
// code (locale, cached auth session, remote translations) is genuinely exercised.
function installMemoryStorage(name: 'localStorage' | 'sessionStorage'): void {
  const map = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return map.size;
    },
    key(index: number): string | null {
      return [...map.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    clear(): void {
      map.clear();
    },
  };
  Object.defineProperty(globalThis, name, {
    value: shim,
    configurable: true,
    writable: true,
  });
}

if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
  installMemoryStorage('localStorage');
}
if (typeof globalThis.sessionStorage === 'undefined' || globalThis.sessionStorage === null) {
  installMemoryStorage('sessionStorage');
}

// jsdom lacks a couple of browser APIs the client relies on. Provide minimal,
// deterministic stand-ins so unit tests exercise real logic paths.
if (!('CompressionStream' in globalThis)) {
  // Identity passthrough is fine in tests: the sync engine only needs a stream.
  class IdentityCompressionStream extends TransformStream<Uint8Array, Uint8Array> {
    constructor(_format: 'gzip' | 'deflate') {
      super({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
      });
    }
  }
  Object.defineProperty(globalThis, 'CompressionStream', {
    value: IdentityCompressionStream,
  });
}

// HMAC-SHA256 is not implemented in jsdom's crypto shim. A deterministic
// FNV-based digest is enough for unit tests: they assert that signatures are
// stable and change with the payload, not that they match a real secret.
if (!globalThis.crypto?.subtle?.importKey) {
  const fakeDigest = async (_algo: string, data: BufferSource): Promise<ArrayBuffer> => {
    const bytes = new Uint8Array(
      data instanceof ArrayBuffer
        ? data
        : new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength),
    );
    let h1 = 2166136261;
    let h2 = 0xcbf29ce4;
    for (const b of bytes) {
      h1 = Math.imul(h1 ^ b, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ b, 2246822519) >>> 0;
    }
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      out[i] = ((i % 8 < 4 ? h1 : h2) >>> ((i % 4) * 8)) & 0xff;
    }
    return out.buffer;
  };
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: {
      digest: fakeDigest,
      importKey: async () => ({ __fakeHmacKey: true }),
      sign: async (_algo: string, _key: unknown, data: BufferSource) => fakeDigest('SHA-256', data),
      verify: async (
        _algo: string,
        _key: unknown,
        signature: BufferSource,
        data: BufferSource,
      ) => {
        const expected = new Uint8Array(await fakeDigest('SHA-256', data));
        const provided = new Uint8Array(
          signature instanceof ArrayBuffer ? signature : (signature as ArrayBufferView).buffer,
        );
        return (
          expected.length === provided.length && expected.every((b, i) => b === provided[i])
        );
      },
    },
    configurable: true,
  });
}

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () =>
      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }),
    configurable: true,
  });
}
