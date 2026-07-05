/* Claude Code — Memory: the CLAUDE.md hierarchy across all levels. */
(function () {
  const { useState } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI;
  window.SCREENS = window.SCREENS || {};

  const M = D.memory;

  // --- tiny markdown renderer for CLAUDE.md bodies ---
  function renderMd(body) {
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong style='color:var(--text-primary)'>$1</strong>")
      .replace(/`(.+?)`/g, "<code class='mono' style='font-size:11.5px;background:var(--bg-canvas);padding:1px 5px;border-radius:4px;border:1px solid var(--border-subtle);color:var(--node-spec)'>$1</code>");
    const out = [];
    body.split("\n").forEach((ln, i) => {
      if (ln.startsWith("## ")) out.push(`<div style='font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin:14px 0 6px'>${inline(ln.slice(3))}</div>`);
      else if (ln.startsWith("# ")) out.push(`<div style='font-size:14px;font-weight:650;margin:0 0 8px'>${inline(ln.slice(2))}</div>`);
      else if (ln.startsWith("@")) out.push(`<div class='mono' style='font-size:12px;color:var(--node-route);background:var(--node-route-soft);display:block;width:fit-content;padding:2px 8px;border-radius:5px;margin:3px 0'>${esc(ln)}</div>`);
      else if (/^\s*- /.test(ln)) out.push(`<div style='display:flex;gap:8px;font-size:12.5px;line-height:1.6;color:var(--text-secondary);padding:1px 0'><span style='color:var(--text-faint)'>\u2022</span><span>${inline(ln.replace(/^\s*- /, ""))}</span></div>`);
      else if (ln.trim() === "") out.push("<div style='height:6px'></div>");
      else out.push(`<div style='font-size:12.5px;line-height:1.6;color:var(--text-secondary)'>${inline(ln)}</div>`);
    });
    return out.join("");
  }

  function levelDot(level) {
    const L = M.levels[level];
    return React.createElement("span", { className: "pill-dot", style: { background: L.color, flexShrink: 0 } });
  }
  function LevelPill({ level }) {
    const L = M.levels[level];
    return React.createElement(UI.Pill, { color: L.color, bg: L.soft }, L.label);
  }

  function TypePill({ type }) {
    const t = M.types[type];
    return React.createElement(UI.Pill, { color: t.color, bg: t.soft }, React.createElement(Icon, { name: t.icon, size: 10 }), t.label);
  }

  function SourceRow({ file, selId, onSel, indent }) {
    const sel = selId === file.id;
    const named = file.level === "import" || file.level === "note";
    const ic = file.level === "import" ? "external" : file.level === "note" ? "tips" : "memory";
    return React.createElement("div", { onClick: () => onSel(file.id), className: "row gap-8", style: {
      padding: "8px 10px", paddingLeft: indent ? 26 : 10, borderRadius: 7, cursor: "pointer",
      background: sel ? "var(--accent-soft)" : "transparent" },
      onMouseEnter: (e) => { if (!sel) e.currentTarget.style.background = "var(--bg-hover)"; },
      onMouseLeave: (e) => { if (!sel) e.currentTarget.style.background = "transparent"; } },
      levelDot(file.level),
      React.createElement(Icon, { name: ic, size: 13, style: { color: sel ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 } }),
      React.createElement("div", { className: "grow", style: { minWidth: 0 } },
        React.createElement("div", { className: "row gap-6" },
          React.createElement("span", { className: "mono", style: { fontSize: 12, color: sel ? "var(--accent)" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, named ? file.name : file.scope),
          file.readOnly && React.createElement(Icon, { name: "lock", size: 10, style: { color: "var(--warn)" } })),
        React.createElement("div", { className: "mono muted", style: { fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, file.path)),
      React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5, flexShrink: 0 } }, D.fmtK(file.tokens)));
  }

  function SourceView({ file }) {
    const L = M.levels[file.level];
    const isNote = file.type === "note";
    const imports = (file.imports || []).map((id) => M.files.find((f) => f.id === id)).filter(Boolean);
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 20 } },
      React.createElement("div", { className: "row gap-8", style: { marginBottom: 6 } },
        React.createElement(TypePill, { type: file.type }),
        React.createElement(LevelPill, { level: file.level }),
        React.createElement("span", { className: "secondary", style: { fontSize: 11.5 } }, L.desc),
        React.createElement("div", { className: "grow" }),
        file.readOnly && React.createElement(UI.Pill, { color: "var(--warn)", bg: "var(--warn-soft)" }, React.createElement(Icon, { name: "lock", size: 10 }), "read-only")),
      React.createElement("div", { className: "row gap-8", style: { marginBottom: 14 } },
        React.createElement("span", { className: "mono", style: { fontSize: 13.5, fontWeight: 600 } }, file.path),
        React.createElement(UI.CopyBtn, { text: file.path })),
      React.createElement("div", { className: "row", style: { gap: 22, padding: "10px 0", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)", marginBottom: 16, flexWrap: "wrap" } },
        kv("Tokens", D.fmtK(file.tokens)), kv("Lines", file.lines), kv("Scope", L.label), kv("Modified", file.modified),
        isNote && file.session && React.createElement("div", null,
          React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, "Saved in"),
          React.createElement("button", { onClick: () => window.go("sessions", { query: { sel: file.session } }), className: "mono", style: { fontSize: 13, fontWeight: 600, marginTop: 1, color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer" } }, file.session))),
      isNote && file.tags && React.createElement("div", { className: "row gap-6", style: { marginBottom: 14, flexWrap: "wrap" } },
        file.tags.map((tg) => React.createElement("span", { key: tg, className: "mono", style: { fontSize: 10.5, color: "var(--node-test)", background: "var(--node-test-soft)", padding: "2px 8px", borderRadius: 5, whiteSpace: "nowrap" } }, "#" + tg))),
      React.createElement("div", { className: "card card-pad", style: { background: "var(--bg-panel)", marginBottom: 16 },
        dangerouslySetInnerHTML: { __html: renderMd(file.body) } }),
      imports.length > 0 && React.createElement("div", null,
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Imports \u00b7 " + imports.length),
        React.createElement("div", { className: "col gap-6" }, imports.map((im) => React.createElement("div", { key: im.id, className: "row gap-8", style: { padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border-subtle)" } },
          React.createElement(Icon, { name: "external", size: 12, style: { color: "var(--node-route)" } }),
          React.createElement("span", { className: "mono grow", style: { fontSize: 11.5 } }, im.path),
          React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5 } }, D.fmtK(im.tokens)))))),
      React.createElement("div", { className: "row gap-8", style: { marginTop: 16 } },
        React.createElement("button", { className: "btn btn-secondary btn-sm" }, React.createElement(Icon, { name: "copy", size: 13 }), "Copy contents")));
  }

  function kv(label, value) {
    return React.createElement("div", null,
      React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, label),
      React.createElement("div", { className: "mono tabular", style: { fontSize: 13, fontWeight: 600, marginTop: 1, whiteSpace: "nowrap" } }, value));
  }

  function EffectiveView({ typeF }) {
    const tf = typeF || "all";
    // instructions + imports merged in precedence order
    const ordered = [];
    M.order.forEach((lvl) => M.files.filter((f) => f.level === lvl).forEach((f) => ordered.push(f)));
    const orderedShown = ordered.filter((f) => tf === "all" || f.type === tf);
    const notes = M.files.filter((f) => f.type === "note" && (tf === "all" || tf === "note"));
    const block = (f, i) => {
      const L = M.levels[f.level];
      return React.createElement("div", { key: f.id, className: "card", style: { overflow: "hidden", display: "flex" } },
        React.createElement("div", { style: { width: 3, background: L.color, flexShrink: 0 } }),
        React.createElement("div", { style: { flex: 1, minWidth: 0, padding: "12px 14px" } },
          React.createElement("div", { className: "row gap-8", style: { marginBottom: 8 } },
            i != null && React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5, width: 16 } }, i + 1),
            React.createElement(LevelPill, { level: f.level }),
            React.createElement("span", { className: "mono", style: { fontSize: 11.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, f.path),
            React.createElement("div", { className: "grow" }),
            f.readOnly && React.createElement(Icon, { name: "lock", size: 11, style: { color: "var(--warn)" } }),
            React.createElement("span", { className: "mono tabular muted", style: { fontSize: 10.5 } }, D.fmtK(f.tokens))),
          React.createElement("div", { style: { paddingLeft: i != null ? 24 : 0 }, dangerouslySetInnerHTML: { __html: renderMd(f.body) } })));
    };
    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 20 } },
      React.createElement("div", { className: "row gap-8", style: { marginBottom: 6 } },
        React.createElement(Icon, { name: "layers", size: 15, style: { color: "var(--accent)" } }),
        React.createElement("span", { style: { fontWeight: 600, fontSize: 14 } }, "Effective memory"),
        React.createElement("span", { className: "secondary", style: { fontSize: 12 } }, "\u00b7 everything the agent loads")),
      React.createElement("div", { className: "secondary", style: { fontSize: 12, lineHeight: 1.55, marginBottom: 16 } }, "Instructions merge in precedence order \u2014 managed policy is authoritative and lower blocks fill in where higher ones are silent. Saved notes are appended as retrieved context."),
      orderedShown.length > 0 && React.createElement("div", null,
        React.createElement("div", { className: "eyebrow", style: { marginBottom: 8 } }, "Instructions \u00b7 precedence order"),
        React.createElement("div", { className: "col gap-10" }, orderedShown.map((f, i) => block(f, i)))),
      notes.length > 0 && React.createElement("div", { style: { marginTop: orderedShown.length ? 20 : 0 } },
        React.createElement("div", { className: "row gap-6", style: { marginBottom: 8 } },
          React.createElement("span", { className: "eyebrow" }, "Notes \u00b7 memory tool"),
          React.createElement("span", { className: "muted", style: { fontSize: 10.5 } }, "retrieved facts, not precedence-ranked")),
        React.createElement("div", { className: "col gap-10" }, notes.map((f) => block(f, null)))));
  }

  function Memory() {
    const [view, setView] = useState("sources");
    const [typeF, setTypeF] = useState("all");
    const [sel, setSel] = useState(M.files[2].id); // default: project
    const cur = M.files.find((f) => f.id === sel);
    const matchesType = (f) => typeF === "all" || f.type === typeF;
    // group sources by level for the rail
    const groups = [
      { key: "enterprise", items: M.files.filter((f) => f.level === "enterprise") },
      { key: "user", items: M.files.filter((f) => f.level === "user") },
      { key: "project", items: M.files.filter((f) => f.level === "project" || f.level === "subdir") },
      { key: "note", items: M.files.filter((f) => f.level === "note") },
    ];
    // a group shows if any of its rows (or their imports) match the type filter
    const groupVisible = (g) => g.items.some((f) => matchesType(f) || (f.imports || []).some((id) => matchesType(M.files.find((x) => x.id === id))));

    const typeChip = (key, count) => {
      const active = typeF === key;
      const t = key === "all" ? { label: "All", color: "var(--text-secondary)" } : M.types[key];
      return React.createElement("button", { key, onClick: () => setTypeF(key), className: "row gap-6", style: {
        height: 26, padding: "0 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: "pointer",
        border: "1px solid " + (active ? "transparent" : "var(--border-subtle)"),
        background: active ? (key === "all" ? "var(--bg-active)" : t.soft) : "var(--bg-panel)",
        color: active ? (key === "all" ? "var(--text-primary)" : t.color) : "var(--text-muted)" } },
        key !== "all" && React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", background: t.color } }),
        t.label, count != null && React.createElement("span", { className: "tabular", style: { opacity: 0.7 } }, count));
    };

    return React.createElement("div", { className: "col", style: { flex: 1, minHeight: 0 } },
      React.createElement("div", { style: { padding: "16px 18px 0" } },
        React.createElement(UI.PageHead, { icon: "memory", title: "Memory", sub: "Everything the agent remembers \u2014 across levels and types",
          actions: React.createElement(UI.Segmented, { value: view, onChange: setView, size: "sm", options: [{ value: "sources", label: "Sources" }, { value: "effective", label: "Effective" }] }) })),

      // stat strip
      React.createElement("div", { className: "row gap-10", style: { padding: "0 18px 12px" } },
        mstat("memory", "Loaded", D.fmtK(M.totalTokens) + " tokens", "var(--accent)"),
        mstat("memory", "Instructions", String(M.instructionCount), "var(--node-spec)"),
        mstat("tips", "Notes", String(M.noteCount), "var(--node-test)"),
        mstat("external", "Imports", String(M.importCount), "var(--node-route)"),
        React.createElement("div", { className: "grow" }),
        React.createElement("button", { className: "btn btn-secondary btn-sm" }, React.createElement(Icon, { name: "refresh", size: 13 }), "Reload memory")),

      // type filter
      React.createElement("div", { className: "row gap-6", style: { padding: "0 18px 14px", flexWrap: "wrap" } },
        React.createElement(Icon, { name: "filter", size: 13, style: { color: "var(--text-muted)" } }),
        typeChip("all"),
        typeChip("instruction", M.instructionCount),
        typeChip("note", M.noteCount),
        typeChip("import", M.importCount),
        React.createElement("span", { className: "grow" }),
        React.createElement("span", { className: "muted", style: { fontSize: 11 } }, M.types[typeF === "all" ? "instruction" : typeF] && typeF !== "all" ? M.types[typeF].desc : "")),

      view === "effective" ? React.createElement(EffectiveView, { typeF }) :
      React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0, borderTop: "1px solid var(--border-subtle)" } },
        // left rail
        React.createElement("div", { className: "col", style: { width: 300, flexShrink: 0, borderRight: "1px solid var(--border-subtle)", background: "var(--bg-panel)" } },
          React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 8 } },
            groups.filter(groupVisible).map((g) => React.createElement("div", { key: g.key, style: { marginBottom: 10 } },
              React.createElement("div", { className: "row gap-6", style: { padding: "8px 8px 4px" } },
                React.createElement("span", { className: "eyebrow" }, M.levels[g.key].label),
                React.createElement("span", { className: "muted", style: { fontSize: 10 } }, M.levels[g.key].desc)),
              g.items.filter((f) => matchesType(f) || (f.imports || []).some((id) => matchesType(M.files.find((x) => x.id === id)))).map((f) => React.createElement(React.Fragment, { key: f.id },
                matchesType(f) && React.createElement(SourceRow, { file: f, selId: sel, onSel: setSel }),
                (f.imports || []).filter((id) => matchesType(M.files.find((x) => x.id === id))).map((id) => { const im = M.files.find((x) => x.id === id); return im && React.createElement(SourceRow, { key: id, file: im, selId: sel, onSel: setSel, indent: true }); }))))))),
        // detail
        React.createElement("div", { className: "col", style: { flex: 1, minWidth: 0 } },
          cur ? React.createElement(SourceView, { file: cur }) : null)));
  }
  function mstat(icon, label, value, color) {
    return React.createElement("div", { className: "row gap-8", style: { padding: "8px 12px", background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", borderRadius: 9, flexShrink: 0 } },
      React.createElement(Icon, { name: icon, size: 14, style: { color, flexShrink: 0 } }),
      React.createElement("div", null,
        React.createElement("div", { className: "muted", style: { fontSize: 10 } }, label),
        React.createElement("div", { className: "mono tabular", style: { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" } }, value)));
  }
  window.SCREENS.memory = Memory;
})();
