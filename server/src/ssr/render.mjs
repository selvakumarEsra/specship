/**
 * Server-side render functions for the lean SSR dashboard (REQ-DASHLEAN-004).
 *
 * Pure functions: (data) -> HTML string. No client framework, no hydration —
 * the page's content is fully present in the returned HTML (REQ-DASHLEAN-004.A1),
 * and the only client JS is the small `islands.js` enhancement layer
 * (REQ-DASHLEAN-004.A2). Uses the shared global design tokens/classes from
 * `public/app.css` so the look matches the existing dashboard (REQ-DASHLEAN-005).
 */
import { escapeHtml, stripSpecMarkers, renderMd } from './md.mjs';

/** The kept read-only page set (REQ-DASHLEAN-006). Dropped routes are absent. */
export const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/specs', label: 'Specs' },
  { href: '/graph', label: 'Graph' },
  { href: '/drift', label: 'Drift' },
  { href: '/specship-impact', label: 'Impact' },
  { href: '/maintainability', label: 'Maintainability' },
  { href: '/domain', label: 'Domain' },
  { href: '/mcp', label: 'MCP' },
  { href: '/memory', label: 'Memory' },
  { href: '/improvements', label: 'Improvements' },
  { href: '/compare', label: 'Compare' },
  { href: '/costs', label: 'Costs' },
  { href: '/heatmap', label: 'Heatmap' },
  { href: '/runs', label: 'Runs' },
  { href: '/sessions', label: 'Sessions' },
];

