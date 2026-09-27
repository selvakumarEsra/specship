/**
 * Drift queue — every drifted/broken/orphaned spec link with state filters,
 * expandable meta, and workflow-gated repair actions. Ported from the design
 * bundle's Drift/DriftRow (specs/specship-desktop/screens-specs.jsx) onto
 * live /api/drift data (REQ-DESKTOP-022, actions per REQ-DESKTOP-005.A2).
 */
import { useState } from 'react';
import { api, isNoProject, type DriftLink } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from '../components/icons';
import { Empty, PageHead, Pill, STATE, StatePill, timeAgo } from '../components/ui';
import type { PageProps } from './types';

const DRIFT_STATES = ['drifted', 'broken', 'orphaned'];

/**
 * Repair action per link state (REQ-TVIZ-009.A2). Each launches the existing
 * default workflow through POST /api/workflows/runs; `spec-verify` takes no
 * declared inputs, so it gets none rather than a SPEC_ID the runner ignores.
 */
const REPAIR: Record<string, { label: string; icon: string; workflow: string; withSpecId: boolean; title: string }> = {
  drifted: { label: 'Fix', icon: 'wrench', workflow: 'spec-fix', withSpecId: true, title: 'Launch the spec-fix workflow for this spec' },
  broken: { label: 'Re-verify', icon: 'refresh', workflow: 'spec-verify', withSpecId: false, title: 'Launch the spec-verify workflow' },
  orphaned: { label: 'Re-attach', icon: 'graph', workflow: 'spec-relink', withSpecId: true, title: 'Launch the spec-relink workflow for this spec' },
};

// @implements REQ-DESKTOP-022
export function DriftPage({ project }: PageProps) {
  const drift = useApi(() => api.drift(project), [project]);
  const [off, setOff] = useState<Set<string>>(new Set());

  if (isNoProject(drift.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const all = drift.data?.links ?? [];
  const counts: Record<string, number> = {};
  for (const l of all) counts[l.state] = (counts[l.state] ?? 0) + 1;
  const links = all.filter((l) => !off.has(l.state));
  const toggle = (s: string) =>
    setOff((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s); else n.add(s);
      return n;
    });

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div style={{ padding: '16px 18px 0' }}>
        <PageHead icon="drift" title="Drift queue" sub={drift.data ? `${all.length} links need attention` : 'Loading drift…'} />
      </div>
      <div className="row gap-8" style={{ padding: '0 18px 12px', flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} style={{ color: 'var(--text-muted)' }} />
        {DRIFT_STATES.map((s) => {
          const on = !off.has(s);
          const st = STATE[s]!;
          return (
            <button
              key={s}
              onClick={() => toggle(s)}
              className="row gap-6"
              style={{
                height: 26, padding: '0 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 500,
                cursor: 'pointer', textTransform: 'capitalize',
                border: '1px solid ' + (on ? 'transparent' : 'var(--border-subtle)'),
                background: on ? st.bg : 'var(--bg-panel)',
                color: on ? st.color : 'var(--text-muted)',
              }}
            >
              {s}
              <span className="tabular" style={{ opacity: 0.7 }}>{counts[s] ?? 0}</span>
            </button>
          );
        })}
      </div>
      {drift.data && !all.length ? (
        <Empty icon="check" title="Nothing drifted" body="Every spec link is intact — the graph matches the specs." />
      ) : (
        <div className="scroll-y" style={{ flex: 1, borderTop: '1px solid var(--border-subtle)' }}>
          {links.map((l, i) => <DriftRow key={l.id != null ? String(l.id) : i} link={l} project={project} />)}
        </div>
      )}
    </div>
  );
}

function metaCell(label: string, value: string) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 12.5, marginTop: 1 }}>{value}</div>
    </div>
  );
}

// @implements REQ-TVIZ-009
function DriftRow({ link, project }: { link: DriftLink; project: string | null }) {
  const [open, setOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const target = [link.targetFilePath, link.targetQualifiedName].filter(Boolean).join(':') || '—';
  const prov = link.provenance || '—';
  const age = timeAgo(link.updatedAt) ?? '—';
  const repair = REPAIR[link.state];

  // Launch, then hand the user the run it created — the repair is a workflow,
  // and the run page is where its approval gates live.
  const launch = () => {
    if (!repair || launching) return;
    setLaunching(true);
    setLaunchError(null);
    api.launchRun(repair.workflow, repair.withSpecId ? { SPEC_ID: link.specId } : {}, project).then(
      (r) => go('runs', { param: r.runId }),
      (e) => { setLaunchError(e instanceof Error ? e.message : String(e)); setLaunching(false); },
    );
  };
  return (
    <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div
        className="row gap-10 list-row"
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        style={{ padding: '10px 14px', cursor: 'pointer' }}
      >
        <div style={{ width: 92, flexShrink: 0 }}><StatePill state={link.state} /></div>
        <span className="mono" style={{ fontSize: 12, color: 'var(--node-spec)', flexShrink: 0, width: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.specId}</span>
        <span className="secondary" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '0 1 220px' }}>{link.specTitle}</span>
        <Icon name="arrowRight" size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span className="mono grow" style={{ fontSize: 11.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{target}</span>
        {link.driftAxis && <Pill color="var(--warn)" bg="var(--warn-soft)">{link.driftAxis}</Pill>}
        <span className="mono muted" style={{ fontSize: 11, flexShrink: 0, maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{link.provenance || ''}</span>
        <span className="mono muted tabular" style={{ fontSize: 11, flexShrink: 0, width: 32, textAlign: 'right' }}>{age}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </div>
      {open && (
        <div style={{ padding: '0 14px 14px 36px', background: 'var(--bg-canvas)' }}>
          <div className="row" style={{ gap: 22, padding: '10px 0', flexWrap: 'wrap' }}>
            {metaCell('Spec', link.specId)}
            {metaCell('Target', target)}
            {metaCell('Provenance', prov)}
            {metaCell('Drift axis', link.driftAxis ?? '—')}
            {metaCell('Age', age)}
          </div>
          <div className="row gap-8">
            {repair && (
              <button className="btn btn-primary btn-sm" disabled={launching} title={repair.title} onClick={launch}>
                <Icon name={repair.icon} size={12} />{launching ? 'Launching…' : repair.label}
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => go('specs', { query: { sel: link.specId } })}>Open spec</button>
            <button className="btn btn-secondary btn-sm" onClick={() => go('graph', { query: { focus: 'spec:' + link.specId } })}>Show in graph</button>
          </div>
          {launchError && (
            <div className="row gap-6" role="alert" style={{ marginTop: 8, color: 'var(--error)', fontSize: 12 }}>
              <Icon name="cancel" size={13} style={{ flexShrink: 0 }} />
              <span>Couldn’t launch {repair?.workflow} — {launchError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
