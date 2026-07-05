import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * REQ-DESKTOP-017: the SPA builds to static assets under ui/dist that the
 * dashboard server serves same-origin. `base: './'` keeps every asset URL
 * relative so the build works from any mount path. Nothing is externalized
 * to a CDN — fonts and scripts all bundle into dist/ (the post-build
 * `check-ui-deps.mjs --dist` scan enforces zero external origins).
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    // Dev convenience only (never in the built output): proxy API calls to a
    // locally running dashboard server so `vite dev` sees live data.
    proxy: { '/api': 'http://127.0.0.1:4242' },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
});
