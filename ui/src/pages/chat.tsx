/**
 * Chat — the project chat wired to the dashboard server's chat API
 * (REQ-DESKTOP-027). TSX port of specs/specship-desktop/screens-chat.jsx
 * bound to GET /api/chat/stream (SSE: thinking → tool → result_summary →
 * chunk… → done), with POST /api/chat as the non-stream fallback: seeded
 * suggested actions send as messages (A1); a sent message round-trips and
 * renders the streamed answer with its tool-call card and per-answer
 * source context (A2); the paperclip attaches spec ids / files as
 * reference chips the message carries (A3); a backend failure renders an
 * error bubble and leaves the composer's unsent text untouched (A4).
 * The answer semantics stay the server's — the sibling chat spec's
 * behaviour contract (REQ-DASH-CHAT-*) is authoritative there.
 */
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  api, chatStreamUrl,
  type ChatDomainDetail, type ChatSource, type ChatSpecDetail, type ChatSymbolDetail, type SpecDoc,
} from '../api';
import { Icon, LogoMark } from '../components/icons';
import { Pill, Segmented } from '../components/ui';
import { useApi } from '../hooks';
import type { PageProps } from './types';

/** One thread entry — user bubbles carry ref chips, assistant ones context. */
interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  refs?: string[];
  tool?: { name: string; input: string };
  sources?: ChatSource[];
  error?: boolean;
  streaming?: boolean;
}

const soft = (color: string) => `color-mix(in srgb, ${color} 14%, transparent)`;

/** Minimal **bold** / `code` / newline rendering — no innerHTML. */
function renderRich(text: string): ReactNode {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((seg, j) => {
        if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
          return <strong key={j} style={{ color: 'var(--text-primary)' }}>{seg.slice(2, -2)}</strong>;
        }
        if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
          return (
            <code key={j} className="mono" style={{ fontSize: 12, background: 'var(--bg-canvas)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border-subtle)', color: 'var(--node-spec)' }}>
              {seg.slice(1, -1)}
            </code>
          );
        }
        return seg;
      })}
    </Fragment>
  ));
}

