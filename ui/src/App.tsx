/**
 * App shell — sidebar, status strip, top bar, routed screens. Ported from the
 * design bundle's app.jsx onto history-API routing and live /api data.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent } from 'react';
import { api, isNoProject, type ProjectEntry, type StatusResponse } from './api';
import { CommandPalette, type PalettePage } from './components/command-palette';
import { Icon, LogoMark } from './components/icons';
import { useApi, useGlobalShortcuts } from './hooks';
import { go, usePathRoute } from './router';
import { applyTheme, getThemePref, type ThemePref } from './theme';
import { DashboardPage } from './pages/dashboard';
import { DesignSystemPage } from './pages/designsystem';
import { DriftPage } from './pages/drift';
import { GraphPage } from './pages/graph';
import { PlaceholderPage } from './pages/placeholder';
import { RunsPage } from './pages/runs';
import { SpecsPage } from './pages/specs';
import type { PageProps } from './pages/types';

/** Live counts the nav badges derive from (design bundle's app.jsx NAV). */
interface BadgeCounts {
  drift: number;
  runs: number;
  tips: number;
}

interface NavEntry {
  id: string;
  label: string;
  icon: string;
  badge?: (c: BadgeCounts) => number;
  badgeKind?: 'warn' | 'error';
}

const NAV: Array<{ group: string; items: NavEntry[] }> = [
  {
    group: 'Project',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { id: 'graph', label: 'Graph', icon: 'graph' },
      { id: 'specs', label: 'Specs', icon: 'book' },
      { id: 'drift', label: 'Drift queue', icon: 'drift', badge: (c) => c.drift },
      { id: 'runs', label: 'Runs', icon: 'play', badge: (c) => c.runs, badgeKind: 'warn' },
    ],
  },
  {
    group: 'Claude Code',
    items: [
      { id: 'sessions', label: 'Sessions', icon: 'sessions' },
      { id: 'heatmap', label: 'Heatmap', icon: 'heatmap' },
      { id: 'costs', label: 'Costs', icon: 'dollar' },
      { id: 'compare', label: 'Compare projects', icon: 'compare' },
      { id: 'memory', label: 'Memory', icon: 'memory' },
      { id: 'mcp', label: 'MCP', icon: 'plug' },
      { id: 'tips', label: 'Tips', icon: 'tips', badge: (c) => c.tips, badgeKind: 'error' },
    ],
  },
];

