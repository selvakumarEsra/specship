/* Chat screen — specship-aware companion. */
(function () {
  const { useState, useRef, useEffect } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI;
  window.SCREENS = window.SCREENS || {};

  function mdToHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong style='color:var(--text-primary)'>$1</strong>")
      .replace(/`(.+?)`/g, "<code class='mono' style='font-size:12px;background:var(--bg-canvas);padding:1px 5px;border-radius:4px;border:1px solid var(--border-subtle);color:var(--node-spec)'>$1</code>")
      .replace(/\n\n/g, "<br/><br/>").replace(/\n/g, "<br/>");
  }

  function ToolCall({ tc }) {
    const [open, setOpen] = useState(false);
    return React.createElement("div", { style: { border: "1px solid var(--border-subtle)", borderRadius: 7, marginTop: 8, overflow: "hidden", background: "var(--bg-canvas)" } },
      React.createElement("div", { onClick: () => setOpen(!open), className: "row gap-8", style: { padding: "6px 10px", cursor: "pointer" } },
        React.createElement(Icon, { name: open ? "chevronDown" : "chevronRight", size: 12, style: { color: "var(--text-muted)" } }),
        React.createElement(Icon, { name: "wrench", size: 12, style: { color: "var(--node-code)" } }),
        React.createElement("span", { className: "mono grow", style: { fontSize: 11.5 } }, tc.name, React.createElement("span", { className: "muted" }, "(" + tc.input + ")")),
        React.createElement("span", { className: "pill", style: { fontSize: 9.5, color: "var(--success)", background: "var(--success-soft)" } }, React.createElement(Icon, { name: "check", size: 9 }), tc.status)),
      open && React.createElement("div", { style: { padding: "8px 10px 10px 30px", borderTop: "1px solid var(--border-subtle)" } },
        React.createElement("div", { className: "mono muted", style: { fontSize: 10.5, marginBottom: 3 } }, "output"),
        React.createElement("div", { className: "mono", style: { fontSize: 11.5, color: "var(--text-secondary)" } }, tc.output)));
  }

  function Message({ m }) {
    if (m.role === "user") return React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", marginBottom: 18 } },
      React.createElement("div", { style: { maxWidth: "76%", background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "12px 12px 4px 12px", padding: "9px 13px", fontSize: 13.5, lineHeight: 1.55 },
        dangerouslySetInnerHTML: { __html: mdToHtml(m.text) } }));
    return React.createElement("div", { style: { marginBottom: 22 } },
      React.createElement("div", { className: "row gap-8", style: { marginBottom: 8 } },
        React.createElement(window.LogoMark, { size: 22, glow: false }),
        React.createElement("span", { style: { fontSize: 12, fontWeight: 600 } }, "specship"),
        React.createElement("span", { className: "mono muted", style: { fontSize: 10.5 } }, "Opus 4")),
      React.createElement("div", { style: { paddingLeft: 30 } },
        React.createElement("div", { style: { fontSize: 13.5, lineHeight: 1.62, color: "var(--text-secondary)", textWrap: "pretty" }, dangerouslySetInnerHTML: { __html: mdToHtml(m.text) } }),
        m.tools && m.tools.map((tc, i) => React.createElement(ToolCall, { key: i, tc })),
        m.cost != null && React.createElement("div", { className: "row gap-8 muted", style: { marginTop: 10, fontSize: 10.5, fontFamily: "var(--font-mono)" } },
          React.createElement(Icon, { name: "coins", size: 11 }), "$" + m.cost.toFixed(2), React.createElement("span", null, "\u00b7"), D.fmtK(m.tokens) + " tokens")));
  }

  const SLASH = [
    { cmd: "/cg-spec", arg: "REQ-ID", desc: "Look up a spec and its link state" },
    { cmd: "/cg-implement", arg: "REQ-ID", desc: "Kick off spec-implement workflow" },
    { cmd: "/cg-explore", arg: "symbol", desc: "Structural neighborhood of a symbol" },
    { cmd: "/cg-drift", arg: "", desc: "Summarize the drift queue" },
  ];

  function ContextPanel({ collapsed, onToggle }) {
    const tools = ["specship_explore", "specship_search", "specship_spec", "specship_link_verify"];
    const [enabled, setEnabled] = useState(new Set(tools));
    if (collapsed) return React.createElement("div", { style: { width: 40, borderLeft: "1px solid var(--border-subtle)", display: "flex", justifyContent: "center", paddingTop: 12 } },
      React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onToggle, title: "Show context" }, React.createElement(Icon, { name: "chevronLeft", size: 14 })));
    return React.createElement("div", { className: "col", style: { width: 264, flexShrink: 0, borderLeft: "1px solid var(--border-subtle)", background: "var(--bg-panel)" } },
      React.createElement("div", { className: "row", style: { padding: "11px 13px", borderBottom: "1px solid var(--border-subtle)" } },
        React.createElement("span", { className: "eyebrow grow" }, "Context"),
        React.createElement("button", { className: "btn btn-ghost btn-xs", onClick: onToggle }, React.createElement(Icon, { name: "chevronRight", size: 13 }))),
      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 13 } },
        ctxRow("Project", D.status.projectPath, "folder"),
        ctxRow("Indexed files", D.status.indexedFiles + " files", "box"),
        ctxRow("Drift queue", D.status.drift + " links", "drift", "var(--warn)"),
        React.createElement("div", { className: "eyebrow", style: { margin: "16px 0 8px" } }, "MCP tools"),
        tools.map((t) => React.createElement("div", { key: t, className: "row gap-8", style: { padding: "5px 0" } },
          React.createElement("button", { onClick: () => setEnabled((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; }),
            style: { width: 30, height: 17, borderRadius: 999, border: "none", cursor: "pointer", padding: 2, background: enabled.has(t) ? "var(--accent)" : "var(--bg-elevated)", display: "flex", justifyContent: enabled.has(t) ? "flex-end" : "flex-start", transition: "all 120ms" } },
            React.createElement("span", { style: { width: 13, height: 13, borderRadius: "50%", background: "#fff" } })),
          React.createElement("span", { className: "mono", style: { fontSize: 11, color: enabled.has(t) ? "var(--text-primary)" : "var(--text-muted)" } }, t)))),
      React.createElement("div", { style: { padding: 12, borderTop: "1px solid var(--border-subtle)" } },
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 6 } }, "Tool access"),
        React.createElement(UI.Segmented, { size: "sm", value: "safe", onChange: () => {}, options: [{ value: "ask", label: "Ask" }, { value: "safe", label: "Auto-safe" }, { value: "all", label: "All" }] })));
  }
  function ctxRow(label, value, icon, color) {
    return React.createElement("div", { className: "row gap-8", style: { padding: "5px 0" } },
      React.createElement(Icon, { name: icon, size: 13, style: { color: color || "var(--text-muted)", flexShrink: 0 } }),
      React.createElement("div", { style: { minWidth: 0 } },
        React.createElement("div", { className: "muted", style: { fontSize: 10 } }, label),
        React.createElement("div", { className: "mono", style: { fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, value)));
  }

  function Chat() {
    const [msgs, setMsgs] = useState(D.chatSeed);
    const [text, setText] = useState("");
    const [collapsed, setCollapsed] = useState(false);
    const [thinking, setThinking] = useState(false);
    const listRef = useRef(null);
    const showSlash = text.startsWith("/") && !text.includes(" ");
    useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [msgs, thinking]);

    const send = () => {
      if (!text.trim()) return;
      const t = text; setText(""); setMsgs((m) => [...m, { role: "user", text: t }]); setThinking(true);
      setTimeout(() => {
        setThinking(false);
        setMsgs((m) => [...m, {
          role: "assistant",
          text: t.startsWith("/cg-spec") ? "Looking that up in the graph \u2014 the spec resolves to one link. See the **state** pill and linked code below for whether it\u2019s drifted." :
            "Got it. I\u2019ll use the specship tools to answer that with structural context rather than re-reading files. Here\u2019s what I found in the current project\u2019s graph.",
          tools: [{ name: t.startsWith("/cg-implement") ? "specship_spec" : "specship_explore", status: "ok", input: t.split(" ")[1] || "validateSession", output: "3 nodes \u00b7 2 edges returned" }],
          cost: +(Math.random() * 0.3 + 0.15).toFixed(2), tokens: Math.round(Math.random() * 8000 + 6000),
        }]);
      }, 1100);
    };

    return React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0 } },
      React.createElement("div", { className: "col", style: { flex: 1, minWidth: 0 } },
        React.createElement("div", { ref: listRef, className: "scroll-y", style: { flex: 1, padding: "20px 24px" } },
          React.createElement("div", { style: { maxWidth: 760, margin: "0 auto" } },
            msgs.map((m, i) => React.createElement(Message, { key: i, m })),
            thinking && React.createElement("div", { className: "row gap-8 muted", style: { paddingLeft: 30, fontSize: 12 } },
              React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: "skeleton 1s infinite" } }), "thinking with specship context\u2026"))),
        // composer
        React.createElement("div", { style: { padding: "12px 24px 18px", borderTop: "1px solid var(--border-subtle)", position: "relative" } },
          React.createElement("div", { style: { maxWidth: 760, margin: "0 auto", position: "relative" } },
            showSlash && React.createElement("div", { style: { position: "absolute", bottom: "100%", left: 0, marginBottom: 8, background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 8, boxShadow: "var(--shadow-pop)", padding: 5, width: 320, zIndex: 10 } },
              SLASH.filter((s) => s.cmd.startsWith(text)).map((s) => React.createElement("div", { key: s.cmd, onClick: () => setText(s.cmd + " "), className: "row gap-8", style: { padding: "6px 9px", borderRadius: 5, cursor: "pointer" },
                onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
                React.createElement("span", { className: "mono", style: { fontSize: 12, color: "var(--accent)" } }, s.cmd),
                s.arg && React.createElement("span", { className: "mono muted", style: { fontSize: 11 } }, s.arg),
                React.createElement("span", { className: "muted grow", style: { fontSize: 11, textAlign: "right" } }, s.desc)))),
            React.createElement("div", { className: "row", style: { gap: 8, alignItems: "flex-end", background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", borderRadius: 12, padding: 8 } },
              React.createElement("button", { className: "btn btn-ghost btn-sm", title: "Attach files or spec IDs", style: { padding: 7 } }, React.createElement(Icon, { name: "paperclip", size: 15 })),
              React.createElement("textarea", { value: text, onChange: (e) => setText(e.target.value), onKeyDown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } },
                placeholder: "Ask with specship context\u2026  /  for commands, Tab to complete spec IDs",
                rows: 1, style: { flex: 1, resize: "none", background: "transparent", border: "none", outline: "none", color: "var(--text-primary)", fontSize: 13.5, fontFamily: "var(--font-ui)", lineHeight: 1.5, padding: "5px 2px", maxHeight: 120 } }),
              React.createElement("button", { className: "btn btn-primary btn-sm", onClick: send, disabled: !text.trim(), style: { padding: "7px 10px" } }, React.createElement(Icon, { name: "send", size: 14 }))),
            React.createElement("div", { className: "row gap-8", style: { marginTop: 8, justifyContent: "space-between" } },
              React.createElement("div", { className: "row gap-6" }, React.createElement(UI.Pill, null, React.createElement(Icon, { name: "bot", size: 10 }), "Opus 4"), React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "single thread \u00b7 this project")),
              React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "Enter to send \u00b7 Shift+Enter for newline"))))),
      React.createElement(ContextPanel, { collapsed, onToggle: () => setCollapsed(!collapsed) }));
  }
  window.SCREENS.chat = Chat;
})();
