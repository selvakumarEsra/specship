import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import { Empty, PageHead, StatePill } from '../components/ui';
import type { PageProps } from './types';

export function SpecsPage({ project }: PageProps) {
  const specs = useApi(() => api.specs(project), [project]);

  if (isNoProject(specs.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  const docs = specs.data?.specs ?? [];
  const linkStates = specs.data?.linkStates ?? {};

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="book" title="Specs" sub={specs.data ? `${docs.length} requirements` : 'Loading specs…'} />
      {specs.data && !docs.length && (
        <Empty icon="book" title="No specs yet" body="Author one with the spec-author skill — specs/*.md index on sync." />
      )}
      <div className="card">
        {docs.map((d, i) => (
          <div key={d.id ?? i} className="row gap-10" style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
            <span className="mono" style={{ fontSize: 12, color: 'var(--node-spec)', flexShrink: 0 }}>{d.id}</span>
            <span className="grow" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
            {linkStates[d.id] && <StatePill state={linkStates[d.id]!} />}
          </div>
        ))}
      </div>
    </div>
  );
}
