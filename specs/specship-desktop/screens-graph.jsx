/* Graph view — toolbar, canvas, node detail panel. */
(function () {
  const { useState, useMemo, useEffect, useRef } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI;
  window.SCREENS = window.SCREENS || {};

  const SIGS = {
    n_explore: "exploreGraph(symbol: string, depth = 1): GraphSlice",
    n_layout: "applyLayout(nodes: Node[], mode: LayoutMode): Positioned[]",
    n_cull: "cull(viewport: Rect, nodes: Node[]): Node[]",
    n_query: "neighbors(id: NodeId, hops = 1): Node[]",
    n_ingest: "tailFrom(path: string, offset: number): AsyncIterable<Line>",
    n_split: "splitSidechain(prompts: Prompt[]): [Main[], Side[]]",
    n_auth: "validateSession(token: string): Session | null",
    n_expiry: "checkExpiry(claims: Claims, skew = 30): Result",
    n_price: "resolveRate(model: string, kind: TokenKind): number",
    n_server: "class MCPServer implements ToolHost",
    n_db: "class SqliteStore extends Store",
  };

  function Chip({ label, count, active, onClick, color }) {
    return React.createElement("button", { onClick, className: "row gap-6", style: {
      height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
      border: "1px solid " + (active ? "transparent" : "var(--border-subtle)"),
      background: active ? (color ? `color-mix(in srgb, ${color} 22%, var(--bg-panel))` : "var(--accent-soft)") : "var(--bg-panel)",
      color: active ? (color || "var(--accent)") : "var(--text-secondary)", transition: "all 100ms" } },
      color && React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", background: color } }),
      label, count != null && React.createElement("span", { className: "tabular muted", style: { fontSize: 10.5 } }, count));
  }

  function NodeLink({ label, file, onClick }) {
    return React.createElement("div", { onClick, className: "row gap-8", style: { padding: "5px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12 },
      onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
      React.createElement(Icon, { name: "box", size: 12, style: { color: "var(--node-code)", flexShrink: 0 } }),
      React.createElement("span", { className: "mono grow", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, label),
      file && React.createElement("span", { className: "mono muted", style: { fontSize: 10, flexShrink: 0 } }, file));
  }

  function OverviewPanel({ onSelect }) {
    const counts = { code: 0, spec: 0, test: 0, route: 0 };
    D.graphNodes.forEach((n) => counts[n.kind]++);
    // degree → hubs
    const deg = {};
    D.graphEdges.forEach((e) => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
    const hubs = [...D.graphNodes].map((n) => ({ n, d: deg[n.id] || 0 })).sort((a, b) => b.d - a.d).slice(0, 5);
    // spec link health
    const health = { verified: 0, drifted: 0, broken: 0, orphaned: 0 };
    D.specDocs.forEach((doc) => doc.reqs.forEach((r) => { if (health[r.state] !== undefined) health[r.state]++; }));
    // edge types
    const et = { calls: 0, implements: 0, tests: 0 };
    D.graphEdges.forEach((e) => { const a = D.graphNodes.find((n) => n.id === e.from), b = D.graphNodes.find((n) => n.id === e.to); if (!a || !b) return; if (a.kind === "spec" || b.kind === "spec") et.implements++; else if (a.kind === "test" || b.kind === "test") et.tests++; else et.calls++; });
    const kindRow = (k, label) => React.createElement("div", { className: "row gap-8", style: { padding: "5px 0" } },
      React.createElement("span", { style: { width: 9, height: 9, borderRadius: k === "spec" ? 2 : "50%", background: UI.nodeColor(k), flexShrink: 0, boxShadow: `0 0 6px ${UI.nodeColor(k)}` } }),
      React.createElement("span", { className: "grow", style: { fontSize: 12.5, textTransform: "capitalize" } }, label),
      React.createElement("span", { className: "mono tabular", style: { fontSize: 12.5, fontWeight: 600 } }, counts[k]));
    return React.createElement("div", { className: "col", style: { height: "100%" } },
      React.createElement("div", { className: "row gap-8", style: { padding: "13px 14px", borderBottom: "1px solid var(--border-subtle)" } },
        React.createElement(Icon, { name: "graph", size: 15, style: { color: "var(--accent)" } }),
        React.createElement("span", { style: { fontWeight: 600, fontSize: 13.5 } }, "Graph overview"),
        React.createElement("span", { className: "grow" }),
        React.createElement("span", { className: "mono muted", style: { fontSize: 11 } }, D.graphNodes.length + " shown")),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 18 } },
        React.createElement("div", { className: "secondary", style: { fontSize: 12, lineHeight: 1.55 } }, "Click any node to inspect its signature, links, callers and callees \u2014 without leaving this view."),
        React.createElement("div", null,
          React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Nodes by kind"),
          kindRow("code", "Code"), kindRow("spec", "Spec"), kindRow("test", "Test"), kindRow("route", "Route")),
        React.createElement("div", null,
          React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Spec link health"),
          React.createElement("div", { className: "row gap-6", style: { flexWrap: "wrap" } },
            health.verified > 0 && React.createElement(UI.StatePill, { state: "verified" }),
            React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11, alignSelf: "center" } }, health.verified),
            health.drifted > 0 && React.createElement(UI.StatePill, { state: "drifted" }),
            health.drifted > 0 && React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11, alignSelf: "center" } }, health.drifted),
            (health.broken + health.orphaned) > 0 && React.createElement(UI.StatePill, { state: "broken" }),
            (health.broken + health.orphaned) > 0 && React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11, alignSelf: "center" } }, health.broken + health.orphaned))),
        React.createElement("div", null,
          React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Edge types"),
          React.createElement(EdgeLegendRow, { color: "var(--text-muted)", label: "calls", count: et.calls }),
          React.createElement(EdgeLegendRow, { color: "var(--node-spec)", label: "implements / documents", count: et.implements }),
          React.createElement(EdgeLegendRow, { color: "var(--node-test)", label: "tests", count: et.tests }),
          React.createElement(EdgeLegendRow, { color: "var(--text-muted)", label: "synthesized (heuristic)", dashed: true })),
        React.createElement("div", null,
          React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Most connected"),
          hubs.map(({ n, d }) => React.createElement("div", { key: n.id, onClick: () => onSelect(n.id), className: "row gap-8", style: { padding: "5px 8px", borderRadius: 6, cursor: "pointer" },
            onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
            React.createElement("span", { style: { width: 7, height: 7, borderRadius: n.kind === "spec" ? 2 : "50%", background: UI.nodeColor(n.kind, n.state), flexShrink: 0 } }),
            React.createElement("span", { className: "mono grow", style: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, n.label),
            React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5 } }, d + " edges"),
            React.createElement(Icon, { name: "chevronRight", size: 12, style: { color: "var(--text-faint)" } }))))));
  }
  function EdgeLegendRow({ color, label, count, dashed }) {
    return React.createElement("div", { className: "row gap-8", style: { padding: "4px 0" } },
      React.createElement("svg", { width: 20, height: 8, style: { flexShrink: 0 } }, React.createElement("line", { x1: 0, y1: 4, x2: 20, y2: 4, stroke: color, strokeWidth: 1.8, strokeDasharray: dashed ? "4 3" : "none" })),
      React.createElement("span", { className: "grow secondary", style: { fontSize: 12 } }, label),
      count != null && React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11 } }, count));
  }

  function DetailPanel({ node, onSelect, onClose }) {
    if (!node) return React.createElement(OverviewPanel, { onSelect });
    const isSpec = node.kind === "spec";
    const col = UI.nodeColor(node.kind, node.state);
    const callers = D.graphEdges.filter((e) => e.to === node.id).map((e) => D.graphNodes.find((n) => n.id === e.from)).filter(Boolean);
    const callees = D.graphEdges.filter((e) => e.from === node.id).map((e) => D.graphNodes.find((n) => n.id === e.to)).filter(Boolean);
    const specRec = isSpec ? D.specDocs.flatMap((d) => d.reqs).find((r) => "spec:" + r.id === node.id) : null;

    return React.createElement("div", { className: "col", style: { height: "100%" } },
      React.createElement("div", { className: "row", style: { gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)" } },
        React.createElement("span", { style: { width: 9, height: 9, borderRadius: isSpec ? 2 : "50%", background: col, flexShrink: 0, marginTop: 5, boxShadow: `0 0 8px ${col}` } }),
        React.createElement("div", { className: "grow", style: { minWidth: 0 } },
          React.createElement("div", { className: "mono", style: { fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" } }, node.label),
          React.createElement("div", { className: "row gap-6", style: { marginTop: 3 } },
            React.createElement(UI.Pill, { color: col, bg: `color-mix(in srgb, ${col} 14%, transparent)` }, node.sub),
            node.lang && React.createElement(UI.Pill, null, node.lang))),
        React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onClose }, React.createElement(Icon, { name: "x", size: 14 }))),

      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 14, display: "flex", flexDirection: "column", gap: 16 } },
        React.createElement("div", { className: "row gap-6", style: { fontSize: 11.5 } },
          React.createElement(Icon, { name: "folder", size: 12, style: { color: "var(--text-muted)" } }),
          React.createElement("span", { className: "mono secondary", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, node.file),
          React.createElement(UI.CopyBtn, { text: node.file })),

        !isSpec && SIGS[node.id] && React.createElement("div", null,
          React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Signature"),
          React.createElement("pre", { className: "mono", style: { margin: 0, fontSize: 11.5, lineHeight: 1.6, color: "var(--text-secondary)", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: 10, overflowX: "auto", whiteSpace: "pre-wrap" } }, SIGS[node.id])),

        // spec body
        isSpec && specRec && React.createElement("div", null,
          React.createElement("div", { className: "row gap-6", style: { marginBottom: 6 } }, React.createElement(UI.StatePill, { state: specRec.state }), React.createElement(UI.Pill, null, specRec.priority)),
          React.createElement("div", { style: { fontWeight: 600, fontSize: 13, marginBottom: 6 } }, specRec.title),
          React.createElement("div", { className: "secondary", style: { fontSize: 12, lineHeight: 1.6 } }, specRec.body.replace(/\*\*/g, "").replace(/`/g, ""))),

        // linked specs (for code nodes)
        !isSpec && React.createElement(LinkedSpecs, { node, onSelect }),

        // callers / callees
        !isSpec && React.createElement(ListBlock, { title: "Callers", icon: "arrowRight", items: callers, empty: "No callers", onSelect }),
        !isSpec && React.createElement(ListBlock, { title: "Callees", icon: "arrowRight", items: callees, empty: "No callees", onSelect }),

        // spec linked code
        isSpec && specRec && React.createElement("div", null,
          React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Linked code"),
          specRec.links.length ? specRec.links.map((l, i) => React.createElement("div", { key: i, className: "row gap-8", style: { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border-subtle)", marginBottom: 5 } },
            React.createElement(UI.StatePill, { state: l.state }),
            React.createElement("span", { className: "mono grow", style: { fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, l.target),
            React.createElement("button", { className: "btn btn-ghost btn-xs", title: "Reveal in editor" }, React.createElement(Icon, { name: "reveal", size: 12 })))) :
            React.createElement("div", { className: "muted", style: { fontSize: 12, padding: 8, border: "1px dashed var(--border-subtle)", borderRadius: 6, textAlign: "center" } }, "No linked code \u2014 orphaned"))),

      // actions footer
      React.createElement("div", { className: "row gap-8", style: { padding: 12, borderTop: "1px solid var(--border-subtle)" } },
        isSpec ? React.createElement(React.Fragment, null,
          React.createElement("button", { className: "btn btn-primary btn-sm grow", style: { justifyContent: "center" }, disabled: true, title: "Read-only \u2014 run automatically by the implementation workflow" }, React.createElement(Icon, { name: "play", size: 13 }), "Implement"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => window.go("drift") }, "View drift"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: true, title: "Read-only \u2014 relinking is disabled" }, "Relink")) :
        React.createElement(React.Fragment, null,
          React.createElement("button", { className: "btn btn-primary btn-sm grow", style: { justifyContent: "center" } }, React.createElement(Icon, { name: "reveal", size: 13 }), "Reveal in editor"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => window.go("specs") }, "Open"))));
  }

  function ListBlock({ title, items, empty, onSelect }) {
    return React.createElement("div", null,
      React.createElement("div", { className: "eyebrow", style: { marginBottom: 4 } }, title, React.createElement("span", { className: "muted", style: { marginLeft: 6, fontWeight: 400 } }, items.length)),
      items.length ? items.slice(0, 10).map((n) => React.createElement(NodeLink, { key: n.id, label: n.label, file: (n.file || "").split("/").pop(), onClick: () => onSelect(n.id) })) :
        React.createElement("div", { className: "muted", style: { fontSize: 12, padding: "4px 8px" } }, empty));
  }

  function LinkedSpecs({ node, onSelect }) {
    const specs = D.graphEdges.filter((e) => e.to === node.id && e.from.startsWith("spec:")).map((e) => D.graphNodes.find((n) => n.id === e.from)).filter(Boolean);
    if (!specs.length) return null;
    return React.createElement("div", null,
      React.createElement("div", { className: "eyebrow", style: { marginBottom: 4 } }, "Linked specs"),
      specs.map((s) => React.createElement("div", { key: s.id, onClick: () => onSelect(s.id), className: "row gap-8", style: { padding: "6px 8px", borderRadius: 6, cursor: "pointer", border: "1px solid var(--border-subtle)", marginBottom: 5 },
        onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
        React.createElement("span", { className: "mono grow", style: { fontSize: 11.5 } }, s.label),
        React.createElement(UI.StatePill, { state: s.state || "verified" }))));
  }

  function EdgeKey({ color, label, dashed }) {
    return React.createElement("div", { className: "row gap-4 secondary" },
      React.createElement("svg", { width: 16, height: 8 }, React.createElement("line", { x1: 0, y1: 4, x2: 16, y2: 4, stroke: color, strokeWidth: 1.6, strokeDasharray: dashed ? "4 3" : "none" })),
      label);
  }

  function GraphView({ query }) {
    const [mode, setMode] = useState("hierarchical");
    const [sel, setSel] = useState(query && query.focus || null);
    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState({ code: true, spec: true, test: true, route: true });
    const [fitKey, setFitKey] = useState(0);
    const searchRef = useRef(null);

    useEffect(() => { if (query && query.focus) setSel(query.focus); }, [query && query.focus]);

    const kindOf = (n) => n.kind;
    const hiddenIds = useMemo(() => {
      const h = new Set();
      D.graphNodes.forEach((n) => { if (!filters[kindOf(n)]) h.add(n.id); });
      return h;
    }, [filters]);

    const nodes = useMemo(() => {
      let ns = D.graphNodes;
      if (mode === "force") ns = ns.map((n, i) => ({ ...n, x: 120 + (i % 5) * 170 + (i * 37 % 60), y: 60 + Math.floor(i / 5) * 150 + (i * 53 % 50) }));
      return ns;
    }, [mode]);

    const searchResults = search.trim() ? D.graphNodes.filter((n) => n.label.toLowerCase().includes(search.toLowerCase())).slice(0, 6) : [];
    const selNode = D.graphNodes.find((n) => n.id === sel);
    const counts = { code: 0, spec: 0, test: 0, route: 0 };
    D.graphNodes.forEach((n) => counts[n.kind]++);

    return React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0 } },
      React.createElement("div", { className: "col", style: { flex: 1, minWidth: 0 } },
        // toolbar
        React.createElement("div", { className: "row", style: { gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-panel-2)", flexWrap: "wrap" } },
          React.createElement(UI.Segmented, { size: "sm", value: mode, onChange: (v) => { setMode(v); setFitKey((k) => k + 1); }, options: [
            { value: "hierarchical", label: "Hierarchical" }, { value: "force", label: "Force" }, { value: "spec", label: "Anchored" } ] }),
          React.createElement("div", { style: { width: 1, height: 20, background: "var(--border-subtle)" } }),
          React.createElement(Chip, { label: "Code", count: counts.code, color: "var(--node-code)", active: filters.code, onClick: () => setFilters((f) => ({ ...f, code: !f.code })) }),
          React.createElement(Chip, { label: "Spec", count: counts.spec, color: "var(--node-spec)", active: filters.spec, onClick: () => setFilters((f) => ({ ...f, spec: !f.spec })) }),
          React.createElement(Chip, { label: "Test", count: counts.test, color: "var(--node-test)", active: filters.test, onClick: () => setFilters((f) => ({ ...f, test: !f.test })) }),
          React.createElement(Chip, { label: "Route", count: counts.route, color: "var(--node-route)", active: filters.route, onClick: () => setFilters((f) => ({ ...f, route: !f.route })) }),
          React.createElement("div", { className: "grow" }),
          React.createElement("div", { style: { position: "relative" } },
            React.createElement("div", { className: "row gap-6", style: { height: 28, padding: "0 10px", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, width: 220 } },
              React.createElement(Icon, { name: "search", size: 13, style: { color: "var(--text-muted)" } }),
              React.createElement("input", { ref: searchRef, value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Fuzzy symbol search\u2026",
                style: { flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 12, fontFamily: "var(--font-mono)" } })),
            searchResults.length > 0 && React.createElement("div", { style: { position: "absolute", top: 32, left: 0, right: 0, background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, boxShadow: "var(--shadow-pop)", padding: 5, zIndex: 20 } },
              searchResults.map((n) => React.createElement("div", { key: n.id, onClick: () => { setSel(n.id); setSearch(""); setFitKey((k) => k + 1); }, className: "row gap-8", style: { padding: "6px 8px", borderRadius: 5, cursor: "pointer" },
                onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
                React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", background: UI.nodeColor(n.kind, n.state) } }),
                React.createElement("span", { className: "mono", style: { fontSize: 12 } }, n.label),
                React.createElement("span", { className: "mono muted grow", style: { fontSize: 10, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, (n.file || "").split("/").pop()))))),
          React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setFitKey((k) => k + 1) }, React.createElement(Icon, { name: "recenter", size: 13 }), "Recenter")),
        // canvas
        React.createElement("div", { style: { flex: 1, minHeight: 0, position: "relative" } },
          React.createElement(window.GraphCanvas, { nodes, edges: D.graphEdges, selectedId: sel, onSelect: setSel, hiddenIds, fitKey }),
          // legend
          React.createElement("div", { style: { position: "absolute", left: 14, top: 14, display: "flex", gap: 12, flexWrap: "wrap", maxWidth: "70%", background: "color-mix(in srgb, var(--bg-panel) 86%, transparent)", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "6px 10px", backdropFilter: "blur(6px)", fontSize: 11 } },
            ["code","spec","test","route"].map((k) => React.createElement("div", { key: k, className: "row gap-4" },
              React.createElement("span", { style: { width: 8, height: 8, borderRadius: k === "spec" ? 2 : "50%", background: UI.nodeColor(k) } }),
              React.createElement("span", { className: "secondary", style: { textTransform: "capitalize" } }, k))),
            React.createElement("span", { style: { width: 1, background: "var(--border-subtle)" } }),
            React.createElement(EdgeKey, { color: "var(--node-spec)", label: "implements" }),
            React.createElement(EdgeKey, { color: "var(--node-test)", label: "tests" }),
            React.createElement(EdgeKey, { color: "var(--text-muted)", label: "calls" }),
            React.createElement(EdgeKey, { color: "var(--text-muted)", label: "synth", dashed: true })))),

      // right panel
      React.createElement("div", { style: { width: 360, flexShrink: 0, borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-panel)" } },
        React.createElement(DetailPanel, { node: selNode, onSelect: (id) => { setSel(id); setFitKey((k) => k + 1); }, onClose: () => setSel(null) })));
  }

  window.SCREENS.graph = GraphView;
})();
