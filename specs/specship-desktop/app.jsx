/* App shell — sidebar, status strip, router, command palette, shortcuts. */
(function () {
  const { useState, useEffect, useRef, useCallback } = React;
  const Icon = window.Icon;
  const D = window.DATA;

  // ---------- Theme ----------
  function applyTheme(mode) {
    const sys = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    const eff = mode === "system" ? sys : mode;
    document.documentElement.setAttribute("data-theme", eff);
    try { localStorage.setItem("specship-theme", mode); } catch (e) {}
  }
  window.getThemePref = function () { try { return localStorage.getItem("specship-theme") || "dark"; } catch (e) { return "dark"; } };
  window.applyTheme = applyTheme;
  applyTheme(window.getThemePref());
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { if (window.getThemePref() === "system") applyTheme("system"); });

  const NAV = [
    { group: "Project", items: [
      { id: "dashboard", label: "Dashboard", icon: "dashboard" },
      { id: "graph", label: "Graph", icon: "graph" },
      { id: "specs", label: "Specs", icon: "book" },
      { id: "drift", label: "Drift queue", icon: "drift", badge: () => D.status.drift },
      { id: "runs", label: "Runs", icon: "play", badge: () => 1, badgeKind: "warn" },
    ]},
    { group: "Claude Code", items: [
      { id: "sessions", label: "Sessions", icon: "sessions" },
      { id: "heatmap", label: "Heatmap", icon: "heatmap" },
      { id: "costs", label: "Costs", icon: "dollar" },
      { id: "compare", label: "Compare projects", icon: "compare" },
      { id: "memory", label: "Memory", icon: "memory" },
      { id: "mcp", label: "MCP", icon: "plug" },
      { id: "tips", label: "Tips", icon: "tips", badge: () => D.tips.filter((t) => t.severity !== "info").length, badgeKind: "error" },
    ]},
  ];
  const ALL_ITEMS = NAV.flatMap((g) => g.items);

  function useHashRoute() {
    const parse = () => {
      const h = (location.hash || "#/dashboard").replace(/^#/, "");
      const [path, qs] = h.split("?");
      const seg = path.split("/").filter(Boolean);
      return { route: seg[0] || "dashboard", param: seg[1], query: Object.fromEntries(new URLSearchParams(qs || "")) };
    };
    const [r, setR] = useState(parse);
    useEffect(() => { const f = () => setR(parse()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
    return r;
  }
  function go(route, opts = {}) {
    let h = "#/" + route;
    if (opts.param) h += "/" + opts.param;
    if (opts.query) h += "?" + new URLSearchParams(opts.query).toString();
    location.hash = h;
  }
  window.go = go;

  // ---------- Sidebar ----------
  function Sidebar({ route, collapsed, drawer, open, onClose, onToggleCollapse }) {
    const [openGroups, setOpenGroups] = useState(() => {
      try { return JSON.parse(localStorage.getItem("ss_nav_groups") || "null") || {}; } catch (e) { return {}; }
    });
    const isOpen = (g) => openGroups[g] !== false; // default open
    const toggleGroup = (g) => setOpenGroups((s) => {
      const n = { ...s, [g]: s[g] === false ? true : false };
      try { localStorage.setItem("ss_nav_groups", JSON.stringify(n)); } catch (e) {}
      return n;
    });
    const base = {
      width: collapsed ? "var(--sidebar-w-collapsed)" : "var(--sidebar-w)", flexShrink: 0,
      background: "var(--bg-panel)", borderRight: "1px solid var(--border-subtle)",
      display: "flex", flexDirection: "column", transition: "width 120ms", overflow: "hidden" };
    const drawerStyle = drawer ? {
      position: "fixed", top: 0, left: 0, height: "100%", zIndex: 110, width: "var(--sidebar-w)",
      transform: open ? "translateX(0)" : "translateX(-100%)",
      transition: "transform 200ms cubic-bezier(.2,.7,.3,1)",
      boxShadow: open ? "var(--shadow-pop)" : "none" } : {};
    return React.createElement("nav", { style: { ...base, ...drawerStyle } },
      // brand — logo toggles collapse
      React.createElement("div", { className: "row gap-8", onClick: (!drawer && onToggleCollapse) ? onToggleCollapse : undefined,
        title: (!drawer && onToggleCollapse) ? (collapsed ? "Expand menu" : "Collapse menu") : undefined,
        style: { padding: collapsed ? "14px 0" : "15px 16px", justifyContent: collapsed ? "center" : "flex-start", cursor: (!drawer && onToggleCollapse) ? "pointer" : "default", userSelect: "none" } },
        React.createElement(window.LogoMark, { size: 26 }),
        !collapsed && React.createElement("div", { className: "grow", style: { fontWeight: 600, fontSize: 13.5, letterSpacing: "-0.01em" } }, "SpecShip"),
        drawer && React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onClose, title: "Close menu" }, React.createElement(Icon, { name: "x", size: 15 }))),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: "4px 8px" } },
        NAV.map((g) => React.createElement("div", { key: g.group, style: { marginBottom: collapsed ? 10 : 4 } },
          !collapsed && React.createElement("button", { onClick: () => toggleGroup(g.group), className: "row gap-6",
            style: { width: "100%", padding: "8px 8px 4px", background: "none", border: "none", cursor: "pointer", textAlign: "left" } },
            React.createElement("span", { className: "eyebrow grow" }, g.group),
            React.createElement(Icon, { name: isOpen(g.group) ? "chevronDown" : "chevronRight", size: 12, style: { color: "var(--text-muted)" } })),
          (collapsed || isOpen(g.group)) && g.items.map((it) => React.createElement(NavItem, { key: it.id, item: it, active: route === it.id, collapsed }))))),
      // settings pinned
      React.createElement("div", { style: { padding: 8, borderTop: "1px solid var(--border-subtle)" } },
        React.createElement(NavItem, { item: { id: "designsystem", label: "Design system", icon: "layers" }, active: route === "designsystem", collapsed }),
        React.createElement(NavItem, { item: { id: "settings", label: "Settings", icon: "settings" }, active: route === "settings", collapsed })));
  }

  function NavItem({ item, active, collapsed }) {
    const badge = item.badge && item.badge();
    const bk = item.badgeKind;
    return React.createElement("a", {
      href: "#/" + item.id, title: collapsed ? item.label : undefined,
      style: {
        display: "flex", alignItems: "center", gap: 10, height: 32, padding: collapsed ? 0 : "0 10px",
        justifyContent: collapsed ? "center" : "flex-start",
        borderRadius: 7, textDecoration: "none", marginBottom: 1,
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "var(--bg-active)" : "transparent",
        fontWeight: active ? 600 : 450, fontSize: 13, position: "relative", transition: "background 100ms",
      },
      onMouseEnter: (e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; },
      onMouseLeave: (e) => { if (!active) e.currentTarget.style.background = "transparent"; },
    },
      active && React.createElement("span", { style: { position: "absolute", left: 0, top: 7, bottom: 7, width: 2.5, borderRadius: 2, background: "var(--accent)" } }),
      React.createElement(Icon, { name: item.icon, size: 16, style: { color: active ? "var(--accent)" : "inherit", flexShrink: 0 } }),
      !collapsed && React.createElement("span", { className: "grow", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.label),
      !collapsed && badge ? React.createElement("span", { className: "pill tabular", style: {
        fontSize: 10, fontWeight: 700, padding: "1px 6px", minWidth: 18, justifyContent: "center",
        color: bk === "error" ? "var(--error)" : bk === "warn" ? "var(--warn)" : "var(--text-secondary)",
        background: bk === "error" ? "var(--error-soft)" : bk === "warn" ? "var(--warn-soft)" : "rgba(255,255,255,0.06)",
      } }, badge) : (collapsed && badge ? React.createElement("span", { style: { position: "absolute", top: 5, right: 9, width: 6, height: 6, borderRadius: "50%", background: bk === "error" ? "var(--error)" : "var(--warn)" } }) : null));
  }

  // ---------- Project switcher ----------
  function ProjectSwitcher() {
    const list = D.projects;
    const [sel, setSel] = useState(() => {
      const saved = localStorage.getItem("ss_project");
      return (saved && list.find((p) => p.id === saved)) ? saved : (list[0] && list[0].id);
    });
    const [open, setOpen] = useState(false);
    const cur = list.find((p) => p.id === sel) || list[0];
    useEffect(() => {
      if (!open) return;
      const h = (e) => { if (!e.target.closest("[data-projsw]")) setOpen(false); };
      window.addEventListener("mousedown", h); return () => window.removeEventListener("mousedown", h);
    }, [open]);
    const pick = (id) => { setSel(id); try { localStorage.setItem("ss_project", id); } catch (e) {} setOpen(false); };
    return React.createElement("div", { "data-projsw": "1", style: { position: "relative", flexShrink: 0 } },
      React.createElement("button", { onClick: () => setOpen((o) => !o), className: "row gap-6", title: "Switch project",
        style: { height: 24, padding: "0 8px", borderRadius: 6, cursor: "pointer", background: open ? "var(--bg-hover)" : "transparent", border: "1px solid " + (open ? "var(--border-strong)" : "transparent"), transition: "background 100ms, border-color 100ms" },
        onMouseEnter: (e) => { if (!open) e.currentTarget.style.background = "var(--bg-hover)"; },
        onMouseLeave: (e) => { if (!open) e.currentTarget.style.background = "transparent"; } },
        React.createElement(Icon, { name: "folder", size: 13, style: { color: "var(--text-muted)", flexShrink: 0 } }),
        React.createElement("span", { className: "mono", style: { fontSize: 11.5, color: "var(--text-primary)" } }, cur.path),
        React.createElement(Icon, { name: "chevronDown", size: 12, style: { color: "var(--text-muted)", flexShrink: 0 } })),
      open && React.createElement("div", { style: { position: "absolute", top: "100%", left: 0, marginTop: 5, minWidth: 264, background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 9, boxShadow: "var(--shadow-pop)", padding: 5, zIndex: 60 } },
        React.createElement("div", { className: "eyebrow", style: { padding: "5px 8px 6px" } }, "Indexed projects"),
        list.map((p) => {
          const active = p.id === sel;
          return React.createElement("button", { key: p.id, onClick: () => pick(p.id), className: "row gap-8",
            style: { width: "100%", textAlign: "left", padding: "7px 8px", borderRadius: 6, cursor: "pointer", border: "none", background: active ? "var(--bg-active)" : "transparent" },
            onMouseEnter: (e) => { if (!active) e.currentTarget.style.background = "var(--bg-hover)"; },
            onMouseLeave: (e) => { if (!active) e.currentTarget.style.background = "transparent"; } },
            React.createElement(Icon, { name: "folder", size: 13, style: { color: active ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 } }),
            React.createElement("div", { className: "grow", style: { minWidth: 0 } },
              React.createElement("div", { style: { fontSize: 12.5, fontWeight: active ? 600 : 450, color: "var(--text-primary)" } }, p.name),
              React.createElement("div", { className: "mono", style: { fontSize: 10.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, p.path)),
            p.drift > 0 && React.createElement("span", { className: "pill tabular", style: { fontSize: 9.5, color: "var(--warn)", background: "var(--warn-soft)", flexShrink: 0 } }, p.drift + " drift"),
            active && React.createElement(Icon, { name: "check", size: 13, style: { color: "var(--accent)", flexShrink: 0 } }));
        })));
  }

  // ---------- Status strip ----------
  function StatusStrip({ onRefresh, refreshing }) {
    const s = D.status;
    const seg = (label, value, color) => React.createElement("div", { className: "row gap-6", style: { flexShrink: 0 } },
      React.createElement("span", { className: "muted", style: { fontSize: 11 } }, label),
      React.createElement("span", { className: "mono tabular", style: { fontSize: 11.5, color: color || "var(--text-secondary)" } }, value));
    const divider = React.createElement("span", { style: { width: 1, height: 12, background: "var(--border-subtle)", flexShrink: 0 } });
    return React.createElement("div", { style: { height: "var(--status-h)", flexShrink: 0, display: "flex", alignItems: "center", gap: 14, padding: "0 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel-2)", overflow: "hidden", whiteSpace: "nowrap" } },
      React.createElement(ProjectSwitcher, null),
      divider, seg("nodes", s.nodes.toLocaleString()), seg("edges", s.edges.toLocaleString()),
      divider, seg("drift", String(s.drift), s.drift ? "var(--warn)" : "var(--success)"),
      React.createElement("div", { className: "grow" }),
      seg("indexed", s.lastIndex),
      React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onRefresh, title: "Refresh now" },
        React.createElement(Icon, { name: "refresh", size: 12, style: { animation: refreshing ? "spin 0.8s linear infinite" : "none" } })));
  }

  // ---------- Command palette ----------
  function CommandPalette({ open, onClose }) {
    const [q, setQ] = useState("");
    const [sel, setSel] = useState(0);
    const inputRef = useRef(null);
    useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current && inputRef.current.focus(), 30); } }, [open]);

    const results = [];
    const add = (type, label, sub, action, icon) => results.push({ type, label, sub, action, icon });
    ALL_ITEMS.concat([{ id: "settings", label: "Settings", icon: "settings" }]).forEach((it) => add("Page", it.label, "/" + it.id, () => go(it.id), it.icon));
    D.graphNodes.filter((n) => n.kind !== "spec").forEach((n) => add("Node", n.label, n.file, () => go("graph", { query: { focus: n.id } }), "box"));
    D.specDocs.forEach((d) => d.reqs.forEach((r) => add("Spec", r.id, r.title, () => go("specs", { query: { sel: r.id } }), "book")));
    D.prompts.slice(0, 5).forEach((p) => add("Prompt", p.text, "$" + p.cost.toFixed(2) + " · " + p.session, () => go("sessions", { query: { sel: p.session } }), "sessions"));

    const filtered = q.trim() ? results.filter((r) => (r.label + " " + (r.sub || "") + " " + r.type).toLowerCase().includes(q.toLowerCase())).slice(0, 40) : results.slice(0, 8);

    useEffect(() => {
      if (!open) return;
      const h = (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
        else if (e.key === "Enter") { e.preventDefault(); const r = filtered[sel]; if (r) { r.action(); onClose(); } }
      };
      window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    }, [open, filtered, sel, onClose]);

    if (!open) return null;
    return React.createElement("div", { onMouseDown: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)", zIndex: 100, display: "grid", placeItems: "start center", paddingTop: "12vh", animation: "fadeIn 100ms" } },
      React.createElement("div", { onMouseDown: (e) => e.stopPropagation(), style: { width: 560, maxWidth: "90vw", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "var(--shadow-pop)", overflow: "hidden" } },
        React.createElement("div", { className: "row gap-10", style: { padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" } },
          React.createElement(Icon, { name: "search", size: 16, style: { color: "var(--text-muted)" } }),
          React.createElement("input", { ref: inputRef, value: q, onChange: (e) => { setQ(e.target.value); setSel(0); },
            placeholder: "Search nodes, specs, workflows, pages\u2026",
            style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 15, fontFamily: "var(--font-ui)" } }),
          React.createElement("kbd", { style: kbd }, "esc")),
        React.createElement("div", { className: "scroll-y", style: { maxHeight: 380, padding: 6 } },
          filtered.length === 0 && React.createElement("div", { className: "muted", style: { padding: 24, textAlign: "center" } }, "No matches"),
          filtered.map((r, i) => React.createElement("div", { key: i, onMouseEnter: () => setSel(i), onClick: () => { r.action(); onClose(); },
            className: "row gap-10", style: { padding: "8px 10px", borderRadius: 7, cursor: "pointer", background: i === sel ? "var(--bg-hover)" : "transparent" } },
            React.createElement(Icon, { name: r.icon, size: 15, style: { color: i === sel ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 } }),
            React.createElement("div", { className: "grow", style: { minWidth: 0 } },
              React.createElement("div", { style: { fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.label),
              r.sub && React.createElement("div", { className: "mono muted", style: { fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.sub)),
            React.createElement("span", { className: "pill", style: { fontSize: 9.5, color: "var(--text-muted)", background: "rgba(255,255,255,0.05)" } }, r.type))))));
  }
  const kbd = { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 4, padding: "2px 6px" };

  // ---------- App root ----------
  function App() {
    const { route, param, query } = useHashRoute();
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [mobile, setMobile] = useState(window.innerWidth < 760);
    const [collapsed, setCollapsed] = useState(window.innerWidth < 1100 && window.innerWidth >= 760);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const gKey = useRef({ armed: false, t: 0 });

    useEffect(() => {
      const onResize = () => {
        const w = window.innerWidth;
        setMobile(w < 760);
        setCollapsed(w < 1100 && w >= 760);
        if (w >= 760) setDrawerOpen(false);
      };
      window.addEventListener("resize", onResize); return () => window.removeEventListener("resize", onResize);
    }, []);

    // close the mobile drawer whenever the route changes
    useEffect(() => { setDrawerOpen(false); }, [route]);

    useEffect(() => {
      const h = (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); return; }
        if (mod && e.key >= "1" && e.key <= "7") { e.preventDefault(); const it = ALL_ITEMS[parseInt(e.key) - 1]; if (it) go(it.id); return; }
        if (e.key === "Escape") { setPaletteOpen(false); }
        // G then G/S/D chord
        if (!mod && e.key.toLowerCase() === "g" && !gKey.current.armed) {
          if (document.activeElement && /input|textarea/i.test(document.activeElement.tagName)) return;
          gKey.current.armed = true; gKey.current.t = Date.now();
          setTimeout(() => { gKey.current.armed = false; }, 600); return;
        }
        if (gKey.current.armed && !mod) {
          const k = e.key.toLowerCase();
          if (k === "g") go("graph"); else if (k === "s") go("specs"); else if (k === "d") go("drift");
          gKey.current.armed = false;
        }
      };
      window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
    }, []);

    const refresh = () => { setRefreshing(true); setTimeout(() => setRefreshing(false), 900); };

    const Screen = (window.SCREENS && window.SCREENS[route]) || (() => React.createElement(window.UI.Empty, { icon: "box", title: "Not found", body: "This route isn't wired yet." }));

    const toggleNav = () => { if (mobile) setDrawerOpen((o) => !o); else setCollapsed((c) => !c); };

    return React.createElement("div", { style: { display: "flex", height: "100%", position: "relative" } },
      React.createElement(Sidebar, { route, collapsed: !mobile && collapsed, drawer: mobile, open: drawerOpen, onClose: () => setDrawerOpen(false), onToggleCollapse: () => setCollapsed((c) => !c) }),
      mobile && drawerOpen && React.createElement("div", { onClick: () => setDrawerOpen(false), style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(1px)", zIndex: 105, animation: "fadeIn 120ms" } }),
      React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 } },
        React.createElement(StatusStrip, { onRefresh: refresh, refreshing }),
        React.createElement(TopBar, { route, collapsed, onToggle: toggleNav, onPalette: () => setPaletteOpen(true) }),
        React.createElement("div", { key: route + (param || ""), style: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" } },
          React.createElement(Screen, { param, query }))),
      React.createElement(CommandPalette, { open: paletteOpen, onClose: () => setPaletteOpen(false) }));
  }

  function TopBar({ collapsed, onToggle, onPalette }) {
    return React.createElement("div", { style: { height: 44, flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-canvas)" } },
      React.createElement("button", { className: "btn btn-ghost", onClick: onToggle, style: { padding: 6 }, title: "Toggle sidebar" }, React.createElement(Icon, { name: "menu", size: 16 })),
      React.createElement("button", { onClick: onPalette, className: "row gap-8", style: {
        flex: 1, maxWidth: 380, height: 30, padding: "0 11px", background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", borderRadius: 8, cursor: "text", color: "var(--text-muted)", fontSize: 12.5 } },
        React.createElement(Icon, { name: "search", size: 14 }),
        React.createElement("span", { className: "grow", style: { textAlign: "left" } }, "Search or jump to\u2026"),
        React.createElement("kbd", { style: kbd }, "\u2318K")),
      React.createElement("div", { className: "grow" }),
      React.createElement(ThemeToggle),
      React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onPalette, title: "Command palette" }, React.createElement(Icon, { name: "command", size: 14 })));
  }

  function ThemeToggle() {
    const [pref, setPref] = useState(window.getThemePref());
    const eff = pref === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref;
    const next = eff === "dark" ? "light" : "dark";
    return React.createElement("button", { className: "btn btn-ghost btn-sm", title: "Switch to " + next + " mode",
      onClick: () => { window.applyTheme(next); setPref(next); window.dispatchEvent(new Event("specship-theme")); } },
      React.createElement(Icon, { name: eff === "dark" ? "sun" : "moon", size: 15 }));
  }

  window.mountApp = function () {
    ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
  };
})();
