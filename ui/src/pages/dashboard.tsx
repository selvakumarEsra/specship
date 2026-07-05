/**
 * Dashboard — the snapshot's module grid bound to live data
 * (REQ-DESKTOP-020): stat tiles / recent neighborhood + tips rail /
 * tool-call heatstrip / recent prompts + cache analytics, arranged per
 * specs/specship-desktop/screens-dashboard.jsx.
 */
import { useState } from 'react';
import { api, isNoProject } from '../api';
import { useApi } from '../hooks';
import {
  CacheCard,
  Heatstrip,
  Module,
  RecentNeighborhood,
  RecentPrompts,
  StatTile,
  TipsRail,
} from '../components/dashboard-modules';
import { Empty, PageHead, RangeSelector } from '../components/ui';
import { go } from '../router';
import type { PageProps } from './types';

const fmtInt = (n: number) => n.toLocaleString();

// @implements REQ-DESKTOP-020
export function DashboardPage({ project }: PageProps) {
  const [range, setRange] = useState('week');
  const status = useApi(() => api.status(project), [project]);
  const stats = useApi(() => api.claudeStats(range), [range]);
  const costs = useApi(() => api.claudeCosts(range), [range]);
  const cache = useApi(() => api.claudeCache(range), [range]);
  const heatmap = useApi(() => api.claudeHeatmap(range), [range]);
  const tips = useApi(() => api.claudeTips(), []);
  const graph = useApi(() => api.graphFull(project), [project]);

  if (isNoProject(status.error)) {
    return <Empty icon="folder" title="No project selected" body="Pick an indexed project from the switcher in the status strip." />;
  }

  // A4: zero ingested sessions — the transcript-fed modules render the
  // enable-ingest guidance instead of presenting zeros as truth.
  const noIngest = stats.data?.sessionCount === 0;
  const reloadIngestFed = () => { stats.reload(); costs.reload(); cache.reload(); heatmap.reload(); tips.reload(); };

  // A2: Apply/Dismiss persists server-side; reload re-fetches the annotated
  // list (dismissed rows disappear, applied ones come back marked).
  const setTipState = (id: string, state: 'applied' | 'dismissed') => {
    api.setTipState(id, state)
      .catch(() => undefined)
      .finally(() => tips.reload());
  };

  const s = status.data;
  const projectName = s ? (s.projectPath.split('/').filter(Boolean).pop() ?? s.projectPath) : '';
  const lastCost = !noIngest && stats.data ? ' · last session $' + stats.data.lastSessionCost.value.toFixed(2) : '';
  const sub = s ? `${projectName} · ${fmtInt(s.nodeCount)} nodes${lastCost}` : 'Loading project status…';

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
      <PageHead icon="dashboard" title="Dashboard" sub={sub} actions={<RangeSelector value={range} onChange={setRange} />} />

      {/* Stat tiles */}
      <div style={{ marginBottom: 14 }}>
        <Module state={stats} label="usage stats" minHeight={86}>
          {(d) => (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <StatTile icon="coins" color="var(--accent)" label="Last session cost"
                value={noIngest ? '—' : '$' + d.lastSessionCost.value.toFixed(2)}
                delta={noIngest ? undefined : d.lastSessionCost.delta} deltaInvert
                spark={noIngest ? undefined : d.lastSessionCost.series} sparkColor="var(--accent)"
                note={noIngest ? 'no transcript data — enable ingest' : undefined}
                onClick={() => go('sessions')} />
              <StatTile icon="wrench" color="var(--node-spec)" label="Tool calls · 7d"
                value={noIngest ? '—' : fmtInt(d.toolCalls.value)}
                delta={noIngest ? undefined : d.toolCalls.delta} deltaInvert
                spark={noIngest ? undefined : d.toolCalls.series} sparkColor="var(--node-spec)"
                note={noIngest ? 'no transcript data — enable ingest' : undefined}
                onClick={() => go('heatmap')} />
              <StatTile icon="bot" color="var(--node-code)" label="Subagent spend"
                value={noIngest ? '—' : d.subagentPct.value + '%'}
                delta={noIngest ? undefined : d.subagentPct.delta} deltaInvert
                spark={noIngest ? undefined : d.subagentPct.series} sparkColor="var(--node-code)"
                note={noIngest ? 'no transcript data — enable ingest' : undefined}
                onClick={() => go('heatmap')} />
              <StatTile icon="drift" color="var(--warn)" label="Drift queue"
                value={fmtInt(d.drift.value)} delta={d.drift.delta} deltaInvert
                sparkColor="var(--warn)"
                onClick={() => go('drift')} />
            </div>
          )}
        </Module>
      </div>

      {/* Center row: recent neighborhood + tips rail */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 14 }}>
        <Module state={graph} label="recent neighborhood" minHeight={340}>
          {(g) => <RecentNeighborhood graph={g} heatFiles={heatmap.data?.files ?? []} />}
        </Module>
        <Module state={tips} label="tips" minHeight={340}>
          {(d) => <TipsRail tips={d.tips} onSetState={setTipState} noIngest={noIngest} onIngested={reloadIngestFed} />}
        </Module>
      </div>

      {/* Heatstrip */}
      <div style={{ marginBottom: 14 }}>
        <Module state={heatmap} label="tool-call heatmap" minHeight={180}>
          {(h) => <Heatstrip files={h.files} noIngest={noIngest} onIngested={reloadIngestFed} />}
        </Module>
      </div>

      {/* Bottom row: recent prompts + cache analytics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
        <Module state={costs} label="recent prompts" minHeight={300}>
          {(c) => <RecentPrompts prompts={c.topPrompts} noIngest={noIngest} onIngested={reloadIngestFed} />}
        </Module>
        <Module state={cache} label="cache analytics" minHeight={300}>
          {(c) => <CacheCard cache={c} range={range} noIngest={noIngest} onIngested={reloadIngestFed} />}
        </Module>
      </div>
    </div>
  );
}