/** Pages the ⌘K palette jumps to — NAV plus the pinned sidebar items. */
const PALETTE_PAGES: PalettePage[] = [
  ...NAV.flatMap((g) => g.items.map(({ id, label, icon }) => ({ id, label, icon }))),
  { id: 'designsystem', label: 'Design system', icon: 'layers' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

/** ⌘1–7 targets: the first seven nav items in sidebar order (REQ-DESKTOP-019). */
const JUMP_PAGE_IDS = NAV.flatMap((g) => g.items.map((it) => it.id)).slice(0, 7);

const SCREENS: Record<string, ComponentType<PageProps>> = {
  dashboard: DashboardPage,
  graph: GraphPage,
  specs: SpecsPage,
  drift: DriftPage,
  runs: RunsPage,
  designsystem: () => <DesignSystemPage />,
  sessions: () => <PlaceholderPage title="Sessions" req="REQ-DESKTOP-024" />,
  heatmap: () => <PlaceholderPage title="Heatmap" req="REQ-DESKTOP-026" />,
  costs: () => <PlaceholderPage title="Costs" req="REQ-DESKTOP-027" />,
  compare: () => <PlaceholderPage title="Compare projects" req="REQ-DESKTOP-028" />,
  memory: () => <PlaceholderPage title="Memory" req="REQ-DESKTOP-029" />,
  mcp: () => <PlaceholderPage title="MCP" req="REQ-DESKTOP-030" />,
  tips: () => <PlaceholderPage title="Tips" req="REQ-DESKTOP-031" />,
  settings: () => <PlaceholderPage title="Settings" req="REQ-DESKTOP-032" />,
};

const PROJECT_KEY = 'ss_project';
const NAV_GROUPS_KEY = 'ss_nav_groups';
const NAV_COLLAPSED_KEY = 'ss_nav_collapsed';

export function App() {
  const { route, param, query } = usePathRoute();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(NAV_COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const [project, setProject] = useState<string | null>(() => {
    try { return localStorage.getItem(PROJECT_KEY); } catch { return null; }
  });
  const [refreshing, setRefreshing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const status = useApi(() => api.status(project), [project, route]);
  const projects = useApi(() => api.projects(), []);
  const runs = useApi(() => api.runs(project), [project, route]);
  const tips = useApi(() => api.claudeTips(), [route]);

  // ⌘K toggle, ⌘1–7 nav jumps, and g-chords (REQ-DESKTOP-019).
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useGlobalShortcuts({ onTogglePalette: togglePalette, pageIds: JUMP_PAGE_IDS });

  const counts: BadgeCounts = {
    drift: status.data?.drift ?? 0,
    runs: runs.data?.runs.filter((r) => r.status === 'running').length ?? 0,
    // Actionable tips only — applied ones no longer need attention, and
    // dismissed ones never come back from the server (REQ-DESKTOP-020.A2).
    tips: tips.data?.tips.filter((t) => t.state !== 'applied').length ?? 0,
  };

  const openPalette = useCallback(() => setPaletteOpen(true), []);

  const toggleCollapse = () =>
    setCollapsed((c) => {
      try { localStorage.setItem(NAV_COLLAPSED_KEY, c ? '0' : '1'); } catch { /* ignore */ }
      return !c;
    });

  const pickProject = (slug: string | null) => {
    setProject(slug);
    try {
      if (slug) localStorage.setItem(PROJECT_KEY, slug);
      else localStorage.removeItem(PROJECT_KEY);
    } catch { /* ignore */ }
  };

  const refresh = () => {
    setRefreshing(true);
    api.refresh(project)
      .catch(() => undefined)
      .finally(() => { setRefreshing(false); status.reload(); });
  };

  const Screen = SCREENS[route] ?? (() => <PlaceholderPage title="Not found" />);

  return (
    <div style={{ display: 'flex', height: '100%', position: 'relative' }}>
      <Sidebar route={route} collapsed={collapsed} counts={counts} onToggleCollapse={toggleCollapse} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <StatusStrip
          status={status.data}
          projectless={isNoProject(status.error)}
          projects={projects.data?.projects ?? []}
          project={project}
          onPick={pickProject}
          onRefresh={refresh}
          refreshing={refreshing}
        />
        <TopBar onToggle={toggleCollapse} onOpenPalette={openPalette} />
        <div key={route + (param ?? '')} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Screen project={project} param={param} query={query} />
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} pages={PALETTE_PAGES} project={project} />
    </div>
  );
}

function Sidebar({ route, collapsed, counts, onToggleCollapse }: { route: string; collapsed: boolean; counts: BadgeCounts; onToggleCollapse: () => void }) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try { return (JSON.parse(localStorage.getItem(NAV_GROUPS_KEY) || 'null') as Record<string, boolean>) || {}; } catch { return {}; }
  });
  const isOpen = (g: string) => openGroups[g] !== false; // default open
  const toggleGroup = (g: string) =>
    setOpenGroups((s) => {
      const n = { ...s, [g]: s[g] === false };
      try { localStorage.setItem(NAV_GROUPS_KEY, JSON.stringify(n)); } catch { /* ignore */ }
      return n;
    });

  return (
    <nav
      style={{
        width: collapsed ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)', flexShrink: 0,
        background: 'var(--bg-panel)', borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', transition: 'width 120ms', overflow: 'hidden',
      }}
    >
      <div
        className="row gap-8"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand menu' : 'Collapse menu'}
        style={{ padding: collapsed ? '14px 0' : '15px 16px', justifyContent: collapsed ? 'center' : 'flex-start', cursor: 'pointer', userSelect: 'none' }}
      >
        <LogoMark size={26} />
        {!collapsed && <div className="grow" style={{ fontWeight: 600, fontSize: 13.5, letterSpacing: '-0.01em' }}>SpecShip</div>}
      </div>
      <div className="scroll-y" style={{ flex: 1, padding: '4px 8px' }}>
        {NAV.map((g) => (
          <div key={g.group} style={{ marginBottom: collapsed ? 10 : 4 }}>
            {!collapsed && (
              <button onClick={() => toggleGroup(g.group)} className="row gap-6" style={{ width: '100%', padding: '8px 8px 4px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span className="eyebrow grow">{g.group}</span>
                <Icon name={isOpen(g.group) ? 'chevronDown' : 'chevronRight'} size={12} style={{ color: 'var(--text-muted)' }} />
              </button>
            )}
            {(collapsed || isOpen(g.group)) && g.items.map((it) => <NavItem key={it.id} item={it} active={route === it.id} collapsed={collapsed} counts={counts} />)}
          </div>
        ))}
      </div>
      <div style={{ padding: 8, borderTop: '1px solid var(--border-subtle)' }}>
        <NavItem item={{ id: 'designsystem', label: 'Design system', icon: 'layers' }} active={route === 'designsystem'} collapsed={collapsed} />
        <NavItem item={{ id: 'settings', label: 'Settings', icon: 'settings' }} active={route === 'settings'} collapsed={collapsed} />
      </div>
    </nav>
  );
}

function NavItem({ item, active, collapsed, counts }: { item: NavEntry; active: boolean; collapsed: boolean; counts?: BadgeCounts }) {
  const onClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // keep open-in-new-tab
    e.preventDefault();
    go(item.id);
  };
  const badge = item.badge && counts ? item.badge(counts) : 0;
  const bk = item.badgeKind;
  return (
    <a
      href={'/' + item.id}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 32, padding: collapsed ? 0 : '0 10px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 7, textDecoration: 'none', marginBottom: 1,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: active ? 'var(--bg-active)' : 'transparent',
        fontWeight: active ? 600 : 450, fontSize: 13, position: 'relative', transition: 'background 100ms',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {active && <span style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 2.5, borderRadius: 2, background: 'var(--accent)' }} />}
      <Icon name={item.icon} size={16} style={{ color: active ? 'var(--accent)' : 'inherit', flexShrink: 0 }} />
      {!collapsed && <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>}
      {!collapsed && badge > 0 && (
        <span
          className="pill tabular"
          style={{
            fontSize: 10, fontWeight: 700, padding: '1px 6px', minWidth: 18, justifyContent: 'center',
            color: bk === 'error' ? 'var(--error)' : bk === 'warn' ? 'var(--warn)' : 'var(--text-secondary)',
            background: bk === 'error' ? 'var(--error-soft)' : bk === 'warn' ? 'var(--warn-soft)' : 'rgba(255,255,255,0.06)',
          }}
        >
          {badge}
        </span>
      )}
      {collapsed && badge > 0 && (
        <span style={{ position: 'absolute', top: 5, right: 9, width: 6, height: 6, borderRadius: '50%', background: bk === 'error' ? 'var(--error)' : 'var(--warn)' }} />
      )}
    </a>
  );
}

