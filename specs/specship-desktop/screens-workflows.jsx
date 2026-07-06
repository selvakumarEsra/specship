/* Workflows + Runs (DAG, SSE events, approval gate). */
(function () {
  const { useState, useEffect, useRef } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI;
  window.SCREENS = window.SCREENS || {};

  // ---------------- WORKFLOWS ----------------
  function RunModal({ wf, onClose }) {
    const [vals, setVals] = useState({});
    if (!wf) return null;
    return React.createElement("div", { onMouseDown: onClose, style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 90, display: "grid", placeItems: "center" } },
      React.createElement("div", { onMouseDown: (e) => e.stopPropagation(), style: { width: 460, background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "var(--shadow-pop)" } },
        React.createElement("div", { className: "row gap-10", style: { padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" } },
          React.createElement(Icon, { name: "workflow", size: 16, style: { color: "var(--accent)" } }),
          React.createElement("span", { className: "mono grow", style: { fontWeight: 600 } }, wf.name),
          React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onClose }, React.createElement(Icon, { name: "x", size: 14 }))),
        React.createElement("div", { style: { padding: 16 } },
          React.createElement("div", { className: "secondary", style: { fontSize: 12.5, marginBottom: 16, lineHeight: 1.55 } }, wf.desc),
          wf.inputs.length ? wf.inputs.map((inp) => React.createElement("div", { key: inp.name, style: { marginBottom: 12 } },
            React.createElement("label", { className: "eyebrow", style: { display: "block", marginBottom: 5 } }, inp.name, inp.required && React.createElement("span", { style: { color: "var(--error)" } }, " *")),
            React.createElement("input", { className: "input mono", style: { width: "100%" }, placeholder: inp.name === "SPEC_ID" ? "REQ-AUTH-005" : "value\u2026", value: vals[inp.name] || "", onChange: (e) => setVals((v) => ({ ...v, [inp.name]: e.target.value })) }))) :
            React.createElement("div", { className: "muted", style: { fontSize: 12, padding: "8px 0" } }, "No inputs required."),
          React.createElement("div", { className: "row gap-6", style: { marginTop: 6, marginBottom: 4 } },
            wf.requires.map((r) => React.createElement(UI.Pill, { key: r }, React.createElement(Icon, { name: "check", size: 10 }), r)))),
        React.createElement("div", { className: "row gap-8", style: { padding: "12px 16px", borderTop: "1px solid var(--border-subtle)", justifyContent: "flex-end" } },
          React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onClose }, "Cancel"),
          React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Read-only \u2014 launching runs is disabled" }, React.createElement(Icon, { name: "play", size: 13 }), "Launch run"))));
  }

  function Workflows({ query }) {
    const [modal, setModal] = useState(query && query.run ? D.workflows.find((w) => w.id === query.run) : null);
    const scopeColor = { bundled: "var(--node-spec)", global: "var(--node-code)", project: "var(--node-route)" };
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 18 } },
      React.createElement(UI.PageHead, { icon: "workflow", title: "Workflows", sub: "Run a YAML-defined DAG of agent, shell and approval steps" }),
      React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } },
        D.workflows.map((wf) => React.createElement("div", { key: wf.id, className: "card card-pad", style: { display: "flex", flexDirection: "column", gap: 10 } },
          React.createElement("div", { className: "row gap-8" },
            React.createElement("span", { className: "mono", style: { fontSize: 13.5, fontWeight: 600 } }, wf.name),
            React.createElement(UI.Pill, { color: scopeColor[wf.scope], bg: `color-mix(in srgb, ${scopeColor[wf.scope]} 14%, transparent)` }, wf.scope),
            React.createElement("span", { className: "grow" })),
          React.createElement("div", { className: "secondary", style: { fontSize: 12.5, lineHeight: 1.5, minHeight: 36 } }, wf.desc),
          React.createElement("div", { className: "row gap-6", style: { flexWrap: "wrap", borderTop: "1px solid var(--border-subtle)", paddingTop: 10 } },
            React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "requires"),
            wf.requires.map((r) => React.createElement("code", { key: r, className: "mono", style: { fontSize: 10.5, color: "var(--text-secondary)", background: "var(--bg-canvas)", padding: "1px 6px", borderRadius: 4 } }, r)),
            wf.inputs.length > 0 && React.createElement(React.Fragment, null,
              React.createElement("span", { className: "muted", style: { fontSize: 10.5, marginLeft: 6 } }, "inputs"),
              wf.inputs.map((i) => React.createElement("code", { key: i.name, className: "mono", style: { fontSize: 10.5, color: "var(--node-spec)", background: "var(--node-spec-soft)", padding: "1px 6px", borderRadius: 4 } }, "$" + i.name))))))),
      React.createElement(RunModal, { wf: modal, onClose: () => setModal(null) }));
  }
  window.SCREENS.workflows = Workflows;

  // ---------------- RUN DAG ----------------
  function RunDAG({ nodes, edges, selected, onSelect }) {
    const W = 920, H = 180;
    const nm = {}; nodes.forEach((n) => nm[n.id] = n);
    const stColor = { pending: "var(--text-muted)", running: "var(--info)", completed: "var(--success)", failed: "var(--error)", paused: "var(--warn)", skipped: "var(--text-muted)" };
    return React.createElement("div", { style: { position: "relative", height: H, background: "var(--bg-canvas-2)", backgroundImage: "radial-gradient(circle, var(--dot-grid) 1px, transparent 1px)", backgroundSize: "20px 20px", borderBottom: "1px solid var(--border-subtle)", overflow: "hidden" } },
      React.createElement("svg", { width: "100%", height: H, viewBox: `0 0 ${W} ${H}`, style: { position: "absolute", inset: 0 } },
        React.createElement("defs", null, React.createElement("marker", { id: "rarrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" }, React.createElement("path", { d: "M0 0 L10 5 L0 10 z", fill: "rgba(160,170,190,0.6)" }))),
        edges.map((e, i) => {
          const a = nm[e.from], b = nm[e.to]; if (!a || !b) return null;
          const ax = a.x + 150, ay = a.y + 18, bx = b.x, by = b.y + 18;
          const mx = (ax + bx) / 2;
          const active = a.state === "completed";
          return React.createElement("path", { key: i, d: `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`, fill: "none", stroke: active ? "var(--success)" : "rgba(150,160,180,0.4)", strokeWidth: 1.6, opacity: active ? 0.7 : 0.5, markerEnd: "url(#rarrow)" });
        })),
      nodes.map((n) => {
        const c = stColor[n.state];
        const sel = selected === n.id;
        return React.createElement("div", { key: n.id, onClick: () => onSelect(n.id), style: {
          position: "absolute", left: `${n.x / W * 100}%`, top: n.y, width: 150, height: 36, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8, padding: "0 11px", borderRadius: 8,
          background: n.state === "running" ? "var(--info-soft)" : "var(--bg-panel)",
          border: `1.5px solid ${sel ? "var(--accent)" : (n.state === "pending" ? "var(--border-subtle)" : c)}`,
          borderStyle: n.state === "skipped" ? "dotted" : "solid",
          opacity: n.state === "pending" ? 0.6 : 1,
          boxShadow: n.state === "running" ? `0 0 0 3px var(--info-soft)` : (sel ? "0 4px 14px rgba(0,0,0,0.4)" : "none"),
        } },
          React.createElement("span", { style: { width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0,
            background: n.state === "completed" ? "var(--success)" : n.state === "failed" ? "var(--error)" : n.state === "paused" ? "var(--warn)" : "transparent",
            border: n.state === "pending" || n.state === "running" || n.state === "skipped" ? `1.5px solid ${c}` : "none",
            animation: n.state === "running" ? "spin 1.4s linear infinite" : "none", borderTopColor: n.state === "running" ? "transparent" : undefined } },
            n.state === "completed" && React.createElement(Icon, { name: "check", size: 11, style: { color: "#fff" } }),
            n.state === "failed" && React.createElement(Icon, { name: "x", size: 11, style: { color: "#fff" } }),
            n.state === "paused" && React.createElement(Icon, { name: "pause", size: 10, style: { color: "#fff" } })),
          React.createElement("div", { className: "grow", style: { minWidth: 0 } },
            React.createElement("div", { style: { fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, n.label),
            React.createElement("div", { className: "mono muted", style: { fontSize: 9 } }, n.type)));
      }));
  }

  // ---------------- EVENTS / RUN DETAIL ----------------
  const EV_COLOR = { step_started: "var(--info)", step_completed: "var(--success)", tool_called: "var(--node-code)", artifact_created: "var(--node-route)", approval_requested: "var(--warn)" };
  function EventsTab() {
    const [events, setEvents] = useState([]);
    const [stuck, setStuck] = useState(true);
    const ref = useRef(null);
    useEffect(() => {
      let i = 0; setEvents([]);
      const t = setInterval(() => {
        if (i >= D.runEvents.length) { clearInterval(t); return; }
        setEvents((e) => [...e, D.runEvents[i]]); i++;
      }, 420);
      return () => clearInterval(t);
    }, []);
    useEffect(() => { if (stuck && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [events, stuck]);
    return React.createElement("div", { ref: ref, className: "scroll-y", "aria-live": "polite", onScroll: (e) => { const el = e.currentTarget; setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 30); }, style: { flex: 1, padding: "8px 14px", fontFamily: "var(--font-mono)", fontSize: 11.5, position: "relative" } },
      events.map((ev, i) => React.createElement("div", { key: i, className: "row gap-10", style: { padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" } },
        React.createElement("span", { className: "muted tabular", style: { flexShrink: 0 } }, ev.t),
        React.createElement("span", { style: { color: EV_COLOR[ev.kind], width: 132, flexShrink: 0 } }, ev.kind),
        React.createElement("span", { className: "muted", style: { flexShrink: 0, width: 80, overflow: "hidden", textOverflow: "ellipsis" } }, ev.node),
        React.createElement("span", { className: "secondary", style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, ev.text))),
      events.length < D.runEvents.length && React.createElement("div", { className: "row gap-6 muted", style: { padding: "6px 0" } },
        React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "var(--info)", animation: "skeleton 1s infinite" } }), "streaming\u2026"));
  }

  const ARTIFACTS = [
    { node: "plan", name: "plan.md", body: "## Plan: REQ-AUTH-005\n\n1. Restore `code: token_expired` field on the 401 response\n2. Keep 30s clock-skew tolerance\n3. Re-run test/auth.test.ts" },
    { node: "implement", name: "diff.md", body: "```diff\n- return res.status(401).json({ reason: 'expired' })\n+ return res.status(401).json({ code: 'token_expired' })\n```\n3 insertions, 1 deletion in src/auth.ts" },
    { node: "run tests", name: "test_results.md", body: "vitest run test/auth.test.ts\n\n\u2713 rejects expired token with 401 (12ms)\n\u2713 includes token_expired code (4ms)\n\n12 passed, 0 failed" },
  ];
  function ArtifactsTab() {
    const [sel, setSel] = useState(0);
    return React.createElement("div", { className: "row", style: { flex: 1, minHeight: 0 } },
      React.createElement("div", { style: { width: 180, borderRight: "1px solid var(--border-subtle)", padding: 8, flexShrink: 0 } },
        ARTIFACTS.map((a, i) => React.createElement("div", { key: i, onClick: () => setSel(i), className: "row gap-8", style: { padding: "7px 9px", borderRadius: 6, cursor: "pointer", background: sel === i ? "var(--bg-hover)" : "transparent" } },
          React.createElement(Icon, { name: "box", size: 13, style: { color: "var(--node-route)" } }),
          React.createElement("div", { style: { minWidth: 0 } },
            React.createElement("div", { className: "mono", style: { fontSize: 11.5 } }, a.name),
            React.createElement("div", { className: "muted", style: { fontSize: 9.5 } }, a.node))))),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 16 } },
        React.createElement("pre", { className: "mono", style: { margin: 0, fontSize: 12, lineHeight: 1.65, color: "var(--text-secondary)", whiteSpace: "pre-wrap" } }, ARTIFACTS[sel].body)));
  }
  function CostTab() {
    const rows = [["plan", 0.41], ["implement", 1.88], ["run tests", 0.00], ["review diff", 0.00]];
    return React.createElement("div", { style: { padding: 16 } },
      React.createElement("div", { className: "row", style: { gap: 18, marginBottom: 16 } },
        React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 11 } }, "Run total"), React.createElement("div", { className: "tabular", style: { fontSize: 26, fontWeight: 700 } }, "$2.29")),
        React.createElement("div", null, React.createElement("div", { className: "muted", style: { fontSize: 11 } }, "Model"), React.createElement("div", { className: "mono", style: { fontSize: 14, marginTop: 6 } }, "Sonnet 4"))),
      React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Per-node cost"),
      rows.map(([n, c]) => React.createElement("div", { key: n, className: "row gap-10", style: { padding: "7px 0", borderBottom: "1px solid var(--border-subtle)" } },
        React.createElement("span", { className: "mono grow", style: { fontSize: 12 } }, n),
        React.createElement("div", { style: { width: 160 } }, React.createElement(UI.Bar, { frac: c / 1.88, color: "var(--accent)" })),
        React.createElement("span", { className: "mono tabular", style: { fontSize: 12, width: 50, textAlign: "right" } }, "$" + c.toFixed(2)))));
  }

  function RunDetail({ id }) {
    const run = D.runs.find((r) => r.id === id) || D.runs[0];
    const [sel, setSel] = useState("r_gate");
    const [tab, setTab] = useState("events");
    const [approved, setApproved] = useState(false);
    return React.createElement("div", { className: "col", style: { flex: 1, minHeight: 0 } },
      React.createElement("div", { className: "row gap-10", style: { padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)" } },
        React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => window.go("runs") }, React.createElement(Icon, { name: "chevronLeft", size: 14 }), "Runs"),
        React.createElement("span", { className: "mono", style: { fontWeight: 600, fontSize: 14 } }, run.workflow),
        React.createElement("span", { className: "mono muted", style: { fontSize: 11.5 } }, run.id),
        React.createElement(UI.StatePill, { state: approved ? "running" : run.status, pulse: approved }),
        React.createElement("span", { className: "grow" }),
        React.createElement("span", { className: "mono muted", style: { fontSize: 11.5 } }, React.createElement(Icon, { name: "clock", size: 11, style: { verticalAlign: -1, marginRight: 4 } }), run.duration),
        React.createElement("button", { className: "btn btn-destructive btn-sm" }, React.createElement(Icon, { name: "cancel", size: 12 }), "Cancel")),

      // approval banner
      !approved && run.status === "paused" && React.createElement("div", { className: "row gap-12", style: { padding: "12px 16px", background: "var(--warn-soft)", borderBottom: "1px solid rgba(229,165,10,0.3)" } },
        React.createElement("div", { style: { color: "var(--warn)", flexShrink: 0 } }, React.createElement(Icon, { name: "pause", size: 18 })),
        React.createElement("div", { className: "grow" },
          React.createElement("div", { style: { fontWeight: 600, fontSize: 13 } }, "Approval required \u2014 review diff before merge"),
          React.createElement("div", { className: "secondary", style: { fontSize: 12, marginTop: 1 } }, "spec-fix restored the token_expired field and tests pass. Approve to merge the worktree.")),
        React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setTab("artifacts") }, "Inspect artifacts"),
        React.createElement("button", { className: "btn btn-destructive btn-sm", disabled: true, title: "Read-only \u2014 approvals are disabled" }, "Reject"),
        React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Read-only \u2014 approvals are disabled" }, React.createElement(Icon, { name: "check", size: 13 }), "Approve")),

      React.createElement(RunDAG, { nodes: approved ? D.runNodes.map((n) => n.id === "r_gate" ? { ...n, state: "completed" } : n.id === "r_verify" ? { ...n, state: "running" } : n) : D.runNodes, edges: D.runEdges, selected: sel, onSelect: setSel }),

      // tabbed panel
      React.createElement("div", { className: "col", style: { flex: 1, minHeight: 0 } },
        React.createElement("div", { className: "row gap-2", style: { padding: "8px 14px 0", borderBottom: "1px solid var(--border-subtle)" } },
          ["events", "artifacts", "cost"].map((t) => React.createElement("button", { key: t, onClick: () => setTab(t), style: {
            padding: "7px 13px", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5, fontWeight: 500, textTransform: "capitalize",
            color: tab === t ? "var(--text-primary)" : "var(--text-muted)", borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`, marginBottom: -1 } }, t,
            t === "events" && React.createElement("span", { className: "pill", style: { marginLeft: 6, fontSize: 9, background: "var(--info-soft)", color: "var(--info)" } }, "live"))),
          ),
        tab === "events" && React.createElement(EventsTab),
        tab === "artifacts" && React.createElement(ArtifactsTab),
        tab === "cost" && React.createElement(CostTab)));
  }

  function Runs({ query }) {
    if (query && query.id) return React.createElement(RunDetail, { id: query.id });
    const [statusF, setStatusF] = useState(null);
    const list = statusF ? D.runs.filter((r) => r.status === statusF) : D.runs;
    const statuses = ["running", "paused", "completed", "failed", "cancelled"];
    return React.createElement("div", { className: "col", style: { flex: 1, minHeight: 0 } },
      React.createElement("div", { style: { padding: "16px 18px 0" } }, React.createElement(UI.PageHead, { icon: "play", title: "Runs", sub: "Recent workflow executions" })),
      React.createElement("div", { className: "row gap-6", style: { padding: "0 18px 12px" } },
        React.createElement(UI.Segmented, { size: "sm", value: statusF || "all", onChange: (v) => setStatusF(v === "all" ? null : v), options: [{ value: "all", label: "All" }].concat(statuses.map((s) => ({ value: s, label: UI.STATE[s].label }))) })),
      React.createElement("div", { style: { padding: "0 18px 18px" } },
        React.createElement("div", { className: "card", style: { overflow: "hidden" } },
          React.createElement("div", { className: "row", style: { padding: "8px 14px", borderBottom: "1px solid var(--border-subtle)", fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 } },
            React.createElement("span", { style: { width: 100 } }, "Status"), React.createElement("span", { className: "grow" }, "Workflow"),
            React.createElement("span", { style: { width: 90 } }, "Duration"), React.createElement("span", { style: { width: 70, textAlign: "right" } }, "Cost"),
            React.createElement("span", { style: { width: 130, textAlign: "right" } }, "Worktree"), React.createElement("span", { style: { width: 60, textAlign: "right" } }, "When")),
          list.map((r) => React.createElement("div", { key: r.id, onClick: () => window.go("runs", { query: { id: r.id } }), className: "row", style: { padding: "11px 14px", borderTop: "1px solid var(--border-subtle)", cursor: "pointer" },
            onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
            React.createElement("span", { style: { width: 100 } }, React.createElement(UI.StatePill, { state: r.status, pulse: r.status === "running" })),
            React.createElement("div", { className: "grow row gap-8" }, React.createElement("span", { className: "mono", style: { fontSize: 12.5 } }, r.workflow), React.createElement("span", { className: "mono muted", style: { fontSize: 11 } }, r.id), r.artifacts > 0 && React.createElement(UI.Pill, null, React.createElement(Icon, { name: "box", size: 10 }), r.artifacts)),
            React.createElement("span", { className: "mono tabular muted", style: { width: 90, fontSize: 11.5 } }, r.duration),
            React.createElement("span", { className: "mono tabular", style: { width: 70, textAlign: "right", fontSize: 12 } }, "$" + r.cost.toFixed(2)),
            React.createElement("span", { className: "mono muted", style: { width: 130, textAlign: "right", fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.worktree),
            React.createElement("span", { className: "mono muted", style: { width: 60, textAlign: "right", fontSize: 11 } }, r.when))))));
  }
  window.SCREENS.runs = Runs;
})();
