import { defineConfig, devices } from '@playwright/test';
import { FAULT_ROUTE, PORT_EMPTY, PORT_FAULT, PORT_MAIN, URL_MAIN } from './lib/ports';

/**
 * Three fixture servers boot for the run (see lib/ports.ts):
 *   - MAIN  — the populated, indexed fixture. `baseURL`; every happy-path spec.
 *   - FAULT — the same fixture with `E2E_FAULT` making one data route 500, so
 *             api-failure.spec.ts can prove the SPA degrades to an error state
 *             instead of a blank screen (REQ-TVIZ-004.A1/.A2).
 *   - EMPTY — an initialized-but-unindexed project with no transcripts, for
 *             empty-project.spec.ts's explicit-empty-state assertions.
 * Each owns a disjoint work dir (E2E_MODE → lib/paths.mjs), so they can build
 * and serve concurrently without trampling each other.
 */
const BASE_URL = URL_MAIN;

/** Shared `webServer` settings — only the port, mode, and env differ. */
const server = (port: number, mode: string, env: Record<string, string> = {}) => ({
  command: 'node scripts/prepare-and-serve.mjs',
  url: `http://127.0.0.1:${port}/api/status`,
  // Cold start = build fixture + index + boot server. Generous on CI.
  timeout: 180_000,
  reuseExistingServer: !process.env.CI,
  stdout: 'pipe' as const,
  stderr: 'pipe' as const,
  env: { E2E_PORT: String(port), E2E_MODE: mode, ...env },
});

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  // The harness runs one server against one fixture — keep it serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    server(PORT_MAIN, 'default'),
    server(PORT_FAULT, 'fault', { E2E_FAULT: FAULT_ROUTE }),
    server(PORT_EMPTY, 'empty'),
  ],
});