function ProjectSwitcher({ projects, project, projectPath, onPick }: {
  projects: ProjectEntry[]; project: string | null; projectPath: string | null; onPick: (slug: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // The status strip clips overflow, so an absolutely-positioned dropdown
  // inside it would be invisible — anchor a fixed-position dropdown to the
  // trigger button instead (fixed elements escape ancestor overflow clips).
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const toggle = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      setAnchor(r ? { top: r.bottom + 5, left: r.left } : null);
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-projsw]')) setOpen(false); };
    window.addEventListener('mousedown', h);
    return () => window.removeEventListener('mousedown', h);
  }, [open]);
  const initialized = projects.filter((p) => p.initialized);
  const current = project ?? '';
  const label = projectPath || (project ?? 'pick a project');
  return (
    <div data-projsw="1" style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={toggle}
        className="row gap-6"
        title="Switch project"
        style={{ height: 24, padding: '0 8px', borderRadius: 6, cursor: 'pointer', background: open ? 'var(--bg-hover)' : 'transparent', border: '1px solid ' + (open ? 'var(--border-strong)' : 'transparent'), transition: 'background 100ms, border-color 100ms' }}
      >
        <Icon name="folder" size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-primary)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <Icon name="chevronDown" size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{ position: 'fixed', top: anchor?.top ?? 34, left: anchor?.left ?? 8, minWidth: 264, background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', borderRadius: 9, boxShadow: 'var(--shadow-pop)', padding: 5, zIndex: 60 }}>
          <div className="eyebrow" style={{ padding: '5px 8px 6px' }}>Indexed projects</div>
          <button className="row gap-8" onClick={() => { onPick(null); setOpen(false); }} style={switcherRow(current === '')}>
            <Icon name="folder" size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <span className="grow" style={{ textAlign: 'left', fontSize: 12.5 }}>Primary project</span>
            {current === '' && <Icon name="check" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
          </button>
          {initialized.map((p) => {
            const active = p.slug === current;
            return (
              <button key={p.slug} className="row gap-8" onClick={() => { onPick(p.slug); setOpen(false); }} style={switcherRow(active)}>
                <Icon name="folder" size={13} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                <span className="grow mono" style={{ textAlign: 'left', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path}</span>
                {(p.driftCount ?? 0) > 0 && (
                  <span className="pill tabular" style={{ fontSize: 9.5, color: 'var(--warn)', background: 'var(--warn-soft)', flexShrink: 0 }}>{p.driftCount} drift</span>
                )}
                {active && <Icon name="check" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
              </button>
            );
          })}
          {!initialized.length && <div className="muted" style={{ padding: '6px 8px', fontSize: 12 }}>No initialized projects found.</div>}
        </div>
      )}
    </div>
  );
}

