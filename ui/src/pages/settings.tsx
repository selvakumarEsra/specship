/**
 * Settings — appearance, backend info, Claude Code ingest, about
 * (REQ-DESKTOP-028). TSX port of specs/specship-desktop/screens-settings.jsx.
 * Appearance changes apply immediately + persist (A1, via theme.ts/prefs.ts
 * localStorage); the transcript-ingest toggle round-trips /api/config (A2, so
 * the analytics screens' useIngestConfig banner reacts); About shows the real
 * product version + DB backend from /api/status (A3).
 *
 * The design bundle's boot-animation toggle and editor picker are gone — no
 * boot splash and no open-in-editor feature ever shipped behind them
 * (REQ-SURF-004).
 */
import { type ReactNode, useState } from 'react';
import { api } from '../api';
import { Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { PageHead, Segmented } from '../components/ui';
import { useApi, useIngestConfig } from '../hooks';
import { type DensityPref, applyDensity, getDensity } from '../prefs';
import { applyTheme, getThemePref, type ThemePref } from '../theme';
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

function ToggleRow({ label, desc, on, onClick, busy }: { label: string; desc: string; on: boolean; onClick: () => void; busy?: boolean }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '8px 0' }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</div>
        <div className="muted" style={{ fontSize: 11 }}>{desc}</div>
      </div>
      <button
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={busy}
        onClick={onClick}
        style={{
          width: 38, height: 22, borderRadius: 11, border: 'none', cursor: busy ? 'wait' : 'pointer',
          background: on ? 'var(--accent)' : 'var(--bg-elevated)', position: 'relative', flexShrink: 0,
          transition: 'background var(--motion-fast)', opacity: busy ? 0.6 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left var(--motion-fast)',
        }} />
      </button>
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

export function SettingsPage(_props: PageProps) {
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [density, setDensity] = useState<DensityPref>(getDensity);

  const status = useApi(() => api.status(_props.project), [_props.project]);
  const ingest = useIngestConfig();
  const [savingIngest, setSavingIngest] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);

  const setThemeAndApply = (v: string) => { const t = v as ThemePref; setTheme(t); applyTheme(t); };
  const setDensityAndApply = (v: string) => { const d = v as DensityPref; setDensity(d); applyDensity(d); };

  const toggleIngest = async () => {
    const next = !(ingest.data?.ingestEnabled ?? false);
    setSavingIngest(true);
    setIngestError(null);
    try {
      await api.config.set({ ingestEnabled: next });
      ingest.reload();
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingIngest(false);
    }
  };

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 22 }}>
      <PageHead icon="settings" title="Settings" />
      <div style={{ maxWidth: 640 }}>
        <Section icon="sparkles" title="Appearance">
          <Field label="Theme" hint="Dark, light, or follow your OS">
            <Segmented
              value={theme}
              onChange={setThemeAndApply}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]}
            />
          </Field>
          <Field label="Density" hint="Row height & padding">
            <Segmented
              value={density}
              onChange={setDensityAndApply}
              options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
            />
          </Field>
        </Section>

        <Section icon="sessions" title="Claude Code">
          <ToggleRow
            label="Enable transcript ingest"
            desc="Read JSONL transcripts from ~/.claude/projects for analytics"
            on={ingest.data?.ingestEnabled ?? false}
            onClick={toggleIngest}
            busy={savingIngest || ingest.loading}
          />
          {ingestError && (
            <div style={{ fontSize: 11.5, color: 'var(--error)', padding: '4px 0' }}>{ingestError}</div>
          )}
          {savingIngest && (
            <div className="muted" style={{ fontSize: 11.5, padding: '4px 0' }}>Saving…</div>
          )}
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
