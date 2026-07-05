import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import { Empty, PageHead, StatePill } from '../components/ui';
import type { PageProps } from './types';

function fmtWhen(v: string | number | null | undefined): string {
  if (v == null) return '';
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

export function RunsPage({ project }: PageProps) {
  const runs = useApi(() => api.runs(project), [project]);

  if (isNoProject(runs.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const list = runs.data?.runs ?? [];

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="play" title="Runs" sub={runs.data ? `${list.length} workflow runs` : 'Loading runs…'} />
      {runs.data && !list.length && (
        <Empty icon="play" title="No runs yet" body="Workflow runs started from the CLI or dashboard land here." />
      )}
      <div className="card">
        {list.map((r, i) => (
          <div key={r.id} className="row gap-10" style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
            <StatePill state={r.status} />
            <span className="mono grow" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {String(r.workflowId ?? r.id)}
            </span>
            <span className="muted tabular" style={{ fontSize: 11 }}>{fmtWhen(r.startedAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
