import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * REQ-DESKTOP-017: the SPA builds to static assets under ui/dist that the
 * dashboard server serves same-origin from the origin root. `base: '/'`
 * makes every asset URL absolute (`/assets/…`), so a fresh full-page load
 * of a deep history route (`/specs/:id`) resolves assets from the root
 * rather than relative to the route path — the relative `./` base 404'd
 * those, breaking REQ-DESKTOP-018.A2 (deep links survive reload). Nothing
 * is externalized to a CDN — fonts and scripts all bundle into dist/ (the
 * post-build `check-ui-deps.mjs --dist` scan enforces zero external origins).
 */
export default defineConfig({
  plugins: [react()],
  base: '/',
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
