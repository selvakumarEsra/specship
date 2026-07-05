/**
 * Memory — the CLAUDE.md hierarchy + memory-tool notes (REQ-DESKTOP-025).
 * TSX port of specs/specship-desktop/screens-memory.jsx bound to live
 * GET /api/memory data (server/src/routes/memory.ts): a grouped
 * sources rail with per-file detail (scope, lines, modified — A1), the
 * composed effective-memory view in load order (A1), copy-contents with a
 * confirmed state (A2), Reload re-reading from disk (A3), and an explicit
 * empty state when no memory files exist (A4).
 */
import { Fragment, useState } from 'react';
import { api, type MemoryFile, type MemoryLevel, type MemoryResponse, type MemoryType } from '../api';
import { fmtTok, Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { CopyBtn, Empty, PageHead, Pill, Segmented } from '../components/ui';
import { useApi } from '../hooks';
import { go } from '../router';
import type { PageProps } from './types';

/** Level chrome (labels, colors) from the design bundle's data.js. */
const LEVELS: Record<MemoryLevel, { label: string; color: string; soft: string; desc: string }> = {
  enterprise: { label: 'Managed', color: '#E5A50A', soft: 'rgba(229,165,10,0.14)', desc: 'Organization policy · cannot be overridden' },
  user: { label: 'User', color: '#29D2BE', soft: 'rgba(41,210,190,0.14)', desc: 'Personal · applies to every project' },
  project: { label: 'Project', color: '#5B93F2', soft: 'rgba(91,147,242,0.14)', desc: 'Team-shared · checked into the repo' },
  subdir: { label: 'Directory', color: '#A586F5', soft: 'rgba(165,134,245,0.14)', desc: 'Scoped to a subtree · loaded when cwd is inside' },
  import: { label: 'Import', color: '#7B8696', soft: 'rgba(123,134,150,0.12)', desc: 'Pulled in via @path reference' },
  note: { label: 'Notes', color: '#46C26B', soft: 'rgba(70,194,107,0.14)', desc: 'Agent-written · memory tool' },
};

/** Memory TYPE is orthogonal to level: what KIND of memory this is. */
const TYPES: Record<MemoryType, { label: string; color: string; soft: string; icon: string; desc: string }> = {
  instruction: { label: 'Instructions', color: '#5B93F2', soft: 'rgba(91,147,242,0.14)', icon: 'memory', desc: 'Directives & rules from CLAUDE.md' },
  note: { label: 'Notes', color: '#46C26B', soft: 'rgba(70,194,107,0.14)', icon: 'tips', desc: 'Facts the agent saved via the memory tool' },
  import: { label: 'Imports', color: '#29D2BE', soft: 'rgba(41,210,190,0.14)', icon: 'external', desc: 'Files pulled in via @path' },
};

type TypeFilter = 'all' | MemoryType;

/** Tiny markdown renderer for CLAUDE.md bodies (design bundle's renderMd). */
function renderMd(body: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const inline = (s: string) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong style='color:var(--text-primary)'>$1</strong>")
    .replace(/`(.+?)`/g, "<code class='mono' style='font-size:11.5px;background:var(--bg-canvas);padding:1px 5px;border-radius:4px;border:1px solid var(--border-subtle);color:var(--node-spec)'>$1</code>");
  const out: string[] = [];
  body.split('\n').forEach((ln) => {
    if (ln.startsWith('## ')) out.push(`<div style='font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:14px 0 6px'>${inline(ln.slice(3))}</div>`);
    else if (ln.startsWith('# ')) out.push(`<div style='font-size:14px;font-weight:650;margin:0 0 8px'>${inline(ln.slice(2))}</div>`);
    else if (ln.startsWith('@')) out.push(`<div class='mono' style='font-size:12px;color:var(--node-route);background:var(--node-route-soft);display:block;width:fit-content;padding:2px 8px;border-radius:5px;margin:3px 0'>${esc(ln)}</div>`);
    else if (/^\s*- /.test(ln)) out.push(`<div style='display:flex;gap:8px;font-size:12.5px;line-height:1.6;color:var(--text-secondary);padding:1px 0'><span style='color:var(--text-faint)'>•</span><span>${inline(ln.replace(/^\s*- /, ''))}</span></div>`);
    else if (ln.trim() === '') out.push("<div style='height:6px'></div>");
    else out.push(`<div style='font-size:12.5px;line-height:1.6;color:var(--text-secondary)'>${inline(ln)}</div>`);
  });
  return out.join('');
}

function LevelPill({ level }: { level: MemoryLevel }) {
  const L = LEVELS[level];
  return <Pill color={L.color} bg={L.soft}>{L.label}</Pill>;
}

function TypePill({ type }: { type: MemoryType }) {
  const t = TYPES[type];
  return <Pill color={t.color} bg={t.soft}><Icon name={t.icon} size={10} />{t.label}</Pill>;
}

/** A2: writes the file body to the clipboard and confirms with a check. */
function CopyContentsBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn btn-secondary btn-sm"
      title="Copy file contents"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1100);
      }}
      style={{ color: done ? 'var(--success)' : undefined }}
    >
      <Icon name={done ? 'check' : 'copy'} size={13} />
      {done ? 'Copied' : 'Copy contents'}
    </button>
  );
}

