import type { Page } from '@playwright/test';

/**
 * Documented allowlist of benign console/page messages that are NOT product
 * bugs (REQ-DESKTOP-032.A1). Keep this EMPTY by default — the built SPA is
 * expected to boot every screen clean. Add an entry ONLY for an unavoidable
 * third-party warning, and always with a comment saying what it is and why it
 * cannot be fixed on our side.
 */
export const CONSOLE_ALLOWLIST: RegExp[] = [
  // (intentionally empty)
];

export interface ConsoleCapture {
  /** Non-allowlisted console.error + uncaught pageerror seen so far. */
  errors: () => string[];
}

/**
 * Start collecting console errors for a page: both `console.error` output and
 * uncaught `pageerror` exceptions, minus anything the allowlist forgives.
 * Attach BEFORE `page.goto` so nothing that fires during boot is missed.
 */
export function captureConsoleErrors(page: Page, allow: RegExp[] = CONSOLE_ALLOWLIST): ConsoleCapture {
  const errors: string[] = [];
  const keep = (source: string, text: string) => {
    if (allow.some((re) => re.test(text))) return;
    errors.push(`[${source}] ${text}`);
  };
  page.on('console', (msg) => {
    if (msg.type() === 'error') keep('console.error', msg.text());
  });
  page.on('pageerror', (err) => keep('pageerror', err.message));
  return { errors: () => errors };
}