function switcherRow(active: boolean): React.CSSProperties {
  return { width: '100%', textAlign: 'left', padding: '7px 8px', borderRadius: 6, cursor: 'pointer', border: 'none', background: active ? 'var(--bg-active)' : 'transparent' };
}

function StatusStrip({ status, projectless, projects, project, onPick, onRefresh, refreshing }: {
  status: StatusResponse | null; projectless: boolean; projects: ProjectEntry[]; project: string | null;
  onPick: (slug: string | null) => void; onRefresh: () => void; refreshing: boolean;
}) {
  const seg = (label: string, value: string, color?: string) => (
    <div className="row gap-6" style={{ flexShrink: 0 }}>
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
      <span className="mono tabular" style={{ fontSize: 11.5, color: color || 'var(--text-secondary)' }}>{value}</span>
    </div>
  );
  const divider = <span style={{ width: 1, height: 12, background: 'var(--border-subtle)', flexShrink: 0 }} />;
  const freshness = status?.lastIndexed ? new Date(status.lastIndexed).toLocaleString() : '—';
  return (
    <div style={{ height: 'var(--status-h)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-panel-2)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
      <ProjectSwitcher projects={projects} project={project} projectPath={status?.projectPath ?? null} onPick={onPick} />
      {divider}
      {seg('nodes', status ? status.nodeCount.toLocaleString() : projectless ? '—' : '…')}
      {seg('edges', status ? status.edgeCount.toLocaleString() : projectless ? '—' : '…')}
      {divider}
      {seg('drift', status ? String(status.drift) : '—', status ? (status.drift ? 'var(--warn)' : 'var(--success)') : undefined)}
      <div className="grow" />
      {seg('indexed', freshness)}
      <button className="btn btn-ghost btn-xs" onClick={onRefresh} title="Refresh now">
        <Icon name="refresh" size={12} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
      </button>
    </div>
  );
}

const KBD_STYLE: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '2px 6px' };

function TopBar({ onToggle, onOpenPalette }: { onToggle: () => void; onOpenPalette: () => void }) {
  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-canvas)' }}>
      <button className="btn btn-ghost" onClick={onToggle} style={{ padding: 6 }} title="Toggle sidebar">
        <Icon name="menu" size={16} />
      </button>
      <button
        onClick={onOpenPalette}
        className="row gap-8"
        style={{ flex: 1, maxWidth: 380, height: 30, padding: '0 11px', background: 'var(--bg-panel)', border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'text', color: 'var(--text-muted)', fontSize: 12.5 }}
      >
        <Icon name="search" size={14} />
        <span className="grow" style={{ textAlign: 'left' }}>Search or jump to…</span>
        <kbd style={KBD_STYLE}>⌘K</kbd>
      </button>
      <div className="grow" />
      <ThemeToggle />
      <button className="btn btn-ghost btn-sm" onClick={onOpenPalette} title="Command palette">
        <Icon name="command" size={14} />
      </button>
    </div>
  );
}

/** Tri-state theme cycle: dark → light → system (system tracks the OS live). */
function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const NEXT: Record<ThemePref, ThemePref> = { dark: 'light', light: 'system', system: 'dark' };
  const ICON: Record<ThemePref, string> = { dark: 'moon', light: 'sun', system: 'monitor' };
  const next = NEXT[pref];
  return (
    <button
      className="btn btn-ghost btn-sm"
      title={'Theme: ' + pref + ' — switch to ' + next}
      onClick={() => { applyTheme(next); setPref(next); }}
    >
      <Icon name={ICON[pref]} size={15} />
    </button>
  );
}
