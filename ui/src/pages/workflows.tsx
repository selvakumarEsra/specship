/**
 * Workflows screen — discovered workflow definitions as launchable cards,
 * ported from the design bundle's Workflows/RunModal
 * (specs/specship-desktop/screens-workflows.jsx) onto live /api/workflows
 * data (REQ-DESKTOP-023). Not a sidebar entry — reached from the Runs
 * screen's Launch-run affordance, the palette, or a deep link.
 */
import { useState } from 'react';
import { api, isNoProject, type WorkflowDefinition } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from '../components/icons';
import { Empty, PageHead, Pill } from '../components/ui';
import type { PageProps } from './types';

const SCOPE_COLOR: Record<string, string> = {
  bundled: 'var(--node-spec)',
  global: 'var(--node-code)',
  project: 'var(--node-route)',
};

// @implements REQ-DESKTOP-023
export function WorkflowsPage({ project, query }: PageProps) {
  const workflows = useApi(() => api.workflows(project), [project]);
  const list = workflows.data?.workflows ?? [];
  // `?run=<name>` deep-links straight into the launch dialog (the Runs
  // screen's Launch-run affordance lands here).
  const [launch, setLaunch] = useState<string | null>(query.run ?? null);

  if (isNoProject(workflows.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const active = launch ? list.find((w) => w.workflow.name === launch) : undefined;

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
      <PageHead
        icon="workflow"
        title="Workflows"
        sub={workflows.data ? 'Run a YAML-defined DAG of agent, shell and approval steps' : 'Loading workflows…'}
      />
      {workflows.data && !list.length && (
        <Empty icon="workflow" title="No workflows found" body="Add YAML definitions under .specship/workflows/ in this project or your home directory." />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {list.map(({ workflow: wf, scope }) => {
          const sc = SCOPE_COLOR[scope] ?? 'var(--text-secondary)';
          return (
            <div key={wf.name} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row gap-8">
                <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{wf.name}</span>
                <Pill color={sc} bg={`color-mix(in srgb, ${sc} 14%, transparent)`}>{scope}</Pill>
                <span className="grow" />
                <span className="mono muted tabular" style={{ fontSize: 10.5 }}>{wf.nodes.length} nodes</span>
              </div>
              <div className="secondary" style={{ fontSize: 12.5, lineHeight: 1.5, minHeight: 36 }}>
                {wf.description || 'No description.'}
              </div>
              <div className="row gap-6" style={{ flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
                {(wf.requires ?? []).length > 0 && <span className="muted" style={{ fontSize: 10.5 }}>requires</span>}
                {(wf.requires ?? []).map((r) => (
                  <code key={r} className="mono" style={{ fontSize: 10.5, color: 'var(--text-secondary)', background: 'var(--bg-canvas)', padding: '1px 6px', borderRadius: 4 }}>{r}</code>
                ))}
                {(wf.inputs ?? []).length > 0 && (
                  <>
                    <span className="muted" style={{ fontSize: 10.5, marginLeft: 6 }}>inputs</span>
                    {(wf.inputs ?? []).map((i) => (
                      <code key={i.name} className="mono" style={{ fontSize: 10.5, color: 'var(--node-spec)', background: 'var(--node-spec-soft)', padding: '1px 6px', borderRadius: 4 }}>${i.name}</code>
                    ))}
                  </>
                )}
                <span className="grow" />
                <button className="btn btn-primary btn-sm" onClick={() => setLaunch(wf.name)}>
                  <Icon name="play" size={13} />Launch
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {active && <LaunchRunDialog wf={active.workflow} project={project} onClose={() => setLaunch(null)} />}
    </div>
  );
}

/** Inputs form + launch POST; navigates to the run detail on success. */
export function LaunchRunDialog({ wf, project, onClose }: {
  wf: WorkflowDefinition; project: string | null; onClose: () => void;
}) {
  const inputs = wf.inputs ?? [];
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.filter((i) => i.default).map((i) => [i.name, i.default!])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = inputs.filter((i) => i.required && !(vals[i.name] ?? '').trim());

  const submit = () => {
    if (busy || missing.length) return;
    setBusy(true);
    setError(null);
    const filled = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.trim()));
    api.launchRun(wf.name, filled, project).then(
      (r) => go('runs', { param: r.runId }),
      (e) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false); },
    );
  };

  return (
    <div onMouseDown={onClose} role="dialog" aria-label={'Launch ' + wf.name} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90, display: 'grid', placeItems: 'center' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '90vw', background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-pop)' }}>
        <div className="row gap-10" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="workflow" size={16} style={{ color: 'var(--accent)' }} />
          <span className="mono grow" style={{ fontWeight: 600 }}>{wf.name}</span>
          <button className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </div>
        <div style={{ padding: 16 }}>
          <div className="secondary" style={{ fontSize: 12.5, marginBottom: 16, lineHeight: 1.55 }}>{wf.description || 'No description.'}</div>
          {inputs.length ? inputs.map((inp) => (
            <div key={inp.name} style={{ marginBottom: 12 }}>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 5 }} htmlFor={'wf-input-' + inp.name}>
                {inp.name}
                {inp.required && <span style={{ color: 'var(--error)' }}> *</span>}
              </label>
              <input
                id={'wf-input-' + inp.name}
                className="input mono"
                style={{ width: '100%' }}
                placeholder={inp.description || (inp.name === 'SPEC_ID' ? 'REQ-AUTH-005' : 'value…')}
                value={vals[inp.name] || ''}
                onChange={(e) => setVals((v) => ({ ...v, [inp.name]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </div>
          )) : (
            <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>No inputs required.</div>
          )}
          <div className="row gap-6" style={{ marginTop: 6, marginBottom: 4 }}>
            {(wf.requires ?? []).map((r) => (
              <Pill key={r}><Icon name="check" size={10} />{r}</Pill>
            ))}
          </div>
          {error && (
            <div className="row gap-8" style={{ marginTop: 8, padding: '8px 10px', borderRadius: 7, background: 'var(--error-soft)', color: 'var(--error)', fontSize: 12 }}>
              <Icon name="cancel" size={13} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="row gap-8" style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={busy || missing.length > 0}
            title={missing.length ? 'Fill the required inputs: ' + missing.map((m) => m.name).join(', ') : undefined}
          >
            <Icon name="play" size={13} />{busy ? 'Launching…' : 'Launch run'}
          </button>
        </div>
      </div>
    </div>
  );
}
