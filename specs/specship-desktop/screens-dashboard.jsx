/* Dashboard screen. */
(function () {
  const { useState } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI, C = window.Charts;
  window.SCREENS = window.SCREENS || {};

  function StatTile({ icon, label, value, delta, deltaInvert, spark, sparkColor, color, onClick }) {
    return React.createElement("button", { onClick, className: "card", style: {
      textAlign: "left", padding: "11px 13px", cursor: "pointer", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 6, transition: "background 100ms, border-color 100ms" },
      onMouseEnter: (e) => { e.currentTarget.style.background = "var(--bg-panel-2)"; e.currentTarget.style.borderColor = "var(--border-strong)"; },
      onMouseLeave: (e) => { e.currentTarget.style.background = "var(--bg-panel)"; e.currentTarget.style.borderColor = "var(--border-subtle)"; },
    },
      React.createElement("div", { className: "row gap-8", style: { color: "var(--text-muted)" } },
        React.createElement(Icon, { name: icon, size: 13, style: { color: color || "var(--text-muted)" } }),
        React.createElement("span", { className: "eyebrow", style: { letterSpacing: "0.04em" } }, label)),
      React.createElement("div", { className: "row", style: { justifyContent: "space-between", alignItems: "flex-end", gap: 8 } },
        React.createElement("div", { className: "tabular", style: { fontSize: 23, fontWeight: 650, letterSpacing: "-0.02em", lineHeight: 1 } }, value),
        spark && React.createElement(C.Sparkline, { data: spark, color: sparkColor || color || "var(--accent)", fill: true, w: 64, h: 22 })),
      delta !== undefined && React.createElement(UI.Delta, { value: delta, invert: deltaInvert }));
  }

  function TipRow({ tip, compact }) {
    const sev = tip.severity;
    const col = sev === "error" ? "var(--error)" : sev === "warn" ? "var(--warn)" : "var(--info)";
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;
    return React.createElement("div", { onClick: () => window.go("tips", { query: { sel: tip.id } }), title: "View in Tips", onAnimationEnd: (e) => { e.currentTarget.style.animation = "none"; }, style: { display: "flex", gap: 10, padding: "10px 12px", borderRadius: 8, background: "var(--bg-panel-2)", border: "1px solid var(--border-subtle)", borderLeft: `2.5px solid ${col}`, animation: "slideInRight 200ms ease", cursor: "pointer" } },
      React.createElement("div", { style: { color: col, flexShrink: 0, marginTop: 1 } }, React.createElement(Icon, { name: tip.icon, size: 14 })),
      React.createElement("div", { className: "grow", style: { minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 12.5, fontWeight: 550, lineHeight: 1.35, textWrap: "pretty" } }, tip.title),
        React.createElement("div", { className: "row gap-8", style: { marginTop: 7 } },
          React.createElement("code", { className: "mono", style: { fontSize: 10.5, color: "var(--text-secondary)", background: "var(--bg-canvas)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 } }, tip.fix),
          React.createElement("span", { className: "grow" }),
          React.createElement("span", { className: "pill", style: { fontSize: 10, color: col, background: "transparent" } }, tip.saving))),
      React.createElement("div", { className: "row gap-4", style: { flexShrink: 0 } },
        React.createElement("button", { className: "btn btn-secondary btn-xs", disabled: true, title: "Read-only \u2014 applying tips is disabled" }, "Apply"),
        React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: (e) => { e.stopPropagation(); setDismissed(true); }, title: "Dismiss" }, React.createElement(Icon, { name: "x", size: 12 }))));
  }

  function Heatstrip() {
    const stats = D.files.map((f) => window.cgFileStats ? window.cgFileStats(f) : { path: f.path, calls: f.calls, tokens: 0, tpc: 0 });
    const maxTpc = Math.max(...stats.map((s) => s.tpc || 0)) || 1;
    const fmtTok = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : D.fmtK(n);
    const items = stats.map((s) => ({
      key: s.path, label: s.path.replace("src/", ""), value: s.calls, intensity: (s.tpc || 0) / maxTpc,
      sub: s.calls + " calls", title: `${s.path}\n${s.calls} calls \u00b7 ${fmtTok(s.tokens)} tokens \u00b7 ${D.fmtK(Math.round(s.tpc))}/call`,
    }));
    return React.createElement("div", { className: "card card-pad" },
      React.createElement("div", { className: "row", style: { justifyContent: "space-between", marginBottom: 10 } },
        React.createElement("div", { className: "row gap-8" }, React.createElement(Icon, { name: "flame", size: 14, style: { color: "var(--warn)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Tool-call heatmap"), React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 area = calls, color = tokens / call")),
        React.createElement("a", { href: "#/heatmap", className: "btn btn-ghost btn-xs" }, "Open heatmap", React.createElement(Icon, { name: "arrowRight", size: 11 }))),
      React.createElement(C.Treemap, { items, height: 116, selKey: null, onPick: () => window.go("heatmap") }),
      React.createElement("div", { className: "row gap-10", style: { marginTop: 9, alignItems: "center" } },
        React.createElement("span", { className: "muted", style: { fontSize: 10 } }, "tokens / call"),
        React.createElement("div", { style: { width: 96, height: 6, borderRadius: 999, background: "linear-gradient(90deg, var(--node-route), var(--warn), var(--error))" } }),
        React.createElement("span", { className: "muted", style: { fontSize: 9.5 } }, "efficient \u2192 wasteful")));
  }

  function PromptRow({ p, max }) {
    return React.createElement("div", { onClick: () => window.go("sessions", { query: { sel: p.session } }), className: "row gap-10", style: { padding: "7px 4px", borderRadius: 6, cursor: "pointer" },
      onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
      React.createElement("div", { className: "grow", style: { minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          p.sidechain && React.createElement(Icon, { name: "bot", size: 11, style: { color: "var(--node-code)", marginRight: 5, verticalAlign: "-1px" } }), p.text),
        React.createElement("div", { style: { marginTop: 4, width: "70%" } }, React.createElement(UI.Bar, { frac: p.cost / max, color: p.cost / max > 0.7 ? "var(--error)" : "var(--accent)" }))),
      React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } },
        React.createElement("div", { className: "mono tabular", style: { fontSize: 12, fontWeight: 600, color: p.cost / max > 0.7 ? "var(--error)" : "var(--text-primary)" } }, "$" + p.cost.toFixed(2)),
        React.createElement("div", { className: "mono muted", style: { fontSize: 10 } }, D.fmtK(p.tokens) + " \u00b7 " + Math.round(p.cache * 100) + "%")));
  }

  function CacheCard() {
    const c = D.cache;
    return React.createElement("div", { className: "card card-pad", style: { display: "flex", flexDirection: "column", gap: 12 } },
      React.createElement("div", { className: "row gap-8" }, React.createElement(Icon, { name: "database", size: 14, style: { color: "var(--node-route)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Cache analytics")),
      React.createElement("div", { className: "row", style: { alignItems: "flex-end", gap: 10 } },
        React.createElement("div", { className: "tabular", style: { fontSize: 38, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 0.9, color: "var(--node-route)" } }, Math.round(c.readRate * 100) + "%"),
        React.createElement("div", { style: { paddingBottom: 3 } },
          React.createElement("div", { className: "muted", style: { fontSize: 11 } }, "cache read rate"),
          React.createElement(UI.Delta, { value: c.wowDelta }))),
      React.createElement("div", { style: { height: 1, background: "var(--border-subtle)" } }),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" } },
        kv("Creation tokens", D.fmtK(c.creationTokens), `${D.fmtK(c.creation1h)} 1h \u00b7 ${D.fmtK(c.creation5m)} 5m`),
        kv("Read tokens", D.fmtK(c.readTokens), "charged at ~10%"),
        kv("Saved this week", "$" + c.dollarsSaved.toFixed(0), "vs no cache", "var(--success)"),
        kv("WoW", "+6%", "more reuse", "var(--success)")));
  }
  function kv(label, value, sub, color) {
    return React.createElement("div", null,
      React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, label),
      React.createElement("div", { className: "mono tabular", style: { fontSize: 15, fontWeight: 600, color: color || "var(--text-primary)" } }, value),
      sub && React.createElement("div", { className: "mono muted", style: { fontSize: 9.5 } }, sub));
  }

  function Dashboard() {
    const [range, setRange] = useState("week");
    const sparkCost = D.costSeries.slice(-10).map((d) => d.cost);
    const maxPrompt = Math.max(...D.prompts.map((p) => p.cost));
    const miniNodes = D.graphNodes.slice(0, 12);
    const miniEdges = D.graphEdges.filter((e) => miniNodes.find((n) => n.id === e.from) && miniNodes.find((n) => n.id === e.to));

    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "dashboard", title: "Dashboard", sub: "specship \u00b7 4,218 nodes \u00b7 last session " + "$11.84",
        actions: React.createElement(UI.RangeSelector, { value: range, onChange: setRange }) }),

      // Stat tiles
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 } },
        React.createElement(StatTile, { icon: "coins", color: "var(--accent)", label: "Last session cost", value: "$11.84", delta: 0.12, deltaInvert: true, spark: sparkCost, sparkColor: "var(--accent)", onClick: () => window.go("sessions") }),
        React.createElement(StatTile, { icon: "wrench", color: "var(--node-spec)", label: "Tool calls · 7d", value: "451", delta: -0.08, deltaInvert: true, spark: [40,52,38,61,44,57,49], sparkColor: "var(--node-spec)", onClick: () => window.go("heatmap") }),
        React.createElement(StatTile, { icon: "bot", color: "var(--node-code)", label: "Subagent spend", value: "31%", delta: 0.04, deltaInvert: true, spark: [22,26,24,30,28,33,31], sparkColor: "var(--node-code)", onClick: () => window.go("heatmap") }),
        React.createElement(StatTile, { icon: "drift", color: "var(--warn)", label: "Drift queue", value: "7", delta: -2, deltaInvert: true, spark: [12,11,10,9,9,8,7], sparkColor: "var(--warn)", onClick: () => window.go("drift") })),

      // Center row
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 14 } },
        React.createElement("div", { className: "card", style: { overflow: "hidden", height: 340, display: "flex", flexDirection: "column" } },
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", padding: "11px 13px", borderBottom: "1px solid var(--border-subtle)" } },
            React.createElement("div", { className: "row gap-8" }, React.createElement(Icon, { name: "graph", size: 14, style: { color: "var(--accent)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Recent neighborhood"), React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 last edited files")),
            React.createElement("a", { href: "#/graph", className: "btn btn-ghost btn-xs" }, "Open graph", React.createElement(Icon, { name: "arrowRight", size: 11 }))),
          React.createElement("div", { style: { flex: 1, minHeight: 0 } },
            React.createElement(window.GraphCanvas, { nodes: miniNodes, edges: miniEdges, onSelect: (id) => window.go("graph", { query: { focus: id } }), interactive: true }))),
        React.createElement("div", { className: "card", style: { display: "flex", flexDirection: "column", height: 340 } },
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", padding: "11px 13px", borderBottom: "1px solid var(--border-subtle)" } },
            React.createElement("div", { className: "row gap-8" }, React.createElement(Icon, { name: "tips", size: 14, style: { color: "var(--warn)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Tips"), React.createElement("span", { className: "pill", style: { fontSize: 10, background: "var(--error-soft)", color: "var(--error)" } }, "2 urgent")),
            React.createElement("a", { href: "#/tips", className: "btn btn-ghost btn-xs" }, "All")),
          React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 10, display: "flex", flexDirection: "column", gap: 8 } },
            D.tips.slice(0, 4).map((t) => React.createElement(TipRow, { key: t.id, tip: t }))))),

      // Heatstrip
      React.createElement("div", { style: { marginBottom: 14 } }, React.createElement(Heatstrip)),

      // Bottom row
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 } },
        React.createElement("div", { className: "card card-pad" },
          React.createElement("div", { className: "row", style: { justifyContent: "space-between", marginBottom: 6 } },
            React.createElement("div", { className: "row gap-8" }, React.createElement(Icon, { name: "coins", size: 14, style: { color: "var(--accent)" } }), React.createElement("span", { style: { fontWeight: 600, fontSize: 12.5 } }, "Recent prompts"), React.createElement("span", { className: "muted", style: { fontSize: 11 } }, "\u00b7 by cost")),
            React.createElement("a", { href: "#/costs", className: "btn btn-ghost btn-xs" }, "Cost ranking")),
          React.createElement("div", { className: "col" }, D.prompts.slice(0, 8).map((p) => React.createElement(PromptRow, { key: p.id, p, max: maxPrompt })))),
        React.createElement(CacheCard)));
  }

  window.SCREENS.dashboard = Dashboard;
})();
