/**
 * ⌘K command palette (REQ-DESKTOP-019): overlay + input searching pages,
 * graph nodes, spec requirements, and recent prompts from live data as the
 * user types; arrows to select, Enter to jump, Escape/backdrop to close.
 * Specs and recent prompts load once per open and filter client-side; node
 * search hits /api/graph/search per keystroke (debounced). Every fetch
 * degrades to an empty list — a 409 `no_project` or an empty index leaves
 * the palette on pages-only with the "No matches" row, never an error (A4).
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, type RecentPrompt, type SpecDoc } from '../api';
import { go } from '../router';
import { Icon } from './icons';

export interface PalettePage {
  id: string;
  label: string;
  icon: string;
}

export type PaletteResultType = 'page' | 'node' | 'spec' | 'prompt';

interface PaletteResult {
  key: string;
  label: string;
  sublabel: string;
  icon: string;
  type: PaletteResultType;
  nav: () => void;
}

/** Per-type caps keep the merged list scannable when everything matches. */
const MAX_NODES = 8;
const MAX_SPECS = 6;
const MAX_PROMPTS = 6;
const SEARCH_DEBOUNCE_MS = 150;

const TYPE_BADGE: Record<PaletteResultType, string> = { page: 'Page', node: 'Node', spec: 'Spec', prompt: 'Prompt' };

const kbd: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '2px 6px' };

// @implements REQ-DESKTOP-019
export function CommandPalette({ open, onClose, pages, project = null }: {
  open: boolean;
  onClose: () => void;
  pages: PalettePage[];
  project?: string | null;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [specs, setSpecs] = useState<SpecDoc[]>([]);
  const [prompts, setPrompts] = useState<RecentPrompt[]>([]);
  const [nodes, setNodes] = useState<PaletteResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchGen = useRef(0);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setNodes([]);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Specs + recent prompts load once per open; both are small and filter
  // client-side per keystroke.
  useEffect(() => {
    if (!open) return;
    api.specs(project).then((r) => setSpecs(r.specs ?? []), () => setSpecs([]));
    api.recentPrompts(project).then((r) => setPrompts(r.prompts ?? []), () => setPrompts([]));
  }, [open, project]);

  // Node search is server-side (FTS over the whole graph) — debounced per
  // keystroke, generation-guarded so a slow response never clobbers a newer one.
  useEffect(() => {
    if (!open) return;
    const needle = q.trim();
    const gen = ++searchGen.current;
    if (needle.length < 2) { setNodes([]); return; }
    const t = setTimeout(() => {
      api.graphSearch(needle, project, MAX_NODES).then(
        (r) => {
          if (searchGen.current !== gen) return;
          setNodes((r.results ?? []).map(({ node }) => ({
            key: 'node:' + node.id,
            label: node.name,
            sublabel: node.filePath,
            icon: 'graph',
            type: 'node' as const,
            nav: () => go('graph', { query: { focus: node.id } }),
          })));
        },
        () => { if (searchGen.current === gen) setNodes([]); },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, open, project]);

  const needle = q.trim().toLowerCase();
  const pageRows: PaletteResult[] = (needle
    ? pages.filter((p) => (p.label + ' ' + p.id).toLowerCase().includes(needle))
    : pages
  ).map((p) => ({ key: 'page:' + p.id, label: p.label, sublabel: '/' + p.id, icon: p.icon, type: 'page', nav: () => go(p.id) }));

  // Live results only join the list once the user types — an empty query
  // keeps the palette as a page jumper (and node search needs ≥2 chars anyway).
  const specRows: PaletteResult[] = needle
    ? specs
        .filter((s) => (s.id + ' ' + s.title).toLowerCase().includes(needle))
        .slice(0, MAX_SPECS)
        .map((s) => ({ key: 'spec:' + s.id, label: s.id, sublabel: s.title, icon: 'book', type: 'spec', nav: () => go('specs', { param: s.id }) }))
    : [];
  const promptRows: PaletteResult[] = needle
    ? prompts
        .filter((p) => p.text.toLowerCase().includes(needle))
        .slice(0, MAX_PROMPTS)
        .map((p) => ({ key: 'prompt:' + p.id, label: p.text, sublabel: new Date(p.ts).toLocaleString(), icon: 'chat', type: 'prompt', nav: () => go('sessions', { param: p.session_id }) }))
    : [];
  const results: PaletteResult[] = [...pageRows, ...(needle ? nodes : []), ...specRows, ...promptRows];

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); const r = results[sel]; if (r) { r.nav(); onClose(); } }
      else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, results, sel, onClose]);

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
            placeholder="Search pages, nodes, specs, prompts…"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 15, fontFamily: 'var(--font-ui)' }}
          />
          <kbd style={kbd}>esc</kbd>
        </div>
        <div className="scroll-y" role="listbox" style={{ maxHeight: 380, padding: 6 }}>
          {results.length === 0 && <div className="muted" style={{ padding: 24, textAlign: 'center' }}>No matches</div>}
          {results.map((r, i) => (
            <div
              key={r.key}
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => { r.nav(); onClose(); }}
              className="row gap-10"
              style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: i === sel ? 'var(--bg-hover)' : 'transparent' }}
            >
              <Icon name={r.icon} size={15} style={{ color: i === sel ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                <div className="mono muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sublabel}</div>
              </div>
              <span className="pill" style={{ fontSize: 9.5, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', flexShrink: 0 }}>{TYPE_BADGE[r.type]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
