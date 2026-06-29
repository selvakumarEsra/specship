// Transform the instrumented Claude-Design snapshot into clean Astro inputs.
// Produces: src/styles/landing.css (design system + landing, page-scoped) and
// src/pages/_landing-body.html (cleaned body with __PLACEHOLDERS__ for dynamic
// values). Prints the design's runtime <script> for inlining. REQ-LANDING-001/002.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..'); // site/
let html = fs.readFileSync(path.join(here, 'SpecShip-Landing.html'), 'utf8');

// 1) Strip designer instrumentation -----------------------------------------
// the omelette injector <script> + injected <style>s (data-omelette-injected),
// the designer overlay style, and every data-om-id / data-om-text attribute.
html = html.replace(/<script data-omelette-injected="">[\s\S]*?<\/script>/g, '');
html = html.replace(/<style data-omelette-injected="">[\s\S]*?<\/style>/g, '');
html = html.replace(/<style data-designer-overlay="1">\s*<\/style>/g, '');
html = html.replace(/\sdata-om-id="[^"]*"/g, '');
html = html.replace(/\sdata-om-text(?:-attrs)?="[^"]*"/g, '');

// 2) Carve out the body content (.page) and the design's runtime script ------
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
const designScript = scriptMatch ? scriptMatch[1].trim() : '';
let body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
body = body.replace(/^<body[^>]*>/, '').trim();
// drop the runtime script from the body (re-inlined separately in the .astro)
body = body.replace(/<script>[\s\S]*?<\/script>/g, '').trim();

// 3) Content adaptations → shipped 0.9.0 truth (REQ-LANDING-002) -------------
const subs = [
  // brand: this is the OSS tool, not a "Desktop" download
  [/<span class="desk">&nbsp;Desktop<\/span>/g, ''],
  [/SpecShip Desktop/g, 'SpecShip'],
  [/Desktop app · MCP server · for Claude Code/g, 'Knowledge graph · MCP server · for Claude Code'],
  // hero install command: real npm global install, not "npx specship init -i"
  [/data-copy="npx specship init -i"/g, 'data-copy="__INSTALL__"'],
  [/<span class="cmd-accent">npx<\/span> specship init <span style="color:var\(--text-muted\)">-i<\/span>/g,
   '<span class="cmd-accent">npm</span> i -g @specship/specship'],
  // CTA labels: no macOS app ships
  [/Download for macOS/g, 'Get started'],
  // GitHub chip → real repo + live star count
  [/<a class="gh-chip" href="#">/g, '<a class="gh-chip" href="__REPO__" target="_blank" rel="noopener">'],
  [/<span class="star">★<\/span> 4\.2k/g, '<span class="star">★</span> __STARS__'],
  // nav "Download" button → Install (the install is npm, not a download)
  [/(<a class="btn btn-primary btn-sm" href="#download">)Download(<\/a>)/g, '$1Install$2'],
  // version + platform drift (final CTA kicker + footer)
  [/v0\.4\.0/g, 'v0.9.0'],
  [/ · macOS · Linux · Windows/g, ' · npm · runs 100% local'],
  // final CTA: no brew cask ships — real npm install
  [/data-copy="brew install --cask specship"/g, 'data-copy="__INSTALL__"'],
  [/<span class="cmd-accent">brew<\/span> install --cask specship/g,
   '<span class="cmd-accent">npm</span> i -g @specship/specship'],
  // final CTA primary → quickstart; secondary "live app" → docs
  [/<a class="btn btn-primary btn-lg" href="#">/g, '<a class="btn btn-primary btn-lg" href="__BASE__/getting-started/quickstart">'],
  [/<a class="btn btn-secondary btn-lg" href="SpecShip\.html">Explore the live app<\/a>/g,
   '<a class="btn btn-secondary btn-lg" href="__BASE__/getting-started/quickstart">Read the docs</a>'],
  // footer: real destinations (no live-demo/Discord/Privacy/Contact pages exist)
  [/<a href="SpecShip\.html">Live demo<\/a>/g, '<a href="__BASE__/getting-started/quickstart">Quickstart</a>'],
  [/<a href="#">Documentation<\/a>/g, '<a href="__BASE__/getting-started/quickstart">Documentation</a>'],
  [/<a href="#">CLI reference<\/a>/g, '<a href="__BASE__/claude-code/overview">Claude Code</a>'],
  [/<a href="#">Changelog<\/a>/g, '<a href="__REPO__/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Changelog</a>'],
  [/<a href="#">GitHub<\/a>/g, '<a href="__REPO__" target="_blank" rel="noopener">GitHub</a>'],
  [/<a href="#">Discord<\/a>/g, '<a href="__REPO__/discussions" target="_blank" rel="noopener">Discussions</a>'],
  [/<a href="#">Privacy<\/a>/g, '<a href="__REPO__/issues" target="_blank" rel="noopener">Issues</a>'],
  [/<a href="#">Contact<\/a>/g, '<a href="__NPM__" target="_blank" rel="noopener">npm</a>'],
  // generic catch-alls for any remaining design-internal "live app" links
  [/href="SpecShip\.html"/g, 'href="__BASE__/getting-started/quickstart"'],
  [/(Open|Explore) the live app/g, 'Read the docs'],
  // surface the reflection engine / Improvements (shipped 0.9.0; design predates it) — REQ-LANDING-002.A2
  [/<h3>Optimization tips<\/h3>\s*<p>Actionable, priced suggestions: which reads to replace, where the cache is cold, when Sonnet beats Opus\.<\/p>/,
   '<h3>Self-improving</h3>\n        <p>SpecShip mines your transcripts for recurring patterns and proposes durable fixes — memory rules, skills, hooks — that you preview and apply in one click on the Improvements page.</p>'],
  // inject a light/dark toggle into the nav (the design had none) — REQ-LANDING-004
  [/<div class="nav-right">/,
   '<div class="nav-right">\n      <button class="theme-btn" type="button" aria-label="Toggle theme" id="themeBtn"><svg class="sun" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button>'],
];
for (const [re, to] of subs) body = body.replace(re, to);

