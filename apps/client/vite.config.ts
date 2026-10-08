import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * The client must be servable from any sub-path (school intranets, USB
 * deployments) and must never require a network round-trip to boot.
 * `base: './'` keeps all asset URLs relative.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    // Dev proxy so the browser talks to the API on the same origin.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? 4600}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
