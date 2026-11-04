/**
 * Settings — appearance, backend info, about (REQ-DESKTOP-028). TSX port of
 * specs/specship-desktop/screens-settings.jsx. Appearance (density only — the
 * dashboard is dark-only, REQ-DASHTHEME-003) applies immediately + persists
 * (A1, via prefs.ts localStorage); About shows the real product version + DB
 * backend from /api/status (A3).
 *
 * The transcript-ingest toggle (and its agent-named section) is gone: it was
 * specific to one coding agent, and no screen may name or assume one
 * (REQ-DASHSIMPLE-001.A7, superseding REQ-DESKTOP-028.A2).
 *
 * The design bundle's boot-animation toggle and editor picker are gone — no
 * boot splash and no open-in-editor feature ever shipped behind them
 * (REQ-SURF-004).
 */
import { type ReactNode, useState } from 'react';
import { api } from '../api';
import { Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { PageHead, Segmented, Switch } from '../components/ui';
import { useApi } from '../hooks';
import { type DensityPref, applyDensity, getDensity } from '../prefs';
import type { PageProps } from './types';

function Section({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="card card-pad" style={{ marginBottom: 14 }}>
      <div className="row gap-8" style={{ marginBottom: 12 }}>
        <Icon name={icon} size={15} style={{ color: 'var(--text-secondary)' }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ padding: '8px 0' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
        {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** A labelled setting row built on the kit's Switch (REQ-DASHTHEME-004). */
// @implements REQ-DASHTHEME-004
function ToggleRow({ label, desc, on, onClick, busy }: { label: string; desc: string; on: boolean; onClick: () => void; busy?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '8px 0' }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11 }}>{desc}</div>
      </div>
      <Switch checked={on} onChange={onClick} label={label} busy={busy} />
    </div>
  );
}

function AboutRow({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '6px 0', fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      <span className="mono" style={{ color: color ?? 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// @implements REQ-DASHSIMPLE-001
export function SettingsPage(_props: PageProps) {
  const [density, setDensity] = useState<DensityPref>(getDensity);

  const status = useApi(() => api.status(_props.project), [_props.project]);

  const setDensityAndApply = (v: string) => { const d = v as DensityPref; setDensity(d); applyDensity(d); };

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="settings" title="Settings" />
      <div style={{ maxWidth: 640 }}>
        <Section icon="sparkles" title="Appearance">
          <Field label="Density" hint="Row height & padding">
            <Segmented
              value={density}
              onChange={setDensityAndApply}
              options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
            />
          </Field>
        </Section>

        <Section icon="database" title="Backend">
          <Module state={status} label="Backend" minHeight={120}>
            {(s) => (
              <>
                <AboutRow label="Database backend" value={s.backend} />
                <AboutRow label="Journal mode" value={s.journalMode} />
                <AboutRow label="Project root" value={<span title={s.projectPath}>{s.projectPath}</span>} />
                <AboutRow label="Indexed files" value={s.fileCount.toLocaleString()} />
              </>
            )}
          </Module>
        </Section>

        <Section icon="graph" title="About">
          <Module state={status} label="About" minHeight={90}>
            {(s) => (
              <>
                <AboutRow label="Version" value={`v${s.version}`} />
                <AboutRow label="Backend" value={s.backend} color="var(--success)" />
                {/* No MCP-server row: this page has no probe for it, and the
                    literal "running" it used to print was a guess
                    (REQ-REVINT-007.A1). The MCP page probes for real. */}
              </>
            )}
          </Module>
        </Section>
      </div>
    </div>
  );
}
