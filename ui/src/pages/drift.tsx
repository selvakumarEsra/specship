import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import { Empty, PageHead, StatePill } from '../components/ui';
import type { PageProps } from './types';

export function DriftPage({ project }: PageProps) {
  const drift = useApi(() => api.drift(project), [project]);

  if (isNoProject(drift.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const links = drift.data?.links ?? [];

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="drift" title="Drift queue" sub={drift.data ? `${links.length} links need attention` : 'Loading drift…'} />
      {drift.data && !links.length && (
        <Empty icon="check" title="Nothing drifted" body="Every spec link is intact — the graph matches the specs." />
      )}
      <div className="card">
        {links.map((l, i) => (
          <div key={i} className="row gap-10" style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
            <StatePill state={l.state} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--node-spec)', flexShrink: 0 }}>{l.specId}</span>
            <span className="grow secondary" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.specTitle ?? ''}
            </span>
            {l.targetFile && <span className="mono muted" style={{ fontSize: 11 }}>{String(l.targetFile)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