function RefChip({ refId, onRemove }: { refId: string; onRemove?: () => void }) {
  const isSpec = /^REQ-/i.test(refId);
  return (
    <span className="pill mono" style={{ fontSize: 10.5, color: isSpec ? 'var(--node-spec)' : 'var(--text-secondary)', background: isSpec ? soft('var(--node-spec)') : 'rgba(255,255,255,0.06)', maxWidth: 240 }}>
      <Icon name={isSpec ? 'book' : 'paperclip'} size={10} style={{ flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{refId}</span>
      {onRemove && (
        <button className="btn btn-ghost btn-xs" onClick={onRemove} aria-label={`Remove ${refId}`} style={{ padding: 0, minWidth: 0 }}>
          <Icon name="x" size={10} />
        </button>
      )}
    </span>
  );
}

// ---- Assistant answer chrome -------------------------------------------------

/** A2: the tool-call context the stream's `tool` event carried. */
function ToolCallCard({ tool }: { tool: { name: string; input: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 7, marginTop: 8, overflow: 'hidden', background: 'var(--bg-canvas)' }}>
      <button className="row gap-8" onClick={() => setOpen((o) => !o)} style={{ width: '100%', padding: '6px 10px', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <Icon name="wrench" size={12} style={{ color: 'var(--node-code)', flexShrink: 0 }} />
        <span className="mono grow" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tool.name}
          <span className="muted">({tool.input})</span>
        </span>
        <span className="pill" style={{ fontSize: 9.5, color: 'var(--success)', background: 'var(--success-soft)', flexShrink: 0 }}>
          <Icon name="check" size={9} />ok
        </span>
      </button>
      {open && (
        <div style={{ padding: '8px 10px 10px 30px', borderTop: '1px solid var(--border-subtle)' }}>
          <div className="mono muted" style={{ fontSize: 10.5, marginBottom: 3 }}>input</div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{tool.input || '—'}</div>
        </div>
      )}
    </div>
  );
}

const SOURCE_KIND: Record<ChatSource['kind'], { icon: string; color: string; label: string }> = {
  symbol: { icon: 'graph', color: 'var(--node-code)', label: 'Symbol' },
  spec: { icon: 'book', color: 'var(--node-spec)', label: 'Spec' },
  domain: { icon: 'sparkles', color: 'var(--node-route)', label: 'Domain fact' },
};

const detailPre: React.CSSProperties = {
  margin: '8px 0 0', fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)',
  background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 7,
  padding: '9px 11px', overflow: 'auto', maxHeight: 220, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
};

function SourceCard({ src }: { src: ChatSource }) {
  const k = SOURCE_KIND[src.kind];
  const d = src.detail;
  return (
    <div className="card" style={{ padding: '10px 12px' }}>
      <div className="row gap-8">
        <Icon name={k.icon} size={13} style={{ color: k.color, flexShrink: 0 }} />
        <span className="mono grow" style={{ fontSize: 12, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.label}</span>
        <Pill color={k.color} bg={soft(k.color)}>{k.label}</Pill>
      </div>
      {src.filePath && (
        <div className="mono muted" style={{ fontSize: 10.5, marginTop: 3 }}>
          {src.filePath}{src.line ? ':' + src.line : ''}
        </div>
      )}
      {d != null && src.kind === 'symbol' && 'callers' in d && (
        <>
          {(d as ChatSymbolDetail).signature && <div className="mono" style={{ fontSize: 11, marginTop: 6, color: 'var(--text-secondary)' }}>{(d as ChatSymbolDetail).signature}</div>}
          <pre className="mono" style={detailPre}>{d.body}</pre>
          <div className="mono muted" style={{ fontSize: 10.5, marginTop: 6 }}>
            {(d as ChatSymbolDetail).callers.length} callers · {(d as ChatSymbolDetail).callees.length} callees
          </div>
        </>
      )}
      {d != null && src.kind === 'spec' && 'links' in d && (
        <>
          <pre className="mono" style={detailPre}>{d.body}</pre>
          {(d as ChatSpecDetail).links.map((l) => (
            <div key={l.target} className="row gap-8" style={{ marginTop: 6 }}>
              <span className="mono grow" style={{ fontSize: 11, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.target}</span>
              <span className="pill" style={{ fontSize: 9.5, color: l.state === 'verified' ? 'var(--success)' : 'var(--warn)', background: l.state === 'verified' ? 'var(--success-soft)' : 'var(--warn-soft)' }}>{l.state}</span>
            </div>
          ))}
        </>
      )}
      {d != null && src.kind === 'domain' && (
        <pre className="mono" style={detailPre}>{(d as ChatDomainDetail).body}</pre>
      )}
    </div>
  );
}

/** The per-answer show-context affordance — expands the answer's sources. */
function SourcesDisclosure({ sources }: { sources: ChatSource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn btn-ghost btn-xs" onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        {open ? 'Hide context' : `Show context · ${sources.length} source${sources.length === 1 ? '' : 's'}`}
      </button>
      {open && (
        <div className="col gap-8" style={{ marginTop: 8 }}>
          {sources.map((s, i) => <SourceCard key={s.kind + ':' + s.ref + ':' + i} src={s} />)}
        </div>
      )}
    </div>
  );
}

function MessageView({ m }: { m: ChatMessage }) {
  if (m.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
        <div style={{ maxWidth: '76%', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '12px 12px 4px 12px', padding: '9px 13px', fontSize: 13.5, lineHeight: 1.55 }}>
          <div>{renderRich(m.text)}</div>
          {m.refs && (
            <div className="row gap-6" style={{ marginTop: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {m.refs.map((r) => <RefChip key={r} refId={r} />)}
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 22 }}>
      <div className="row gap-8" style={{ marginBottom: 8 }}>
        <LogoMark size={22} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>specship</span>
        <span className="mono muted" style={{ fontSize: 10.5 }}>knowledge base</span>
      </div>
      <div style={{ paddingLeft: 30 }}>
        {m.streaming && !m.text && (
          <div className="row gap-8 muted" style={{ fontSize: 12 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', animation: 'skeleton 1s infinite' }} />
            thinking with specship context…
          </div>
        )}
        {m.text && (
          <div style={{ fontSize: 13.5, lineHeight: 1.62, color: 'var(--text-secondary)', textWrap: 'pretty' }}>{renderRich(m.text)}</div>
        )}
        {m.tool && <ToolCallCard tool={m.tool} />}
        {m.error && (
          <div className="row gap-8" style={{ marginTop: m.text || m.tool ? 8 : 0, padding: '8px 11px', background: 'var(--error-soft)', border: '1px solid rgba(242,85,90,0.25)', borderRadius: 7 }}>
            <Icon name="cancel" size={14} style={{ color: 'var(--error)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              The chat backend didn't answer — the send failed or the stream dropped. Your draft is preserved; try again.
            </span>
          </div>
        )}
        {!!m.sources?.length && <SourcesDisclosure sources={m.sources} />}
      </div>
    </div>
  );
}

// ---- Empty thread + seeded suggestions (A1) ----------------------------------

interface Suggestion { icon: string; q: string }

/** The spec's three seeded actions, grounded in a real spec id when loaded. */
function seededSuggestions(specId: string | undefined): Suggestion[] {
  return [
    { icon: 'drift', q: 'Summarize the drift queue' },
    { icon: 'book', q: specId ? `What is the link state of ${specId}?` : 'What specs does this project have?' },
    { icon: 'play', q: specId ? `Kick off the spec-implement workflow for ${specId}` : 'Kick off the spec-implement workflow' },
  ];
}

function EmptyThread({ suggestions, onPick }: { suggestions: Suggestion[]; onPick: (q: string) => void }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: 320, textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ maxWidth: 460 }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', display: 'grid', placeItems: 'center', color: 'var(--accent)', margin: '0 auto 16px' }}>
          <Icon name="sparkles" size={24} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Ask with specship context</div>
        <div className="secondary" style={{ lineHeight: 1.55, marginBottom: 18 }}>
          Answers come from this project's own knowledge base — the code graph, specs, and domain facts. No model, no network.
        </div>
        <div className="col gap-8">
          {suggestions.map((s) => (
            <button key={s.q} className="btn btn-secondary btn-sm" onClick={() => onPick(s.q)} style={{ justifyContent: 'flex-start' }}>
              <Icon name={s.icon} size={13} />{s.q}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Composer -----------------------------------------------------------------

/** A3: pick a spec id or an indexed file to attach as a reference chip. */
function AttachPopover({ specs, project, onPick }: {
  specs: SpecDoc[]; project: string | null; onPick: (ref: string) => void;
}) {
  const [needle, setNeedle] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const gen = useRef(0);

  useEffect(() => {
    const n = needle.trim();
    const g = ++gen.current;
    if (n.length < 2) { setFiles([]); return; }
    const t = setTimeout(() => {
      api.graphSearch(n, project).then(
        (r) => { if (gen.current === g) setFiles([...new Set(r.results.map((x) => x.node.filePath))].slice(0, 6)); },
        () => { if (gen.current === g) setFiles([]); },
      );
    }, 150);
    return () => clearTimeout(t);
  }, [needle, project]);

  const n = needle.trim().toLowerCase();
  const specMatches = specs.filter((s) => !n || (s.id + ' ' + s.title).toLowerCase().includes(n)).slice(0, 6);

  const row = (key: string, icon: string, color: string, label: string) => (
    <button key={key} className="row gap-8" onClick={() => onPick(key)} style={{ width: '100%', padding: '6px 9px', borderRadius: 5, cursor: 'pointer', border: 'none', background: 'transparent', textAlign: 'left' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon name={icon} size={12} style={{ color, flexShrink: 0 }} />
      <span className="mono grow" style={{ fontSize: 11.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </button>
  );

  return (
    <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, width: 340, background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: 'var(--shadow-pop)', padding: 5, zIndex: 10 }}>
      <input
        className="input mono" autoFocus
        style={{ width: '100%', marginBottom: 5 }}
        placeholder="Filter specs, search files…"
        aria-label="Filter attachments"
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
      />
      {specMatches.length > 0 && <div className="eyebrow" style={{ padding: '4px 9px 2px' }}>Specs</div>}
      {specMatches.map((s) => row(s.id, 'book', 'var(--node-spec)', `${s.id} · ${s.title}`))}
      {files.length > 0 && <div className="eyebrow" style={{ padding: '6px 9px 2px' }}>Files</div>}
      {files.map((f) => row(f, 'paperclip', 'var(--text-muted)', f))}
      {!specMatches.length && !files.length && (
        <div className="muted" style={{ padding: '6px 9px', fontSize: 11.5 }}>
          {n.length < 2 ? 'No specs indexed yet — type to search files.' : 'No matches.'}
        </div>
      )}
    </div>
  );
}

function Composer({ draft, setDraft, refs, onRemoveRef, onAttach, busy, onSend, specs, project, contextChips }: {
  draft: string;
  setDraft: (v: string) => void;
  refs: string[];
  onRemoveRef: (r: string) => void;
  onAttach: (r: string) => void;
  busy: boolean;
  onSend: () => void;
  specs: SpecDoc[];
  project: string | null;
  contextChips: ReactNode;
}) {
  const [attachOpen, setAttachOpen] = useState(false);

  // Close the attach popover on any outside press (mirrors ProjectSwitcher).
  useEffect(() => {
    if (!attachOpen) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-chat-attach]')) setAttachOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [attachOpen]);

  return (
    <div style={{ padding: '12px 24px 14px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
      <div data-chat-attach="1" style={{ maxWidth: 760, margin: '0 auto', position: 'relative' }}>
        {attachOpen && (
          <AttachPopover specs={specs} project={project} onPick={(r) => { onAttach(r); setAttachOpen(false); }} />
        )}
        {refs.length > 0 && (
          <div className="row gap-6" style={{ marginBottom: 7, flexWrap: 'wrap' }}>
            {refs.map((r) => <RefChip key={r} refId={r} onRemove={() => onRemoveRef(r)} />)}
          </div>
        )}
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 8 }}>
          <button className="btn btn-ghost btn-sm" title="Attach files or spec IDs" aria-label="Attach files or spec IDs" onClick={() => setAttachOpen((o) => !o)} style={{ padding: 7 }}>
            <Icon name="paperclip" size={15} />
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
            placeholder="Ask with specship context…"
            aria-label="Chat message"
            rows={1}
            style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'var(--font-ui)', lineHeight: 1.5, padding: '5px 2px', maxHeight: 120 }}
          />
          <button className="btn btn-primary btn-sm" title="Send" aria-label="Send" onClick={onSend} disabled={busy || !draft.trim()} style={{ padding: '7px 10px' }}>
            <Icon name="send" size={14} />
          </button>
        </div>
        <div className="row gap-8" style={{ marginTop: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          {contextChips}
          <span className="muted" style={{ fontSize: 10.5, flexShrink: 0 }}>Enter to send · Shift+Enter for newline</span>
        </div>
      </div>
    </div>
  );
}

// ---- Page ---------------------------------------------------------------------

// @implements REQ-DESKTOP-027
export function ChatPage({ project }: PageProps) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [refs, setRefs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState('safe');
  const listRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Context-chip data — every fetch degrades to a hidden chip, never a blank.
  const status = useApi(() => api.status(project), [project]);
  const specsState = useApi(() => api.specs(project), [project]);
  const mcp = useApi(() => api.mcpServers(), []);

  useEffect(() => () => esRef.current?.close(), []);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs]);

  const send = useCallback((question: string, sendRefs: string[], fromComposer: boolean) => {
    const text = question.trim();
    if (!text || busy) return;
    // The API contract is `question` only — attached refs travel inside it.
    const wire = [text, ...sendRefs].join(' ');
    setMsgs((m) => [
      ...m,
      { role: 'user', text, refs: sendRefs.length ? sendRefs : undefined },
      { role: 'assistant', text: '', streaming: true },
    ]);
    setBusy(true);

    const patchTail = (fn: (m: ChatMessage) => ChatMessage) =>
      setMsgs((m) => m.map((msg, i) => (i === m.length - 1 ? fn(msg) : msg)));
    // The draft clears on the first server event, not at send time — a dead
    // endpoint must leave the composer's unsent text untouched (A4).
    const clearDraft = () => { if (fromComposer) { setDraft(''); setRefs([]); } };
    const fail = () => { setBusy(false); patchTail((m) => ({ ...m, streaming: false, error: true })); };

    if (typeof EventSource === 'undefined') {
      api.chat(wire, project).then(
        (r) => { clearDraft(); setBusy(false); patchTail((m) => ({ ...m, streaming: false, text: r.answer, sources: r.sources })); },
        fail,
      );
      return;
    }

    const es = new EventSource(chatStreamUrl(wire, project));
    esRef.current = es;
    const on = <T,>(type: string, fn: (data: T) => void) =>
      es.addEventListener(type, (ev) => {
        try { fn(JSON.parse((ev as MessageEvent).data as string) as T); } catch { /* malformed frame — skip */ }
      });
    es.addEventListener('thinking', clearDraft);
    on<{ name: string; input: string }>('tool', (d) => patchTail((m) => ({ ...m, tool: d })));
    on<{ text: string }>('chunk', (d) => { clearDraft(); patchTail((m) => ({ ...m, text: m.text + d.text })); });
    on<{ found: boolean; sources: ChatSource[] }>('done', (d) => {
      es.close();
      setBusy(false);
      patchTail((m) => ({ ...m, streaming: false, sources: d.sources }));
    });
    es.onerror = () => { es.close(); fail(); };
  }, [busy, project]);

  const specs = specsState.data?.specs ?? [];
  const suggestions = seededSuggestions(specs[0]?.id);
  const toolCount = mcp.data ? mcp.data.servers.reduce((a, s) => a + s.tools.length, 0) : null;

  const chip = (icon: string, text: string, title?: string) => (
    <span className="row gap-6" title={title} style={{ flexShrink: 0 }}>
      <Icon name={icon} size={11} style={{ color: 'var(--text-muted)' }} />
      <span className="mono muted" style={{ fontSize: 10.5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</span>
    </span>
  );

  // The snapshot's context chips: project · indexed files · MCP tools · access.
  const contextChips = (
    <div className="row gap-10" style={{ flexWrap: 'wrap', minWidth: 0 }}>
      {status.data && chip('folder', status.data.projectPath, 'Project')}
      {status.data && chip('box', `${status.data.fileCount.toLocaleString()} files indexed`)}
      {toolCount != null && chip('plug', `${toolCount} MCP tools`)}
      <Segmented
        size="sm"
        label="Tool access"
        value={access}
        onChange={setAccess}
        options={[{ value: 'ask', label: 'Ask' }, { value: 'safe', label: 'Auto-safe' }, { value: 'all', label: 'All' }]}
      />
    </div>
  );

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div ref={listRef} className="scroll-y" style={{ flex: 1, padding: '20px 24px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {msgs.length === 0
            ? <EmptyThread suggestions={suggestions} onPick={(q) => send(q, [], false)} />
            : msgs.map((m, i) => <MessageView key={i} m={m} />)}
        </div>
      </div>
      <Composer
        draft={draft}
        setDraft={setDraft}
        refs={refs}
        onRemoveRef={(r) => setRefs((s) => s.filter((x) => x !== r))}
        onAttach={(r) => setRefs((s) => (s.includes(r) ? s : [...s, r]))}
        busy={busy}
        onSend={() => send(draft, refs, true)}
        specs={specs}
        project={project}
        contextChips={contextChips}
      />
    </div>
  );
}
