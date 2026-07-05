/**
 * Design-system screen: renders every in-module chart/graph primitive with
 * reference data so the ports stay eyeball-verifiable against the snapshot
 * (specs/specship-desktop/snapshot.html). This is the one screen whose data
 * is intentionally static.
 */
import { useState } from 'react';
import { Donut, HBars, LineChart, Sparkline, StackedBars, Treemap } from '../components/charts';
import { GraphCanvas } from '../components/graph';
import { PageHead, Pill, Segmented, StatePill } from '../components/ui';

const SPARK = [4, 6, 5, 8, 7, 10, 9, 12, 11, 14];
const LINE = Array.from({ length: 14 }, (_, i) => ({ day: i + 1, cost: 4 + Math.sin(i / 2) * 2 + i * 0.6 }));
const DONUT = [
  { label: 'verified', cost: 12, color: 'var(--success)' },
  { label: 'implemented', cost: 7, color: 'var(--node-spec)' },
  { label: 'drifted', cost: 2, color: 'var(--warn)' },
];
const STACKED = [
  { label: 'specship', values: { a: 14, b: 6 } },
  { label: 'web-ng', values: { a: 9, b: 3 } },
];
const SEGMENTS = [
  { key: 'a', label: 'Fable', color: 'var(--accent)' },
  { key: 'b', label: 'Haiku', color: 'var(--node-route)' },
];
const HB = [
  { name: 'specship_explore', calls: 42 },
  { name: 'specship_node', calls: 17 },
  { name: 'specship_search', calls: 9 },
];
const TREE = [
  { key: 'a', label: 'server.ts', value: 42, intensity: 0.8, sub: '42 edits' },
  { key: 'b', label: 'tools.ts', value: 28, intensity: 0.5, sub: '28 edits' },
  { key: 'c', label: 'index.ts', value: 12, intensity: 0.2, sub: '12 edits' },
  { key: 'd', label: 'schema.sql', value: 8, intensity: 0.1, sub: '8 edits' },
];
const GNODES = [
  { id: 'spec', label: 'REQ-DESKTOP-017', kind: 'spec', x: 0, y: 40 },
  { id: 'fn', label: 'createServer', kind: 'code', x: 260, y: 0 },
  { id: 'test', label: 'ui-build-guard', kind: 'test', x: 260, y: 90 },
  { id: 'route', label: '/api/status', kind: 'route', x: 520, y: 40 },
];
const GEDGES = [
  { from: 'spec', to: 'fn' },
  { from: 'spec', to: 'test' },
  { from: 'fn', to: 'route', kind: 'synth' },
];

export function DesignSystemPage() {
  const [seg, setSeg] = useState('week');
  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="layers" title="Design system" sub="In-module SVG primitives — charts, pills, graph canvas (no third-party chart/CSS package)." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Pills + segmented</div>
          <div className="row gap-8" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            {['verified', 'implemented', 'drifted', 'broken', 'running', 'completed', 'failed'].map((s) => <StatePill key={s} state={s} />)}
            <Pill color="var(--accent)" bg="var(--accent-soft)" dot>custom</Pill>
          </div>
          <Segmented options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} value={seg} onChange={setSeg} size="sm" />
        </div>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Sparkline + line chart</div>
          <Sparkline data={SPARK} fill />
          <div style={{ marginTop: 10 }}>
            <LineChart series={LINE} h={160} />
          </div>
        </div>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Donut + stacked bars</div>
          <div className="row gap-16">
            <Donut data={DONUT} centerLabel="21" centerSub="links" />
            <div className="grow">
              <StackedBars rows={STACKED} segments={SEGMENTS} fmt={(v) => '$' + v.toFixed(0)} />
            </div>
          </div>
        </div>
        <div className="card card-pad">
          <div className="eyebrow" style={{ marginBottom: 12 }}>Horizontal bars + treemap</div>
          <HBars items={HB} />
          <div style={{ marginTop: 12 }}>
            <Treemap items={TREE} height={110} />
          </div>
        </div>
        <div className="card" style={{ gridColumn: '1 / -1', overflow: 'hidden' }}>
          <div className="eyebrow" style={{ padding: '12px 14px 0' }}>Graph canvas</div>
          <div style={{ height: 240 }}>
            <GraphCanvas nodes={GNODES} edges={GEDGES} />
          </div>
        </div>
      </div>
    </div>
  );
}
