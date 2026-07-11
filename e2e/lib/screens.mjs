/**
 * Canonical list of the desktop SPA's routed screens, mirrored from
 * `ui/src/App.tsx` (the `SCREENS` map plus the separately-wired `tips` route).
 * The e2e suite iterates this to prove every screen renders (REQ-DESKTOP-032.A1).
 *
 * `content` is a stable substring that appears INSIDE the screen's own content
 * region. Tests scope the assertion to `[data-screen="<id>"]` (only one screen
 * mounts at a time; the sidebar sits outside it) so a match proves the SCREEN
 * rendered, not just a same-named sidebar nav label. Matching is
 * case-insensitive substring, so a token present in both the populated and
 * empty states of a screen keeps the check robust across fixture data.
 *
 * Keep this in lockstep with `ui/src/App.tsx` — a new routed screen there needs
 * a row here or the render sweep won't cover it.
 */
export const SCREENS = [
  { id: 'dashboard', path: '/dashboard', content: 'Dashboard' },
  { id: 'graph', path: '/graph', content: 'Recenter' },
  { id: 'specs', path: '/specs', content: 'Specs' },
  { id: 'drift', path: '/drift', content: 'Drift queue' },
  { id: 'runs', path: '/runs', content: 'Runs' },
  { id: 'workflows', path: '/workflows', content: 'Workflows' },
  // chat removed entirely (CHAT-REMOVE-DOC) — the reviewer loop lives on Runs.
  { id: 'sessions', path: '/sessions', content: 'Sessions' },
  { id: 'heatmap', path: '/heatmap', content: 'Heatmap' },
  { id: 'costs', path: '/costs', content: 'Costs' },
  { id: 'compare', path: '/compare', content: 'Compare projects' },
  { id: 'memory', path: '/memory', content: 'Memory' },
  { id: 'mcp', path: '/mcp', content: 'MCP servers' },
  { id: 'tips', path: '/tips', content: 'Tips' },
  { id: 'designsystem', path: '/designsystem', content: 'Design system' },
  { id: 'settings', path: '/settings', content: 'Settings' },
];

/** The fixture spec the edit/detail specs drive (seeded by lib/fixture.mjs). */
export const FIXTURE_SPEC_ID = 'REQ-ORDERS-001';
