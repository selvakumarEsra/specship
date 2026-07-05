import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import { Donut, HBars } from '../components/charts';
import { Empty, PageHead, StatePill, nodeColor } from '../components/ui';
import { go } from '../router';
import type { PageProps } from './types';

const fmtInt = (n: number) => n.toLocaleString();

export function DashboardPage({ project }: PageProps) {
  const status = useApi(() => api.status(project), [project]);
  const specs = useApi(() => api.specs(project), [project]);
  const drift = useApi(() => api.drift(project), [project]);
  const runs = useApi(() => api.runs(project), [project]);

  if (isNoProject(status.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const s = status.data;
  const kindItems = s
    ? Object.entries(s.nodesByKind)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }))
    : [];

  const stateCounts: Record<string, number> = {};
  for (const st of Object.values(specs.data?.linkStates ?? {})) {
    stateCounts[st] = (stateCounts[st] || 0) + 1;
  }
  const donutData = Object.entries(stateCounts).map(([label, n]) => ({
    label,
    cost: n,
    color:
      label === 'verified' ? 'var(--success)'
      : label === 'drifted' ? 'var(--warn)'
      : label === 'broken' || label === 'orphaned' ? 'var(--error)'
      : 'var(--node-spec)',
  }));

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="dashboard" title="Dashboard" sub={s ? s.projectPath : 'Loading project status…'} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Stat label="Nodes" value={s ? fmtInt(s.nodeCount) : '—'} />
        <Stat label="Edges" value={s ? fmtInt(s.edgeCount) : '—'} />
        <Stat label="Files" value={s ? fmtInt(s.fileCount) : '—'} />
        <Stat label="Drift" value={s ? fmtInt(s.drift) : '—'} tone={s && s.drift > 0 ? 'var(--warn)' : 'var(--success)'} onClick={() => go('drift')} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Nodes by kind</div>
          {kindItems.length ? (
            <HBars items={kindItems} labelKey="name" valueKey="count" color={(it) => nodeColor(String(it.name) === 'route' ? 'route' : 'code')} fmt={fmtInt} />
          ) : (
            <div className="muted">No index yet — run specship index.</div>
          )}
        </div>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Spec link states</div>
          {donutData.length ? (
            <div className="row gap-16">
              <Donut data={donutData} centerLabel={String(Object.keys(specs.data?.linkStates ?? {}).length)} centerSub="linked specs" />
              <div className="col gap-6">
                {donutData.map((d) => (
                  <div key={d.label} className="row gap-8">
                    <span className="pill-dot" style={{ background: d.color, width: 8, height: 8, borderRadius: '50%' }} />
                    <span className="secondary" style={{ fontSize: 12 }}>{d.label}</span>
                    <span className="tabular mono" style={{ fontSize: 12 }}>{d.cost}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="muted">No spec links yet.</div>
          )}
        </div>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Drift queue</div>
          {(drift.data?.links ?? []).slice(0, 6).map((l, i) => (
            <div key={i} className="row gap-8" style={{ padding: '5px 0', cursor: 'pointer' }} onClick={() => go('drift')}>
              <StatePill state={l.state} />
              <span className="mono grow" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.specId}</span>
            </div>
          ))}
          {drift.data && !drift.data.links.length && <div className="muted">Nothing drifted — graph is clean.</div>}
        </div>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Recent runs</div>
          {(runs.data?.runs ?? []).slice(0, 6).map((r) => (
            <div key={r.id} className="row gap-8" style={{ padding: '5px 0', cursor: 'pointer' }} onClick={() => go('runs')}>
              <StatePill state={r.status} />
              <span className="mono grow" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(r.workflowId ?? r.id)}</span>
            </div>
          ))}
          {runs.data && !runs.data.runs.length && <div className="muted">No workflow runs yet.</div>}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: string; tone?: string; onClick?: () => void }) {
  return (
    <div className="card card-pad" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="eyebrow">{label}</div>
      <div className="tabular" style={{ fontSize: 'var(--fs-big)', fontWeight: 650, marginTop: 4, color: tone }}>{value}</div>
    </div>
  );
}
