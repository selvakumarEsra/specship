/**
 * The three fixture servers the suite runs against (REQ-TVIZ-004.A1), and the
 * single knob (`E2E_PORT`) that moves all of them.
 *
 * `playwright.config.ts` spawns one `webServer` per entry; the specs import the
 * base URL they need. Splitting them by port (instead of reconfiguring one
 * server mid-run) keeps every server's state hermetic and lets the happy-path
 * specs stay pointed at the populated fixture while the failure-path specs
 * drive a deliberately broken one.
 */
const BASE = Number(process.env.E2E_PORT || 4319);

/** Populated, indexed fixture with seeded transcripts — the default baseURL. */
export const PORT_MAIN = BASE;
/** Same fixture, but `E2E_FAULT` makes one data route 500 (A2). */
export const PORT_FAULT = BASE + 1;
/** An initialized-but-unindexed project with no transcripts. */
export const PORT_EMPTY = BASE + 2;

/** The `/api` path substring the fault server is configured to fail. */
export const FAULT_ROUTE = '/api/claude/stats';

export const URL_MAIN = `http://127.0.0.1:${PORT_MAIN}`;
export const URL_FAULT = `http://127.0.0.1:${PORT_FAULT}`;
export const URL_EMPTY = `http://127.0.0.1:${PORT_EMPTY}`;
