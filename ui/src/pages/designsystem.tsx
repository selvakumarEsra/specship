/**
 * Design system — the living token gallery (REQ-DESKTOP-028.A4). Every
 * swatch, control state, and pill renders `var(<token>)` from the manifest in
 * ../tokens, so it is the LIVE token value, never a hard-coded hex. The whole
 * gallery is rendered twice — once in a dark theme wrapper, once in a light
 * one — so both themes are visible side by side (A4: "in both themes"). Also
 * showcases the in-module SVG chart/graph primitives so the ports stay
 * eyeball-verifiable against the snapshot.
 */
import { useState } from 'react';
import { Donut, HBars, LineChart, Sparkline, StackedBars, Treemap } from '../components/charts';
import { GraphCanvas } from '../components/graph';
import { PageHead, Pill, Segmented, StatePill } from '../components/ui';
import {
  BUTTON_VARIANTS,
  FORCED_STATE_CLASS,
  NODE_TOKENS,
  PILL_GROUPS,
  SEMANTIC_TOKENS,
  SURFACE_TOKENS,
  TYPE_SCALE,
  type TokenSwatch,
} from '../tokens';

function DSBlock({ title, children, span }: { title: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div className="card card-pad" style={span ? { gridColumn: '1 / -1' } : undefined}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Swatch({ tok }: { tok: TokenSwatch }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 96 }}>
      <div style={{ height: 40, borderRadius: 8, background: `var(${tok.varName})`, border: '1px solid var(--border-subtle)' }} />
      <div style={{ fontSize: 11, fontWeight: 500 }}>{tok.name}</div>
      <div className="mono muted" style={{ fontSize: 10 }}>{tok.varName}</div>
    </div>
  );
}

/** The gallery body — pure token/state rendering; re-used per theme. */
function Gallery() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
      <DSBlock title="Surfaces & text">
        <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
          {SURFACE_TOKENS.map((t) => <Swatch key={t.varName} tok={t} />)}
        </div>
      </DSBlock>

      <DSBlock title="Node colors · distinct at 4px">
        <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
          {NODE_TOKENS.map((t) => <Swatch key={t.varName} tok={t} />)}
        </div>
      </DSBlock>

      <DSBlock title="Semantic states">
        <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
          {SEMANTIC_TOKENS.map((s) => (
            <div key={s.varName} style={{ minWidth: 96 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <div style={{ flex: 1, height: 40, borderRadius: '8px 0 0 8px', background: `var(${s.varName})` }} />
                <div style={{ flex: 1, height: 40, borderRadius: '0 8px 8px 0', background: `var(${s.softVar})` }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, marginTop: 4 }}>{s.state}</div>
              <div className="mono muted" style={{ fontSize: 10 }}>{s.varName}</div>
            </div>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Typography">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {TYPE_SCALE.map((t) => (
            <div key={t.label + t.sample}>
              <span
                className={t.mono ? 'mono' : undefined}
                style={{ fontSize: `var(${t.varName})`, fontWeight: 500 }}
              >{t.sample}</span>
              <span className="muted" style={{ fontSize: 10.5, marginLeft: 8 }}>{t.label}</span>
            </div>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Buttons · every state">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {BUTTON_VARIANTS.map((v) => (
            <div key={v.className} className="row gap-6" style={{ flexWrap: 'wrap' }}>
              {v.states.map((st) => {
                const forced = FORCED_STATE_CLASS[st];
                return (
                  <button
                    key={st}
                    className={`btn ${v.className} btn-sm${forced ? ' ' + forced : ''}`}
                    disabled={st === 'disabled' || st === 'loading'}
                    aria-busy={st === 'loading'}
                    aria-label={`${v.label} ${st}`}
                  >
                    {v.label} · {st}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </DSBlock>

      {PILL_GROUPS.map((g) => (
        <DSBlock key={g.label} title={g.label}>
          <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
            {g.states.map((s) => <StatePill key={s} state={s} />)}
          </div>
        </DSBlock>
      ))}

      <DSBlock title="Pills & badges">
        <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
          <Pill color="var(--accent)" bg="var(--accent-soft)" dot>custom</Pill>
          <Pill color="var(--node-code)" bg="var(--node-code-soft)">code</Pill>
          <Pill color="var(--text-secondary)" bg="var(--bg-elevated)">neutral</Pill>
        </div>
      </DSBlock>
    </div>
  );
}

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

/** In-module SVG primitives — proves no third-party chart/CSS package. */
function Primitives() {
  const [seg, setSeg] = useState('week');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
      <div className="card card-pad">
        <div className="eyebrow" style={{ marginBottom: 12 }}>Segmented</div>
        <Segmented options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} value={seg} onChange={setSeg} size="sm" />
      </div>
      <div className="card card-pad">
        <div className="eyebrow" style={{ marginBottom: 12 }}>Sparkline + line</div>
        <Sparkline data={SPARK} fill />
        <div style={{ marginTop: 10 }}><LineChart series={LINE} h={140} /></div>
      </div>
      <div className="card card-pad">
        <div className="eyebrow" style={{ marginBottom: 12 }}>Donut + stacked bars</div>
        <div className="row gap-16">
          <Donut data={DONUT} centerLabel="21" centerSub="links" />
          <div className="grow"><StackedBars rows={STACKED} segments={SEGMENTS} fmt={(v) => '$' + v.toFixed(0)} /></div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="eyebrow" style={{ marginBottom: 12 }}>Bars + treemap</div>
        <HBars items={HB} />
        <div style={{ marginTop: 12 }}><Treemap items={TREE} height={110} /></div>
      </div>
      <div className="card" style={{ gridColumn: '1 / -1', overflow: 'hidden' }}>
        <div className="eyebrow" style={{ padding: '12px 14px 0' }}>Graph canvas</div>
        <div style={{ height: 220 }}><GraphCanvas nodes={GNODES} edges={GEDGES} /></div>
      </div>
    </div>
  );
}

export function DesignSystemPage() {
  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="layers" title="Design system" sub="Tokens, components and states — rendered live in both themes, WCAG AA." />
      {(['dark', 'light'] as const).map((theme) => (
        <div key={theme} data-theme={theme} style={{ marginBottom: 20, borderRadius: 12, background: 'var(--bg-canvas)', padding: 16, border: '1px solid var(--border-subtle)' }}>
          <div className="eyebrow" data-testid={`theme-${theme}`} style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>{theme} theme</div>
          <Gallery />
        </div>
      ))}
      <Primitives />
    </div>
  );
}
