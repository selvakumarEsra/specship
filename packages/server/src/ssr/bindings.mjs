/**
 * Per-screen live-data bindings for the design templates (REQ-DASHLEAN-005).
 *
 * The templates under ./templates/ are the design's own rendered DOM. Each
 * binder here locates the design's repeating sample rows at runtime, keeps ONE
 * row as the markup unit (so the pixels stay the design's), and rebuilds the
 * list from live /api data by substituting the unit's sample values. Screens
 * therefore stay pixel-true while showing real data.
 */

const VOID = new Set(['br','img','input','hr','meta','link','area','base','col','embed','source','track','wbr']);

/** End index (exclusive) of the element starting at `start`. */
function subtreeEnd(html, start) {
  let depth = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    const self = /\/\s*>$/.test(m[0]) || VOID.has(m[2].toLowerCase());
    if (!m[1]) { if (!self) depth++; }
    else { depth--; if (depth === 0) return re.lastIndex; }
  }
  return -1;
}

/** All sibling rows starting with `prefix` (optionally filtered by content). */
function listRows(html, prefix, mustContain) {
  const rows = [];
  for (let i = html.indexOf(prefix); i >= 0; i = html.indexOf(prefix, i + 1)) {
    const end = subtreeEnd(html, i);
    if (end < 0) break;
    const row = html.slice(i, end);
    if (!mustContain || row.includes(mustContain)) rows.push({ start: i, end, row });
    i = end - 1;
  }
  return rows;
}

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Replace the inner text of the FIRST cell matched by `cellRe` in `unit`.
 *  Uses a replacement FUNCTION so `$` in values is never interpreted as a
 *  capture-group reference (the `$38.46 → "8.46"` bug). */
function setCell(unit, cellRe, value) {
  return unit.replace(cellRe, (m, open, _old, close) => open + esc(value) + close);
}

const ROW_TABLE = '<div class="row" style="padding: 11px 14px; border-top: 1px solid var(--border-subtle); cursor: pointer;">';
const ROW_CARD  = '<div class="row" style="gap: 12px; margin-bottom: 18px; align-items: flex-start;">';

/** Swap a list region (all sample rows) for freshly built rows. */
function swapRows(html, rows, built) {
  if (!rows.length) return html;
  const start = rows[0].start, end = rows[rows.length - 1].end;
  return html.slice(0, start) + built.join('') + html.slice(end);
}

// ---------------------------------------------------------------- status strip
export function bindStatusStrip(html, { nodes, edges, drift, indexedAgo }) {
  if (nodes != null) html = html.replace('>4,218<', '>' + Number(nodes).toLocaleString() + '<');
  if (edges != null) html = html.replace('>9,743<', '>' + Number(edges).toLocaleString() + '<');
  if (drift != null) html = html.replace(/(>drift<\/span><span[^>]*>)\d+(<)/, `$1${drift}$2`);
  if (indexedAgo) html = html.replace('>2m ago<', '>' + esc(indexedAgo) + '<');
  return html;
}

