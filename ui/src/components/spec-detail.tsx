/**
 * Spec detail read view — TSX port of the design bundle's SpecRead
 * (specs/specship-desktop/screens-specs.jsx; pixel authority snapshot.html).
 * Covers the read-view contract of REQ-DESKTOP-001…005 and 012:
 *   001 section order + copy-id + state-accent hero + neutral placeholders,
 *   002 escaped RFC-2119 keyword/code/bold decoration,
 *   003 criterion marks + segment bar + N/M-met rollup,
 *   004 linked-code rows + orphaned alarm card,
 *   005 workflow-gated actions (editor arrives with REQ-DESKTOP-006),
 *   012 guidance empty / skeleton / error-with-retry / unknown-state safety.
 */
import { api, isNoProject, type LinkedSpec, type SpecDetailResponse, type SpecDoc } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from './icons';
import { CopyBtn, Empty, Pill, STATE, StatePill, timeAgo } from './ui';

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

function SpecDetailLoaded({ id, project }: { id: string; project: string | null }) {
  const detail = useApi(() => api.spec(id, project), [id, project]);

  if (detail.data) return <SpecRead data={detail.data} />;
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
function SpecRead({ data }: { data: SpecDetailResponse }) {
  const { spec, parent, children, links, childLinks } = data;
  const docPath = parent?.sourcePath ?? spec.sourcePath ?? '';
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
          <button className="btn btn-secondary btn-sm" disabled title="Read-only for now — the inline editor lands with REQ-DESKTOP-006">
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
