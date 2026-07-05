/**
 * Minimal ⌘K command palette (REQ-DESKTOP-018): overlay + input filtering the
 * app's pages, arrows to select, Enter to jump, Escape/backdrop to close.
 * Ported from the design bundle's app.jsx CommandPalette; live-data search
 * sources (nodes, specs, prompts) and g-chords land with REQ-DESKTOP-019.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { go } from '../router';
import { Icon } from './icons';

export interface PaletteEntry {
  id: string;
  label: string;
  icon: string;
}

const kbd: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '2px 6px' };

export function CommandPalette({ open, onClose, pages }: { open: boolean; onClose: () => void; pages: PaletteEntry[] }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? pages.filter((p) => (p.label + ' ' + p.id).toLowerCase().includes(needle))
    : pages;

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = filtered[sel]; if (r) { go(r.id); onClose(); } }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, filtered, sel, onClose]);

  if (!open) return null;
  return (
    <div
      onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', zIndex: 100, display: 'grid', placeItems: 'start center', paddingTop: '12vh', animation: 'fadeIn 100ms' }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 560, maxWidth: '90vw', background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-pop)', overflow: 'hidden' }}
      >
        <div className="row gap-10" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="search" size={16} style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            placeholder="Search pages…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 15, fontFamily: 'var(--font-ui)' }}
          />
          <kbd style={kbd}>esc</kbd>
        </div>
        <div className="scroll-y" style={{ maxHeight: 380, padding: 6 }}>
          {filtered.length === 0 && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>No matches</div>}
          {filtered.map((r, i) => (
            <div
              key={r.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => { go(r.id); onClose(); }}
              className="row gap-10"
              style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: i === sel ? 'var(--bg-hover)' : 'transparent' }}
            >
              <Icon name={r.icon} size={15} style={{ color: i === sel ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                <div className="mono muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{'/' + r.id}</div>
              </div>
              <span className="pill" style={{ fontSize: 9.5, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)' }}>Page</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
