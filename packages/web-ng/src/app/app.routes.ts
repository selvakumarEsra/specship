import { Routes } from '@angular/router';

/**
 * Top-level routes. Every page is lazy-loaded — the main bundle only
 * ships the shell + the dashboard's deps; everything else streams in on
 * navigation. Hash routing wouldn't matter here since this is a desktop-
 * style SPA, but the default (path-based) router works fine because Vite
 * + Angular CLI dev serve falls back to index.html.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
    data: { nav: 'dashboard', title: 'Dashboard' },
  },
  {
    path: 'graph',
    loadComponent: () => import('./pages/graph/graph').then((m) => m.Graph),
    data: { nav: 'graph', title: 'Graph' },
  },
  {
    path: 'specs',
    loadComponent: () => import('./pages/specs/specs').then((m) => m.Specs),
    data: { nav: 'specs', title: 'Specs' },
  },
  {
    path: 'specs/:id',
    loadComponent: () => import('./pages/spec-detail/spec-detail').then((m) => m.SpecDetail),
    data: { nav: 'specs', title: 'Spec' },
  },
  {
    path: 'drift',
    loadComponent: () => import('./pages/drift/drift').then((m) => m.Drift),
    data: { nav: 'drift', title: 'Drift queue' },
  },
  {
    path: 'improvements',
    loadComponent: () => import('./pages/improvements/improvements').then((m) => m.Improvements),
    data: { nav: 'improvements', title: 'Improvements' },
  },
  {
    path: 'maintainability',
    loadComponent: () => import('./pages/maintainability/maintainability').then((m) => m.Maintainability),
    data: { nav: 'maintainability', title: 'Maintainability' },
  },
  {
    path: 'domain',
    loadComponent: () => import('./pages/domain/domain').then((m) => m.Domain),
    data: { nav: 'domain', title: 'Domain' },
  },
  {
    path: 'workflows',
    loadComponent: () => import('./pages/workflows/workflows').then((m) => m.Workflows),
    data: { nav: 'workflows', title: 'Workflows' },
  },
  {
    path: 'runs',
    loadComponent: () => import('./pages/runs/runs').then((m) => m.Runs),
    data: { nav: 'runs', title: 'Runs' },
  },
  {
    path: 'runs/:id',
    loadComponent: () => import('./pages/run-detail/run-detail').then((m) => m.RunDetail),
    data: { nav: 'runs', title: 'Run detail' },
  },
  {
    path: 'chat',
    loadComponent: () => import('./pages/chat/chat').then((m) => m.Chat),
    data: { nav: 'chat', title: 'Chat' },
  },
  {
    path: 'sessions',
    loadComponent: () => import('./pages/sessions/sessions').then((m) => m.Sessions),
    data: { nav: 'sessions', title: 'Sessions' },
  },
  {
    path: 'sessions/:id',
    loadComponent: () => import('./pages/session-detail/session-detail').then((m) => m.SessionDetail),
    data: { nav: 'sessions', title: 'Session detail' },
  },
  {
    path: 'heatmap',
    loadComponent: () => import('./pages/heatmap/heatmap').then((m) => m.Heatmap),
    data: { nav: 'heatmap', title: 'Heatmap' },
  },
  {
    path: 'costs',
    loadComponent: () => import('./pages/costs/costs').then((m) => m.Costs),
    data: { nav: 'costs', title: 'Costs' },
  },
  {
    path: 'specship-impact',
    loadComponent: () => import('./pages/specship-impact/specship-impact').then((m) => m.SpecshipImpact),
    data: { nav: 'specship-impact', title: 'SpecShip Impact' },
  },
  {
    path: 'compare',
    loadComponent: () => import('./pages/compare/compare').then((m) => m.Compare),
    data: { nav: 'compare', title: 'Compare projects' },
  },
  // Tips merged into Improvements (REQ-DASHUX-005); deep links keep working.
  { path: 'tips', redirectTo: 'improvements' },
  {
    path: 'memory',
    loadComponent: () => import('./pages/memory/memory').then((m) => m.Memory),
    data: { nav: 'memory', title: 'Memory' },
  },
  {
    path: 'design',
    loadComponent: () => import('./pages/design/design').then((m) => m.Design),
    data: { nav: 'design', title: 'Design system' },
  },
  {
    path: 'mcp',
    loadComponent: () => import('./pages/mcp/mcp').then((m) => m.Mcp),
    data: { nav: 'mcp', title: 'MCP servers' },
  },
  {
    path: 'mcp/:id',
    loadComponent: () => import('./pages/mcp/mcp-detail').then((m) => m.McpDetail),
    data: { nav: 'mcp', title: 'MCP server' },
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.Settings),
    data: { nav: 'settings', title: 'Settings' },
  },
  { path: '**', redirectTo: 'dashboard' },
];
