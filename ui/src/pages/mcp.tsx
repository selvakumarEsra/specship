/**
 * MCP — configured Model Context Protocol servers with live status
 * (REQ-DESKTOP-026). TSX port of specs/specship-desktop/screens-mcp.jsx
 * bound to live GET /api/mcp/servers: scope-grouped server cards with
 * 5-state status pills (A1); per-server detail with the owning config JSON,
 * per-tool call stats and a real example call from the transcript DB (A2);
 * enable/disable behind a confirm dialog that PATCHes the owning config
 * file and reflects the new state (A3); failed/disabled treatments plus
 * explicit empty and error states — never a blank screen (A4). This fork is
 * Claude Code only, so the inventory is Claude Code's config surfaces; the
 * snapshot's multi-client "Used by" rail is intentionally not rendered.
 */
import { useState } from 'react';
import { api, type AddMcpServerPayload, type McpServer, type McpServerState } from '../api';
import { fmtTok, Module } from '../components/dashboard-modules';
import { Icon } from '../components/icons';
import { CopyBtn, Empty, PageHead, Pill, Segmented, timeAgo } from '../components/ui';
import { useApi } from '../hooks';
import type { PageProps } from './types';

/** State chrome (design bundle's SRV_STATE, extended to the spec vocab). */
const SRV_STATE: Record<McpServerState, { color: string; label: string; dot: boolean; pulse?: boolean }> = {
  active: { color: 'var(--success)', label: 'Active', dot: true, pulse: true },
  connected: { color: 'var(--node-spec)', label: 'Connected', dot: true },
  idle: { color: 'var(--text-muted)', label: 'Idle', dot: false },
  failed: { color: 'var(--error)', label: 'Failed', dot: true },
  disabled: { color: 'var(--text-muted)', label: 'Disabled', dot: false },
};

const SCOPE: Record<McpServer['scope'], { color: string; label: string; hint: string; icon: string }> = {
  user: { color: 'var(--node-route)', label: 'Global', hint: '~/.claude.json', icon: 'database' },
  project: { color: 'var(--accent)', label: 'Project', hint: '.mcp.json', icon: 'folder' },
  unknown: { color: 'var(--text-muted)', label: 'Usage only', hint: 'seen in transcripts, not configured', icon: 'sessions' },
};

const soft = (color: string) => `color-mix(in srgb, ${color} 14%, transparent)`;

function StatePill({ state }: { state: McpServerState }) {
  const st = SRV_STATE[state];
  return (
    <span className="pill" style={{ color: st.color, background: soft(st.color), width: 92, justifyContent: 'center' }}>
      {st.dot && <span className="pill-dot" style={{ background: st.color, animation: st.pulse ? 'pulsePill 1.6s ease-out infinite' : undefined }} />}
      {st.label}
    </span>
  );
}

function ScopePill({ scope }: { scope: McpServer['scope'] }) {
  const sc = SCOPE[scope];
  return <Pill color={sc.color} bg={soft(sc.color)}><Icon name={sc.icon} size={10} />{sc.label}</Pill>;
}

/** Display string for the real example call (latest input_json row). */
function exampleText(srv: McpServer): string | null {
  if (!srv.exampleCall) return null;
  return `${srv.exampleCall.tool} ${JSON.stringify(srv.exampleCall.args)}`;
}

