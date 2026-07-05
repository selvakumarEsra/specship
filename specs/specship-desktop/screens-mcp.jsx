/* MCP — every Model Context Protocol server configured at the global or
   project level. List view + per-server detail (status, tools, config). */
(function () {
  const { useState } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI;
  window.SCREENS = window.SCREENS || {};

  const realTool = (name) => D.tools.find((t) => t.name === name) || { calls: 0, tokens: 0 };
  const avg = (t) => t.calls ? Math.round(t.tokens / t.calls) : 0;
  function fmtTok(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : D.fmtK(n); }

  // ---- server state config ----
  const SRV_STATE = {
    running:  { color: "var(--success)",    label: "Running",   dot: true },
    error:    { color: "var(--error)",      label: "Failed",    dot: true },
    disabled: { color: "var(--text-muted)", label: "Disabled",  dot: false },
  };
  const SCOPE = {
    global:  { color: "var(--node-route)", label: "Global",  hint: "~/.claude.json", icon: "database" },
    project: { color: "var(--accent)",     label: "Project", hint: ".mcp.json",      icon: "folder" },
  };

  // ============================================================
  //  Configured MCP servers
  // ============================================================
  const SERVERS = [
    {
      id: "specship", name: "specship", scope: "project", icon: "graph", color: "var(--node-spec)",
      state: "running", version: "0.4.0", protocol: "2025-06-18", uptime: "4h 12m", transport: "stdio",
      command: "npx specship mcp",
      desc: "SpecShip\u2019s own server \u2014 structural code intelligence over the spec\u2194code graph.",
      tools: [
        { name: "specship_explore", icon: "graph", color: "var(--node-code)", desc: "Return the callers, callees and linked specs for a symbol \u2014 the structural alternative to re-reading files.", params: [["symbol", "string", true], ["depth", "int", false, "2"], ["include", "enum", false, "callers|callees|specs"]], example: "specship_explore --symbol validateSession --depth 2", stat: realTool("specship_explore"), drill: true },
        { name: "specship_search", icon: "search", color: "var(--node-spec)", desc: "Indexed structural search across the graph for call sites, definitions and references \u2014 returns qualified symbols, not raw lines.", params: [["query", "string", true], ["kind", "enum", false, "call-site|def|ref"], ["limit", "int", false, "50"]], example: "specship_search 'parseTranscript' --kind call-site", stat: realTool("specship_search"), drill: true },
        { name: "specship_links", icon: "book", color: "var(--node-route)", desc: "List spec\u2194code links and their verification state. Filter by requirement id or state.", params: [["spec", "string", false], ["state", "enum", false, "verified|drifted|broken"]], example: "specship_links --spec REQ-AUTH-005", stat: { calls: 31, tokens: 74000 } },
        { name: "specship_drift", icon: "drift", color: "var(--warn)", desc: "Detect links that have drifted since they were last verified. Powers the drift queue.", params: [["path", "string", false], ["since", "string", false, "HEAD~1"]], example: "specship_drift --path src/ingest/", stat: { calls: 19, tokens: 28000 } },
        { name: "specship_impact", icon: "compare", color: "var(--node-test)", desc: "Trace the blast radius of a change \u2014 every symbol, test and spec downstream of an edit.", params: [["symbol", "string", true], ["depth", "int", false, "3"]], example: "specship_impact --symbol tailFrom", stat: { calls: 12, tokens: 51000 } },
      ],
      usedBy: [
        { name: "Claude Code", host: "stdio \u00b7 ~/dev/specship", state: "active", last: "active now" },
        { name: "Claude Desktop", host: "stdio \u00b7 global", state: "connected", last: "12m ago" },
        { name: "Cursor", host: "stdio \u00b7 workspace", state: "idle", last: "3h ago" },
      ],
      config: `{
  "mcpServers": {
    "specship": {
      "command": "npx",
      "args": ["specship", "mcp"],
      "env": { "SPECSHIP_ROOT": "~/dev/specship" }
    }
  }
}`,
    },
    {
      id: "filesystem", name: "filesystem", scope: "global", icon: "folder", color: "var(--node-route)",
      state: "running", version: "0.6.2", protocol: "2025-06-18", uptime: "1d 6h", transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-filesystem ~/dev",
      desc: "Sandboxed read/write access to files under an allowed root directory.",
      tools: [
        { name: "read_file", icon: "book", color: "var(--node-route)", desc: "Read the complete contents of a file from the allowed directories.", params: [["path", "string", true]], example: "read_file --path src/index.ts", stat: { calls: 142, tokens: 980000 } },
        { name: "write_file", icon: "reveal", color: "var(--node-route)", desc: "Create a new file or overwrite an existing one with new contents.", params: [["path", "string", true], ["content", "string", true]], example: "write_file --path notes.md", stat: { calls: 24, tokens: 60000 } },
        { name: "list_directory", icon: "folder", color: "var(--node-route)", desc: "List files and directories at a given path with type annotations.", params: [["path", "string", true]], example: "list_directory --path src/", stat: { calls: 58, tokens: 120000 } },
        { name: "search_files", icon: "search", color: "var(--node-route)", desc: "Recursively search for files matching a pattern under a directory.", params: [["path", "string", true], ["pattern", "string", true]], example: "search_files --pattern '*.test.ts'", stat: { calls: 33, tokens: 210000 } },
      ],
      usedBy: [
        { name: "Claude Desktop", host: "stdio \u00b7 global", state: "active", last: "active now" },
        { name: "Claude Code", host: "stdio \u00b7 inherited", state: "connected", last: "20m ago" },
      ],
      config: `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "~/dev"]
    }
  }
}`,
    },
    {
      id: "github", name: "github", scope: "global", icon: "external", color: "var(--node-code)",
      state: "running", version: "0.5.0", protocol: "2025-06-18", uptime: "1d 6h", transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-github",
      desc: "Read and write GitHub repos, issues and pull requests via a personal access token.",
      tools: [
        { name: "search_repositories", icon: "search", color: "var(--node-code)", desc: "Search GitHub repositories by query, language and stars.", params: [["query", "string", true], ["perPage", "int", false, "30"]], example: "search_repositories --query 'mcp server'", stat: { calls: 14, tokens: 88000 } },
        { name: "get_file_contents", icon: "book", color: "var(--node-code)", desc: "Fetch the contents of a file or directory from a repository.", params: [["owner", "string", true], ["repo", "string", true], ["path", "string", true]], example: "get_file_contents --repo anthropics/mcp", stat: { calls: 22, tokens: 140000 } },
        { name: "create_issue", icon: "drift", color: "var(--node-code)", desc: "Open a new issue on a repository with a title, body and labels.", params: [["owner", "string", true], ["repo", "string", true], ["title", "string", true]], example: "create_issue --title 'Drifted link'", stat: { calls: 4, tokens: 12000 } },
        { name: "create_pull_request", icon: "compare", color: "var(--node-code)", desc: "Create a pull request from a head branch into a base branch.", params: [["owner", "string", true], ["repo", "string", true], ["head", "string", true], ["base", "string", true]], example: "create_pull_request --head feat/mcp", stat: { calls: 3, tokens: 9000 } },
      ],
      usedBy: [
        { name: "Claude Code", host: "stdio \u00b7 ~/dev/specship", state: "connected", last: "1h ago" },
      ],
      config: `{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "\${GITHUB_TOKEN}" }
    }
  }
}`,
    },
    {
      id: "postgres", name: "postgres", scope: "project", icon: "database", color: "var(--node-test)",
      state: "running", version: "0.6.2", protocol: "2025-06-18", uptime: "4h 12m", transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-postgres postgresql://localhost/specship",
      desc: "Read-only SQL access to the local SpecShip database for schema-aware queries.",
      tools: [
        { name: "query", icon: "database", color: "var(--node-test)", desc: "Run a read-only SQL query against the connected database and return rows.", params: [["sql", "string", true]], example: "query --sql 'select count(*) from nodes'", stat: { calls: 27, tokens: 64000 } },
      ],
      usedBy: [
        { name: "Claude Code", host: "stdio \u00b7 ~/dev/specship", state: "connected", last: "40m ago" },
      ],
      config: `{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres",
               "postgresql://localhost/specship"]
    }
  }
}`,
    },
    {
      id: "sentry", name: "sentry", scope: "global", icon: "drift", color: "var(--error)",
      state: "error", version: "remote", protocol: "\u2014", uptime: "\u2014", transport: "http (sse)",
      command: "https://mcp.sentry.dev/sse",
      desc: "Pull issues and stack traces from Sentry. Connection is failing \u2014 the OAuth token has expired.",
      error: "401 Unauthorized \u2014 token expired. Re-authenticate to restore the connection.",
      tools: [],
      usedBy: [
        { name: "Claude Code", host: "http \u00b7 remote", state: "idle", last: "failed 8m ago" },
      ],
      config: `{
  "mcpServers": {
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/sse"
    }
  }
}`,
    },
    {
      id: "playwright", name: "playwright", scope: "project", icon: "reveal", color: "var(--text-muted)",
      state: "disabled", version: "0.0.27", protocol: "\u2014", uptime: "\u2014", transport: "stdio",
      command: "npx -y @playwright/mcp",
      desc: "Drive a real browser for end-to-end checks. Disabled in this workspace \u2014 enable to expose its tools.",
      tools: [
        { name: "browser_navigate", icon: "external", color: "var(--text-muted)", desc: "Navigate the browser to a URL.", params: [["url", "string", true]], example: "browser_navigate --url http://localhost:3000", stat: { calls: 0, tokens: 0 } },
        { name: "browser_snapshot", icon: "reveal", color: "var(--text-muted)", desc: "Capture an accessibility snapshot of the current page.", params: [], example: "browser_snapshot", stat: { calls: 0, tokens: 0 } },
        { name: "browser_click", icon: "box", color: "var(--text-muted)", desc: "Click an element identified by its accessibility ref.", params: [["ref", "string", true]], example: "browser_click --ref button-submit", stat: { calls: 0, tokens: 0 } },
      ],
      usedBy: [],
      config: `{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"],
      "disabled": true
    }
  }
}`,
    },
  ];

  const CLIENT_STATE = {
    active:    { color: "var(--success)",    label: "Active" },
    connected: { color: "var(--node-spec)",  label: "Connected" },
    idle:      { color: "var(--text-muted)", label: "Idle" },
  };

  // ============================================================
  //  LIST VIEW
  // ============================================================
  function ServerRow({ srv, onOpen }) {
    const st = SRV_STATE[srv.state];
    const sc = SCOPE[srv.scope];
    return React.createElement("div", { onClick: () => onOpen(srv.id), className: "card", style: { padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "background 100ms, border-color 100ms" },
      onMouseEnter: (e) => { e.currentTarget.style.background = "var(--bg-panel-2)"; e.currentTarget.style.borderColor = "var(--border-strong)"; },
      onMouseLeave: (e) => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.borderColor = "var(--border-subtle)"; } },
      React.createElement("div", { style: { position: "relative", width: 36, height: 36, borderRadius: 9, background: `color-mix(in srgb, ${srv.color} 14%, transparent)`, color: srv.color, display: "grid", placeItems: "center", flexShrink: 0 } },
        React.createElement(Icon, { name: srv.icon, size: 18 }),
        React.createElement("span", { style: { position: "absolute", right: -2, bottom: -2, width: 11, height: 11, borderRadius: "50%", background: st.color, border: "2px solid var(--bg-panel)", boxShadow: srv.state === "running" ? `0 0 6px ${st.color}` : "none" } })),
      React.createElement("div", { className: "grow", style: { minWidth: 0 } },
        React.createElement("div", { className: "row gap-8" },
          React.createElement("span", { className: "mono", style: { fontSize: 13.5, fontWeight: 600 } }, srv.name),
          React.createElement(UI.Pill, { color: sc.color, bg: `color-mix(in srgb, ${sc.color} 14%, transparent)` }, React.createElement(Icon, { name: sc.icon, size: 10 }), sc.label)),
        React.createElement("div", { className: "mono muted", style: { fontSize: 11, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, srv.command)),
      React.createElement("div", { className: "row gap-16", style: { flexShrink: 0 } },
        React.createElement("div", { style: { textAlign: "right", width: 56 } },
          React.createElement("div", { className: "mono tabular", style: { fontSize: 14, fontWeight: 600, color: srv.tools.length ? "var(--text-primary)" : "var(--text-muted)" } }, srv.tools.length),
          React.createElement("div", { className: "muted", style: { fontSize: 10 } }, srv.tools.length === 1 ? "tool" : "tools")),
        React.createElement("span", { className: "pill", style: { color: st.color, background: `color-mix(in srgb, ${st.color} 14%, transparent)`, width: 92, justifyContent: "center" } },
          st.dot && React.createElement("span", { className: "pill-dot", style: { background: st.color, animation: srv.state === "running" ? "pulsePill 1.6s ease-out infinite" : undefined } }), st.label),
        React.createElement(Icon, { name: "chevronRight", size: 15, style: { color: "var(--text-muted)" } })));
  }

  function ServerList({ onOpen }) {
    const running = SERVERS.filter((s) => s.state === "running").length;
    const totalTools = SERVERS.reduce((a, s) => a + s.tools.length, 0);
    const groups = [["global", "Global"], ["project", "Project"]];
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "plug", title: "MCP servers", sub: "Model Context Protocol servers configured at the global and project level",
        actions: React.createElement("div", { className: "row gap-6" },
          React.createElement("button", { className: "btn btn-ghost btn-sm" }, React.createElement(Icon, { name: "refresh", size: 13 }), "Reload"),
          React.createElement("button", { className: "btn btn-secondary btn-sm" }, React.createElement(Icon, { name: "plus", size: 13 }), "Add server")) }),

      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 } },
        tile("plug", "Servers", String(SERVERS.length), "global + project"),
        tile("circle", "Running", running + " / " + SERVERS.length, "connected now", "var(--success)"),
        tile("wrench", "Tools", String(totalTools), "exposed to agents", "var(--node-code)"),
        tile("drift", "Needs attention", "1", "sentry \u00b7 auth failed", "var(--error)")),

      groups.map(([key, label]) => {
        const list = SERVERS.filter((s) => s.scope === key);
        if (!list.length) return null;
        const sc = SCOPE[key];
        return React.createElement("div", { key, style: { marginBottom: 18 } },
          React.createElement("div", { className: "row gap-8", style: { marginBottom: 9 } },
            React.createElement(Icon, { name: sc.icon, size: 13, style: { color: sc.color } }),
            React.createElement("span", { className: "eyebrow" }, label),
            React.createElement("span", { className: "mono muted", style: { fontSize: 11 } }, sc.hint),
            React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 " + list.length)),
          React.createElement("div", { className: "col gap-8" },
            list.map((s) => React.createElement(ServerRow, { key: s.id, srv: s, onOpen }))));
      }),
      React.createElement("div", { style: { height: 20 } }));
  }
  function tile(icon, label, value, sub, color) {
    return React.createElement("div", { className: "card", style: { padding: "11px 13px", display: "flex", flexDirection: "column", gap: 3 } },
      React.createElement("div", { className: "row gap-6", style: { color: "var(--text-muted)" } },
        React.createElement(Icon, { name: icon, size: 12, style: { color: color || "var(--accent)", flexShrink: 0 } }),
        React.createElement("span", { className: "eyebrow", style: { letterSpacing: "0.03em" } }, label)),
      React.createElement("div", { className: "mono tabular", style: { fontSize: 19, fontWeight: 650, letterSpacing: "-0.01em" } }, value),
      sub && React.createElement("div", { className: "mono muted", style: { fontSize: 10 } }, sub));
  }

  // ============================================================
  //  DETAIL VIEW
  // ============================================================
  function ToolRow({ tool, open, onToggle }) {
    const a = avg(tool.stat);
    const heavy = a > 8000;
    const cold = tool.stat.calls === 0;
    return React.createElement("div", { className: "card", style: { overflow: "hidden", borderColor: open ? "var(--border-strong)" : "var(--border-subtle)" } },
      React.createElement("div", { onClick: onToggle, className: "row gap-10", style: { padding: "11px 13px", cursor: "pointer" },
        onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
        React.createElement("div", { style: { width: 30, height: 30, borderRadius: 8, background: `color-mix(in srgb, ${tool.color} 15%, transparent)`, color: tool.color, display: "grid", placeItems: "center", flexShrink: 0 } },
          React.createElement(Icon, { name: tool.icon, size: 15 })),
        React.createElement("div", { className: "grow", style: { minWidth: 0 } },
          React.createElement("div", { className: "row gap-6" },
            React.createElement("span", { className: "mono", style: { fontSize: 13, fontWeight: 600 } }, tool.name)),
          React.createElement("div", { className: "secondary", style: { fontSize: 11.5, marginTop: 3, overflow: open ? "visible" : "hidden", textOverflow: "ellipsis", whiteSpace: open ? "normal" : "nowrap", textWrap: "pretty" } }, tool.desc)),
        React.createElement("div", { className: "row gap-12", style: { flexShrink: 0 } },
          React.createElement("div", { style: { textAlign: "right" } },
            React.createElement("div", { className: "mono tabular", style: { fontSize: 13, fontWeight: 600, color: cold ? "var(--text-muted)" : "var(--text-primary)" } }, "\u00d7" + tool.stat.calls),
            React.createElement("div", { className: "mono tabular muted", style: { fontSize: 10 } }, "calls / 7d")),
          React.createElement("div", { style: { textAlign: "right", width: 64 } },
            React.createElement("div", { className: "mono tabular", style: { fontSize: 13, fontWeight: 600, color: cold ? "var(--text-muted)" : heavy ? "var(--warn)" : "var(--success)" } }, cold ? "\u2014" : D.fmtK(a)),
            React.createElement("div", { className: "mono tabular muted", style: { fontSize: 10 } }, "tok / call")),
          React.createElement(Icon, { name: open ? "chevronDown" : "chevronRight", size: 15, style: { color: "var(--text-muted)" } }))),
      open && React.createElement("div", { style: { padding: "0 13px 13px 53px", animation: "fadeIn 120ms" } },
        React.createElement("div", { className: "eyebrow", style: { margin: "2px 0 7px" } }, "Input schema"),
        tool.params.length ? React.createElement("div", { className: "col gap-5", style: { marginBottom: 13 } },
          tool.params.map((p) => React.createElement("div", { key: p[0], className: "row gap-8", style: { fontSize: 12 } },
            React.createElement("span", { className: "mono", style: { width: 110, color: "var(--text-primary)", flexShrink: 0 } }, p[0]),
            React.createElement("span", { className: "mono", style: { color: "var(--node-route)", width: 52, flexShrink: 0 } }, p[1]),
            p[2] ? React.createElement(UI.Pill, { color: "var(--error)", bg: "var(--error-soft)" }, "required")
                 : React.createElement("span", { className: "muted mono", style: { fontSize: 11 } }, "optional"),
            p[3] && React.createElement("span", { className: "mono muted", style: { fontSize: 11 } }, "\u00b7 " + p[3]))))
          : React.createElement("div", { className: "muted", style: { fontSize: 11.5, marginBottom: 13 } }, "No parameters."),
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 7 } }, "Example call"),
        React.createElement("div", { className: "row gap-8", style: { background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "8px 11px" } },
          React.createElement("span", { className: "mono grow", style: { fontSize: 11.5, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tool.example),
          React.createElement(UI.CopyBtn, { text: tool.example })),
        tool.drill && React.createElement("button", { className: "btn btn-secondary btn-sm", style: { marginTop: 11 }, onClick: () => window.go("heatmap") },
          React.createElement(Icon, { name: "heatmap", size: 13 }), "View usage in heatmap")));
  }

  function ServerDetail({ srv, onBack }) {
    const [openTool, setOpenTool] = useState(null);
    const st = SRV_STATE[srv.state];
    const sc = SCOPE[srv.scope];
    const totalCalls = srv.tools.reduce((a, t) => a + t.stat.calls, 0);
    const totalTok = srv.tools.reduce((a, t) => a + t.stat.tokens, 0);
    const banColor = st.color;
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      // back + header
      React.createElement("div", { className: "row gap-10", style: { marginBottom: 14 } },
        React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onBack }, React.createElement(Icon, { name: "chevronLeft", size: 14 }), "MCP servers"),
        React.createElement("span", { className: "mono", style: { fontSize: 16, fontWeight: 600 } }, srv.name),
        React.createElement(UI.Pill, { color: sc.color, bg: `color-mix(in srgb, ${sc.color} 14%, transparent)` }, React.createElement(Icon, { name: sc.icon, size: 10 }), sc.label),
        React.createElement("span", { className: "mono muted", style: { fontSize: 11.5 } }, sc.hint)),

      // status banner (adapts to state)
      React.createElement("div", { className: "card", style: { padding: 0, overflow: "hidden", marginBottom: 14, display: "flex" } },
        React.createElement("div", { style: { width: 3, background: banColor, flexShrink: 0 } }),
        React.createElement("div", { style: { flex: 1, padding: "13px 16px" } },
          React.createElement("div", { className: "row gap-16", style: { flexWrap: "wrap" } },
            React.createElement("div", { className: "row gap-8", style: { flexShrink: 0 } },
              React.createElement("span", { style: { width: 9, height: 9, borderRadius: "50%", background: banColor, boxShadow: srv.state === "running" ? `0 0 8px ${banColor}` : "none", animation: srv.state === "running" ? "pulsePill 1.6s ease-out infinite" : undefined } }),
              React.createElement("span", { style: { fontWeight: 600, fontSize: 13.5 } }, st.label),
              React.createElement("span", { className: "mono muted", style: { fontSize: 12 } }, srv.name + "-mcp " + srv.version)),
            seg("Transport", srv.transport), seg("Uptime", srv.uptime), seg("Protocol", srv.protocol), seg("Tools", String(srv.tools.length)),
            React.createElement("div", { className: "grow" }),
            React.createElement("div", { className: "row gap-8", style: { background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: "6px 10px", maxWidth: 360 } },
              React.createElement(Icon, { name: "command", size: 12, style: { color: "var(--text-muted)", flexShrink: 0 } }),
              React.createElement("span", { className: "mono", style: { fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, srv.command),
              React.createElement(UI.CopyBtn, { text: srv.command }))),
          srv.error && React.createElement("div", { className: "row gap-8", style: { marginTop: 11, padding: "8px 11px", background: "var(--error-soft)", border: "1px solid rgba(242,85,90,0.25)", borderRadius: 7 } },
            React.createElement(Icon, { name: "drift", size: 14, style: { color: "var(--error)", flexShrink: 0 } }),
            React.createElement("span", { style: { fontSize: 12, color: "var(--text-secondary)", flex: 1 } }, srv.error),
            React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: true, title: "Read-only \u2014 re-authentication is disabled" }, "Re-authenticate")),
          srv.state === "disabled" && React.createElement("div", { className: "row gap-8", style: { marginTop: 11 } },
            React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Read-only \u2014 enabling servers is disabled" }, React.createElement(Icon, { name: "play", size: 12 }), "Enable server"),
            React.createElement("span", { className: "muted", style: { fontSize: 11.5 } }, "Tools below are declared but not currently exposed.")))),

      // summary tiles
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 } },
        tile("plug", "Tools", String(srv.tools.length), "exposed"),
        tile("wrench", "Calls", totalCalls.toLocaleString(), "this week", "var(--node-code)"),
        tile("database", "Result tokens", fmtTok(totalTok), "returned to context", "var(--node-route)"),
        tile("bot", "Used by", String(srv.usedBy.length), "clients", "var(--success)")),

      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, alignItems: "start" } },
        // tools
        React.createElement("div", { style: { minWidth: 0, gridColumn: "1 / -1" } },
          React.createElement("div", { className: "row gap-8", style: { marginBottom: 10 } },
            React.createElement("span", { className: "eyebrow" }, "Tools \u00b7 " + srv.tools.length),
            srv.tools.length ? React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "click a tool for its schema") : null),
          srv.tools.length ? React.createElement("div", { className: "col gap-8" },
            srv.tools.map((t) => React.createElement(ToolRow, { key: t.name, tool: t, open: openTool === t.name, onToggle: () => setOpenTool((o) => o === t.name ? null : t.name) })))
            : React.createElement(UI.Empty, { icon: "plug", title: "No tools available", body: "This server isn\u2019t exposing any tools \u2014 fix the connection above to load its tool list." })),

        // used by
        React.createElement("div", { className: "card card-pad", style: { minWidth: 0 } },
          React.createElement("div", { className: "row gap-8", style: { marginBottom: 12 } },
            React.createElement(Icon, { name: "bot", size: 14, style: { color: "var(--node-route)" } }),
            React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Used by")),
          srv.usedBy.length ? React.createElement("div", { className: "col gap-8" },
            srv.usedBy.map((c) => {
              const cs = CLIENT_STATE[c.state];
              return React.createElement("div", { key: c.name, className: "row gap-10", style: { padding: "9px 10px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: "var(--bg-canvas)" } },
                React.createElement("span", { style: { width: 8, height: 8, borderRadius: "50%", background: cs.color, flexShrink: 0, boxShadow: c.state === "active" ? `0 0 7px ${cs.color}` : "none" } }),
                React.createElement("div", { className: "grow", style: { minWidth: 0 } },
                  React.createElement("div", { style: { fontSize: 12.5, fontWeight: 500 } }, c.name),
                  React.createElement("div", { className: "mono muted", style: { fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, c.host)),
                React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } },
                  React.createElement("div", { className: "mono", style: { fontSize: 10.5, color: cs.color } }, cs.label),
                  React.createElement("div", { className: "mono muted", style: { fontSize: 10 } }, c.last)));
            }))
            : React.createElement("div", { className: "muted", style: { fontSize: 11.5, padding: "4px 0" } }, "No clients reference this server.")),

        // configuration
        React.createElement("div", { className: "card card-pad", style: { minWidth: 0 } },
          React.createElement("div", { className: "row gap-8", style: { marginBottom: 12 } },
            React.createElement(Icon, { name: "settings", size: 14, style: { color: "var(--accent)" } }),
            React.createElement("span", { className: "grow", style: { fontWeight: 600, fontSize: 12.5 } }, "Configuration"),
            React.createElement("span", { className: "mono muted", style: { fontSize: 10.5 } }, sc.hint),
            React.createElement(UI.CopyBtn, { text: srv.config })),
          React.createElement("pre", { className: "mono scroll-y", style: { margin: 0, fontSize: 11.5, lineHeight: 1.65, color: "var(--text-secondary)", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "11px 13px", overflowX: "auto", whiteSpace: "pre" } }, srv.config))),

      React.createElement("div", { style: { height: 24 } }));
  }
  function seg(label, value) {
    return React.createElement("div", { className: "row gap-6", style: { flexShrink: 0 } },
      React.createElement("span", { className: "muted", style: { fontSize: 11 } }, label),
      React.createElement("span", { className: "mono tabular", style: { fontSize: 12, color: "var(--text-secondary)" } }, value));
  }

  // ============================================================
  function Mcp({ query }) {
    const [sel, setSel] = useState((query && query.server) || null);
    const srv = sel && SERVERS.find((s) => s.id === sel);
    if (srv) return React.createElement(ServerDetail, { srv, onBack: () => setSel(null) });
    return React.createElement(ServerList, { onOpen: setSel });
  }
  window.SCREENS.mcp = Mcp;
})();
