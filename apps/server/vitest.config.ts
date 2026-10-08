import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Integration tests share the in-memory SQLite per test file; serial is
    // faster and avoids port/file contention on low-core CI runners.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
