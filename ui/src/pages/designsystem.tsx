/**
 * Design system — the living token gallery (REQ-DESKTOP-028.A4) and the
 * shared UI kit in every state (REQ-DASHTHEME-004.A2). Every
 * swatch, control state, and pill renders `var(<token>)` from the manifest in
 * ../tokens, so it is the LIVE token value, never a hard-coded hex. The
 * gallery is rendered once, in the dark theme wrapper — the dashboard is
 * dark-only (REQ-DASHTHEME-003), so there is no light variant to show. Also
 * showcases the in-module SVG chart/graph primitives so the ports stay
 * eyeball-verifiable against the snapshot.
 */
import { useState } from 'react';
import { Donut, HBars, LineChart, Sparkline, StackedBars, Treemap } from '../components/charts';
import { GraphCanvas } from '../components/graph';
import { StatTile } from '../components/dashboard-modules';
import { Button, Chip, Empty, ErrorState, PageHead, Pill, SampleBadge, Segmented, StatePill, Switch } from '../components/ui';
import {
  BUTTON_VARIANTS,
  FORCED_STATE_CLASS,
  KIT_COMPONENT_STATES,
  type KitState,
  NODE_TOKENS,
  PILL_GROUPS,
  RADIUS_TOKENS,
  SEMANTIC_TOKENS,
  SPACE_TOKENS,
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

/**
 * One kit sample in one state. data-kit / data-kit-state let the
 * REQ-DASHTHEME-004.A2 test prove every component renders in every state.
 */
function KitSample({ kit, state, children }: { kit: string; state: KitState; children: React.ReactNode }) {
  return (
    <div data-kit={kit} data-kit-state={state} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', alignItems: 'flex-start' }}>
      {children}
      <div className="mono muted" style={{ fontSize: 'var(--fs-xs)' }}>{state}</div>
    </div>
  );
}

const noop = () => undefined;
const forced = (st: KitState) => FORCED_STATE_CLASS[st];

/** Every shared-kit component in each of its states (REQ-DASHTHEME-004.A2). */
function KitGallery() {
  return (
    <>
      <DSBlock title="Buttons · every state" span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
          {BUTTON_VARIANTS.map((v) => (
            <div key={v.variant} className="row gap-10" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              {v.states.map((st) => (
                <KitSample key={st} kit="button" state={st}>
                  <Button
                    variant={v.variant}
                    size="sm"
                    className={forced(st)}
                    disabled={st === 'disabled'}
                    loading={st === 'loading'}
                    aria-label={`${v.label} ${st}`}
                  >
                    {v.label}
                  </Button>
                </KitSample>
              ))}
            </div>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Cards · every state">
        <div className="row gap-10" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {KIT_COMPONENT_STATES.card!.map((st) => (
            <KitSample key={st} kit="card" state={st}>
              {st === 'default'
                ? <div className="card card-pad">Card</div>
                : <button type="button" className={'card card-btn card-pad' + (forced(st) ? ' ' + forced(st) : '')} disabled={st === 'disabled'}>Clickable card</button>}
            </KitSample>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Stat tiles · every state">
        <div className="row gap-10" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {KIT_COMPONENT_STATES['stat-tile']!.map((st) => (
            <KitSample key={st} kit="stat-tile" state={st}>
              {st === 'loading'
                ? <div className="skel" aria-busy="true" aria-label="Loading stat" style={{ width: 'var(--empty-icon)', height: 'var(--empty-icon)' }} />
                : <StatTile icon="check" label="Verified" value="42" note="links" className={forced(st)} disabled={st === 'disabled'} onClick={noop} />}
            </KitSample>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Chips · every state">
        <div className="row gap-10" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {KIT_COMPONENT_STATES.chip!.map((st) => (
            <KitSample key={st} kit="chip" state={st}>
              <Chip
                label="Spec"
                count={12}
                color="var(--node-spec)"
                active={st === 'on'}
                className={forced(st)}
                disabled={st === 'disabled'}
                onClick={noop}
              />
            </KitSample>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Segmented · every state">
        <div className="row gap-10" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {KIT_COMPONENT_STATES.segmented!.map((st) => (
            <KitSample key={st} kit="segmented" state={st}>
              {st === 'hover' || st === 'pressed' ? (
                // Static mirror: the forced class sits on the unselected segment.
                <div className="seg" role="radiogroup" aria-label={`Segmented ${st}`}>
                  <button type="button" role="radio" aria-checked className="seg-btn active" tabIndex={-1}>Day</button>
                  <button type="button" role="radio" aria-checked={false} className={'seg-btn ' + forced(st)} tabIndex={-1}>Week</button>
                </div>
              ) : (
                <Segmented options={['Day', 'Week']} value="Day" onChange={noop} disabled={st === 'disabled'} label={`Segmented ${st}`} />
              )}
            </KitSample>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Switches · every state">
        <div className="row gap-10" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {KIT_COMPONENT_STATES.switch!.map((st) => (
            <KitSample key={st} kit="switch" state={st}>
              <Switch
                checked={st === 'on'}
                onChange={noop}
                label={`Switch ${st}`}
                className={forced(st)}
                disabled={st === 'disabled'}
                busy={st === 'loading'}
              />
            </KitSample>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Empty & error states" span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-md)' }}>
          <KitSample kit="empty" state="default">
            <Empty icon="book" title="No specs yet" body="Author one with the spec-author skill." action={<Button variant="outline" size="sm">Learn how</Button>} />
          </KitSample>
          <KitSample kit="error" state="default">
            <ErrorState title="Couldn't load specs" detail="fetch failed: 503" action={<Button variant="outline" size="sm">Retry</Button>} />
          </KitSample>
        </div>
      </DSBlock>
    </>
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

      <DSBlock title="Spacing">
        <div className="col" style={{ gap: 6 }}>
          {SPACE_TOKENS.map((t) => (
            <div key={t.varName} className="row" style={{ gap: 10, alignItems: 'center' }}>
              <div style={{ width: `var(${t.varName})`, height: 12, background: 'var(--accent)', borderRadius: 2, flexShrink: 0 }} />
              <div style={{ fontSize: 11, fontWeight: 500 }}>{t.name}</div>
              <div className="mono muted" style={{ fontSize: 10 }}>{t.varName}</div>
            </div>
          ))}
        </div>
      </DSBlock>

      <DSBlock title="Radius">
        <div className="row gap-10" style={{ flexWrap: 'wrap' }}>
          {RADIUS_TOKENS.map((t) => (
            <div key={t.varName} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 72 }}>
              <div style={{ height: 40, borderRadius: `var(${t.varName})`, background: 'var(--fill)', border: '1px solid var(--border-strong)' }} />
              <div style={{ fontSize: 11, fontWeight: 500 }}>{t.name}</div>
              <div className="mono muted" style={{ fontSize: 10 }}>{t.varName}</div>
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

      <KitGallery />

      {PILL_GROUPS.map((g) => (
        <DSBlock key={g.label} title={g.label}>
          <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
            {g.states.map((s) => <StatePill key={s} state={s} />)}
          </div>
        </DSBlock>
      ))}

      <DSBlock title="Pills & badges">
        <div className="row gap-8" style={{ flexWrap: 'wrap' }} data-kit="badge" data-kit-state="default">
          <Pill color="var(--accent)" bg="var(--accent-soft)" dot>custom</Pill>
          <Pill color="var(--node-code)" bg="var(--node-code-soft)">code</Pill>
          <Pill color="var(--text-secondary)" bg="var(--bg-elevated)">neutral</Pill>
        </div>
      </DSBlock>
    </div>
  );
}

const SPARK = [4, 6, 5, 8, 7, 10, 9, 12, 11, 14];
const LINE = Array.from({ length: 14 }, (_, i) => ({ day: i + 1, count: Math.round(4 + Math.sin(i / 2) * 2 + i * 0.6) }));
const DONUT = [
  { label: 'verified', count: 12, color: 'var(--success)' },
  { label: 'implemented', count: 7, color: 'var(--node-spec)' },
  { label: 'drifted', count: 2, color: 'var(--warn)' },
];
const STACKED = [
  { label: 'specship', values: { a: 14, b: 6 } },
  { label: 'web-ng', values: { a: 9, b: 3 } },
];
const SEGMENTS = [
  { key: 'a', label: 'specs', color: 'var(--accent)' },
  { key: 'b', label: 'tests', color: 'var(--node-route)' },
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
    <>
    <div className="row gap-8" style={{ margin: '20px 0 8px' }}>
      <div className="eyebrow">Chart & graph primitives</div>
      <SampleBadge title="Illustrative reference data — these primitives have no backend; every data screen binds to your live project." />
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
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
          <div className="grow"><StackedBars rows={STACKED} segments={SEGMENTS} /></div>
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
    </>
  );
}

// @implements REQ-DASHTHEME-004
export function DesignSystemPage() {
  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="layers" title="Design system" sub="Tokens, components and states — rendered live in the dark theme, WCAG AA." />
      <div data-theme="dark" style={{ marginBottom: 20, borderRadius: 12, background: 'var(--bg-canvas)', padding: 16, border: '1px solid var(--border-subtle)' }}>
        <div className="eyebrow" data-testid="theme-dark" style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>dark theme</div>
        <Gallery />
      </div>
      <Primitives />
    </div>
  );
}