function tile(icon: string, label: string, value: string, sub: string, color?: string) {
  return (
    <div className="card" style={{ padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div className="row gap-6" style={{ color: 'var(--text-muted)' }}>
        <Icon name={icon} size={12} style={{ color: color || 'var(--accent)', flexShrink: 0 }} />
        <span className="eyebrow" style={{ letterSpacing: '0.03em' }}>{label}</span>
      </div>
      <div className="mono tabular" style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.01em' }}>{value}</div>
      <div className="mono muted" style={{ fontSize: 10 }}>{sub}</div>
    </div>
  );
}

function seg(label: string, value: string) {
  return (
    <div className="row gap-6" style={{ flexShrink: 0 }}>
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <span className="mono tabular" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
}

// ---- List view --------------------------------------------------------------

function ServerRow({ srv, onOpen }: { srv: McpServer; onOpen: (id: string) => void }) {
  const st = SRV_STATE[srv.state];
  return (
    <div
      onClick={() => onOpen(srv.id)}
      className="card"
      style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'background var(--motion-fast), border-color var(--motion-fast)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-panel-2)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
    >
      <div style={{ position: 'relative', width: 36, height: 36, borderRadius: 9, background: soft(SCOPE[srv.scope].color), color: SCOPE[srv.scope].color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name="plug" size={18} />
        <span style={{ position: 'absolute', right: -2, bottom: -2, width: 11, height: 11, borderRadius: '50%', background: st.color, border: '2px solid var(--bg-panel)', boxShadow: srv.state === 'active' ? `0 0 6px ${st.color}` : 'none' }} />
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-8">
          <span className="mono" style={{ fontSize: 13.5, fontWeight: 600 }}>{srv.name}</span>
          <ScopePill scope={srv.scope} />
        </div>
        <div className="mono muted" style={{ fontSize: 11, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {srv.command || 'no config entry — usage only'}
        </div>
      </div>
      <div className="row gap-16" style={{ flexShrink: 0 }}>
        <div style={{ textAlign: 'right', width: 56 }}>
          <div className="mono tabular" style={{ fontSize: 14, fontWeight: 600, color: srv.calls ? 'var(--text-primary)' : 'var(--text-muted)' }}>{srv.calls.toLocaleString()}</div>
          <div className="muted" style={{ fontSize: 10 }}>calls</div>
        </div>
        <StatePill state={srv.state} />
        <Icon name="chevronRight" size={15} style={{ color: 'var(--text-muted)' }} />
      </div>
    </div>
  );
}

function ServerList({ servers, onOpen, onReload, onAdd }: {
  servers: McpServer[]; onOpen: (id: string) => void; onReload: () => void; onAdd: () => void;
}) {
  const connected = servers.filter((s) => s.state === 'active' || s.state === 'connected').length;
  const totalTools = servers.reduce((a, s) => a + s.tools.length, 0);
  const failed = servers.filter((s) => s.state === 'failed');
  const groups: Array<[McpServer['scope'], McpServer[]]> = (['user', 'project', 'unknown'] as const)
    .map((k) => [k, servers.filter((s) => s.scope === k)] as [McpServer['scope'], McpServer[]]);

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
      <PageHead
        icon="plug"
        title="MCP servers"
        sub="Model Context Protocol servers Claude Code is configured to load"
        actions={
          <div className="row gap-6">
            <button className="btn btn-ghost btn-sm" onClick={onReload}><Icon name="refresh" size={13} />Reload</button>
            <button className="btn btn-secondary btn-sm" onClick={onAdd}><Icon name="plus" size={13} />Add server</button>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
        {tile('plug', 'Servers', String(servers.length), 'global + project')}
        {tile('circle', 'Connected', `${connected} / ${servers.length}`, 'answering now', 'var(--success)')}
        {tile('wrench', 'Tools', String(totalTools), 'seen in transcripts', 'var(--node-code)')}
        {tile('drift', 'Needs attention', String(failed.length), failed.length ? failed.map((f) => f.name).join(', ') : 'all healthy', failed.length ? 'var(--error)' : 'var(--success)')}
      </div>

      {groups.map(([key, list]) => {
        if (!list.length) return null;
        const sc = SCOPE[key];
        return (
          <div key={key} style={{ marginBottom: 18 }}>
            <div className="row gap-8" style={{ marginBottom: 9 }}>
              <Icon name={sc.icon} size={13} style={{ color: sc.color }} />
              <span className="eyebrow">{sc.label}</span>
              <span className="mono muted" style={{ fontSize: 11 }}>{sc.hint}</span>
              <span className="muted" style={{ fontSize: 11 }}>· {list.length}</span>
            </div>
            <div className="col gap-8">
              {list.map((s) => <ServerRow key={s.id} srv={s} onOpen={onOpen} />)}
            </div>
          </div>
        );
      })}
      <div style={{ height: 20 }} />
    </div>
  );
}

// ---- Detail view ------------------------------------------------------------

function ToolRow({ tool }: { tool: McpServer['tools'][number] }) {
  const perCall = tool.calls ? Math.round(tool.resultBytes / tool.calls) : 0;
  return (
    <div className="card row gap-10" style={{ padding: '11px 13px' }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--node-code-soft)', color: 'var(--node-code)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name="wrench" size={15} />
      </div>
      <span className="mono grow" style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tool.name}</span>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div className="mono tabular" style={{ fontSize: 13, fontWeight: 600 }}>×{tool.calls.toLocaleString()}</div>
        <div className="mono tabular muted" style={{ fontSize: 10 }}>calls</div>
      </div>
      <div style={{ textAlign: 'right', width: 64, flexShrink: 0 }}>
        <div className="mono tabular" style={{ fontSize: 13, fontWeight: 600, color: perCall > 8000 ? 'var(--warn)' : 'var(--success)' }}>{fmtTok(perCall)}</div>
        <div className="mono tabular muted" style={{ fontSize: 10 }}>bytes / call</div>
      </div>
    </div>
  );
}

function ServerDetail({ srv, onBack, onChanged }: {
  srv: McpServer; onBack: () => void; onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const st = SRV_STATE[srv.state];
  const sc = SCOPE[srv.scope];
  const example = exampleText(srv);
  const lastMs = srv.lastUsed ? Date.parse(srv.lastUsed) : 0;
  const configJson = srv.entry ? JSON.stringify({ mcpServers: { [srv.name]: srv.entry } }, null, 2) : null;
  const canToggle = srv.configFile != null;

  return (
    <div className="scroll-y" style={{ flex: 1, padding: 18 }}>
      <div className="row gap-10" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="chevronLeft" size={14} />MCP servers</button>
        <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{srv.name}</span>
        <ScopePill scope={srv.scope} />
        {srv.configFile && <span className="mono muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{srv.configFile}</span>}
      </div>

      {/* Status banner — adapts to state (failed strip, disabled affordance). */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 14, display: 'flex' }}>
        <div style={{ width: 3, background: st.color, flexShrink: 0 }} />
        <div style={{ flex: 1, padding: '13px 16px' }}>
          <div className="row gap-16" style={{ flexWrap: 'wrap' }}>
            <div className="row gap-8" style={{ flexShrink: 0 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: st.color, boxShadow: srv.state === 'active' ? `0 0 8px ${st.color}` : 'none', animation: srv.state === 'active' ? 'pulsePill 1.6s ease-out infinite' : undefined }} />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>{st.label}</span>
            </div>
            {seg('Transport', srv.transport)}
            {seg('Calls', srv.calls.toLocaleString())}
            {seg('Last used', lastMs ? (timeAgo(lastMs) ?? '—') : 'never')}
            {seg('Tools', String(srv.tools.length))}
            <div className="grow" />
            {srv.command && (
              <div className="row gap-8" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '6px 10px', maxWidth: 360 }}>
                <Icon name="command" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{srv.command}</span>
                <CopyBtn text={srv.command} />
              </div>
            )}
            {canToggle && (
              <button
                className={srv.disabled ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                onClick={() => setConfirming(true)}
              >
                <Icon name={srv.disabled ? 'play' : 'pause'} size={12} />
                {srv.disabled ? 'Enable server' : 'Disable server'}
              </button>
            )}
          </div>
          {srv.state === 'failed' && (
            <div className="row gap-8" style={{ marginTop: 11, padding: '8px 11px', background: 'var(--error-soft)', border: '1px solid rgba(242,85,90,0.25)', borderRadius: 7 }}>
              <Icon name="drift" size={14} style={{ color: 'var(--error)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                The server didn't answer an MCP initialize — it may be crashing, unreachable, or mis-configured. Check the command and credentials, then reload.
              </span>
            </div>
          )}
          {srv.disabled && (
            <div className="muted" style={{ marginTop: 11, fontSize: 11.5 }}>
              Disabled in {srv.configFile} — Claude Code won't load this server until it's enabled again.
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {tile('wrench', 'Tools', String(srv.tools.length), 'seen in transcripts')}
        {tile('plug', 'Calls', srv.calls.toLocaleString(), 'all time', 'var(--node-code)')}
        {tile('database', 'Result bytes', fmtTok(srv.resultBytes), 'returned to context', 'var(--node-route)')}
        {tile('clock', 'Last used', lastMs ? (timeAgo(lastMs) ?? '—') : 'never', lastMs ? new Date(lastMs).toLocaleString() : 'no calls recorded', 'var(--success)')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div style={{ minWidth: 0, gridColumn: '1 / -1' }}>
          <div className="row gap-8" style={{ marginBottom: 10 }}>
            <span className="eyebrow">Tools · {srv.tools.length}</span>
            <span className="muted" style={{ fontSize: 11 }}>call counts from ingested transcripts</span>
          </div>
          {srv.tools.length ? (
            <div className="col gap-8">
              {srv.tools.map((t) => <ToolRow key={t.name} tool={t} />)}
            </div>
          ) : (
            <div className="card card-pad muted" style={{ fontSize: 12 }}>
              No tool calls recorded yet — statistics appear after Claude Code uses this server.
            </div>
          )}
        </div>

        {/* Example call — the latest real input from claude_tool_calls (A2). */}
        <div className="card card-pad" style={{ minWidth: 0 }}>
          <div className="row gap-8" style={{ marginBottom: 12 }}>
            <Icon name="command" size={14} style={{ color: 'var(--node-code)' }} />
            <span style={{ fontWeight: 600, fontSize: 12.5 }}>Example call</span>
            {example && <span className="muted" style={{ fontSize: 10.5 }}>latest recorded input</span>}
          </div>
          {example ? (
            <div className="row gap-8" style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '8px 11px' }}>
              <span className="mono grow" style={{ fontSize: 11.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{example}</span>
              <CopyBtn text={example} />
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 11.5 }}>No calls recorded yet.</div>
          )}
        </div>

        <div className="card card-pad" style={{ minWidth: 0 }}>
          <div className="row gap-8" style={{ marginBottom: 12 }}>
            <Icon name="settings" size={14} style={{ color: 'var(--accent)' }} />
            <span className="grow" style={{ fontWeight: 600, fontSize: 12.5 }}>Configuration</span>
            <span className="mono muted" style={{ fontSize: 10.5 }}>{srv.configFile ?? sc.hint}</span>
            {configJson && <CopyBtn text={configJson} />}
          </div>
          {configJson ? (
            <pre className="mono scroll-y" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: 'var(--text-secondary)', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '11px 13px', overflowX: 'auto', whiteSpace: 'pre' }}>{configJson}</pre>
          ) : (
            <div className="muted" style={{ fontSize: 11.5 }}>
              This server appears in transcripts but isn't in any config file — it was likely removed, or belongs to another machine's setup.
            </div>
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmToggleDialog
          srv={srv}
          onClose={() => setConfirming(false)}
          onDone={() => { setConfirming(false); onChanged(); }}
        />
      )}
      <div style={{ height: 24 }} />
    </div>
  );
}

/** A3: the config write happens only after an explicit confirmation. */
function ConfirmToggleDialog({ srv, onClose, onDone }: {
  srv: McpServer; onClose: () => void; onDone: () => void;
}) {
  const enabling = srv.disabled;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verb = enabling ? 'Enable' : 'Disable';

  const confirm = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    api.setMcpServerEnabled(srv.name, enabling).then(
      () => onDone(),
      (e) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false); },
    );
  };

  return (
    <div onMouseDown={onClose} role="dialog" aria-label={`${verb} ${srv.name}`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90, display: 'grid', placeItems: 'center' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '90vw', background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-pop)' }}>
        <div className="row gap-10" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name={enabling ? 'play' : 'pause'} size={16} style={{ color: enabling ? 'var(--success)' : 'var(--warn)' }} />
          <span className="grow" style={{ fontWeight: 600 }}>{verb} {srv.name}?</span>
          <button className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </div>
        <div style={{ padding: 16 }}>
          <div className="secondary" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            This writes to <code className="mono" style={{ fontSize: 11.5 }}>{srv.configFile}</code>.{' '}
            {enabling
              ? 'Claude Code loads the server again on its next start.'
              : 'Claude Code stops loading the server (and its tools) on its next start.'}
          </div>
          {error && (
            <div className="row gap-8" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 7, background: 'var(--error-soft)', color: 'var(--error)', fontSize: 12 }}>
              <Icon name="cancel" size={13} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="row gap-8" style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={confirm} disabled={busy}>
            {busy ? `${verb.slice(0, -1)}ing…` : `${verb} server`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Add server -------------------------------------------------------------

/** Guided add — name, scope, transport; POSTs to /api/mcp/servers. */
function AddServerDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [transport, setTransport] = useState('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = !!name.trim() && !/\s/.test(name.trim());
  const targetOk = transport === 'stdio' ? !!command.trim() : !!url.trim();
  const valid = nameOk && targetOk;

  const submit = () => {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    const payload: AddMcpServerPayload = { name: name.trim(), scope };
    if (transport === 'stdio') {
      const [cmd, ...args] = command.trim().split(/\s+/);
      payload.command = cmd;
      if (args.length) payload.args = args;
    } else {
      payload.url = url.trim();
    }
    api.addMcpServer(payload).then(
      () => onAdded(),
      (e) => { setError(e instanceof Error ? e.message : String(e)); setBusy(false); },
    );
  };

  return (
    <div onMouseDown={onClose} role="dialog" aria-label="Add MCP server" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 90, display: 'grid', placeItems: 'center' }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '90vw', background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 12, boxShadow: 'var(--shadow-pop)' }}>
        <div className="row gap-10" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="plus" size={16} style={{ color: 'var(--accent)' }} />
          <span className="grow" style={{ fontWeight: 600 }}>Add MCP server</span>
          <button className="btn btn-ghost btn-xs" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label className="eyebrow" style={{ display: 'block', marginBottom: 5 }} htmlFor="mcp-add-name">Name</label>
            <input
              id="mcp-add-name" className="input mono" style={{ width: '100%' }}
              placeholder="github" value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 5 }}>Scope</div>
            <Segmented
              value={scope}
              onChange={(v) => setScope(v as 'user' | 'project')}
              size="sm"
              label="Server scope"
              options={[{ value: 'user', label: 'Global · ~/.claude.json' }, { value: 'project', label: 'Project · .mcp.json' }]}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 5 }}>Transport</div>
            <Segmented
              value={transport}
              onChange={setTransport}
              size="sm"
              label="Server transport"
              options={[{ value: 'stdio', label: 'stdio · command' }, { value: 'http', label: 'http · url' }]}
            />
          </div>
          {transport === 'stdio' ? (
            <div style={{ marginBottom: 4 }}>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 5 }} htmlFor="mcp-add-command">Command</label>
              <input
                id="mcp-add-command" className="input mono" style={{ width: '100%' }}
                placeholder="npx -y @modelcontextprotocol/server-github"
                value={command} onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </div>
          ) : (
            <div style={{ marginBottom: 4 }}>
              <label className="eyebrow" style={{ display: 'block', marginBottom: 5 }} htmlFor="mcp-add-url">URL</label>
              <input
                id="mcp-add-url" className="input mono" style={{ width: '100%' }}
                placeholder="https://<host>/sse"
                value={url} onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </div>
          )}
          {error && (
            <div className="row gap-8" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 7, background: 'var(--error-soft)', color: 'var(--error)', fontSize: 12 }}>
              <Icon name="cancel" size={13} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="row gap-8" style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy || !valid}>
            <Icon name="plus" size={13} />{busy ? 'Adding…' : 'Add server'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Page -------------------------------------------------------------------

/** A4: nothing configured anywhere — say so and point at the config files. */
function EmptyMcp({ onAdd, onReload }: { onAdd: () => void; onReload: () => void }) {
  return (
    <Empty
      icon="plug"
      title="No MCP servers configured"
      body={
        <>
          Claude Code loads MCP servers from <code className="mono">~/.claude.json</code> and the
          project's <code className="mono">.mcp.json</code>. Add one here, or run{' '}
          <code className="mono">specship install</code> to register SpecShip's own server.
        </>
      }
      action={
        <div className="row gap-8" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={onAdd}><Icon name="plus" size={13} />Add server</button>
          <button className="btn btn-ghost btn-sm" onClick={onReload}><Icon name="refresh" size={13} />Reload</button>
        </div>
      }
    />
  );
}

// @implements REQ-DESKTOP-026
export function McpPage({ query }: PageProps) {
  const servers = useApi(() => api.mcpServers(), []);
  const [sel, setSel] = useState<string | null>(query?.server ?? null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="col" style={{ flex: 1, minHeight: 0 }}>
      <Module state={servers} label="MCP servers" minHeight={320}>
        {(d) => {
          const cur = sel ? d.servers.find((s) => s.id === sel) : undefined;
          if (cur) return <ServerDetail srv={cur} onBack={() => setSel(null)} onChanged={servers.reload} />;
          if (!d.servers.length) return <EmptyMcp onAdd={() => setAdding(true)} onReload={servers.reload} />;
          return <ServerList servers={d.servers} onOpen={setSel} onReload={servers.reload} onAdd={() => setAdding(true)} />;
        }}
      </Module>
      {adding && (
        <AddServerDialog
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); servers.reload(); }}
        />
      )}
    </div>
  );
}
