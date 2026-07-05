/* Settings + Design system page. */
(function () {
  const { useState } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI;
  window.SCREENS = window.SCREENS || {};

  // ================= SETTINGS =================
  function Field({ label, children, hint }) {
    return React.createElement("div", { style: { marginBottom: 16 } },
      React.createElement("label", { style: { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 } }, label),
      children,
      hint && React.createElement("div", { className: "muted", style: { fontSize: 11, marginTop: 5 } }, hint));
  }
  function Section({ icon, title, children }) {
    return React.createElement("div", { className: "card card-pad", style: { marginBottom: 14 } },
      React.createElement("div", { className: "row gap-8", style: { marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" } },
        React.createElement(Icon, { name: icon, size: 15, style: { color: "var(--accent)" } }),
        React.createElement("span", { style: { fontWeight: 600, fontSize: 13.5 } }, title)),
      children);
  }
  function Toggle({ on, onClick }) {
    return React.createElement("button", { onClick, style: { width: 36, height: 20, borderRadius: 999, border: "none", cursor: "pointer", padding: 2, background: on ? "var(--accent)" : "var(--bg-elevated)", display: "flex", justifyContent: on ? "flex-end" : "flex-start", transition: "all 120ms" } },
      React.createElement("span", { style: { width: 16, height: 16, borderRadius: "50%", background: "#fff" } }));
  }

  function Settings() {
    const [ingest, setIngest] = useState(true);
    const [watch, setWatch] = useState(true);
    const [motion, setMotion] = useState(false);
    const [theme, setTheme] = useState(window.getThemePref ? window.getThemePref() : "dark");
    const setThemeAndApply = (v) => { setTheme(v); window.applyTheme && window.applyTheme(v); window.dispatchEvent(new Event("specship-theme")); };
    const prices = [["claude-opus-4", "15.00", "75.00"], ["claude-sonnet-4", "3.00", "15.00"], ["claude-haiku-4", "0.80", "4.00"]];
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "settings", title: "Settings" }),
      React.createElement("div", { style: { maxWidth: 720 } },
        React.createElement(Section, { icon: "folder", title: "Project" },
          React.createElement(Field, { label: "Project root", hint: "Set at app open \u00b7 read-only" },
            React.createElement("input", { className: "input mono", style: { width: "100%" }, value: "~/dev/specship", readOnly: true })),
          React.createElement(Field, { label: "Spec roots" }, React.createElement("input", { className: "input mono", style: { width: "100%" }, defaultValue: "specs/", readOnly: true })),
          React.createElement(Field, { label: "Ignore patterns" }, React.createElement("input", { className: "input mono", style: { width: "100%" }, defaultValue: "node_modules/, dist/, .cg/wt/", readOnly: true }))),

        React.createElement(Section, { icon: "sessions", title: "Claude Code" },
          React.createElement(Field, { label: "Transcripts path", hint: "Auto-detected \u00b7 overridable" },
            React.createElement("input", { className: "input mono", style: { width: "100%" }, defaultValue: "~/.claude/projects/", readOnly: true })),
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", padding: "8px 0" } }, React.createElement("div", null, React.createElement("div", { style: { fontSize: 12.5, fontWeight: 500 } }, "Enable transcript ingest"), React.createElement("div", { className: "muted", style: { fontSize: 11 } }, "Read JSONL transcripts for analytics")), React.createElement(Toggle, { on: ingest, onClick: () => setIngest(!ingest) })),
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", padding: "8px 0" } }, React.createElement("div", null, React.createElement("div", { style: { fontSize: 12.5, fontWeight: 500 } }, "Real-time watch"), React.createElement("div", { className: "muted", style: { fontSize: 11 } }, "Tail new transcript lines as they\u2019re written")), React.createElement(Toggle, { on: watch, onClick: () => setWatch(!watch) }))),

        React.createElement(Section, { icon: "dollar", title: "Pricing table" },
          React.createElement("div", { className: "muted", style: { fontSize: 11.5, marginBottom: 12 } }, "Per-million-token prices. Bump these when Anthropic publishes new tiers."),
          React.createElement("div", { className: "row", style: { fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, marginBottom: 6 } },
            React.createElement("span", { className: "grow" }, "Model"), React.createElement("span", { style: { width: 110, textAlign: "right" } }, "Input $/M"), React.createElement("span", { style: { width: 110, textAlign: "right" } }, "Output $/M")),
          prices.map((p) => React.createElement("div", { key: p[0], className: "row", style: { padding: "6px 0", borderTop: "1px solid var(--border-subtle)", alignItems: "center" } },
            React.createElement("span", { className: "mono grow", style: { fontSize: 12 } }, p[0]),
            React.createElement("input", { className: "input mono tabular", style: { width: 100, textAlign: "right", padding: "4px 8px" }, defaultValue: p[1], readOnly: true }),
            React.createElement("span", { style: { width: 10 } }),
            React.createElement("input", { className: "input mono tabular", style: { width: 100, textAlign: "right", padding: "4px 8px" }, defaultValue: p[2], readOnly: true })))),

        React.createElement(Section, { icon: "sparkles", title: "Appearance" },
          React.createElement(Field, { label: "Theme", hint: "Now fully supported \u2014 dark, light, or follow your OS" },
            React.createElement(UI.Segmented, { value: theme, onChange: setThemeAndApply, options: [{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "system", label: "System" }] })),
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", padding: "8px 0" } }, React.createElement("div", null, React.createElement("div", { style: { fontSize: 12.5, fontWeight: 500 } }, "Reduced motion"), React.createElement("div", { className: "muted", style: { fontSize: 11 } }, "Honor OS preference \u2014 instant transitions")), React.createElement(Toggle, { on: motion, onClick: () => setMotion(!motion) })),
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border-subtle)", marginTop: 4 } },
            React.createElement("div", null, React.createElement("div", { style: { fontSize: 12.5, fontWeight: 500 } }, "Boot animation"), React.createElement("div", { className: "muted", style: { fontSize: 11 } }, "The graph-assembly splash on app launch")),
            React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => { try { sessionStorage.removeItem("specship-booted"); } catch (e) {} location.reload(); } }, React.createElement(Icon, { name: "refresh", size: 13 }), "Replay intro"))),

        React.createElement(Section, { icon: "reveal", title: "Editor" },
          React.createElement(Field, { label: "Open files with", hint: "Detected via code / subl / etc." },
            React.createElement("select", { className: "input", style: { width: 200 } }, ["code (VS Code)", "subl (Sublime)", "cursor", "nvim"].map((o) => React.createElement("option", { key: o }, o))))),

        React.createElement(Section, { icon: "graph", title: "About" },
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" } },
            about("Version", "0.4.0"), about("MCP server", "running", "var(--success)"), about("Backend", D.status.backend), about("Log path", "~/.cg/logs/desktop.log"))),
        React.createElement("div", { style: { height: 30 } })));
  }
  function about(label, value, color) {
    return React.createElement("div", { className: "row", style: { justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border-subtle)" } },
      React.createElement("span", { className: "muted", style: { fontSize: 12 } }, label),
      React.createElement("span", { className: "mono", style: { fontSize: 12, color: color || "var(--text-primary)" } }, color && React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block", marginRight: 6 } }), value));
  }
  window.SCREENS.settings = Settings;

  // ================= DESIGN SYSTEM =================
  function Swatch({ name, varName, hex }) {
    return React.createElement("div", { className: "row gap-8", style: { padding: "5px 0" } },
      React.createElement("div", { style: { width: 28, height: 28, borderRadius: 7, background: `var(${varName})`, border: "1px solid var(--border-subtle)", flexShrink: 0 } }),
      React.createElement("div", { style: { minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 12 } }, name),
        React.createElement("div", { className: "mono muted", style: { fontSize: 10 } }, hex)));
  }
  function DSBlock({ title, children, span }) {
    return React.createElement("div", { className: "card card-pad", style: { gridColumn: span ? "1 / -1" : "auto" } },
      React.createElement("div", { className: "eyebrow", style: { marginBottom: 12 } }, title), children);
  }
  function DesignSystem() {
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "layers", title: "Design system", sub: "Tokens, components and states \u2014 dark mode, WCAG AA" }),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, maxWidth: 1100 } },
        React.createElement(DSBlock, { title: "Surfaces & text" },
          [["bg/canvas", "--bg-canvas", "#0E1014"], ["bg/panel", "--bg-panel", "#161A21"], ["bg/elevated", "--bg-elevated", "#20262F"], ["text/primary", "--text-primary", "#E8EBF0"], ["text/secondary", "--text-secondary", "#9AA3B2"], ["accent/primary", "--accent", "#3B82F6"]].map((s) => React.createElement(Swatch, { key: s[0], name: s[0], varName: s[1], hex: s[2] }))),
        React.createElement(DSBlock, { title: "Node colors \u00b7 distinct at 4px" },
          [["accent/code", "--node-code", "purple"], ["accent/spec", "--node-spec", "blue"], ["accent/test", "--node-test", "green"], ["accent/route", "--node-route", "teal"]].map((s) => React.createElement(Swatch, { key: s[0], name: s[0], varName: s[1], hex: s[2] })),
          React.createElement("div", { className: "row gap-6", style: { marginTop: 10 } }, ["--node-code", "--node-spec", "--node-test", "--node-route"].map((c) => React.createElement("span", { key: c, style: { width: 4, height: 28, background: `var(${c})`, borderRadius: 2 } })), React.createElement("span", { className: "muted", style: { fontSize: 10.5, alignSelf: "center", marginLeft: 4 } }, "4px legibility test"))),
        React.createElement(DSBlock, { title: "Semantic states" },
          ["success", "warn", "error", "info"].map((s) => React.createElement("div", { key: s, style: { marginBottom: 6 } }, React.createElement(UI.StatePill, { state: s })))),

        React.createElement(DSBlock, { title: "Typography" },
          React.createElement("div", { style: { fontSize: 22, fontWeight: 650, letterSpacing: "-0.01em" } }, "Page title \u00b7 22px"),
          React.createElement("div", { style: { fontSize: 13, marginTop: 4 } }, "Body & labels \u00b7 13px Geist"),
          React.createElement("div", { className: "mono", style: { fontSize: 12, marginTop: 4, color: "var(--text-secondary)" } }, "mono \u00b7 validateSession()"),
          React.createElement("div", { className: "mono tabular", style: { fontSize: 12, marginTop: 4, color: "var(--text-secondary)" } }, "tabular \u00b7 $1,184.42")),
        React.createElement(DSBlock, { title: "Buttons" },
          React.createElement("div", { className: "col gap-8" },
            React.createElement("div", { className: "row gap-6" }, React.createElement("button", { className: "btn btn-primary btn-sm" }, "Primary"), React.createElement("button", { className: "btn btn-secondary btn-sm" }, "Secondary"), React.createElement("button", { className: "btn btn-ghost btn-sm" }, "Ghost")),
            React.createElement("div", { className: "row gap-6" }, React.createElement("button", { className: "btn btn-destructive btn-sm" }, "Destructive"), React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true }, "Disabled")))),
        React.createElement(DSBlock, { title: "Spec link states" },
          React.createElement("div", { className: "row gap-6", style: { flexWrap: "wrap" } }, ["verified", "implemented", "implementing", "drifted", "broken", "orphaned"].map((s) => React.createElement(UI.StatePill, { key: s, state: s })))),

        React.createElement(DSBlock, { title: "Run states" },
          React.createElement("div", { className: "row gap-6", style: { flexWrap: "wrap" } }, ["pending", "running", "paused", "completed", "failed", "cancelled"].map((s) => React.createElement(UI.StatePill, { key: s, state: s })))),
        React.createElement(DSBlock, { title: "Pills & badges" },
          React.createElement("div", { className: "row gap-6", style: { flexWrap: "wrap" } },
            React.createElement(UI.Pill, { color: "var(--node-code)", bg: "var(--node-code-soft)" }, "function"),
            React.createElement(UI.Pill, null, "ts"),
            React.createElement(UI.Pill, { color: "var(--warn)", bg: "var(--warn-soft)" }, "code drift"),
            React.createElement(UI.CopyBtn, { text: "x", label: "Copy" }))),
        React.createElement(DSBlock, { title: "Density" },
          React.createElement("div", { className: "muted", style: { fontSize: 11.5, lineHeight: 1.7 } }, "List rows 36\u201340px \u00b7 sidebar items 32px \u00b7 card padding ~14px. Higher than a marketing site, lower than a trading terminal.")),

        React.createElement(DSBlock, { title: "Graph nodes", span: true },
          React.createElement("div", { className: "row gap-16", style: { flexWrap: "wrap" } },
            dsNode("exploreGraph", "code"), dsNode("REQ-AUTH-005", "spec", "drifted"), dsNode("auth.test", "test"), dsNode("/explore", "route"), dsNode("REQ-GRAPH-009", "spec", "orphaned")))));
  }
  function dsNode(label, kind, state) {
    const col = UI.nodeColor(kind, state);
    if (kind === "route") return React.createElement("div", { className: "row gap-8" }, React.createElement("span", { style: { width: 16, height: 16, borderRadius: "50%", background: col, boxShadow: `0 0 8px ${col}` } }), React.createElement("span", { className: "mono muted", style: { fontSize: 11 } }, label));
    return React.createElement("div", { className: "row", style: { gap: 7, height: 30, padding: "0 12px", borderRadius: kind === "spec" ? 7 : 999, background: `color-mix(in srgb, ${col} 16%, var(--bg-panel))`, border: `1.5px solid ${state ? col : `color-mix(in srgb, ${col} 45%, transparent)`}`, fontFamily: "var(--font-mono)", fontSize: 12 } },
      React.createElement("span", { style: { width: 7, height: 7, borderRadius: kind === "spec" ? 2 : "50%", background: col } }), label,
      state && React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: state === "drifted" ? "var(--warn)" : "var(--error)" } }));
  }
  window.SCREENS.designsystem = DesignSystem;
})();