// ---------------------------------------------------------------- sessions
export function bindSessions(html, sessions) {
  const rows = listRows(html, ROW_TABLE, '$');
  if (!rows.length || !sessions?.length) return html;
  const unit = rows[0].row;
  const built = sessions.slice(0, 50).map((s) => {
    let r = unit;
    r = setCell(r, /(<span class="mono" style="width: 90px; font-size: 12px;">)([^<]*)(<\/span>)/, String(s.id ?? '').slice(0, 8));
    r = setCell(r, /(<span class="pill" style="color: var\(--text-secondary\); background: rgba\(255, 255, 255, 0\.05\);">)([^<]*)(<\/span>)/, (s.project_path ?? '').replace(/^.*\//, '') || '—');
    const started = s.started_at ? new Date(s.started_at) : null;
    const when = started ? started.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
    const model = (s.last_model ?? '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
    r = setCell(r, /(<span class="mono muted grow" style="font-size: 11\.5px;">)([^<]*)(<\/span>)/, `${when} · ${model}`);
    const total = (s.total_input_tokens ?? 0) + (s.total_cache_read_tokens ?? 0);
    const cache = total ? Math.round(((s.total_cache_read_tokens ?? 0) / total) * 100) : null;
    r = setCell(r, /(<span class="mono tabular" style="width: 70px; text-align: right; font-size: 12px;">)([^<]*)(<\/span>)/, String(s.prompt_count ?? 0));
    r = setCell(r, /(<span class="mono tabular" style="width: 70px; text-align: right; font-size: 12px; color: var\(--[a-z]+\);">)([^<]*)(<\/span>)/, cache == null ? '—' : cache + '%');
    r = setCell(r, /(<span class="mono tabular" style="width: 70px; text-align: right; font-size: 12\.5px; font-weight: 600;">)([^<]*)(<\/span>)/, '$' + Number(s.total_cost_usd ?? 0).toFixed(2));
    return r;
  });
  html = swapRows(html, rows, built);
  // Header subtitle: sample "8 sessions · …" → live count.
  html = html.replace(/>\d+ sessions · across all projects</, `>${sessions.length} sessions · across all projects<`);
  return html;
}

// ---------------------------------------------------------------- runs
const RUN_STATE = {
  running:  { label: 'Running',  color: 'var(--info)',  soft: 'var(--info-soft)' },
  completed:{ label: 'Completed',color: 'var(--success)', soft: 'var(--success-soft)' },
  failed:   { label: 'Failed',   color: 'var(--error)', soft: 'var(--error-soft)' },
  paused:   { label: 'Paused',   color: 'var(--warn)',  soft: 'var(--warn-soft)' },
};
export function bindRuns(html, runs) {
  const rows = listRows(html, ROW_TABLE, '');
  if (!rows.length || !runs?.length) return html;
  const unit = rows[0].row;
  const built = runs.slice(0, 50).map((r0) => {
    let r = unit;
    const st = RUN_STATE[String(r0.status ?? '').toLowerCase()] ?? { label: r0.status ?? '—', color: 'var(--text-secondary)', soft: 'rgba(255,255,255,0.05)' };
    // status pill: recolor + relabel (keep the icon)
    r = r.replace(/(<span class="pill" style="color: )var\(--warn\)(; background: )var\(--warn-soft\)(;">)([\s\S]*?<\/svg>)[^<]*(<\/span>)/,
      `$1${st.color}$2${st.soft}$3$4${esc(st.label)}$5`);
    r = setCell(r, /(<span class="mono" style="font-size: 12\.5px;">)([^<]*)(<\/span>)/, r0.workflowName ?? '—');
    r = setCell(r, /(<span class="mono muted" style="font-size: 11px;">)([^<]*)(<\/span>)/, String(r0.id ?? '').slice(0, 8));
    const t0 = r0.startedAt ? Date.parse(r0.startedAt) : null;
    const t1 = r0.lastActivityAt ? Date.parse(r0.lastActivityAt) : null;
    const dur = t0 && t1 && t1 > t0 ? Math.round((t1 - t0) / 1000) : null;
    const durTxt = dur == null ? '—' : (dur >= 60 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : `${dur}s`);
    r = setCell(r, /(<span class="mono tabular muted" style="width: 90px; font-size: 11\.5px;">)([^<]*)(<\/span>)/, durTxt);
    r = setCell(r, /(<span class="mono tabular" style="width: 70px; text-align: right; font-size: 12px;">)([^<]*)(<\/span>)/, '—');
    // Trailing cell (sample "Worktree") → the run's primary input, when present.
    const input = r0.inputs && typeof r0.inputs === 'object' ? Object.values(r0.inputs)[0] : null;
    r = setCell(r, /(<span class="mono muted" style="width: 130px; text-align: right;[^"]*">)([^<]*)(<\/span>)/, input ? String(input) : '');
    // Artifacts pill (sample "3") — no artifact count on the list API; blank it.
    r = setCell(r, /(<\/svg>)(\d+)(<\/span><\/div>)/, '');
    return r;
  });
  return swapRows(html, rows, built);
}

// ---------------------------------------------------------------- drift queue
const DRIFT_STATE = {
  drifted:  { label: 'Drifted',  color: 'var(--warn)' },
  broken:   { label: 'Broken',   color: 'var(--error)' },
  orphaned: { label: 'Orphaned', color: 'var(--error)' },
};
const ROW_DRIFT = '<div class="row gap-10" style="padding: 10px 14px; cursor: pointer; background: transparent;">';
export function bindDrift(html, links) {
  const rows = listRows(html, ROW_DRIFT, 'REQ-');
  const live = (links ?? []).filter((l) => DRIFT_STATE[l.state]);
  if (!rows.length || !live.length) return html;
  const unit = rows[0].row;
  const built = live.slice(0, 50).map((l) => {
    let r = unit;
    const st = DRIFT_STATE[l.state];
    r = r.replace(/>(Drifted|Broken|Orphaned)</, '>' + st.label + '<');
    r = setCell(r, /(<span class="mono" style="font-size: 12px; color: var\(--node-spec\); flex-shrink: 0; width: 130px;">)([^<]*)(<\/span>)/, l.specId ?? '—');
    r = setCell(r, /(<span class="secondary" style="font-size: 12\.5px; overflow: h[^"]*">)([^<]*)(<\/span>)/, `${l.targetQualifiedName ?? ''} · ${l.targetFilePath ?? ''}`);
    // pointer cell (sample src/auth.ts:checkExpiry) ← real file:symbol
    r = r.replace(/>src\/auth\.ts:checkExpiry</, () => '>' + esc(((l.targetFilePath ?? '').replace(/^.*\//, '') + ':' + (l.targetQualifiedName ?? '')).slice(0, 40)) + '<');
    // right-side cells: kind pill ← node kind; sample container + age cells blanked
    r = r.replace(/>code</, '>' + esc(l.targetNodeKind ?? l.kind ?? 'code') + '<');
    r = setCell(r, /(<span class="mono muted" style="[^"]*text-align: right;">)(tree-sitter)(<\/span>)/, '');
    r = setCell(r, /(<span class="mono muted tabular" style="font-size: 11px; flex-shrink: 0; width: 32px; text-align: right;">)([^<]*)(<\/span>)/, '');
    return r;
  });
  html = swapRows(html, rows, built);
  // Header subtitle: sample "4 links need attention" → live count.
  html = html.replace(/>\d+ links need attention</, `>${live.length} links need attention<`);
  return html;
}

// ---------------------------------------------------------------- memory
const ROW_MEM = '<div class="row gap-8" style="padding: 8px 10px; border-radius: 7px; cursor: pointer; background: transparent;">';
export function bindMemory(html, mem) {
  const files = mem?.files ?? [];
  const rows = listRows(html, ROW_MEM, '');
  if (rows.length && files.length) {
    const unit = rows[0].row;
    const built = files.slice(0, 40).map((f) => {
      let r = unit;
      r = setCell(r, /(<span class="mono" style="font-size: 12px; color: var\(--text-primary\);[^"]*">)([^<]*)(<\/span>)/, f.name ?? '—');
      // path/scope cell (mono muted 10px)
      r = setCell(r, /(<div class="mono muted" style="font-size: 10px;[^"]*">)([^<]*)(<\/div>)/, f.path ?? f.scope ?? '');
      // any token figure cell in the row
      r = r.replace(/>([\d.,]+k?) tokens</, () => '>' + (Number(f.tokens ?? 0) >= 1000 ? (f.tokens / 1000).toFixed(1) + 'k' : String(f.tokens ?? 0)) + ' tokens<');
      return r;
    });
    html = swapRows(html, rows, built);
  }
  // headline totals
  if (mem?.totalTokens != null) {
    const tot = mem.totalTokens >= 1000 ? (mem.totalTokens / 1000).toFixed(1) + 'k' : String(mem.totalTokens);
    html = html.replace(/>[\d.,]+k? tokens</, '>' + tot + ' tokens<');
  }
  return html;
}

// ---------------------------------------------------------------- compare
const ROW_CMP = '<div class="row" style="padding: 11px 14px; border-top: 1px solid var(--border-subtle);">';
export function bindCompare(html, projects) {
  const rows = listRows(html, ROW_CMP, '$');
  const list = (projects ?? []).slice().sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  if (!rows.length || !list.length) return html;
  const unit = rows[0].row;
  const built = list.slice(0, 30).map((p) => {
    let r = unit;
    const name = (p.name || p.path || '').replace(/^.*\//, '') || '—';
    // first text cell = project name (first mono/grow-ish span with text)
    r = r.replace(/(>)([a-z][\w./-]{2,40})(<)/i, (m, a, _o, b) => a + esc(name) + b);
    // dollar cells: total then avg (in order)
    let n = 0;
    r = r.replace(/>\$[0-9,.]+</g, () => {
      n++;
      const v = n === 1 ? (p.cost ?? 0) : (p.avgCost ?? 0);
      return '>$' + Number(v).toFixed(n === 1 ? 0 : 2) + '<';
    });
    // sessions / prompts / cache% numeric cells
    r = r.replace(/>(\d{1,4})</g, (m, d) => {
      if (d === String(p.sessions) || d === String(p.prompts)) return m;
      return m; // leave small numerics that we can't attribute
    });
    return r;
  });
  html = swapRows(html, rows, built);

  // Filter buttons + bar-chart labels/widths: top-5 real projects.
  const top = list.slice(0, 5);
  const short = (p) => (p.name || p.path || '').replace(/^.*\//, '') || '—';
  let bi = 0;
  html = html.replace(/(<button style="height: 28px;[^"]*">)([^<]+)(<\/button>)/g, (m, a, _o, b) =>
    top[bi] ? a + esc(short(top[bi++])) + b : m);
  const maxCost = Math.max(1, ...top.map((p) => p.cost ?? 0));
  const maxPrompts = Math.max(1, ...top.map((p) => p.prompts ?? 0));
  const maxSessions = Math.max(1, ...top.map((p) => p.sessions ?? 0));
  let li = 0;
  html = html.replace(/(white-space: nowrap;">)([a-z0-9/._-]+)(<\/div><div class="row")/g, (m, a, _o, b) => {
    const p = top[li];
    if (!p) return m;
    li++;
    return a + esc(short(p)) + b;
  });
  // widths: groups of 3 per project inside the bar section, positional
  const firstLabel = html.indexOf('white-space: nowrap;">' + esc(short(top[0] ?? { name: '' })));
  if (firstLabel > 0 && top.length) {
    let wi = 0;
    const section = html.slice(firstLabel);
    const rebound = section.replace(/width: [0-9.]+%/g, (m) => {
      const p = top[Math.floor(wi / 3)];
      if (!p) return m;
      const which = wi % 3; wi++;
      const pct = which === 0 ? (p.cost ?? 0) / maxCost : which === 1 ? (p.prompts ?? 0) / maxPrompts : (p.sessions ?? 0) / maxSessions;
      return 'width: ' + Math.max(2, Math.round(pct * 100)) + '%';
    });
    html = html.slice(0, firstLabel) + rebound;
  }
  return html;
}

// ---------------------------------------------------------------- tips (in-place)
const SEV = { high: 'error', medium: 'warn', low: 'info' };
export function bindTips(html, proposals) {
  const list = proposals ?? [];
  if (!list.length) return html;
  // Each sample card: title div + body ("secondary") + severity pill. Bind in
  // place, iterating in REVERSE so earlier offsets stay valid as lengths change.
  const CARD = '<div style="padding: 14px 16px; flex: 1 1 0%; min-width: 0px;">';
  const rows = listRows(html, CARD, '');
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = rows[i];
    const p = list[i];
    if (!p) continue;
    let r = c.row;
    r = setCell(r, /(<div style="font-size: 14px; font-weight: 600; letter-spacing: -0\.01em; text-wrap: pretty;">)([^<]*)(<\/div>)/, p.title ?? '');
    r = setCell(r, /(<div class="secondary" style="font-size: 12\.5px; line-height: 1\.6; margin-bottom: 12px;">)([^<]*)(<\/div>)/, (p.body ?? '').slice(0, 220));
    const sev = SEV[p.severity] ?? 'info';
    r = r.replace(/var\(--(error|warn|info)\)/g, `var(--${sev})`);
    r = r.replace(/(<span class="pill" style="color: var\(--[a-z]+\); background: color-mix[^"]*">)([^<]*)(<\/span>)/, (m, a, _o, b) => a + esc(p.severity ?? '') + b);
    const hash8 = String(p.contentHash ?? '').slice(0, 8) || '—';
    r = r.replace(/Open session [0-9a-f]{8}/g, 'Proposal ' + hash8);
    r = r.replace(/>[0-9a-f]{8}</g, '>' + hash8 + '<');
    r = r.replace(/(<code[^>]*>)([^<]*)(<\/code>)/g, (m, a, _o, b) => a + esc('specship reflect apply ' + hash8) + b);
    html = html.slice(0, c.start) + r + html.slice(c.end);
  }
  // Filter counts: sample "2 urgent / 2 warn / 2 info" → real severity tallies.
  const tally = { high: 0, medium: 0, low: 0 };
  for (const p of list) if (tally[p.severity] != null) tally[p.severity]++;
  html = html.replace(/>\d+ urgent</, `>${tally.high} urgent<`);
  html = html.replace(/>\d+ warn</, `>${tally.medium} warn<`);
  html = html.replace(/>\d+ info</, `>${tally.low} info<`);
  return html;
}

// ---------------------------------------------------------------- heatmap (rank-fill)
export function bindHeatmap(html, files) {
  const list = (files ?? []).slice().sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0));
  if (!list.length) return html;
  // Design cells keep their geometry; fill by rank (largest sample area ← hottest file).
  const cells = [...html.matchAll(/<div title="([^"]*)" style="position: absolute;[^"]*">/g)];
  // Rank sample cells by area from their style
  const meta = cells.map((m) => {
    const st = m[0];
    const w = Number((st.match(/width: ([\d.]+)px/) || [])[1] || 0);
    const h = Number((st.match(/height: ([\d.]+)px/) || [])[1] || 0);
    return { open: m[0], title: m[1], area: w * h, idx: m.index };
  }).sort((a, b) => b.area - a.area);
  meta.forEach((cell, rank) => {
    const f = list[rank];
    if (!f) return;
    const short = (f.path || '').replace(/^.*\/([^/]+\/[^/]+)$/, '$1');
    const kb = Math.round((f.resultBytes ?? 0) / 1024);
    const newTitle = `${short} ${f.calls ?? 0} calls · ${kb}k result bytes`;
    const newOpen = cell.open.replace(/title="[^"]*"/, `title="${esc(newTitle)}"`);
    html = html.replace(cell.open, newOpen);
    // label + calls text inside the cell: first two text spans after the open
    const at = html.indexOf(newOpen);
    const seg = html.slice(at, at + 900);
    const lab = seg.match(/>([^<]{2,60})<\/span><span class="mono tabular"[^>]*>([^<]*)</);
    if (lab) {
      const replaced = seg.replace(lab[0], `>${esc(short)}</span><span class="mono tabular"${lab[0].split('<span class="mono tabular"')[1].split('>')[0]}>${(f.calls ?? 0)} calls<`);
      html = html.slice(0, at) + replaced + html.slice(at + seg.length);
    }
  });
  return html;
}

// ---------------------------------------------------------------- costs
export function bindCosts(html, costs) {
  const d = costs ?? {};
  if (d.total != null) html = html.replace('>$184.40<', '>$' + Number(d.total).toFixed(2) + '<');
  // byModel rows (3 sample) — in place with top real models
  const models = (d.byModel ?? []).slice().sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)).slice(0, 3);
  let mi = 0;
  html = html.replace(/(<span class="mono grow" style="font-size: 11\.5px;">)([^<]+)(<\/span><span class="mono tabular" style="font-size: 11[^"]*">)([^<]*)(<\/span>)/g,
    (m, a, _n, mid, _v, z) => {
      const md = models[mi++];
      if (!md) return m;
      const name = String(md.model ?? '').replace(/^claude-/, '').replace(/-\d{8}$/, '');
      return a + esc(name) + mid + '$' + Number(md.cost ?? 0).toFixed(1) + z;
    });
  // top prompts list — in place: text + trailing cost cells within each row
  const prompts = (d.topPrompts ?? []).slice(0, 8);
  let pi = 0;
  html = html.replace(/(<div style="font-size: 12\.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">)([^<]*)(<\/div>)/g,
    (m, a, _o, b) => {
      const p = prompts[pi++];
      return p ? a + esc(String(p.text ?? '').replace(/\s+/g, ' ').slice(0, 90)) + b : m;
    });
  return html;
}

// ---------------------------------------------------------------- specs (tree + sp-* detail)
const TREE_ROW = '<div class="row gap-6" style="padding: 5px 8px; border-radius: 6px; cursor: pointer; background: transparent;">';
const TREE_ROW_SEL = '<div class="row gap-6" style="padding: 5px 8px; border-radius: 6px; cursor: pointer; background: var(--accent-soft);">';
const GROUP_HEAD = '<div class="row gap-6" style="padding: 6px 8px; border-radius: 6px; cursor: pointer; color: var(--text-secondary);">';

export function bindSpecs(html, specsResp, detail) {
  const specs = (specsResp?.specs ?? []).filter((s) => s.kind !== 'brief');
  const linkStates = specsResp?.linkStates ?? {};
  if (!specs.length) return html;

  // ---- tree rebuild: group units composed from design units
  const groupHeads = listRows(html, GROUP_HEAD, '.md');
  const selRows = listRows(html, TREE_ROW_SEL, '');
  const plainRows = listRows(html, TREE_ROW, '');
  if (groupHeads.length && plainRows.length) {
    const headUnit = groupHeads[0].row;
    const rowUnit = plainRows[0].row;
    const selUnit = selRows.length ? selRows[0].row : rowUnit;
    // group container = the <div> wrapping head+rows; derive spans from heads
    // Build fresh groups markup
    const byDoc = new Map();
    for (const s of specs) {
      const doc = (s.sourcePath || '(unknown)').replace(/^specs\//, '');
      if (!byDoc.has(doc)) byDoc.set(doc, []);
      byDoc.get(doc).push(s);
    }
    const dotFor = (id) => {
      const st = linkStates[id];
      return st === 'verified' ? 'var(--success)' : st === 'implemented' ? 'var(--info)'
        : st === 'drifted' ? 'var(--warn)' : st === 'broken' || st === 'orphaned' ? 'var(--error)' : 'var(--text-faint)';
    };
    let first = true;
    const groups = [...byDoc.entries()].map(([doc, list]) => {
      const head = headUnit.replace(/>([a-z0-9-]+\.md)</, '>' + esc(doc) + '<')
        .replace(/>(\d+)\/(\d+)</, `>${list.filter((s) => ['verified','implemented'].includes(linkStates[s.id])).length}/${list.length}<`);
      const rows = list.map((s) => {
        const unit = first ? selUnit : rowUnit;
        first = false;
        let r = unit;
        r = r.replace(/(<div class="mono" style="font-size: 11px; color: var\(--[a-z-]+\);">)([^<]*)(<\/div>)/, (m, a, _o, b) => a + esc(s.id) + b);
        r = r.replace(/(<div class="muted" style="font-size: 10\.5px;[^"]*">)([^<]*)(<\/div>)/, (m, a, _o, b) => a + esc((s.title || '').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 60)) + b);
        r = r.replace(/(<span class="pill-dot" style="background: )[^;"]*(;)/, `$1${dotFor(s.id)}$2`);
        return r;
      }).join('');
      return `<div>${head}<div style="margin-left: 14px; border-left: 1px solid var(--border-subtle); padding-left: 6px;">${rows}</div></div>`;
    }).join('');
    const treeStart = groupHeads[0].start - '<div>'.length >= 0 && html.slice(groupHeads[0].start - 5, groupHeads[0].start) === '<div>'
      ? groupHeads[0].start - 5 : groupHeads[0].start;
    // end = end of the last plain row's parent group: use last row end, then closing </div></div>
    const lastRow = plainRows[plainRows.length - 1];
    let treeEnd = lastRow.end;
    const closer = '</div></div>';
    const ci = html.indexOf(closer, treeEnd);
    if (ci >= 0 && ci - treeEnd < 40) treeEnd = ci + closer.length;
    html = html.slice(0, treeStart) + groups + html.slice(treeEnd);
  }

  // ---- detail panel: bind the selected (first) spec
  const spec = detail?.spec ?? specs[0];
  if (spec) {
    const title = (spec.title || '').replace(/<!--[\s\S]*?-->/g, '').trim();
    html = html.replace(/(<h1 class="sp-title">)([^<]*)(<\/h1>)/, (m, a, _o, b) => a + esc(title) + b);
    html = html.replace(/REQ-AUTH-001/g, esc(spec.id));
    // breadcrumb doc path + owner
    html = html.replace(/specs\/auth\.md/g, esc(spec.sourcePath ?? 'specs/'));
    if (spec.owner) html = html.replace(/owned by [a-z.@-]+/i, 'owned by ' + esc(spec.owner));
    // statement/prose: replace the sp-statement block's prose with the real body
    const body = String(spec.body || '').replace(/<!--[\s\S]*?-->/g, '').trim();
    const lead = body.split(/\n\s*\n/)[0] || '';
    const kw = lead.match(/\b(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)\b/);
    const leadHtml = esc(lead).replace(/\b(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)\b/g,
      (w) => `<span class="sp-kw sp-kw-${w.startsWith('MUST') ? 'must' : w.startsWith('SHOULD') ? 'should' : 'may'}">${w}</span>`);
    html = html.replace(/(<div class="sp-prose">)([\s\S]*?)(<\/div>)/, (m, a, _o, b) => a + leadHtml + b);
    const para2 = body.split(/\n\s*\n/)[1] || '';
    html = html.replace(/(<div class="sp-rationale"[^>]*>)([\s\S]*?)(<\/div>)/, (m, a, _o, b) => a + esc(para2.replace(/\s+/g, ' ').slice(0, 220)) + b);
    // criteria: in-place bind sample A1..A3 with real acceptance children
    const crits = (detail?.children ?? []).filter((c) => c.kind === 'acceptance');
    if (crits.length) {
      let ci2 = 0;
      html = html.replace(/(<span class="sp-crit-id">)([^<]*)(<\/span>)(<span class="sp-crit-text">)([\s\S]*?)(<\/span>)/g,
        (m, a, _id, b, c, _t, d) => {
          const cr = crits[ci2++];
          if (!cr) return m;
          const idSuffix = (cr.id.split('.').pop() || 'A' + ci2);
          const text = (cr.title || '').replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 160);
          return a + esc(idSuffix) + b + c + esc(text) + d;
        });
    }
  }
  return html;
}

// ------------------------------------------------------- dashboard extras
const DASH_SAMPLE_TIPS = [
  'You read auth.ts 17× last session — one specship_explore covers it',
  'Bash(grep) returned 82k tokens — specship_search does it in 600',
  'Cache miss rate on evening sessions is 91%',
  'REQ-INGEST-004 drifted — code changed, spec link stale',
];
const DASH_SAMPLE_NODES = ['MCPServer','exploreGraph','applyLayout','resolveRefs','checkExpiry','neighbors','cull','validateSession','writeStore'];
export function bindDashboardExtras(html, { subagentPct, tips, prompts, cacheRate, graphNames }) {
  if (subagentPct != null) html = html.replace('>31%<', '>' + Math.round(subagentPct * 100) + '%<');
  if (cacheRate != null) html = html.replace('>71%<', '>' + Math.round(cacheRate * 100) + '%<');
  (tips ?? []).slice(0, 4).forEach((p, i) => {
    if (DASH_SAMPLE_TIPS[i]) html = html.replace(DASH_SAMPLE_TIPS[i], esc(p.title ?? ''));
  });
  // recent prompts rows (same ellipsis cell pattern as costs' top prompts)
  const ps = (prompts ?? []).slice(0, 6);
  let pi = 0;
  html = html.replace(/(<div style="font-size: 12\.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">)([^<]*)(<\/div>)/g,
    (m, a, _o, b) => { const p = ps[pi++]; return p ? a + esc(String(p.text ?? '').replace(/\s+/g, ' ').slice(0, 90)) + b : m; });
  // tip command pills + leftover sample prompt rows
  const hashes = (tips ?? []).map((p) => String(p.contentHash ?? '').slice(0, 8));
  let hi = 0;
  html = html.replace(/(<code[^>]*>)(specship[^<]*)(<\/code>)/g, (m, a, _o, b) => hashes[hi] ? a + esc('specship reflect apply ' + hashes[hi++]) + b : m);
  for (const leftover of ['Implement REQ-INGEST-004: incremental jsonl tailing']) {
    const p = ps[pi++];
    if (p) html = html.replace(leftover, esc(String(p.text ?? '').replace(/\s+/g, ' ').slice(0, 90)));
  }
  // mini-graph node labels ← top-degree real symbols
  const names = (graphNames ?? []).slice(0, DASH_SAMPLE_NODES.length);
  DASH_SAMPLE_NODES.forEach((sample, i) => {
    if (names[i]) html = html.replace('>' + sample + '<', '>' + esc(names[i]) + '<');
  });
  return html;
}

// ------------------------------------------------------- graph canvas labels
const GRAPH_SAMPLE_SPECS = ['REQ-GRAPH-002', 'REQ-AUTH-005', 'REQ-INGEST-004', 'REQ-PRICE-001'];
const GRAPH_SAMPLE_CODE = ['validateSession', 'checkExpiry', 'exploreGraph', 'resolveRefs', 'applyLayout', 'writeStore', 'neighbors', 'cull', 'MCPServer'];
export function bindGraphCanvas(html, names, specIds) {
  // Sample spec bubbles → first real requirement ids (attr + visible label).
  GRAPH_SAMPLE_SPECS.forEach((sample, i) => {
    const real = specIds?.[i];
    if (real) html = html.split(sample).join(esc(real));
  });
  // Sample code labels → top-degree real symbol names.
  let ni = 0;
  GRAPH_SAMPLE_CODE.forEach((sample) => {
    const real = names?.[ni];
    if (real && html.includes('>' + sample + '<')) { html = html.split('>' + sample + '<').join('>' + esc(real) + '<'); ni++; }
  });
  return html;
}
