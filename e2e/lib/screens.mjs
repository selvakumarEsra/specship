/**
 * Canonical list of the desktop SPA's routed screens, mirrored from
 * `ui/src/App.tsx` (the `SCREENS` map).
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
  { id: 'dashboard', path: '/dashboard', content: 'Overview' },
  { id: 'plan', path: '/plan', content: 'Plan' },
  { id: 'review', path: '/review', content: 'Review' },
  { id: 'graph', path: '/graph', content: 'Recenter' },
  { id: 'traceability', path: '/traceability', content: 'Traceability' },
  { id: 'runs', path: '/runs', content: 'Runs' },
  { id: 'workflows', path: '/workflows', content: 'Workflows' },
  { id: 'designsystem', path: '/designsystem', content: 'Design system' },
  { id: 'settings', path: '/settings', content: 'Settings' },
];

/**
 * Screens the dashboard simplification retired (REQ-DASHSIMPLE-001), and the
 * live screen each old URL now lands on (`ui/src/router.ts` REDIRECTS) — so a
 * bookmarked link never shows a blank page.
 */
export const RETIRED = [
  { from: '/specs', to: 'review' },
  { from: '/drift', to: 'review' },
  { from: '/sessions', to: 'dashboard' },
  { from: '/heatmap', to: 'dashboard' },
  { from: '/costs', to: 'dashboard' },
  { from: '/compare', to: 'dashboard' },
  { from: '/memory', to: 'dashboard' },
  { from: '/mcp', to: 'dashboard' },
  { from: '/tips', to: 'dashboard' },
];

/** The fixture spec the edit/detail specs drive (seeded by lib/fixture.mjs). */
export const FIXTURE_SPEC_ID = 'REQ-ORDERS-001';
