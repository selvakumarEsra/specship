/**
 * Spec detail read view + inline structured editor — TSX port of the design
 * bundle's SpecRead/SpecEditor (specs/specship-desktop/screens-specs.jsx;
 * pixel authority snapshot.html).
 * Covers the read-view contract of REQ-DESKTOP-001…005 and 012:
 *   001 section order + copy-id + state-accent hero + neutral placeholders,
 *   002 escaped RFC-2119 keyword/code/bold decoration,
 *   003 criterion marks + segment bar + N/M-met rollup,
 *   004 linked-code rows + orphaned alarm card,
 *   005 workflow-gated actions + the enabled Edit affordance,
 *   012 guidance empty / skeleton / error-with-retry / unknown-state safety.
 * And the editor contract of REQ-DESKTOP-006…011:
 *   006 in-place read/edit swap, draft scoped to the selected spec,
 *   007 dirty-by-value tracking gating Save,
 *   008 system-managed status (read-only, re-queued as Drafted on save),
 *   009 structured fields + Write/Preview reusing renderProse + keyword legend,
 *   010 criteria add/edit/remove with positional A-renumbering,
 *   011 section-scoped serialization (ui/src/spec-source.ts) through the
 *       existing spec write API, with keep-draft failure + sync-lag hints.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, isNoProject, type LinkedSpec, type SpecDetailResponse, type SpecDoc } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { normalizeSectionDraft, parseRequirementSection, serializeRequirementSection, type ParsedSection } from '../spec-source';
import { Icon } from './icons';
import { CopyBtn, Empty, Pill, Segmented, STATE, StatePill, timeAgo } from './ui';

/**
 * Inline markdown + RFC-2119 keyword highlighting (REQ-DESKTOP-002).
 * Operates on ESCAPED text — spec bodies are author-controlled file content
 * and must never inject live markup (A3). `\b` keeps MUSTARD/dismay prose (A2).
 */
