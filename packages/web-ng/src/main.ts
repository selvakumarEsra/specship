import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

// Register the offline service worker (REQ-OFFLINE-001). Service workers only
// run in a secure context — HTTPS or localhost/127.0.0.1 — which is exactly
// where the desktop dashboard runs, so on any other host this simply no-ops.
// Registration failures are non-fatal: the app still works online without it.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('[specship] offline service worker registration failed', err);
    });
  });
}
