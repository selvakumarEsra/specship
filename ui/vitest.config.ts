import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * ui-module test runner (REQ-DESKTOP-019 introduced the first tests). Kept
 * separate from vite.config.ts so the build config stays test-free, and from
 * the ROOT vitest config, which only includes `__tests__/**` — these tests
 * run via `npm test` inside ui/ (jsdom, not node).
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