// 4) Write outputs -----------------------------------------------------------
const css =
  fs.readFileSync(path.join(here, 'styles.css'), 'utf8') +
  '\n\n/* ---- landing ---- */\n' +
  fs.readFileSync(path.join(here, 'landing.css'), 'utf8') +
  `\n\n/* ---- use the site's bundled Geist (fontsource), not a Google Fonts request ---- */
:root{ --font-ui:"Geist Variable","Geist",system-ui,-apple-system,sans-serif; }

/* ---- a11y: lift muted/faint text to WCAG AA contrast in both themes (REQ-LANDING-005) ---- */
:root{ --text-muted:#868fa0; --text-faint:#828b9c; }
[data-theme="light"]{ --text-muted:#5b6473; --text-faint:#5f6878; --node-route:#0a6e63; }

/* ---- nav theme toggle (added; design had none) ---- */
.theme-btn{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:var(--r-sm); border:1px solid var(--border-subtle); background:transparent; color:var(--text-secondary); cursor:pointer; transition:border-color .12s,color .12s; }
.theme-btn:hover{ border-color:var(--border-strong); color:var(--text-primary); }
.theme-btn .moon{ display:none; } .theme-btn .sun{ display:inline; }
[data-theme="light"] .theme-btn .sun{ display:none; } [data-theme="light"] .theme-btn .moon{ display:inline; }
@media (max-width:860px){ .theme-btn{ display:none; } }\n`;
fs.mkdirSync(path.join(root, 'src/styles'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/styles/landing.css'), css);
fs.writeFileSync(path.join(root, 'src/pages/_landing-body.html'), body + '\n');

// report
const omLeft = (body.match(/data-om-id/g) || []).length;
const hrefHash = (body.match(/href="#"/g) || []).length;
console.log('landing.css bytes:', css.length);
console.log('_landing-body.html bytes:', body.length);
console.log('residual data-om-id:', omLeft, '| residual href="#":', hrefHash);
// committed runtime (reveal/observer/copy/counters) — imported ?raw by index.astro
fs.mkdirSync(path.join(root, 'src/scripts'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/scripts/landing-runtime.js'), designScript + '\n');
console.log('landing-runtime.js bytes:', designScript.length);
