/**
 * Graph split view (REQ-DASHSIMPLE-005): one search box over specs and code
 * symbols, and a two-pane spec ↔ code view driven entirely by the URL —
 * `/graph?req=<ID>` or `/graph?sym=<nodeId>`. Every step is a `go()` push, so
 * Back/Forward retrace it and a reload restores the same pair.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { api, type GraphNodeDetail, type LinkedSpec, type NodeRef, type SplitSearchResponse } from '../api';
import { useApi } from '../hooks';
import { go } from '../router';
import { Icon } from './icons';
import { Empty, ErrorState, Pill, StatePill, nodeColor } from './ui';

const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const pane: CSSProperties = { flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 };
const codeBox: CSSProperties = {
  margin: 0, padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-canvas)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5,
  overflow: 'auto', whiteSpace: 'pre',
};

const openReq = (id: string) => go('graph', { query: { req: id } });
const openSym = (id: string) => go('graph', { query: { sym: id } });

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow" style={{ marginBottom: 6 }}>{children}</div>;
}

/** Keyboard-operable list row, shared .list-row states (REQ-DESKTOP-013). */
function LinkRow({ onClick, children, testId }: { onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="row gap-8 list-row"
      style={{ padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
    >
      {children}
    </div>
  );
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- Search ----

type Option = { key: string; group: 'spec' | 'symbol'; label: string; sub: string; pick: () => void };

/** One combobox over specs and code symbols; results come back in two groups. */
// @implements REQ-DASHSIMPLE-005
export function SplitSearch({ project }: { project: string | null }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<SplitSearchResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const gen = useRef(0);

  useEffect(() => {
    const qs = text.trim();
    const g = ++gen.current;
    if (!qs) { setRes(null); return; }
    const t = setTimeout(() => {
      api.splitSearch(qs, project).then(
        (r) => { if (gen.current === g) { setRes(r); setActive(0); } },
        () => { if (gen.current === g) setRes({ specs: [], symbols: [] }); },
      );
    }, 120);
    return () => clearTimeout(t);
  }, [text, project]);

  const options: Option[] = [
    ...(res?.specs ?? []).map((s): Option => ({ key: 'spec:' + s.id, group: 'spec', label: s.id, sub: s.title, pick: () => openReq(s.id) })),
    ...(res?.symbols ?? []).map((n): Option => ({ key: 'sym:' + n.id, group: 'symbol', label: n.name, sub: n.filePath + (n.startLine ? ':' + n.startLine : ''), pick: () => openSym(n.id) })),
  ];
  const choose = (o: Option) => { o.pick(); setOpen(false); };
  const showList = open && res !== null && text.trim().length > 0;

  const renderGroup = (group: Option['group'], title: string) => {
    const items = options.filter((o) => o.group === group);
    if (!items.length) return null;
    return (
      <div role="group" aria-label={title}>
        <div className="eyebrow" style={{ padding: '6px 10px 2px' }}>{title}</div>
        {items.map((o) => {
          const i = options.indexOf(o);
          return (
            <div
              key={o.key}
              role="option"
              aria-selected={i === active}
              data-testid={'split-option-' + o.key}
              className="row gap-8 list-row"
              onMouseDown={(e) => { e.preventDefault(); choose(o); }}
              onMouseEnter={() => setActive(i)}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, background: i === active ? 'var(--bg-panel-2)' : undefined }}
            >
              <span className="mono" style={{ ...ellipsis, flexShrink: 0, maxWidth: '45%' }}>{o.label}</span>
              <span className="muted grow" style={{ ...ellipsis, fontSize: 11 }}>{o.sub}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ position: 'relative', padding: '9px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-panel)' }}>
      <div className="row gap-8">
        <Icon name="search" size={14} style={{ color: 'var(--text-muted)' }} />
        <input
          role="combobox"
          aria-label="Search specs and code"
          aria-expanded={showList}
          aria-controls="split-search-list"
          placeholder="Search a requirement ID or a symbol name…"
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0))); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && options[active]) { e.preventDefault(); choose(options[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          className="grow"
          style={{ border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-primary)', fontSize: 13 }}
        />
      </div>
      {showList && (
        <div
          id="split-search-list"
          role="listbox"
          aria-label="Search results"
          style={{
            position: 'absolute', left: 14, right: 14, top: '100%', zIndex: 20, maxHeight: 360, overflow: 'auto',
            background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '4px 0',
          }}
        >
          {options.length === 0 && <div className="muted" style={{ padding: '8px 10px', fontSize: 12 }}>No matching spec or symbol</div>}
          {renderGroup('spec', 'Specs')}
          {renderGroup('symbol', 'Symbols')}
        </div>
      )}
    </div>
  );
}

// ---- Code ----

/** A symbol's verbatim source block with its location header. */
function CodeBlock({ node }: { node: GraphNodeDetail }) {
  return (
    <div data-testid={'split-code-' + node.id}>
      <div className="row gap-8" style={{ marginBottom: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: nodeColor(node.kind), flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, ...ellipsis }}>{node.name}</span>
        <Pill>{node.kind}</Pill>
        <span className="mono muted grow" style={{ fontSize: 11, ...ellipsis }}>
          {node.filePath}{node.startLine ? `:${node.startLine}` : ''}
        </span>
      </div>
      {node.code ? (
        <pre style={codeBox} data-testid="split-source">{node.code}</pre>
      ) : (
        <div className="muted" style={{ fontSize: 12 }}>Source not available for this symbol.</div>
      )}
      {node.codeTruncated && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Source truncated — open the file for the rest.</div>}
    </div>
  );
}

function useNode(id: string, project: string | null) {
  return useApi(() => api.graphNode(id, project, { includeCode: true }), [id, project]);
}

/** One linked symbol in a requirement's code stack, fetched with its source. */
function StackedSymbol({ id, project }: { id: string; project: string | null }) {
  const n = useNode(id, project);
  if (n.error) return <ErrorState title="Couldn't load this symbol" detail={errorText(n.error)} />;
  const node = n.data?.matches[0];
  if (!node) return <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
  return (
    <div>
      <CodeBlock node={node} />
      <div style={{ marginTop: 4 }}>
        <LinkRow onClick={() => openSym(node.id)}>
          <span className="muted">Step into {node.name}</span>
          <Icon name="chevronRight" size={12} style={{ color: 'var(--text-faint)' }} />
        </LinkRow>
      </div>
    </div>
  );
}

/** Callers / callees list: each row steps the split view to that symbol. */
function NeighbourList({ title, nodes, kind }: { title: string; nodes: NodeRef[]; kind: 'caller' | 'callee' }) {
  return (
    <div>
      <Eyebrow>{title} · {nodes.length}</Eyebrow>
      {nodes.length === 0 && <div className="muted" style={{ fontSize: 12 }}>None</div>}
      {nodes.map((c) => (
        <LinkRow key={c.id} onClick={() => openSym(c.id)} testId={`split-${kind}-${c.name}`}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: nodeColor(c.kind), flexShrink: 0 }} />
          <span className="mono grow" style={ellipsis}>{c.name}</span>
          <span className="mono muted" style={{ fontSize: 10.5, ...ellipsis, maxWidth: '50%' }}>{c.filePath}</span>
        </LinkRow>
      ))}
    </div>
  );
}

// ---- Panes ----

/** Left pane for `req=`: the requirement's own text. */
function RequirementPane({ spec, error }: { spec: { id: string; title: string; body?: string } | null; error: unknown }) {
  if (error) return <ErrorState title="Couldn't load this requirement" detail={errorText(error)} />;
  if (!spec) return <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
  return (
    <div data-testid="split-requirement">
      <div className="mono muted" style={{ fontSize: 11 }}>{spec.id}</div>
      <h2 style={{ fontSize: 16, margin: '4px 0 10px' }}>{spec.title}</h2>
      <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{spec.body}</div>
    </div>
  );
}

/** Left pane for `sym=`: the requirements linked to the symbol (dedup by spec id). */
function LinkedSpecsPane({ links }: { links: LinkedSpec[] }) {
  const bySpec = new Map<string, LinkedSpec>();
  for (const l of links) if (!bySpec.has(l.specId)) bySpec.set(l.specId, l);
  if (bySpec.size === 0) {
    return (
      <div data-testid="split-no-linked">
        <Eyebrow>Linked requirements</Eyebrow>
        <div className="muted" style={{ fontSize: 13 }}>no linked requirement</div>
      </div>
    );
  }
  return (
    <div data-testid="split-linked-specs">
      <Eyebrow>Linked requirements · {bySpec.size}</Eyebrow>
      {[...bySpec.values()].map((l) => (
        <LinkRow key={l.specId} onClick={() => openReq(l.specId)} testId={'split-linked-' + l.specId}>
          <span className="mono grow" style={ellipsis}>{l.specId}</span>
          <span className="muted" style={{ fontSize: 11 }}>{l.kind}</span>
          <StatePill state={l.state} />
        </LinkRow>
      ))}
    </div>
  );
}

function Split({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <section aria-label="Spec" data-testid="split-left" style={{ ...pane, borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-panel)' }}>{left}</section>
      <section aria-label="Code" data-testid="split-right" style={pane}>{right}</section>
    </div>
  );
}

function RequirementSplit({ id, project }: { id: string; project: string | null }) {
  const d = useApi(() => api.spec(id, project), [id, project]);
  // Every resolved link, implementations before tests, one block per symbol.
  const ids: string[] = [];
  const links = [...(d.data?.links ?? [])].sort((a, b) => Number(a.kind === 'tests') - Number(b.kind === 'tests'));
  for (const l of links) if (l.resolvedNodeId && !ids.includes(l.resolvedNodeId)) ids.push(l.resolvedNodeId);
  const unresolved = links.filter((l) => !l.resolvedNodeId);
  return (
    <Split
      left={<RequirementPane spec={d.data?.spec ?? null} error={d.error} />}
      right={
        d.error ? null : !d.data ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div> : (
          <>
            <Eyebrow>Linked code · {ids.length}</Eyebrow>
            {ids.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No code is linked to this requirement yet.</div>}
            {ids.map((nid) => <StackedSymbol key={nid} id={nid} project={project} />)}
            {unresolved.map((l, i) => (
              <div key={'u' + i} className="muted mono" style={{ fontSize: 11 }}>
                {l.targetFilePath}:{l.targetQualifiedName} — not resolved ({l.state})
              </div>
            ))}
          </>
        )
      }
    />
  );
}

function SymbolSplit({ id, project }: { id: string; project: string | null }) {
  const n = useNode(id, project);
  const node = n.data?.matches[0] ?? null;
  const loading = <div className="muted" style={{ fontSize: 12 }}>Loading…</div>;
  return (
    <Split
      left={n.error ? null : node ? <LinkedSpecsPane links={node.linkedSpecs ?? []} /> : loading}
      right={
        n.error ? <ErrorState title="Couldn't load this symbol" detail={errorText(n.error)} /> : !node ? loading : (
          <>
            <CodeBlock node={node} />
            <NeighbourList title="Callers" nodes={node.callers ?? []} kind="caller" />
            <NeighbourList title="Callees" nodes={node.callees ?? []} kind="callee" />
          </>
        )
      }
    />
  );
}

/** The two-pane view for `?req=` or `?sym=`; renders nothing for neither. */
// @implements REQ-DASHSIMPLE-005
export function SplitView({ project, query }: { project: string | null; query: Record<string, string> }) {
  if (query.req) return <RequirementSplit key={'r:' + query.req} id={query.req} project={project} />;
  if (query.sym) return <SymbolSplit key={'s:' + query.sym} id={query.sym} project={project} />;
  return <Empty icon="search" title="Search a requirement or a symbol" />;
}
