/**
 * Design-true SSR layout (REQ-DASHLEAN-005) — composes pages from the
 * "SpecShip Desktop" Claude Design reference imported 2026-07-04.
 *
 * The markup under ./templates/ is the design's own rendered DOM (captured
 * from the live preview per screen and archived in specs/lean-dashboard/),
 * so what this module serves IS the design, byte-for-byte, with dynamic
 * slots substituted: nav hrefs, active route, badge counts, project path,
 * and per-screen data bindings applied by the caller.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bindStatusStrip } from './bindings.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const T = join(here, 'templates');
const tpl = (name) => readFileSync(join(T, name + '.html'), 'utf8');

const SIDEBAR = tpl('sidebar');
const STATUS = tpl('status-strip');
const TOPBAR = tpl('topbar');
const CONTENT = {};
for (const s of ['dashboard','graph','specs','drift','runs','sessions','heatmap','costs','compare','memory','mcp','tips','design-system','settings']) {
  CONTENT[s] = tpl('content-' + s);
}

const ACTIVE = 'color: var(--text-primary); background: var(--bg-active); font-weight: 600;';
const INACTIVE = 'color: var(--text-secondary); background: transparent; font-weight: 450;';

/** The design's nav routes (href = screen key). */
export const SCREENS = Object.keys(CONTENT);

/**
 * Render the sidebar with real hrefs, one active route, and live badges.
 * badges: { drift, runs, tips } — replaces the design's sample counts.
 */
function sidebar(route, badges = {}) {
  let s = SIDEBAR;
  // Real links: '#/x' → '/x'
  s = s.replace(/href="#\/([a-z-]+)"/g, 'href="/$1"');
  // Normalize every nav link to INACTIVE, then activate the current route.
  s = s.replace(/color: var\(--text-primary\); background: var\(--bg-active\); font-weight: 600;/g, INACTIVE);
  const esc = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(`(<a href="/${esc}" style="[^"]*?)${INACTIVE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `$1${ACTIVE}`);
  // Live badges: swap the sample count inside each badged link.
  const badge = (href, n) => {
    if (n == null) return;
    const re = new RegExp(`(href="/${href}"[\\s\\S]{0,900}?<span class="pill tabular"[^>]*>)\\d+(</span>)`);
    s = s.replace(re, `$1${n}$2`);
  };
  badge('drift', badges.drift);
  badge('runs', badges.runs);
  badge('tips', badges.tips);
  return s;
}

/** Status strip with the real project path + live index counts. */
function statusStrip(projectPath, strip = {}) {
  let s = STATUS;
  if (projectPath) s = s.replace(/~\/dev\/specship/g, projectPath);
  return bindStatusStrip(s, strip);
}

/**
 * Full document. content is design markup (already pixel-true); callers bind
 * per-screen data into it before passing.
 */
export function designLayout({ route, title, content, badges, projectPath, strip, theme = 'dark' }) {
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · SpecShip</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;450;500;600;650;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css">
<style>html,body{margin:0;height:100%;background:var(--bg-canvas);color:var(--text-primary);font-family:var(--font-ui);font-size:var(--fs-base)}#app{height:100vh}a{color:inherit}</style>
</head>
<body>
<div id="app"><div style="display: flex; height: 100%; position: relative;">
${sidebar(route, badges)}
<div style="flex: 1 1 0%; display: flex; flex-direction: column; min-width: 0px;">
${statusStrip(projectPath, strip)}
${TOPBAR}
${content}
</div>
</div></div>
<script type="module" src="/islands.js"></script>
</body>
</html>`;
}

/** A screen's design content template, verbatim. */
export function screenContent(name) {
  return CONTENT[name] ?? null;
}