function SourceRow({ file, selId, onSel, indent }: {
  file: MemoryFile; selId: string; onSel: (id: string) => void; indent?: boolean;
}) {
  const sel = selId === file.id;
  const named = file.level === 'import' || file.level === 'note';
  const ic = file.level === 'import' ? 'external' : file.level === 'note' ? 'tips' : 'memory';
  return (
    <div
      onClick={() => onSel(file.id)}
      className="row gap-8"
      style={{ padding: '8px 10px', paddingLeft: indent ? 26 : 10, borderRadius: 7, cursor: 'pointer', background: sel ? 'var(--accent-soft)' : 'transparent' }}
      onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
    >
      <span className="pill-dot" style={{ background: LEVELS[file.level].color, flexShrink: 0 }} />
      <Icon name={ic} size={13} style={{ color: sel ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-6">
          <span className="mono" style={{ fontSize: 12, color: sel ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {named ? file.name : file.scope}
          </span>
          {file.readOnly && <Icon name="lock" size={10} style={{ color: 'var(--warn)' }} />}
        </div>
        <div className="mono muted" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.path}</div>
      </div>
      <span className="mono tabular muted" style={{ fontSize: 10.5, flexShrink: 0 }}>{fmtTok(file.tokens)}</span>
    </div>
  );
}

function kv(label: string, value: string) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
      <div className="mono tabular" style={{ fontSize: 13, fontWeight: 600, marginTop: 1, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

function SourceView({ file, files }: { file: MemoryFile; files: MemoryFile[] }) {
  const L = LEVELS[file.level];
  const isNote = file.type === 'note';
  const imports = (file.imports ?? [])
    .map((id) => files.find((f) => f.id === id))
    .filter((f): f is MemoryFile => !!f);
  return (
    <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
      <div className="row gap-8" style={{ marginBottom: 6 }}>
        <TypePill type={file.type} />
        <LevelPill level={file.level} />
        <span className="secondary" style={{ fontSize: 11.5 }}>{L.desc}</span>
        <div className="grow" />
        {file.readOnly && <Pill color="var(--warn)" bg="var(--warn-soft)"><Icon name="lock" size={10} />read-only</Pill>}
      </div>
      <div className="row gap-8" style={{ marginBottom: 14 }}>
        <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{file.path}</span>
        <CopyBtn text={file.path} />
      </div>
      <div className="row" style={{ gap: 22, padding: '10px 0', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', marginBottom: 16, flexWrap: 'wrap' }}>
        {kv('Tokens', fmtTok(file.tokens))}
        {kv('Lines', String(file.lines))}
        {kv('Scope', L.label)}
        {kv('Modified', file.modified)}
        {isNote && file.session && (
          <div>
            <div className="muted" style={{ fontSize: 10.5 }}>Saved in</div>
            <button
              onClick={() => go('sessions', { query: { sel: file.session! } })}
              className="mono"
              style={{ fontSize: 13, fontWeight: 600, marginTop: 1, color: 'var(--accent)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              {file.session}
            </button>
          </div>
        )}
      </div>
      {isNote && file.tags && (
        <div className="row gap-6" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
          {file.tags.map((tg) => (
            <span key={tg} className="mono" style={{ fontSize: 10.5, color: 'var(--node-test)', background: 'var(--node-test-soft)', padding: '2px 8px', borderRadius: 5, whiteSpace: 'nowrap' }}>#{tg}</span>
          ))}
        </div>
      )}
      <div className="card card-pad" style={{ background: 'var(--bg-panel)', marginBottom: 16 }} dangerouslySetInnerHTML={{ __html: renderMd(file.body) }} />
      {imports.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Imports · {imports.length}</div>
          <div className="col gap-6">
            {imports.map((im) => (
              <div key={im.id} className="row gap-8" style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border-subtle)' }}>
                <Icon name="external" size={12} style={{ color: 'var(--node-route)' }} />
                <span className="mono grow" style={{ fontSize: 11.5 }}>{im.path}</span>
                <span className="mono tabular muted" style={{ fontSize: 10.5 }}>{fmtTok(im.tokens)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="row gap-8" style={{ marginTop: 16 }}>
        <CopyContentsBtn text={file.body} />
      </div>
    </div>
  );
}

function EffectiveView({ files, typeF }: { files: MemoryFile[]; typeF: TypeFilter }) {
  // A1: instructions + imports compose in LOAD ORDER — the server returns
  // files exactly as Claude Code loads them (enterprise → user → project →
  // its @imports → subdirs), so array order is the composition order.
  const orderedShown = files.filter((f) => f.type !== 'note' && (typeF === 'all' || f.type === typeF));
  const notes = files.filter((f) => f.type === 'note' && (typeF === 'all' || typeF === 'note'));
  const composed = [...orderedShown, ...notes].map((f) => f.body).join('\n\n');
  const block = (f: MemoryFile, i: number | null) => {
    const L = LEVELS[f.level];
    return (
      <div key={f.id} className="card" style={{ overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: 3, background: L.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, padding: '12px 14px' }}>
          <div className="row gap-8" style={{ marginBottom: 8 }}>
            {i != null && <span className="mono tabular muted" style={{ fontSize: 10.5, width: 16 }}>{i + 1}</span>}
            <LevelPill level={f.level} />
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
            <div className="grow" />
            {f.readOnly && <Icon name="lock" size={11} style={{ color: 'var(--warn)' }} />}
            <span className="mono tabular muted" style={{ fontSize: 10.5 }}>{fmtTok(f.tokens)}</span>
          </div>
          <div style={{ paddingLeft: i != null ? 24 : 0 }} dangerouslySetInnerHTML={{ __html: renderMd(f.body) }} />
        </div>
      </div>
    );
  };
  return (
    <div className="scroll-y" style={{ flex: 1, padding: 20 }}>
      <div className="row gap-8" style={{ marginBottom: 6 }}>
        <Icon name="layers" size={15} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>Effective memory</span>
        <span className="secondary" style={{ fontSize: 12 }}>· everything the agent loads</span>
        <div className="grow" />
        <CopyBtn text={composed} label="Copy all" ariaLabel="Copy effective memory" />
      </div>
      <div className="secondary" style={{ fontSize: 12, lineHeight: 1.55, marginBottom: 16 }}>
        Instructions compose in load order — later files layer onto earlier ones, and @imports load with the file that references them. Saved notes are appended as retrieved context.
      </div>
      {orderedShown.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Instructions · load order</div>
          <div className="col gap-10">{orderedShown.map((f, i) => block(f, i))}</div>
        </div>
      )}
      {notes.length > 0 && (
        <div style={{ marginTop: orderedShown.length ? 20 : 0 }}>
          <div className="row gap-6" style={{ marginBottom: 8 }}>
            <span className="eyebrow">Notes · memory tool</span>
            <span className="muted" style={{ fontSize: 10.5 }}>retrieved facts, not precedence-ranked</span>
          </div>
          <div className="col gap-10">{notes.map((f) => block(f, null))}</div>
        </div>
      )}
    </div>
  );
}

function mstat(icon: string, label: string, value: string, color: string) {
  return (
    <div className="row gap-8" style={{ padding: '8px 12px', background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 9, flexShrink: 0 }}>
      <Icon name={icon} size={14} style={{ color, flexShrink: 0 }} />
      <div>
        <div className="muted" style={{ fontSize: 10 }}>{label}</div>
        <div className="mono tabular" style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{value}</div>
      </div>
    </div>
  );
}

/** A4: no memory files anywhere — say so and point at what Claude Code reads. */
function EmptyMemory({ onReload }: { onReload: () => void }) {
  return (
    <Empty
      icon="memory"
      title="No memory files found"
      body={
        <>
          Claude Code reads <code className="mono">~/.claude/CLAUDE.md</code>, a{' '}
          <code className="mono">CLAUDE.md</code> at the project root (and one level of
          subdirectories), and saved notes under <code className="mono">~/.claude/memory/</code>.
          Create one, then reload.
        </>
      }
      action={
        <button className="btn btn-secondary btn-sm" onClick={onReload}>
          <Icon name="refresh" size={13} />Reload memory
        </button>
      }
    />
  );
}

function MemoryBody({ data, view, typeF, onTypeF, sel, onSel, onReload }: {
  data: MemoryResponse;
  view: string;
  typeF: TypeFilter;
  onTypeF: (t: TypeFilter) => void;
  sel: string | null;
  onSel: (id: string) => void;
  onReload: () => void;
}) {
  const files = data.files;
  // Default selection: the project CLAUDE.md when present (design default).
  const cur = files.find((f) => f.id === sel) ?? files.find((f) => f.level === 'project') ?? files[0];
  const byId = (id: string) => files.find((x) => x.id === id);
  const matchesType = (f: MemoryFile) => typeF === 'all' || f.type === typeF;
  const importsMatching = (f: MemoryFile) =>
    (f.imports ?? []).map(byId).filter((im): im is MemoryFile => !!im && matchesType(im));

  // Rail groups by level; subdir files fold into the project group, and
  // import files render indented under the instruction file that pulls them in.
  const groups: Array<{ key: MemoryLevel; items: MemoryFile[] }> = [
    { key: 'enterprise', items: files.filter((f) => f.level === 'enterprise') },
    { key: 'user', items: files.filter((f) => f.level === 'user') },
    { key: 'project', items: files.filter((f) => f.level === 'project' || f.level === 'subdir') },
    { key: 'note', items: files.filter((f) => f.level === 'note') },
  ];
  // A group shows if any of its rows (or their imports) match the type filter.
  const groupVisible = (g: { items: MemoryFile[] }) =>
    g.items.some((f) => matchesType(f) || importsMatching(f).length > 0);

  const typeChip = (key: TypeFilter, count?: number) => {
    const active = typeF === key;
    const t = key === 'all' ? { label: 'All', color: 'var(--text-secondary)', soft: '' } : TYPES[key];
    return (
      <button
        onClick={() => onTypeF(key)}
        className="row gap-6"
        style={{
          height: 26, padding: '0 11px', borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
          border: '1px solid ' + (active ? 'transparent' : 'var(--border-subtle)'),
          background: active ? (key === 'all' ? 'var(--bg-active)' : t.soft) : 'var(--bg-panel)',
          color: active ? (key === 'all' ? 'var(--text-primary)' : t.color) : 'var(--text-muted)',
        }}
      >
        {key !== 'all' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color }} />}
        {t.label}
        {count != null && <span className="tabular" style={{ opacity: 0.7 }}>{count}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="row gap-10" style={{ padding: '0 18px 12px', flexWrap: 'wrap' }}>
        {mstat('memory', 'Loaded', fmtTok(data.totalTokens) + ' tokens', 'var(--accent)')}
        {mstat('memory', 'Instructions', String(data.instructionCount), 'var(--node-spec)')}
        {mstat('tips', 'Notes', String(data.noteCount), 'var(--node-test)')}
        {mstat('external', 'Imports', String(data.importCount), 'var(--node-route)')}
        <div className="grow" />
        <button className="btn btn-secondary btn-sm" onClick={onReload} title="Re-read memory files from disk">
          <Icon name="refresh" size={13} />Reload memory
        </button>
      </div>

      <div className="row gap-6" style={{ padding: '0 18px 14px', flexWrap: 'wrap' }}>
        <Icon name="filter" size={13} style={{ color: 'var(--text-muted)' }} />
        {typeChip('all')}
        {typeChip('instruction', data.instructionCount)}
        {typeChip('note', data.noteCount)}
        {typeChip('import', data.importCount)}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 11 }}>{typeF !== 'all' ? TYPES[typeF].desc : ''}</span>
      </div>

      {view === 'effective' ? <EffectiveView files={files} typeF={typeF} /> : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, borderTop: '1px solid var(--border-subtle)' }}>
          <div className="col" style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-panel)' }}>
            <div className="scroll-y" style={{ flex: 1, padding: 8 }}>
              {groups.filter(groupVisible).map((g) => (
                <div key={g.key} style={{ marginBottom: 10 }}>
                  <div className="row gap-6" style={{ padding: '8px 8px 4px' }}>
                    <span className="eyebrow">{LEVELS[g.key].label}</span>
                    <span className="muted" style={{ fontSize: 10 }}>{LEVELS[g.key].desc}</span>
                  </div>
                  {g.items
                    .filter((f) => matchesType(f) || importsMatching(f).length > 0)
                    .map((f) => (
                      <Fragment key={f.id}>
                        {matchesType(f) && <SourceRow file={f} selId={cur?.id ?? ''} onSel={onSel} />}
                        {importsMatching(f).map((im) => (
                          <SourceRow key={im.id} file={im} selId={cur?.id ?? ''} onSel={onSel} indent />
                        ))}
                      </Fragment>
                    ))}
                </div>
              ))}
            </div>
          </div>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            {cur && <SourceView file={cur} files={files} />}
          </div>
        </div>
      )}
    </>
  );
}

// @implements REQ-DESKTOP-025
export function MemoryPage({ project }: PageProps) {
  const mem = useApi(() => api.memory(project), [project]);
  const [view, setView] = useState('sources');
  const [typeF, setTypeF] = useState<TypeFilter>('all');
  const [sel, setSel] = useState<string | null>(null);

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <div style={{ padding: '16px 18px 0' }}>
        <PageHead
          icon="memory"
          title="Memory"
          sub="Everything the agent remembers — across levels and types"
          actions={
            <Segmented
              value={view}
              onChange={setView}
              size="sm"
              label="Memory view"
              options={[{ value: 'sources', label: 'Sources' }, { value: 'effective', label: 'Effective' }]}
            />
          }
        />
      </div>
      <Module state={mem} label="memory" minHeight={320}>
        {(d) => (d.files.length === 0
          ? <EmptyMemory onReload={mem.reload} />
          : <MemoryBody data={d} view={view} typeF={typeF} onTypeF={setTypeF} sel={sel} onSel={setSel} onReload={mem.reload} />)}
      </Module>
    </div>
  );
}
