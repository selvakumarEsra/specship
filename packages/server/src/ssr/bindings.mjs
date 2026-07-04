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
    return r;
  });
  html = swapRows(html, rows, built);
  // Header subtitle: sample "4 links need attention" → live count.
  html = html.replace(/>\d+ links need attention</, `>${live.length} links need attention<`);
  return html;
}