export function renderProse(s: string): string {
  let h = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/`([^`]+?)`/g, "<code class='sp-code'>$1</code>");
  h = h.replace(/\b(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED)\b/g, "<span class='sp-kw sp-kw-must'>$1</span>");
  h = h.replace(/\b(SHOULD NOT|SHOULD|RECOMMENDED)\b/g, "<span class='sp-kw sp-kw-should'>$1</span>");
  h = h.replace(/\b(MAY|OPTIONAL)\b/g, "<span class='sp-kw sp-kw-may'>$1</span>");
  return h;
}

/** States that count as "met" in the acceptance rollup (REQ-DESKTOP-003.A3). */
const MET_STATES = new Set(['verified', 'implemented', 'completed']);

/**
 * Worst-state-wins rollup across a spec's links, mirroring the server's
 * /api/specs linkStates pass. `empty` is the zero-links state ('drafted' for
 * a requirement, 'pending' for an acceptance criterion).
 */
export function rollupState(links: LinkedSpec[] | undefined, empty: string): string {
  if (!links || !links.length) return empty;
  const states = links.map((l) => l.state);
  if (states.includes('broken')) return 'broken';
  if (states.includes('orphaned')) return 'orphaned';
  if (states.includes('drifted')) return 'drifted';
  return states.every((s) => s === 'verified') ? 'verified' : 'implemented';
}

const CRIT_ICON: Record<string, string> = {
  verified: 'check', implemented: 'check', completed: 'check',
  drifted: 'drift', broken: 'cancel', orphaned: 'cancel', failed: 'cancel',
};

/**
 * Per-criterion status mark (REQ-DESKTOP-003.A1): check glyph for met states,
 * the state's attention glyph for drifted/broken/orphaned/failed, and a
 * hollow ring for everything else (pending, unknown → info treatment).
 */
export function CritMark({ state }: { state: string }) {
  const c = STATE[state] ?? STATE.info!;
  const ic = CRIT_ICON[state];
  return (
    <div className="sp-crit-mark" style={{ background: c.bg, color: c.color }}>
      {ic
        ? <Icon name={ic} size={12} />
        : <span style={{ width: 7, height: 7, borderRadius: '50%', border: '1.6px solid ' + c.color, boxSizing: 'border-box' }} />}
    </div>
  );
}

/** "REQ-X-001.A2" → "A2"; ids without a dot render whole. */
function subId(id: string): string {
  const i = id.lastIndexOf('.');
  return i === -1 ? id : id.slice(i + 1);
}

/** Label for a state string: known states map to their label, unknown pass through. */
function stateLabel(state: string): string {
  return STATE[state]?.label ?? state;
}

// @implements REQ-DESKTOP-012
export function SpecDetail({ id, project }: { id: string | null; project: string | null }) {
  return id ? <SpecDetailLoaded id={id} project={project} /> : <NoSelection />;
}

/** No-selection guidance empty state (REQ-DESKTOP-012.A1). */
function NoSelection() {
  return (
    <Empty
      icon="book"
      title="Pick a spec from the tree"
      body="Or run specship init -i to index your specs/ folder if you haven’t yet."
      action={
        <span className="row gap-6" style={{ justifyContent: 'center' }}>
          <code className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', background: 'var(--bg-canvas)', padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
            specship init -i
          </code>
          <CopyBtn text="specship init -i" />
        </span>
      }
    />
  );
}

// @implements REQ-DESKTOP-006
function SpecDetailLoaded({ id, project }: { id: string; project: string | null }) {
  const detail = useApi(() => api.spec(id, project), [id, project]);
  const [editing, setEditing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // The working copy is scoped to the spec being edited: a tree click while
  // editing discards the draft and renders the new selection's read view
  // (006.A3). The editor itself owns the draft, so unmounting drops it.
  useEffect(() => { setEditing(false); setSyncNotice(null); }, [id]);

  if (detail.data) {
    if (editing) {
      return (
        <SpecEditor
          data={detail.data}
          project={project}
          onCancel={() => setEditing(false)}
          onSaved={(syncError) => {
            setEditing(false);
            setSyncNotice(syncError);
            detail.reload();
          }}
        />
      );
    }
    return (
      <SpecRead
        data={detail.data}
        notice={syncNotice}
        onEdit={() => { setSyncNotice(null); setEditing(true); }}
      />
    );
  }
  if (detail.loading) return <DetailSkeleton />;
  if (isNoProject(detail.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }
  // Failed fetch → visible error with a retry affordance (REQ-DESKTOP-012.A3).
  return (
    <Empty
      icon="drift"
      title={`Couldn’t load ${id}`}
      body={detail.error instanceof Error ? detail.error.message : 'The spec detail request failed.'}
      action={
        <button className="btn btn-secondary btn-sm" onClick={detail.reload}>
          <Icon name="refresh" size={13} />Retry
        </button>
      }
    />
  );
}

/** Skeleton shimmer mirroring the section stack — never a blank pane (012.A2). */
function DetailSkeleton() {
  return (
    <div className="scroll-y" style={{ flex: 1, padding: '28px 32px 56px' }} data-testid="spec-skeleton">
      <div className="sp-doc">
        <div className="skel" style={{ width: 230, height: 12, marginBottom: 20 }} />
        <div className="skel" style={{ width: '72%', height: 28, marginBottom: 16 }} />
        <div className="skel" style={{ width: 340, height: 20, marginBottom: 32 }} />
        <div className="skel" style={{ width: '100%', height: 96, marginBottom: 30 }} />
        <div className="skel" style={{ width: '100%', height: 132, marginBottom: 30 }} />
        <div className="skel" style={{ width: '100%', height: 56 }} />
      </div>
    </div>
  );
}

// @implements REQ-DESKTOP-001
// @implements REQ-DESKTOP-002
// @implements REQ-DESKTOP-003
// @implements REQ-DESKTOP-004
// @implements REQ-DESKTOP-005
function SpecRead({ data, notice, onEdit }: {
  data: SpecDetailResponse;
  notice?: string | null;
  onEdit?: () => void;
}) {
  const { spec, parent, children, links, childLinks } = data;
  const docPath = parent?.sourcePath ?? spec.sourcePath ?? '';
  // Editable only when the raw source is available AND this requirement's
  // marker + heading section can be located in it (REQ-DESKTOP-005/006).
  const editable = data.source != null && parseRequirementSection(data.source, spec.id) != null;
  const editTitle = editable
    ? 'Edit this requirement in place'
    : data.source == null
      ? 'Source file not available'
      : 'Couldn’t locate this requirement’s section in the source file';
  const criteria = children.filter((c) => c.kind === 'acceptance');
  const critState = (c: SpecDoc) => rollupState(childLinks[c.id], 'pending');
  const state = rollupState(links, 'drafted');
  const met = criteria.filter((c) => MET_STATES.has(critState(c))).length;
  const accent = (STATE[state] ?? STATE.info!).color;

  const verifiedAgo = state === 'verified'
    ? timeAgo(links.reduce((m, l) => Math.max(m, l.updatedAt ?? 0), 0) || undefined)
    : null;
  const verifiedColor = state === 'verified' ? 'var(--success)'
    : state === 'broken' || state === 'drifted' || state === 'orphaned' ? 'var(--warn)'
    : 'var(--text-secondary)';

  const rationale =
    typeof spec.metadata?.rationale === 'string' ? spec.metadata.rationale
    : typeof spec.rationale === 'string' ? spec.rationale
    : null;

  const linkTarget = (l: LinkedSpec) =>
    [l.targetFilePath, l.targetQualifiedName].filter(Boolean).join(':') || '—';
  // Reveal focuses the linked symbol itself when it resolved; a spec-focus
  // deep-link is the fallback — the same mechanism as Show in graph (004).
  const reveal = (l: LinkedSpec) =>
    go('graph', { query: { focus: l.resolvedNodeId || 'spec:' + spec.id } });

  const sep = <span className="sep" />;

  return (
    <div className="scroll-y" style={{ flex: 1, padding: '28px 32px 56px' }}>
      <div className="sp-doc">

        {/* ---- post-save sync-lag hint (REQ-DESKTOP-011.A3) ---- */}
        {notice != null && (
          <div className="card card-pad row gap-8" style={{ color: 'var(--warn)', borderColor: 'var(--warn)', marginBottom: 20, fontSize: 12.5 }}>
            <Icon name="drift" size={14} style={{ flexShrink: 0 }} />
            <span>Saved, but not yet indexed — re-sync failed ({notice}). The file is on disk; the next sync picks it up.</span>
          </div>
        )}

        {/* ---- breadcrumb ---- */}
        <div className="sp-breadcrumb">
          <Icon name="book" size={13} style={{ color: 'var(--node-spec)' }} />
          <span className="mono" style={{ color: 'var(--text-secondary)' }}>{docPath}</span>
          <Icon name="chevronRight" size={11} />
          <span className="mono" style={{ color: 'var(--node-spec)', fontWeight: 600 }}>{spec.id}</span>
          <CopyBtn text={spec.id} />
        </div>

        {/* ---- title ---- */}
        <h1 className="sp-title">{spec.title}</h1>

        {/* ---- single meta line ---- */}
        <div className="sp-metaline" style={{ marginBottom: 32 }}>
          <StatePill state={state} pulse={state === 'broken' || state === 'drifted'} />
          <Pill>{spec.priority || '—'}</Pill>
          {sep}
          <span className="fact"><b>{spec.kind || 'requirement'}</b></span>
          {sep}
          <span className="fact">owned by <b className="mono">{spec.owner || '—'}</b></span>
          {sep}
          <span className="fact">
            {state === 'verified' ? 'verified ' : null}
            <b style={{ color: verifiedColor }}>{verifiedAgo ? verifiedAgo + ' ago' : '—'}</b>
          </span>
        </div>

        {/* ---- requirement statement (hero, accent edge = state color) ---- */}
        <div className="sp-sec">
          <div className="sp-label">Requirement</div>
          <div className="sp-statement lead" style={{ '--sp-accent': accent } as React.CSSProperties}>
            {spec.body?.trim()
              ? <div className="sp-prose" dangerouslySetInnerHTML={{ __html: renderProse(spec.body) }} />
              : <div className="muted" style={{ fontSize: 13 }}>No normative statement recorded.</div>}
          </div>
        </div>

        {/* ---- rationale (optional) ---- */}
        {rationale && (
          <div className="sp-sec">
            <div className="sp-label">Why it matters</div>
            <div className="sp-rationale" dangerouslySetInnerHTML={{ __html: renderProse(rationale) }} />
          </div>
        )}

        {/* ---- acceptance criteria (omitted entirely at zero — 003.A4) ---- */}
        {criteria.length > 0 && (
          <div className="sp-sec">
            <div className="sp-label">
              Acceptance criteria
              <span className="ct tabular" style={{ color: met === criteria.length ? 'var(--success)' : 'var(--text-muted)' }}>
                {met + ' / ' + criteria.length + ' met'}
              </span>
            </div>
            <div className="row gap-4" style={{ marginBottom: 12 }}>
              {criteria.map((c) => {
                const st = critState(c);
                const cs = STATE[st] ?? STATE.info!;
                return (
                  <div
                    key={c.id}
                    title={subId(c.id) + ' · ' + stateLabel(st)}
                    style={{ flex: 1, height: 4, borderRadius: 999, background: cs.color, opacity: st === 'pending' ? 0.25 : 0.9 }}
                  />
                );
              })}
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              {criteria.map((c) => (
                <div key={c.id} className="sp-crit">
                  <CritMark state={critState(c)} />
                  <span className="sp-crit-id">{subId(c.id)}</span>
                  <span className="sp-crit-text" dangerouslySetInnerHTML={{ __html: renderProse(c.body || c.title) }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- linked code ---- */}
        <div className="sp-sec">
          <div className="sp-label">
            Linked code
            {links.length > 0 && <span className="ct">{links.length + (links.length === 1 ? ' symbol' : ' symbols')}</span>}
          </div>
          {links.length ? (
            <div className="card" style={{ overflow: 'hidden' }}>
              {links.map((l, i) => (
                <div key={i} className="row gap-10" style={{ padding: '11px 14px', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
                  <StatePill state={l.state} />
                  {l.driftAxis && <Pill color="var(--warn)" bg="var(--warn-soft)">{l.driftAxis + ' drift'}</Pill>}
                  <span className="mono grow" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkTarget(l)}</span>
                  <Pill>{l.provenance || '—'}</Pill>
                  <button className="btn btn-ghost btn-xs" onClick={() => reveal(l)} title="Reveal in the graph">
                    <Icon name="reveal" size={12} />Reveal
                  </button>
                </div>
              ))}
            </div>
          ) : (
            // Zero links is an alarm state, not a neutral empty (004.A3).
            <div className="card card-pad" style={{ textAlign: 'center', color: 'var(--error)', borderColor: 'rgba(242,85,90,0.3)' }}>
              <Icon name="drift" size={16} />
              <div style={{ marginTop: 6, fontSize: 12.5 }}>Orphaned — no code implements this requirement yet</div>
            </div>
          )}
        </div>

        {/* ---- quick actions (workflow-owned = disabled + explaining tooltip) ---- */}
        <div className="row gap-8" style={{ flexWrap: 'wrap', marginTop: 4 }}>
          <button className="btn btn-primary btn-sm" disabled title="Run automatically by the implementation workflow once Drafted">
            <Icon name="play" size={13} />Implement
          </button>
          <button className="btn btn-secondary btn-sm" disabled title="Run automatically by the verification workflow">
            <Icon name="check" size={13} />Verify
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!editable} title={editTitle} onClick={editable ? onEdit : undefined}>
            <Icon name="reveal" size={13} />Edit spec
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => go('graph', { query: { focus: 'spec:' + spec.id } })}>
            <Icon name="graph" size={13} />Show in graph
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SPEC EDITOR (REQ-DESKTOP-006…011)
// ============================================================

const CRIT_STATES = ['pending', 'implementing', 'implemented', 'verified', 'drifted', 'broken'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const KIND_OPTIONS = ['requirement', 'constraint', 'guideline', 'invariant', 'non-functional'];

/** The editor's working copy. Persisted fields are title/statement/criteria
 * text — the rest render from available data but the spec format carries no
 * per-requirement slot for them yet (see the field hints). */
interface EditorDraft {
  title: string;
  priority: string;
  kind: string;
  owner: string;
  statement: string;
  rationale: string;
  criteria: Array<{ id: string; state: string; text: string }>;
}

function seedDraft(data: SpecDetailResponse, section: ParsedSection): EditorDraft {
  const { spec, childLinks } = data;
  const rationale =
    typeof spec.metadata?.rationale === 'string' ? spec.metadata.rationale
    : typeof spec.rationale === 'string' ? spec.rationale
    : '';
  return {
    title: section.title,
    priority: spec.priority ?? '',
    kind: spec.kind ?? 'requirement',
    owner: spec.owner ?? '',
    statement: section.statement,
    rationale,
    criteria: section.criteria.map((c) => ({
      id: c.id,
      state: rollupState(childLinks[c.id], 'pending'),
      text: c.text,
    })),
  };
}

const EMPTY_DRAFT: EditorDraft = {
  title: '', priority: '', kind: 'requirement', owner: '', statement: '', rationale: '', criteria: [],
};

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <label className="sp-fl">{label}</label>
      {children}
      {hint && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{hint}</div>}
    </div>
  );
}

function PlainSelect({ value, onChange, options, label }: {
  value: string; onChange: (v: string) => void; options: string[]; label: string;
}) {
  const opts = options.includes(value) ? options : [value, ...options];
  return (
    <select
      className="input sp-select"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', textTransform: 'capitalize' }}
    >
      {opts.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/** Dot-coded state select for criterion rows (REQ-DESKTOP-010.A3). */
function StateSelect({ value, onChange, options, width, label }: {
  value: string; onChange: (v: string) => void; options: string[]; width?: number; label: string;
}) {
  const c = STATE[value] ?? STATE.info!;
  return (
    <div className="row" style={{ position: 'relative', width: width ?? 'auto', flexShrink: 0 }}>
      <span className="pill-dot" data-testid="crit-state-dot" style={{ background: c.color, position: 'absolute', left: 11, pointerEvents: 'none', zIndex: 1 }} />
      <select
        className="input sp-select"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', paddingLeft: 26, textTransform: 'capitalize' }}
      >
        {options.map((s) => <option key={s} value={s}>{STATE[s]?.label ?? s}</option>)}
      </select>
    </div>
  );
}

/**
 * Read-only status field: no user-operable control, visibly locked. Saving
 * re-enters the spec into the lifecycle at Drafted, so a non-drafted spec
 * shows the current-state → drafted transition.
 */
// @implements REQ-DESKTOP-008
function AutoStatus({ state }: { state: string }) {
  return (
    <div className="sp-status-auto">
      {state === 'drafted' ? (
        <>
          <StatePill state="drafted" />
          <span className="muted" style={{ fontSize: 12 }}>queued for implementation</span>
        </>
      ) : (
        <>
          <StatePill state={state} />
          <Icon name="arrowRight" size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <StatePill state="drafted" />
        </>
      )}
      <span className="grow" />
      <Icon name="lock" size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
    </div>
  );
}

/** Per-row criteria editor: state dot-picker, text, remove; positional
 * A-numbering renumbers on add/delete (REQ-DESKTOP-010). */
// @implements REQ-DESKTOP-010
function CriteriaEditor({ criteria, onChange }: {
  criteria: EditorDraft['criteria'];
  onChange: (next: EditorDraft['criteria']) => void;
}) {
  const setCrit = (i: number, patch: Partial<{ state: string; text: string }>) =>
    onChange(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <>
      <div className="row" style={{ marginBottom: 10, gap: 10 }}>
        <span className="eyebrow">Acceptance criteria</span>
        <span style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span className="mono tabular muted" style={{ fontSize: 11.5 }}>{criteria.length + ' total'}</span>
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
        {criteria.length === 0 ? (
          <div className="muted" style={{ fontSize: 12.5, textAlign: 'center', padding: '18px 14px' }}>
            No criteria yet — add one below.
          </div>
        ) : (
          criteria.map((c, i) => (
            <div key={i} className="sp-crit-edit">
              <span className="sp-crit-grip"><Icon name="grip" size={14} /></span>
              <span className="sp-crit-num">{'A' + (i + 1)}</span>
              <StateSelect
                value={c.state}
                onChange={(v) => setCrit(i, { state: v })}
                options={CRIT_STATES}
                width={156}
                label={'Criterion A' + (i + 1) + ' state'}
              />
              <input
                className="input grow"
                style={{ fontSize: 13 }}
                value={c.text}
                aria-label={'Criterion A' + (i + 1) + ' text'}
                placeholder="Observable, testable condition…"
                onChange={(e) => setCrit(i, { text: e.target.value })}
              />
              <button className="sp-icon-btn" title="Remove criterion" onClick={() => onChange(criteria.filter((_, j) => j !== i))}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))
        )}
      </div>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => onChange([...criteria, { id: '', state: 'pending', text: '' }])}
      >
        <Icon name="plus" size={13} />Add criterion
      </button>
    </>
  );
}

/**
 * Inline structured editor. The draft seeds once from the fetched raw source
 * (no extra network round-trip — REQ-DESKTOP-016.A2) and lives only in this
 * component's state: Cancel or a tree click unmounts it and the draft is
 * gone; re-entering Edit reseeds from the persisted values (006.A2–A4).
 * Dirtiness is by value against the open-time snapshot (007).
 */
// @implements REQ-DESKTOP-006
// @implements REQ-DESKTOP-007
// @implements REQ-DESKTOP-009
// @implements REQ-DESKTOP-011
function SpecEditor({ data, project, onCancel, onSaved }: {
  data: SpecDetailResponse;
  project: string | null;
  onCancel: () => void;
  onSaved: (syncError: string | null) => void;
}) {
  const { spec } = data;
  const docPath = data.parent?.sourcePath ?? spec.sourcePath ?? '';
  const section = useMemo(
    () => parseRequirementSection(data.source ?? '', spec.id),
    [data.source, spec.id],
  );

  const [d, setD] = useState<EditorDraft>(() => (section ? seedDraft(data, section) : EMPTY_DRAFT));
  const snapshot = useRef(JSON.stringify(d));
  const dirty = JSON.stringify(d) !== snapshot.current;
  const [tab, setTab] = useState('write');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (patch: Partial<EditorDraft>) => setD((p) => ({ ...p, ...patch }));

  const currentState = rollupState(data.links, 'drafted');
  const accent = (STATE[currentState] ?? STATE.info!).color;

  // Belt-and-braces: SpecRead only enables Edit when the section parses.
  if (!section) {
    return <Empty icon="drift" title="Can’t edit this spec" body="Its requirement section couldn’t be located in the source file." />;
  }

  const save = async () => {
    if (!dirty || saving) return;
    // Normalize at save time only (REQ-DESKTOP-011.A4 / 010.A4): trimmed
    // fields, empty criteria dropped, contiguous A-renumbering.
    const norm = normalizeSectionDraft({ title: d.title, statement: d.statement, criteria: d.criteria });
    const content = serializeRequirementSection(data.source ?? '', spec.id, norm);
    if (content === null) {
      setSaveError('Could not locate this requirement’s section in the source file.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.specSave(spec.id, content, project);
      onSaved(res.syncError ?? null);
    } catch (e) {
      // A rejected or failed write keeps the editor open with the draft
      // intact and surfaces the error (011.A2).
      setSaveError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const saveBtn = (
    <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
      <Icon name="check" size={13} />{saving ? 'Saving…' : 'Save changes'}
    </button>
  );

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      {/* ---- sticky edit bar (accent edge via .sp-edit-bar::before) ---- */}
      <div className="sp-edit-bar">
        <Icon name="reveal" size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div className="col" style={{ gap: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Editing spec</div>
          <div className="mono muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {docPath + ' · ' + spec.id}
          </div>
        </div>
        <div className="grow" />
        {dirty && (
          <div className="row gap-6" style={{ marginRight: 4 }}>
            <span className="sp-dirty-dot" />
            <span className="muted" style={{ fontSize: 11.5 }}>Unsaved changes</span>
          </div>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          <Icon name="x" size={13} />Cancel
        </button>
        {saveBtn}
      </div>

      <div className="scroll-y" style={{ flex: 1, padding: '24px 28px 56px' }}>
        <div style={{ maxWidth: 780 }}>

          {saveError && (
            <div className="card card-pad row gap-8" role="alert" style={{ color: 'var(--error)', borderColor: 'rgba(242,85,90,0.35)', marginBottom: 18, fontSize: 12.5 }}>
              <Icon name="cancel" size={14} style={{ flexShrink: 0 }} />
              <span>Save failed — {saveError} Your draft is intact.</span>
            </div>
          )}

          {/* ---- title ---- */}
          <Field label="Title">
            <input
              className="input sp-input-lg"
              value={d.title}
              aria-label="Title"
              placeholder="Short, imperative requirement title"
              onChange={(e) => set({ title: e.target.value })}
            />
          </Field>

          {/* ---- metadata grid ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 22px', marginBottom: 4 }}>
            <Field label="Status" hint="Set automatically — saving re-queues this spec as Drafted so the implementation workflow picks it up.">
              <AutoStatus state={currentState} />
            </Field>
            <Field label="Priority">
              <Segmented options={PRIORITIES} value={d.priority} onChange={(v) => set({ priority: v })} />
            </Field>
            <Field label="Kind">
              <PlainSelect value={d.kind} onChange={(v) => set({ kind: v })} options={KIND_OPTIONS} label="Kind" />
            </Field>
            <Field label="Owner">
              <input
                className="input mono"
                style={{ width: '100%' }}
                value={d.owner}
                aria-label="Owner"
                placeholder="unassigned"
                onChange={(e) => set({ owner: e.target.value })}
              />
            </Field>
          </div>
          <div className="muted" style={{ fontSize: 11, margin: '-8px 0 22px' }}>
            Priority, kind, and owner are document-level in the current spec format — they render from available data but aren’t persisted per-requirement yet.
          </div>

          {/* ---- normative statement w/ write / preview ---- */}
          <div style={{ marginBottom: 22 }}>
            <div className="row" style={{ marginBottom: 7 }}>
              <label className="sp-fl" style={{ marginBottom: 0 }}>Normative statement</label>
              <div className="grow" />
              <Segmented
                size="sm"
                options={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]}
                value={tab}
                onChange={setTab}
              />
            </div>
            {tab === 'write' ? (
              <textarea
                className="input sp-textarea"
                value={d.statement}
                spellCheck={false}
                aria-label="Normative statement"
                placeholder="The server MUST validate …  (use MUST / SHOULD / MAY, **bold**, and `code`)"
                onChange={(e) => set({ statement: e.target.value })}
              />
            ) : (
              // Preview reuses exactly the read view's decoration (002.A4).
              <div className="sp-statement" style={{ '--sp-accent': accent } as React.CSSProperties}>
                {d.statement.trim()
                  ? <div className="sp-prose" dangerouslySetInnerHTML={{ __html: renderProse(d.statement) }} />
                  : <div className="muted" style={{ fontSize: 13 }}>Nothing to preview yet.</div>}
              </div>
            )}
            <div className="sp-kw-legend">
              <span className="label">Keywords:</span>
              <span className="sp-kw sp-kw-must">MUST</span>
              <span className="sp-kw sp-kw-should">SHOULD</span>
              <span className="sp-kw sp-kw-may">MAY</span>
              <span className="label" style={{ marginLeft: 4 }}>auto-highlight as you type</span>
            </div>
          </div>

          {/* ---- rationale ---- */}
          <Field label="Rationale" hint="Optional — why this requirement exists. Presentation-only today: the spec format carries no per-requirement rationale field.">
            <textarea
              className="input sp-textarea"
              value={d.rationale}
              spellCheck={false}
              style={{ minHeight: 84 }}
              aria-label="Rationale"
              placeholder="Why does this matter? What breaks without it?"
              onChange={(e) => set({ rationale: e.target.value })}
            />
          </Field>

          {/* ---- acceptance criteria ---- */}
          <CriteriaEditor criteria={d.criteria} onChange={(next) => set({ criteria: next })} />

          {/* ---- footer actions ---- */}
          <div className="row" style={{ gap: 10, marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--border-subtle)' }}>
            {saveBtn}
            <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
            <div className="grow" />
            <span className="mono muted" style={{ fontSize: 11 }}>{dirty ? 'edited' : 'no changes'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
