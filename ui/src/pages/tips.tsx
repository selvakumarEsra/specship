/**
 * Tips — "a senior teammate reviewed your transcripts" (REQ-DESKTOP-024):
 * severity-ordered tip cards with evidence, impact, fix and Apply / Dismiss,
 * arranged per specs/specship-desktop/screens-claude.jsx Tips. The tips
 * state is OWNED by App (its useApi feeds the sidebar badge), so a dismissal
 * here updates the badge in the same reload (A4).
 */
import { useEffect, useRef, useState } from 'react';
import { api, type ClaudeTip, type ClaudeTipsResponse } from '../api';
import { IngestGuidance } from '../components/claude-analytics';
import { Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { CopyBtn, PageHead, Pill } from '../components/ui';
import { useApi, type ApiState } from '../hooks';
import { go } from '../router';
import type { PageProps } from './types';

const SEV_ORDER: Record<string, number> = { error: 0, warn: 1, info: 2 };
const sevColor = (sev: string): string =>
  sev === 'error' ? 'var(--error)' : sev === 'warn' ? 'var(--warn)' : 'var(--info)';

export interface TipsPageProps extends PageProps {
  /** App's shared tips state — the same fetch the sidebar badge counts. */
  tips: ApiState<ClaudeTipsResponse>;
  onSetTipState: (id: string, state: 'applied' | 'dismissed') => void;
}

// @implements REQ-DESKTOP-024
export function TipsPage({ query, tips, onSetTipState }: TipsPageProps) {
  const stats = useApi(() => api.claudeStats(), []);
  const noIngest = stats.data?.sessionCount === 0;
  const focusId = query.sel;

  const list = tips.data?.tips ?? [];
  const ordered = [...list].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
  const count = (sev: string) => list.filter((t) => t.severity === sev && t.state !== 'applied').length;

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
      <PageHead
        icon="tips"
        title="Tips"
        sub="A senior teammate reviewed your transcripts"
        actions={
          list.length > 0 && (
            <div className="row gap-6">
              <Pill color="var(--error)" bg="var(--error-soft)">{count('error')} urgent</Pill>
              <Pill color="var(--warn)" bg="var(--warn-soft)">{count('warn')} warn</Pill>
              <Pill color="var(--info)" bg="var(--info-soft)">{count('info')} info</Pill>
            </div>
          )
        }
      />
      {noIngest && !list.length
        ? <IngestGuidance onIngested={() => { stats.reload(); tips.reload(); }} />
        : (
          <Module state={tips} label="tips" minHeight={240}>
            {(d) => (d.tips.length
              ? (
                <div className="col gap-12" style={{ maxWidth: 860 }}>
                  {ordered.map((t) => (
                    <TipCard key={t.id} tip={t} focus={t.id === focusId}
                      onApply={() => onSetTipState(t.id, 'applied')}
                      onDismiss={() => onSetTipState(t.id, 'dismissed')} />
                  ))}
                </div>
              )
              : <div className="muted" style={{ fontSize: 12.5, padding: 8 }}>No tips — nothing wasteful in your recent sessions.</div>)}
          </Module>
        )}
    </div>
  );
}

function TipCard({ tip, focus, onApply, onDismiss }: {
  tip: ClaudeTip; focus: boolean; onApply: () => void; onDismiss: () => void;
}) {
  const [lit, setLit] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // ?sel= deep link (the dashboard rail navigates here): scroll the card into
  // view and ring it briefly, per the design's focus treatment.
  useEffect(() => {
    if (!focus || !ref.current) return;
    const card = ref.current;
    const sc = card.closest('.scroll-y');
    if (sc) sc.scrollTop = Math.max(0, card.offsetTop - 20);
    setLit(true);
    const t = setTimeout(() => setLit(false), 1800);
    return () => clearTimeout(t);
  }, [focus]);

  const col = sevColor(tip.severity);
  const applied = tip.state === 'applied';
  return (
    <div ref={ref} className="card" style={{ display: 'flex', opacity: applied ? 0.7 : 1, transition: 'box-shadow var(--motion-fast), border-color var(--motion-fast)', boxShadow: lit ? `0 0 0 2px ${col}` : 'none', borderColor: lit ? col : undefined }}>
      <div style={{ width: 3, background: col, flexShrink: 0, borderRadius: '9px 0 0 9px' }} />
      <div style={{ padding: '14px 16px', flex: 1, minWidth: 0 }}>
        <div className="row gap-10" style={{ marginBottom: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${col} 16%, transparent)`, display: 'grid', placeItems: 'center', color: col, flexShrink: 0 }}>
            <Icon name={tip.icon} size={15} />
          </div>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', textWrap: 'pretty' }}>{tip.title}</div>
          </div>
          <Pill color={col} bg={`color-mix(in srgb, ${col} 14%, transparent)`}>{tip.severity}</Pill>
        </div>
        <div className="secondary" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>{tip.why}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div
            onClick={() => go('sessions', { query: { sel: tip.evidence.session } })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go('sessions', { query: { sel: tip.evidence.session } }); } }}
            title={'Open session ' + tip.evidence.session}
            className="list-row"
            style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10, cursor: 'pointer' }}
          >
            <div className="row gap-6" style={{ marginBottom: 5 }}>
              <span className="eyebrow">Evidence</span>
              <span className="grow" />
              <Icon name="arrowRight" size={11} style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="row gap-6" style={{ fontSize: 11.5 }}>
              <Icon name="sessions" size={11} style={{ color: 'var(--text-muted)' }} />
              <span className="mono" style={{ color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tip.evidence.session}</span>
            </div>
            <div className="mono secondary" style={{ fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tip.evidence.detail}</div>
          </div>
          <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 10 }}>
            <div className="eyebrow" style={{ marginBottom: 5 }}>Impact</div>
            <div className="tabular" style={{ fontSize: 16, fontWeight: 700, color: 'var(--success)' }}>{tip.saving}</div>
          </div>
        </div>
        <div className="row gap-8" style={{ alignItems: 'center' }}>
          <div className="row gap-8 grow" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '6px 10px', minWidth: 0 }}>
            <span className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>fix</span>
            <code className="mono grow" style={{ fontSize: 11.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tip.fix}</code>
            <CopyBtn text={tip.fix} />
          </div>
          {applied
            ? (
              <span className="pill" style={{ color: 'var(--success)', background: 'var(--success-soft)' }}>
                <Icon name="check" size={11} />Applied
              </span>
            )
            : <button className="btn btn-primary btn-sm" onClick={onApply} title="Mark applied">Apply</button>}
          <button className="btn btn-secondary btn-sm" onClick={onDismiss} title="Dismiss — this tip won't come back">Dismiss</button>
        </div>
      </div>
    </div>
  );
}