/** The full HTML document: sidebar + top bar + page slot. */
export function layout({ title, activeHref, body }) {
  const nav = NAV.map(
    (n) =>
      `<a class="nav-link${n.href === activeHref ? ' active' : ''}" href="${n.href}" data-nav>${escapeHtml(n.label)}</a>`,
  ).join('');
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · SpecShip</title>
<link rel="stylesheet" href="/app.css">
<style>
  .shell{display:flex;min-height:100vh;background:var(--bg-canvas);color:var(--text-primary)}
  .sidebar{width:200px;flex-shrink:0;border-right:1px solid var(--border-subtle,rgba(255,255,255,.08));padding:16px 10px;display:flex;flex-direction:column;gap:2px}
  .brand{font-weight:700;font-size:14px;padding:6px 10px 12px}
  .nav-link{display:block;padding:7px 10px;border-radius:7px;color:var(--text-muted,#9aa);text-decoration:none;font-size:13px}
  .nav-link:hover{background:rgba(255,255,255,.05);color:var(--text-primary)}
  .nav-link.active{background:rgba(255,255,255,.08);color:var(--accent);font-weight:600}
  .main{flex:1;min-width:0;display:flex;flex-direction:column}
  .topbar{height:48px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.08));display:flex;align-items:center;padding:0 20px;font-size:12px;color:var(--text-muted,#9aa)}
  .page{padding:22px;overflow:auto}
  .ro-badge{margin-left:auto;font-size:11px;color:var(--text-muted,#9aa);border:1px solid var(--border-subtle,rgba(255,255,255,.12));padding:2px 8px;border-radius:999px}
</style>
</head>
<body>
<div class="shell">
  <nav class="sidebar" aria-label="Primary">
    <div class="brand">SpecShip</div>
    ${nav}
  </nav>
  <div class="main">
    <header class="topbar"><span>${escapeHtml(title)}</span><span class="ro-badge" title="This dashboard is read-only">read-only</span></header>
    <main class="page" id="page">${body}</main>
  </div>
</div>
<script type="module" src="/islands.js"></script>
</body>
</html>`;
}

function stateDotColor(state) {
  const map = {
    verified: 'var(--state-verified,#3fb950)', implemented: 'var(--state-implemented,#58a6ff)',
    drifted: 'var(--state-drifted,#d29922)', broken: 'var(--state-broken,#f85149)',
    orphaned: 'var(--state-orphaned,#f85149)',
  };
  return map[state] || 'var(--text-muted,#9aa)';
}

/** REQ-DASHLEAN-006: the Specs list, grouped by source file. */
export function renderSpecs(specs) {
  const real = (specs || []).filter((s) => s.kind !== 'brief');
  if (!real.length) {
    return `<div class="page-head"><h1>Specs</h1></div><p class="muted">No specs indexed yet. Run <code class="mono">specship sync</code>.</p>`;
  }
  const groups = new Map();
  for (const s of real) {
    const key = s.sourcePath || '(unknown)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const sections = [...groups.entries()].map(([path, rows]) => {
    const items = rows
      .map(
        (s) => `<a class="req-row" href="/specs/${encodeURIComponent(s.id)}" data-nav>
        <span class="pill-dot" style="background:${stateDotColor(s.linkState)}"></span>
        <span class="grow" style="min-width:0">
          <span class="mono req-id">${escapeHtml(s.id)}</span>
          <span class="muted req-title">${escapeHtml(stripSpecMarkers(s.title || '').trim())}</span>
        </span>
      </a>`,
      )
      .join('');
    return `<section class="spec-group"><h2 class="group-title mono">${escapeHtml(path.replace(/^specs\//, ''))}</h2>${items}</section>`;
  });
  return `<div class="page-head"><h1>Specs</h1><span class="muted">${real.length} requirements</span></div>
  <div class="spec-tree">${sections.join('')}</div>
  <style>
    .page-head{display:flex;align-items:baseline;gap:10px;margin-bottom:16px}
    .page-head h1{font-size:18px;margin:0}
    .spec-group{margin-bottom:18px}
    .group-title{font-size:11px;color:var(--text-muted,#9aa);letter-spacing:.5px;margin:0 0 6px}
    .req-row{display:flex;gap:8px;align-items:center;padding:7px 8px;border-radius:7px;text-decoration:none}
    .req-row:hover{background:rgba(255,255,255,.05)}
    .pill-dot{width:8px;height:8px;border-radius:999px;flex-shrink:0}
    .req-id{font-size:12px;color:var(--node-spec,#a371f7);margin-right:8px}
    .req-title{font-size:12.5px}
  </style>`;
}

/** REQ-DASHLEAN-003 + 006: read-only spec detail — rendered markdown, no editor. */
export function renderSpecDetail(detail) {
  const spec = detail?.spec || detail;
  if (!spec) return `<div class="page-head"><h1>Spec not found</h1></div><p><a href="/specs" data-nav>← Back to specs</a></p>`;
  const links = detail?.links || [];
  const bodyHtml = renderMd(spec.body || '');
  const linkRows = links.length
    ? `<h2>Linked code</h2><ul class="links">${links
        .map((l) => `<li><span class="pill-dot" style="background:${stateDotColor(l.state)}"></span> <span class="mono">${escapeHtml(l.targetName || l.target || '')}</span> <span class="muted">${escapeHtml(l.state || '')}</span></li>`)
        .join('')}</ul>`
    : '';
  return `<div class="page-head">
    <a class="muted back" href="/specs" data-nav>← Specs</a>
    <span class="mono" style="color:var(--node-spec,#a371f7)">${escapeHtml(spec.id)}</span>
    <span class="pill">${escapeHtml(spec.kind || '')}</span>
    ${spec.priority ? `<span class="pill">${escapeHtml(spec.priority)}</span>` : ''}
  </div>
  <h1 class="spec-title">${escapeHtml(stripSpecMarkers(spec.title || '').trim())}</h1>
  <article class="spec-body">${bodyHtml}</article>
  ${linkRows}
  <div class="actions"><a class="btn" href="/graph?focus=spec:${encodeURIComponent(spec.id)}" data-nav>Show in graph</a></div>
  <style>
    .page-head{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}
    .page-head .back{text-decoration:none;font-size:12px}
    .spec-title{font-size:19px;margin:0 0 14px;max-width:820px}
    .pill{font-size:11px;border:1px solid var(--border-subtle,rgba(255,255,255,.15));padding:1px 8px;border-radius:999px;color:var(--text-muted,#9aa)}
    .spec-body{max-width:820px;line-height:1.6}
    .spec-body h1{font-size:20px}.spec-body h2{font-size:15px;margin-top:20px}
    .spec-body code{background:var(--bg-elevated,rgba(255,255,255,.06));padding:1px 5px;border-radius:5px;font-size:12.5px}
    .spec-body pre{background:var(--bg-elevated,rgba(255,255,255,.06));padding:12px;border-radius:8px;overflow:auto}
    .links{list-style:none;padding:0}.links li{display:flex;align-items:center;gap:8px;padding:4px 0}
    .actions{margin-top:20px}
    .btn{display:inline-block;padding:6px 12px;border-radius:7px;border:1px solid var(--border-subtle,rgba(255,255,255,.15));color:var(--text-primary);text-decoration:none;font-size:12.5px}
  </style>`;
}

// --- shared building blocks -------------------------------------------------

function pageHead(title, meta) {
  return `<div class="page-head"><h1>${escapeHtml(title)}</h1>${meta ? `<span class="muted">${escapeHtml(meta)}</span>` : ''}</div>`;
}

/** A grid of KPI tiles: [{ label, value, sub? }]. */
function statTiles(tiles) {
  const cells = tiles
    .map(
      (t) => `<div class="stat-tile">
      <div class="stat-value">${escapeHtml(String(t.value))}</div>
      <div class="stat-label">${escapeHtml(t.label)}</div>
      ${t.sub ? `<div class="stat-sub muted">${escapeHtml(t.sub)}</div>` : ''}
    </div>`,
    )
    .join('');
  return `<div class="stat-grid">${cells}</div>`;
}

/** A simple read-only table: cols = [labels], rows = [[cell,...]] (cells are pre-escaped HTML). */
function table(cols, rows) {
  if (!rows.length) return `<p class="muted">Nothing to show.</p>`;
  const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="ro-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const SHARED_CSS = `<style>
  .page-head{display:flex;align-items:baseline;gap:10px;margin-bottom:16px}
  .page-head h1{font-size:18px;margin:0}
  .stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:22px}
  .stat-tile{border:1px solid var(--border-subtle,rgba(255,255,255,.1));border-radius:10px;padding:14px 16px;background:var(--bg-elevated,rgba(255,255,255,.03))}
  .stat-value{font-size:22px;font-weight:700}
  .stat-label{font-size:12px;color:var(--text-muted,#9aa);margin-top:2px}
  .stat-sub{font-size:11px;margin-top:4px}
  .ro-table{width:100%;border-collapse:collapse;font-size:12.5px}
  .ro-table th{text-align:left;color:var(--text-muted,#9aa);font-weight:600;padding:6px 10px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.1))}
  .ro-table td{padding:6px 10px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.05))}
  .pill-dot{display:inline-block;width:8px;height:8px;border-radius:999px;margin-right:6px;vertical-align:middle}
  .sec-title{font-size:13px;margin:22px 0 8px}
</style>`;

// --- ported pages -----------------------------------------------------------

/** REQ-DASHLEAN-006: the landing dashboard — index + Claude Code KPIs. */
export function renderDashboard(status, stats) {
  const s = status || {};
  const st = stats || {};
  const cost = st.lastSessionCost?.value;
  const tiles = statTiles([
    { label: 'Nodes', value: (s.nodeCount ?? 0).toLocaleString?.() ?? s.nodeCount ?? 0 },
    { label: 'Edges', value: (s.edgeCount ?? 0).toLocaleString?.() ?? s.edgeCount ?? 0 },
    { label: 'Files', value: (s.fileCount ?? 0).toLocaleString?.() ?? s.fileCount ?? 0 },
    { label: 'Drifted links', value: s.drift ?? 0 },
    { label: 'Last session cost', value: cost != null ? '$' + Number(cost).toFixed(2) : '—' },
    { label: 'Tool calls', value: st.toolCalls?.value != null ? Number(st.toolCalls.value).toLocaleString() : '—' },
  ]);
  const kinds = Object.entries(s.nodesByKind || {}).sort((a, b) => b[1] - a[1]);
  const kindRows = kinds.map(([k, n]) => [escapeHtml(k), String(n)]);
  return `${pageHead('Dashboard', s.backend ? 'backend: ' + s.backend : '')}
  ${tiles}
  <h2 class="sec-title">Nodes by kind</h2>
  ${table(['Kind', 'Count'], kindRows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: the drift queue — links whose code moved off their spec. */
export function renderDrift(drift) {
  const links = (drift?.links || []).filter((l) => ['drifted', 'broken', 'orphaned'].includes(l.state));
  const rows = links.map((l) => [
    `<a class="mono" href="/specs/${encodeURIComponent(l.specId)}" data-nav style="color:var(--node-spec,#a371f7)">${escapeHtml(l.specId)}</a>`,
    `<span class="mono">${escapeHtml(l.targetQualifiedName || '')}</span>`,
    `<span class="muted">${escapeHtml(l.targetFilePath || '')}</span>`,
    escapeHtml(l.kind || ''),
    `<span class="pill-dot" style="background:${stateDotColor(l.state)}"></span>${escapeHtml(l.state || '')}`,
  ]);
  return `${pageHead('Drift', `${links.length} out of alignment`)}
  ${table(['Spec', 'Target', 'File', 'Kind', 'State'], rows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: maintainability — oversized symbols, god files, cycles, dead code. */
export function renderMaintainability(m) {
  const d = m || {};
  const tiles = statTiles([
    { label: 'Oversized', value: (d.oversized || []).length },
    { label: 'God files', value: (d.godFiles || []).length },
    { label: 'Cycles', value: (d.cycles || []).length },
    { label: 'Dead code', value: (d.deadCode || []).length },
  ]);
  const oversized = table(
    ['Symbol', 'Lines', 'File'],
    (d.oversized || []).slice(0, 50).map((o) => [
      `<span class="mono">${escapeHtml(o.qualifiedName || o.name || '')}</span>`,
      String(o.lines ?? ''),
      `<span class="muted">${escapeHtml(o.filePath || '')}</span>`,
    ]),
  );
  const gods = table(
    ['File', 'Symbols'],
    (d.godFiles || []).slice(0, 50).map((g) => [`<span class="mono">${escapeHtml(g.filePath || '')}</span>`, String(g.symbolCount ?? '')]),
  );
  return `${pageHead('Maintainability', d.clean ? 'clean' : '')}
  ${tiles}
  <h2 class="sec-title">Oversized symbols</h2>${oversized}
  <h2 class="sec-title">God files</h2>${gods}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: domain knowledge — confirmed facts by type + coverage. */
export function renderDomain(d) {
  const byType = d?.factsByType || {};
  const cov = d?.coverage || {};
  const tiles = statTiles([
    { label: 'Documented', value: cov.documented ?? 0 },
    { label: 'Gaps', value: cov.gaps ?? 0 },
    ...Object.entries(byType).map(([t, arr]) => ({ label: t, value: Array.isArray(arr) ? arr.length : arr })),
  ]);
  const groups = Object.entries(byType)
    .filter(([, arr]) => Array.isArray(arr) && arr.length)
    .map(([t, arr]) => {
      const rows = arr.slice(0, 40).map((f) => [
        `<span class="mono">${escapeHtml(f.id || f.name || '')}</span>`,
        `<span class="muted">${escapeHtml((f.title || f.body || '').slice(0, 120))}</span>`,
      ]);
      return `<h2 class="sec-title">${escapeHtml(t)}</h2>${table(['Fact', 'Summary'], rows)}`;
    })
    .join('');
  return `${pageHead('Domain', `${cov.documented ?? 0} documented · ${cov.gaps ?? 0} gaps`)}
  ${tiles}${groups}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: memory — CLAUDE.md instruction/note footprint. */
export function renderMemory(m) {
  const d = m || {};
  const tiles = statTiles([
    { label: 'Total tokens', value: (d.totalTokens ?? 0).toLocaleString?.() ?? d.totalTokens ?? 0 },
    { label: 'Instructions', value: d.instructionCount ?? 0 },
    { label: 'Notes', value: d.noteCount ?? 0 },
    { label: 'Imports', value: d.importCount ?? 0 },
  ]);
  const rows = (d.files || []).map((f) => [
    escapeHtml(f.name || ''),
    escapeHtml(f.level || ''),
    escapeHtml(f.type || ''),
    String(f.tokens ?? ''),
    `<span class="muted mono">${escapeHtml(f.path || '')}</span>`,
  ]);
  return `${pageHead('Memory', `${(d.totalTokens ?? 0).toLocaleString?.() ?? d.totalTokens} tokens`)}
  ${tiles}
  ${table(['File', 'Level', 'Type', 'Tokens', 'Path'], rows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: improvements — reflection proposals (memory rules, tips). */
export function renderImprovements(reflect) {
  const proposals = reflect?.proposals || [];
  const rows = proposals.slice(0, 100).map((p) => [
    `<span class="pill-dot" style="background:${p.severity === 'high' ? 'var(--state-broken,#f85149)' : p.severity === 'medium' ? 'var(--state-drifted,#d29922)' : 'var(--text-muted,#9aa)'}"></span>${escapeHtml(p.severity || '')}`,
    escapeHtml((p.type || '').replace(/_/g, ' ')),
    `<strong>${escapeHtml(p.title || '')}</strong><br><span class="muted">${escapeHtml((p.body || '').slice(0, 160))}</span>`,
  ]);
  return `${pageHead('Improvements', `${proposals.length} proposals`)}
  ${table(['Severity', 'Type', 'Suggestion'], rows)}
  ${SHARED_CSS}`;
}

/** WORKFLOW-ETA-DOC: compact duration for estimate ranges. */
function fmtDur(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * REQ-ETA-005: human text for a run's estimate — a range for running runs,
 * "waiting on you" for paused ones, empty string otherwise (absence, never a
 * placeholder number).
 */
export function etaText(run) {
  const eta = run?.eta;
  if (!eta) return '';
  if (eta.available) {
    const low = fmtDur(eta.lowMs);
    const high = fmtDur(eta.highMs);
    return low === high ? `≈${low} left` : `≈${low}–${high} left`;
  }
  if (eta.reason === 'paused') {
    return eta.waitingSinceMs
      ? `waiting on you since ${new Date(eta.waitingSinceMs).toLocaleTimeString()}`
      : 'waiting on you';
  }
  return '';
}

/** REQ-DASHLEAN-006: workflow runs — read-only run history. */
export function renderRuns(data) {
  const runs = data?.runs || [];
  const rows = runs.slice(0, 100).map((r) => [
    `<a class="mono" href="/runs/${encodeURIComponent(r.id)}" data-nav>${escapeHtml(r.workflowName || '')}</a>`,
    escapeHtml(r.status || ''),
    `<span class="muted">${escapeHtml(String(r.startedAt || r.createdAt || ''))}</span>`,
    `<span class="muted">${escapeHtml(etaText(r))}</span>`,
  ]);
  return `${pageHead('Runs', `${runs.length} runs`)}
  ${table(['Workflow', 'Status', 'Started', 'ETA'], rows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: a single workflow run — status + its event log. */
export function renderRunDetail(data) {
  const run = data?.run || {};
  const events = data?.events || [];
  const remaining = etaText(run);
  const meta = statTiles([
    { label: 'Workflow', value: run.workflowName || '—' },
    { label: 'Status', value: run.status || '—' },
    { label: 'Events', value: events.length },
    ...(remaining ? [{ label: 'Remaining', value: remaining }] : []),
  ]);
  const rows = events.slice(0, 200).map((e) => [
    `<span class="muted">${escapeHtml(String(e.ts || e.timestamp || e.at || ''))}</span>`,
    `<span class="mono">${escapeHtml(e.type || e.kind || e.event || '')}</span>`,
    `<span class="muted">${escapeHtml(JSON.stringify(e.data ?? e.payload ?? '').slice(0, 100))}</span>`,
  ]);
  return `${pageHead('Run')}
  <p><a class="muted" href="/runs" data-nav>← Runs</a></p>
  ${meta}
  <h2 class="sec-title">Events</h2>${table(['Time', 'Type', 'Detail'], rows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: Claude Code sessions — read-only transcript index. */
export function renderSessions(data) {
  const sessions = data?.sessions || [];
  const rows = sessions.slice(0, 100).map((s) => [
    `<a class="mono" href="/sessions/${encodeURIComponent(s.id)}" data-nav>${escapeHtml((s.project_path || '').replace(/^.*\//, '') || s.id)}</a>`,
    `<span class="muted">${escapeHtml(String(s.started_at || ''))}</span>`,
    String(s.prompt_count ?? ''),
    s.total_cost_usd != null ? '$' + Number(s.total_cost_usd).toFixed(2) : '',
    `<span class="mono">${escapeHtml(s.last_model || '')}</span>`,
  ]);
  return `${pageHead('Sessions', `${sessions.length} sessions`)}
  ${table(['Project', 'Started', 'Prompts', 'Cost', 'Model'], rows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: a single Claude Code session — totals + prompts + tool calls. */
export function renderSessionDetail(data) {
  const s = data?.session || {};
  const prompts = data?.prompts || [];
  const toolCalls = data?.toolCalls || [];
  const tiles = statTiles([
    { label: 'Prompts', value: s.prompt_count ?? prompts.length },
    { label: 'Tool calls', value: Array.isArray(toolCalls) ? toolCalls.length : toolCalls ?? 0 },
    { label: 'Cost', value: s.total_cost_usd != null ? '$' + Number(s.total_cost_usd).toFixed(2) : '—' },
    { label: 'Model', value: s.last_model || '—' },
  ]);
  const rows = prompts.slice(0, 100).map((p) => [
    `<span class="muted">${escapeHtml(String(p.timestamp || p.ts || ''))}</span>`,
    `<span class="muted">${escapeHtml(String(p.text || p.content || '').replace(/\s+/g, ' ').slice(0, 140))}</span>`,
  ]);
  return `${pageHead('Session')}
  <p><a class="muted" href="/sessions" data-nav>← Sessions</a></p>
  ${tiles}
  <h2 class="sec-title">Prompts</h2>${table(['Time', 'Prompt'], rows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: MCP servers — connected servers and their tools. */
export function renderMcp(servers) {
  const list = servers && servers.length ? servers : MCP_SEED;
  const cards = list
    .map((s) => {
      const tools = (s.tools || [])
        .map((t) => `<li><span class="mono">${escapeHtml(t.name || '')}</span> <span class="muted">${escapeHtml((t.desc || '').slice(0, 90))}</span></li>`)
        .join('');
      return `<div class="mcp-card">
      <div class="mcp-head">
        <span class="pill-dot" style="background:${s.state === 'running' ? 'var(--state-verified,#3fb950)' : 'var(--text-muted,#9aa)'}"></span>
        <strong class="mono">${escapeHtml(s.name || '')}</strong>
        <span class="pill">${escapeHtml(s.scope || '')}</span>
        <span class="pill">${escapeHtml(s.state || '')}</span>
        <span class="muted" style="margin-left:auto">${escapeHtml(s.transport || '')} · v${escapeHtml(s.version || '?')}</span>
      </div>
      <div class="muted mcp-desc">${escapeHtml(s.desc || '')}</div>
      <ul class="mcp-tools">${tools}</ul>
    </div>`;
    })
    .join('');
  return `${pageHead('MCP', `${list.length} server${list.length === 1 ? '' : 's'}`)}
  <div class="mcp-list">${cards}</div>
  ${SHARED_CSS}
  <style>
    .mcp-card{border:1px solid var(--border-subtle,rgba(255,255,255,.1));border-radius:10px;padding:14px 16px;margin-bottom:12px;background:var(--bg-elevated,rgba(255,255,255,.03))}
    .mcp-head{display:flex;align-items:center;gap:8px;font-size:14px}
    .mcp-desc{font-size:12.5px;margin:6px 0}
    .mcp-tools{list-style:none;padding:0;margin:8px 0 0;font-size:12.5px}
    .mcp-tools li{padding:3px 0}
  </style>`;
}

/** Fallback MCP data — the SpecShip server (mirrors the Angular page's seed). */
const MCP_SEED = [
  {
    id: 'specship', name: 'specship', scope: 'project', state: 'running',
    version: '0.11.9', transport: 'stdio',
    desc: "SpecShip's own server — structural code intelligence over the spec↔code graph.",
    tools: [
      { name: 'specship_explore', desc: 'Verbatim source of the relevant symbols, grouped by file — the structural alternative to re-reading.' },
      { name: 'specship_search', desc: 'Indexed structural search across the graph for definitions and references.' },
      { name: 'specship_node', desc: 'One symbol in full — signature, callers/callees trail, and body.' },
      { name: 'specship_spec', desc: 'Fetch a spec/requirement, its links and drift state, or the lifecycle funnel.' },
      { name: 'specship_impact', desc: 'What changing a symbol would break — its impact radius.' },
    ],
  },
];

/** REQ-DASHLEAN-006: costs — Claude Code spend by model + top prompts. */
export function renderCosts(data) {
  const d = data || {};
  const tiles = statTiles([
    { label: 'Total spend', value: d.total != null ? '$' + Number(d.total).toFixed(2) : '—' },
    { label: 'WoW delta', value: d.wowDelta != null ? (d.wowDelta >= 0 ? '+' : '') + (Number(d.wowDelta) * 100).toFixed(0) + '%' : '—' },
  ]);
  const byModel = table(
    ['Model', 'Prompts', 'Cost'],
    (d.byModel || []).map((m) => [`<span class="mono">${escapeHtml(m.model || '')}</span>`, String(m.prompts ?? ''), '$' + Number(m.cost ?? 0).toFixed(2)]),
  );
  return `${pageHead('Costs')}
  ${tiles}
  <h2 class="sec-title">By model</h2>${byModel}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: SpecShip impact — tokens saved vs spent, by tool. */
export function renderImpact(data) {
  const d = data || {};
  const tiles = statTiles([
    { label: 'Tokens saved', value: (d.savedTokens ?? 0).toLocaleString() },
    { label: 'Cost saved', value: d.savedCostUsd != null ? '$' + Number(d.savedCostUsd).toFixed(2) : '—' },
    { label: 'Net tokens', value: (d.netTokens ?? 0).toLocaleString() },
    { label: 'SpecShip calls', value: (d.totalSpecshipCalls ?? 0).toLocaleString() },
  ]);
  const byTool = table(
    ['Tool', 'Calls', 'Spend tok', 'Saved tok'],
    (d.byTool || []).map((t) => [
      `<span class="mono">${escapeHtml(t.tool || '')}</span>`,
      String(t.calls ?? ''),
      Number(t.spendTokens ?? 0).toLocaleString(),
      Number(t.savedTokens ?? 0).toLocaleString(),
    ]),
  );
  return `${pageHead('SpecShip impact')}
  ${tiles}
  <h2 class="sec-title">By tool</h2>${byTool}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: compare — per-project Claude Code usage side by side. */
export function renderCompare(data) {
  const projects = (data?.projects || []).slice().sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  const rows = projects.slice(0, 100).map((p) => [
    `<span class="mono">${escapeHtml((p.name || p.path || '').replace(/^.*\//, ''))}</span>`,
    String(p.sessions ?? ''),
    String(p.prompts ?? ''),
    p.cost != null ? '$' + Number(p.cost).toFixed(2) : '',
    p.cacheHit != null ? (Number(p.cacheHit) * 100).toFixed(0) + '%' : '',
  ]);
  return `${pageHead('Compare', `${projects.length} projects`)}
  ${table(['Project', 'Sessions', 'Prompts', 'Cost', 'Cache hit'], rows)}
  ${SHARED_CSS}`;
}

/** REQ-DASHLEAN-006: heatmap — Claude Code file-touch intensity (server-rendered). */
export function renderHeatmap(data) {
  const files = (data?.files || []).slice(0, 60);
  const max = files.reduce((m, f) => Math.max(m, f.calls || 0), 1);
  const rows = files.map((f) => {
    const intensity = (f.calls || 0) / max;
    const bg = `rgba(88,166,255,${(0.12 + intensity * 0.78).toFixed(3)})`;
    const trend = (f.trend || [])
      .map((v) => {
        const h = Math.max(2, Math.round((v / Math.max(1, Math.max(...(f.trend || [1])))) * 16));
        return `<span class="spark" style="height:${h}px"></span>`;
      })
      .join('');
    return `<div class="hm-row">
      <span class="hm-cell" style="background:${bg}" title="${escapeHtml(String(f.calls || 0))} calls"></span>
      <span class="hm-name mono muted">${escapeHtml((f.path || '').replace(/^.*\/([^/]+\/[^/]+)$/, '$1'))}</span>
      <span class="hm-calls">${f.calls || 0}</span>
      <span class="hm-trend">${trend}</span>
    </div>`;
  });
  return `${pageHead('Heatmap', `${files.length} hottest files`)}
  <div class="hm-list">${rows.join('')}</div>
  ${SHARED_CSS}
  <style>
    .hm-row{display:flex;align-items:center;gap:10px;padding:3px 0}
    .hm-cell{width:26px;height:14px;border-radius:3px;flex-shrink:0}
    .hm-name{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .hm-calls{width:44px;text-align:right;font-size:12px}
    .hm-trend{display:flex;align-items:flex-end;gap:2px;width:80px;height:18px}
    .hm-trend .spark{width:8px;background:var(--accent,#58a6ff);border-radius:1px;opacity:.7}
  </style>`;
}

/** REQ-DASHLEAN-006: graph — interactive node-link view. Data is embedded and
 *  drawn by the `/islands/graph.js` island (canvas + pan/zoom/hover). */
export function renderGraph(graph) {
  const nodes = (graph?.nodes || []).slice(0, 250);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (graph?.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to)).slice(0, 600);
  const payload = JSON.stringify({ nodes: nodes.map((n) => ({ id: n.id, name: n.name, kind: n.kind, degree: n.degree })), edges });
  return `${pageHead('Graph', `${graph?.shown ?? nodes.length} of ${graph?.total ?? nodes.length} nodes`)}
  <div id="graph-host"><canvas id="graph-canvas"></canvas>
    <div class="graph-hint muted">drag to pan · scroll to zoom · hover a node</div>
    <div id="graph-tip" class="graph-tip"></div>
  </div>
  <script type="application/json" id="graph-data">${payload.replace(/</g, '\\u003c')}</script>
  <script type="module" src="/islands/graph.js"></script>
  ${SHARED_CSS}
  <style>
    #graph-host{position:relative;height:72vh;border:1px solid var(--border-subtle,rgba(255,255,255,.1));border-radius:10px;overflow:hidden;background:var(--bg-elevated,rgba(255,255,255,.02))}
    #graph-canvas{width:100%;height:100%;display:block;cursor:grab}
    .graph-hint{position:absolute;left:12px;bottom:10px;font-size:11px;pointer-events:none}
    .graph-tip{position:absolute;padding:4px 8px;font-size:11px;background:var(--bg-canvas,#0d1117);border:1px solid var(--border-subtle,rgba(255,255,255,.2));border-radius:6px;pointer-events:none;opacity:0;transform:translate(-50%,-140%);white-space:nowrap}
  </style>`;
}

/** A generic "under migration" placeholder for kept pages not yet ported. */
export function renderStub(label) {
  return `<div class="page-head"><h1>${escapeHtml(label)}</h1></div>
  <p class="muted" style="max-width:640px">This read-only page is part of the SSR migration (REQ-DASHLEAN-006) and has not been ported from the Angular dashboard yet. Its data is already available from the same <code class="mono">/api</code> the Angular app uses.</p>`;
}
