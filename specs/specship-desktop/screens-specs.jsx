/* Specs page + Drift queue. */
(function () {
  const { useState } = React;
  const D = window.DATA, Icon = window.Icon, UI = window.UI;
  window.SCREENS = window.SCREENS || {};

  // =================== SPECS ===================
  function SpecTreeRow({ doc, reqs, selId, onSel }) {
    const [open, setOpen] = useState(true);
    const driftCount = reqs.filter((r) => ["drifted", "broken", "orphaned"].includes(r.state)).length;
    return React.createElement("div", null,
      React.createElement("div", { onClick: () => setOpen(!open), className: "row gap-6", style: { padding: "6px 8px", borderRadius: 6, cursor: "pointer", color: "var(--text-secondary)" },
        onMouseEnter: (e) => e.currentTarget.style.background = "var(--bg-hover)", onMouseLeave: (e) => e.currentTarget.style.background = "transparent" },
        React.createElement(Icon, { name: open ? "chevronDown" : "chevronRight", size: 12, style: { color: "var(--text-muted)" } }),
        React.createElement(Icon, { name: "book", size: 13, style: { color: "var(--node-spec)" } }),
        React.createElement("span", { className: "mono grow", style: { fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, doc.path.replace("specs/", "")),
        driftCount > 0 && React.createElement("span", { className: "pill", style: { fontSize: 9.5, color: "var(--warn)", background: "var(--warn-soft)" } }, driftCount)),
      open && React.createElement("div", { style: { marginLeft: 14, borderLeft: "1px solid var(--border-subtle)", paddingLeft: 6 } },
        reqs.map((r) => React.createElement("div", { key: r.id, onClick: () => onSel(r.id), className: "row gap-6", style: {
          padding: "5px 8px", borderRadius: 6, cursor: "pointer", background: selId === r.id ? "var(--accent-soft)" : "transparent" },
          onMouseEnter: (e) => { if (selId !== r.id) e.currentTarget.style.background = "var(--bg-hover)"; }, onMouseLeave: (e) => { if (selId !== r.id) e.currentTarget.style.background = "transparent"; } },
          React.createElement("span", { className: "pill-dot", style: { background: (UI.STATE[r.state] || {}).color, flexShrink: 0 } }),
          React.createElement("div", { className: "grow", style: { minWidth: 0 } },
            React.createElement("div", { className: "mono", style: { fontSize: 11, color: selId === r.id ? "var(--accent)" : "var(--text-primary)" } }, r.id),
            React.createElement("div", { className: "muted", style: { fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.title))))));
  }

  // Inline markdown + RFC-2119 normative keyword highlighting
  function renderProse(s) {
    let h = String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    h = h.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/`([^`]+?)`/g, "<code class='sp-code'>$1</code>");
    h = h.replace(/\b(MUST NOT|MUST|SHALL NOT|SHALL|REQUIRED)\b/g, "<span class='sp-kw sp-kw-must'>$1</span>");
    h = h.replace(/\b(SHOULD NOT|SHOULD|RECOMMENDED)\b/g, "<span class='sp-kw sp-kw-should'>$1</span>");
    h = h.replace(/\b(MAY|OPTIONAL)\b/g, "<span class='sp-kw sp-kw-may'>$1</span>");
    return h;
  }
  const CRIT_ICON = { verified: "check", implemented: "check", completed: "check", drifted: "drift", broken: "cancel", orphaned: "cancel", failed: "cancel" };

  function CritMark({ state }) {
    const c = UI.STATE[state] || UI.STATE.info;
    const ic = CRIT_ICON[state];
    return React.createElement("div", { className: "sp-crit-mark", style: { background: c.bg, color: c.color } },
      ic ? React.createElement(Icon, { name: ic, size: 12 })
        : React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", border: "1.6px solid " + c.color, boxSizing: "border-box" } }));
  }

  function Eyebrow({ children, right }) {
    return React.createElement("div", { className: "row", style: { marginBottom: 10, gap: 10 } },
      React.createElement("span", { className: "eyebrow" }, children),
      React.createElement("span", { style: { flex: 1, height: 1, background: "var(--border-subtle)" } }),
      right);
  }

  function SpecDetail({ req, doc }) {
    const [editing, setEditing] = useState(false);
    const [data, setData] = useState(req);
    if (!req) return React.createElement(UI.Empty, { icon: "book", title: "Pick a spec from the tree",
      body: "Or run specship init -i to index your specs/ folder if you haven\u2019t yet.",
      action: React.createElement("code", { className: "mono", style: { fontSize: 11.5, color: "var(--accent)", background: "var(--bg-canvas)", padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)" } }, "specship init -i") });

    if (editing) return React.createElement(SpecEditor, { req: data, doc,
      onCancel: () => setEditing(false),
      onSave: (draft) => { Object.assign(req, draft); setData({ ...req }); setEditing(false); } });

    return React.createElement(SpecRead, { req: data, doc, onEdit: () => setEditing(true) });
  }

  function SpecRead({ req, doc, onEdit }) {
    const acc = req.acceptance || [];
    const passing = acc.filter((a) => a.state === "verified" || a.state === "implemented" || a.state === "completed").length;
    const accent = (UI.STATE[req.state] || UI.STATE.info).color;
    const verifiedColor = req.state === "verified" ? "var(--success)"
      : (req.state === "broken" || req.state === "drifted" || req.state === "orphaned") ? "var(--warn)" : "var(--text-secondary)";

    const sep = () => React.createElement("span", { className: "sep" });
    const fact = (label, value, opts) => React.createElement("span", { className: "fact" },
      label ? label + " " : null,
      React.createElement("b", { style: opts && opts.color ? { color: opts.color } : null, className: opts && opts.mono ? "mono" : null }, value));

    return React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: "28px 32px 56px" } },
      React.createElement("div", { className: "sp-doc" },

        // ---- breadcrumb ----
        React.createElement("div", { className: "sp-breadcrumb" },
          React.createElement(Icon, { name: "book", size: 13, style: { color: "var(--node-spec)" } }),
          React.createElement("span", { className: "mono", style: { color: "var(--text-secondary)" } }, doc.path),
          React.createElement(Icon, { name: "chevronRight", size: 11 }),
          React.createElement("span", { className: "mono", style: { color: "var(--node-spec)", fontWeight: 600 } }, req.id),
          React.createElement(UI.CopyBtn, { text: req.id })),

        // ---- title ----
        React.createElement("h1", { className: "sp-title" }, req.title),

        // ---- single meta line ----
        React.createElement("div", { className: "sp-metaline", style: { marginBottom: 32 } },
          React.createElement(UI.StatePill, { state: req.state, pulse: req.state === "broken" || req.state === "drifted" }),
          React.createElement(UI.Pill, null, req.priority),
          sep(),
          fact(null, req.kind),
          sep(),
          fact("owned by", req.owner || "\u2014", { mono: true }),
          sep(),
          fact(req.state === "verified" ? "verified" : null, req.verifiedAt || "\u2014", { color: verifiedColor })),

        // ---- requirement statement (hero) ----
        React.createElement("div", { className: "sp-sec" },
          React.createElement("div", { className: "sp-label" }, "Requirement"),
          React.createElement("div", { className: "sp-statement lead", style: { ["--sp-accent"]: accent } },
            React.createElement("div", { className: "sp-prose", dangerouslySetInnerHTML: { __html: renderProse(req.body) } }))),

        // ---- rationale (optional) ----
        req.rationale && React.createElement("div", { className: "sp-sec" },
          React.createElement("div", { className: "sp-label" }, "Why it matters"),
          React.createElement("div", { className: "sp-rationale", dangerouslySetInnerHTML: { __html: renderProse(req.rationale) } })),

        // ---- acceptance criteria ----
        acc.length > 0 && React.createElement("div", { className: "sp-sec" },
          React.createElement("div", { className: "sp-label" }, "Acceptance criteria",
            React.createElement("span", { className: "ct tabular", style: { color: passing === acc.length ? "var(--success)" : "var(--text-muted)" } }, passing + " / " + acc.length + " met")),
          React.createElement("div", { className: "row gap-4", style: { marginBottom: 12 } },
            acc.map((a, i) => React.createElement("div", { key: i, title: a.id + " \u00b7 " + (UI.STATE[a.state] || {}).label, style: { flex: 1, height: 4, borderRadius: 999, background: (UI.STATE[a.state] || UI.STATE.info).color, opacity: a.state === "pending" ? 0.25 : 0.9 } }))),
          React.createElement("div", { className: "card", style: { overflow: "hidden" } },
            acc.map((a, i) => React.createElement("div", { key: i, className: "sp-crit" },
              React.createElement(CritMark, { state: a.state }),
              React.createElement("span", { className: "sp-crit-id" }, a.id),
              React.createElement("span", { className: "sp-crit-text", dangerouslySetInnerHTML: { __html: renderProse(a.text) } }))))),

        // ---- linked code ----
        React.createElement("div", { className: "sp-sec" },
          React.createElement("div", { className: "sp-label" }, "Linked code",
            req.links.length ? React.createElement("span", { className: "ct" }, req.links.length + (req.links.length === 1 ? " symbol" : " symbols")) : null),
          req.links.length ? React.createElement("div", { className: "card", style: { overflow: "hidden" } },
            req.links.map((l, i) => React.createElement("div", { key: i, className: "row gap-10", style: { padding: "11px 14px", borderTop: i ? "1px solid var(--border-subtle)" : "none" } },
              React.createElement(UI.StatePill, { state: l.state }),
              l.axis && React.createElement(UI.Pill, { color: "var(--warn)", bg: "var(--warn-soft)" }, l.axis + " drift"),
              React.createElement("span", { className: "mono grow", style: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, l.target),
              React.createElement(UI.Pill, null, l.prov),
              React.createElement("button", { className: "btn btn-ghost btn-xs" }, React.createElement(Icon, { name: "reveal", size: 12 }), "Reveal")))) :
            React.createElement("div", { className: "card card-pad", style: { textAlign: "center", color: "var(--error)", borderColor: "rgba(242,85,90,0.3)" } },
              React.createElement(Icon, { name: "drift", size: 16 }), React.createElement("div", { style: { marginTop: 6, fontSize: 12.5 } }, "Orphaned \u2014 no code implements this requirement yet"))),

        // ---- quick actions ----
        React.createElement("div", { className: "row gap-8", style: { flexWrap: "wrap", marginTop: 4 } },
          React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Run automatically by the implementation workflow once Drafted" }, React.createElement(Icon, { name: "play", size: 13 }), "Implement"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: true, title: "Run automatically by the verification workflow" }, React.createElement(Icon, { name: "check", size: 13 }), "Verify"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: true, title: "Read-only \u2014 editing is disabled" }, React.createElement(Icon, { name: "reveal", size: 13 }), "Edit spec"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => window.go("graph", { query: { focus: "spec:" + req.id } }) }, React.createElement(Icon, { name: "graph", size: 13 }), "Show in graph"))));
  }

  // =================== SPEC EDITOR ===================
  const CRIT_STATES = ["pending", "implementing", "implemented", "verified", "drifted", "broken"];
  const SPEC_STATES = ["drafted", "implementing", "implemented", "verified", "drifted", "broken", "orphaned"];
  const PRIORITIES = ["P0", "P1", "P2", "P3"];
  const KIND_OPTIONS = ["requirement", "constraint", "guideline", "invariant", "non-functional"];

  function Field({ label, children, hint }) {
    return React.createElement("div", { style: { marginBottom: 22 } },
      React.createElement("label", { className: "sp-fl" }, label),
      children,
      hint && React.createElement("div", { className: "muted", style: { fontSize: 11, marginTop: 6 } }, hint));
  }

  function StateSelect({ value, onChange, options, width }) {
    const c = UI.STATE[value] || UI.STATE.info;
    return React.createElement("div", { className: "row", style: { position: "relative", width: width || "auto" } },
      React.createElement("span", { className: "pill-dot", style: { background: c.color, position: "absolute", left: 11, pointerEvents: "none", zIndex: 1 } }),
      React.createElement("select", { className: "input sp-select", value, onChange: (e) => onChange(e.target.value),
        style: { width: "100%", paddingLeft: 26, textTransform: "capitalize" } },
        options.map((s) => React.createElement("option", { key: s, value: s }, (UI.STATE[s] || {}).label || s))));
  }

  function PlainSelect({ value, onChange, options, width }) {
    return React.createElement("select", { className: "input sp-select", value, onChange: (e) => onChange(e.target.value),
      style: { width: width || "100%", textTransform: "capitalize" } },
      options.map((s) => React.createElement("option", { key: s, value: s }, s)));
  }

  // read-only status: editing re-queues the spec as Drafted for the implementation workflow
  function AutoStatus({ state }) {
    return React.createElement("div", { className: "sp-status-auto" },
      state === "drafted"
        ? React.createElement(React.Fragment, null,
            React.createElement(UI.StatePill, { state: "drafted" }),
            React.createElement("span", { className: "muted", style: { fontSize: 12 } }, "queued for implementation"))
        : React.createElement(React.Fragment, null,
            React.createElement(UI.StatePill, { state: state }),
            React.createElement(Icon, { name: "arrowRight", size: 13, style: { color: "var(--text-muted)", flexShrink: 0 } }),
            React.createElement(UI.StatePill, { state: "drafted" })),
      React.createElement("span", { className: "grow" }),
      React.createElement(Icon, { name: "lock", size: 12, style: { color: "var(--text-faint)", flexShrink: 0 } }));
  }

  function SpecEditor({ req, doc, onCancel, onSave }) {
    const [d, setD] = useState(() => ({
      title: req.title, kind: req.kind, priority: req.priority, state: req.state, owner: req.owner || "",
      body: req.body, rationale: req.rationale || "",
      acceptance: (req.acceptance || []).map((a) => ({ ...a })),
    }));
    const [tab, setTab] = useState("write");
    const orig = React.useRef(JSON.stringify({
      title: req.title, kind: req.kind, priority: req.priority, state: req.state, owner: req.owner || "",
      body: req.body, rationale: req.rationale || "", acceptance: (req.acceptance || []).map((a) => ({ ...a })),
    }));
    const dirty = JSON.stringify(d) !== orig.current;
    const set = (patch) => setD((p) => ({ ...p, ...patch }));

    const renumber = (arr) => arr.map((a, i) => ({ ...a, id: "A" + (i + 1) }));
    const setCrit = (i, patch) => set({ acceptance: d.acceptance.map((a, j) => j === i ? { ...a, ...patch } : a) });
    const addCrit = () => set({ acceptance: renumber([...d.acceptance, { id: "A?", state: "pending", text: "" }]) });
    const delCrit = (i) => set({ acceptance: renumber(d.acceptance.filter((_, j) => j !== i)) });

    const accent = (UI.STATE[d.state] || UI.STATE.info).color;
    // saving re-queues the spec: status is forced to "drafted" so the workflow picks it up
    const save = () => { if (dirty) onSave({ title: d.title.trim(), kind: d.kind.trim(), priority: d.priority, state: "drafted", owner: d.owner.trim(), body: d.body.trim(), rationale: d.rationale.trim(), acceptance: renumber(d.acceptance.filter((a) => a.text.trim())) }); };

    return React.createElement("div", { className: "col", style: { flex: 1, minHeight: 0 } },
      // ---- sticky edit bar ----
      React.createElement("div", { className: "sp-edit-bar" },
        React.createElement(Icon, { name: "reveal", size: 15, style: { color: "var(--accent)", flexShrink: 0 } }),
        React.createElement("div", { className: "col", style: { gap: 1, minWidth: 0 } },
          React.createElement("div", { style: { fontSize: 13, fontWeight: 600 } }, "Editing spec"),
          React.createElement("div", { className: "mono muted", style: { fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, doc.path + " \u00b7 " + req.id)),
        React.createElement("div", { className: "grow" }),
        dirty && React.createElement("div", { className: "row gap-6", style: { marginRight: 4 } },
          React.createElement("span", { className: "sp-dirty-dot" }),
          React.createElement("span", { className: "muted", style: { fontSize: 11.5 } }, "Unsaved changes")),
        React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onCancel }, React.createElement(Icon, { name: "x", size: 13 }), "Cancel"),
        React.createElement("button", { className: "btn btn-primary btn-sm", disabled: !dirty, onClick: save }, React.createElement(Icon, { name: "check", size: 13 }), "Save changes")),

      React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: "24px 28px 56px" } },
        React.createElement("div", { style: { maxWidth: 780 } },

          // title
          React.createElement(Field, { label: "Title" },
            React.createElement("input", { className: "input sp-input-lg", value: d.title, placeholder: "Short, imperative requirement title", onChange: (e) => set({ title: e.target.value }) })),

          // metadata grid
          React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 22px", marginBottom: 4 } },
            React.createElement(Field, { label: "Status", hint: "Set automatically \u2014 saving re-queues this spec as Drafted so the implementation workflow picks it up." },
              React.createElement(AutoStatus, { state: req.state })),
            React.createElement(Field, { label: "Priority" },
              React.createElement(UI.Segmented, { options: PRIORITIES, value: d.priority, onChange: (v) => set({ priority: v }) })),
            React.createElement(Field, { label: "Kind" },
              React.createElement(PlainSelect, { value: d.kind, onChange: (v) => set({ kind: v }), options: KIND_OPTIONS })),
            React.createElement(Field, { label: "Owner" },
              React.createElement("input", { className: "input mono", style: { width: "100%" }, value: d.owner, placeholder: "unassigned", onChange: (e) => set({ owner: e.target.value }) }))),

          // normative statement w/ write/preview
          React.createElement("div", { style: { marginBottom: 22 } },
            React.createElement("div", { className: "row", style: { marginBottom: 7 } },
              React.createElement("label", { className: "sp-fl", style: { marginBottom: 0 } }, "Normative statement"),
              React.createElement("div", { className: "grow" }),
              React.createElement(UI.Segmented, { size: "sm", options: [{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }], value: tab, onChange: setTab })),
            tab === "write"
              ? React.createElement("textarea", { className: "input sp-textarea", value: d.body, spellCheck: false,
                  placeholder: "The server MUST validate \u2026  (use MUST / SHOULD / MAY, **bold**, and `code`)",
                  onChange: (e) => set({ body: e.target.value }) })
              : React.createElement("div", { className: "sp-statement", style: { ["--sp-accent"]: accent } },
                  d.body.trim()
                    ? React.createElement("div", { className: "sp-prose", dangerouslySetInnerHTML: { __html: renderProse(d.body) } })
                    : React.createElement("div", { className: "muted", style: { fontSize: 13 } }, "Nothing to preview yet.")),
            React.createElement("div", { className: "sp-kw-legend" },
              React.createElement("span", { className: "label" }, "Keywords:"),
              React.createElement("span", { className: "sp-kw sp-kw-must" }, "MUST"),
              React.createElement("span", { className: "sp-kw sp-kw-should" }, "SHOULD"),
              React.createElement("span", { className: "sp-kw sp-kw-may" }, "MAY"),
              React.createElement("span", { className: "label", style: { marginLeft: 4 } }, "auto-highlight as you type"))),

          // rationale
          React.createElement(Field, { label: "Rationale", hint: "Optional \u2014 why this requirement exists. Helps the indexer and reviewers." },
            React.createElement("textarea", { className: "input sp-textarea", value: d.rationale, spellCheck: false, style: { minHeight: 84 },
              placeholder: "Why does this matter? What breaks without it?", onChange: (e) => set({ rationale: e.target.value }) })),

          // acceptance criteria editor
          React.createElement("div", { className: "row", style: { marginBottom: 10, gap: 10 } },
            React.createElement("span", { className: "eyebrow" }, "Acceptance criteria"),
            React.createElement("span", { style: { flex: 1, height: 1, background: "var(--border-subtle)" } }),
            React.createElement("span", { className: "mono tabular muted", style: { fontSize: 11.5 } }, d.acceptance.length + " total")),
          React.createElement("div", { className: "card", style: { overflow: "hidden", marginBottom: 12 } },
            d.acceptance.length === 0
              ? React.createElement("div", { className: "muted", style: { fontSize: 12.5, textAlign: "center", padding: "18px 14px" } }, "No criteria yet \u2014 add one below.")
              : d.acceptance.map((a, i) => React.createElement("div", { key: i, className: "sp-crit-edit" },
                  React.createElement("span", { className: "sp-crit-grip" }, React.createElement(Icon, { name: "grip", size: 14 })),
                  React.createElement("span", { className: "sp-crit-num" }, "A" + (i + 1)),
                  React.createElement(StateSelect, { value: a.state, onChange: (v) => setCrit(i, { state: v }), options: CRIT_STATES, width: 156 }),
                  React.createElement("input", { className: "input grow", style: { fontSize: 13 }, value: a.text, placeholder: "Observable, testable condition\u2026", onChange: (e) => setCrit(i, { text: e.target.value }) }),
                  React.createElement("button", { className: "sp-icon-btn", title: "Remove criterion", onClick: () => delCrit(i) }, React.createElement(Icon, { name: "trash", size: 14 }))))),
          React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: addCrit }, React.createElement(Icon, { name: "plus", size: 13 }), "Add criterion"),

          // footer actions
          React.createElement("div", { className: "row", style: { gap: 10, marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--border-subtle)" } },
            React.createElement("button", { className: "btn btn-primary btn-sm", disabled: !dirty, onClick: save }, React.createElement(Icon, { name: "check", size: 13 }), "Save changes"),
            React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: onCancel }, "Cancel"),
            React.createElement("div", { className: "grow" }),
            React.createElement("span", { className: "mono muted", style: { fontSize: 11 } }, dirty ? "edited" : "no changes"))))); 
  }
  function meta(label, value) {
    return React.createElement("div", null,
      React.createElement("div", { className: "muted", style: { fontSize: 10.5 } }, label),
      React.createElement("div", { className: "mono", style: { fontSize: 12.5, marginTop: 1 } }, value));
  }

  function Specs({ query }) {
    const flat = D.specDocs.flatMap((d) => d.reqs.map((r) => ({ r, d })));
    const [sel, setSel] = useState((query && query.sel) || flat[0].r.id);
    const cur = flat.find((x) => x.r.id === sel);
    return React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0 } },
      React.createElement("div", { className: "col", style: { width: 280, flexShrink: 0, borderRight: "1px solid var(--border-subtle)", background: "var(--bg-panel)" } },
        React.createElement("div", { className: "row", style: { gap: 8, padding: "11px 12px", borderBottom: "1px solid var(--border-subtle)" } },
          React.createElement(Icon, { name: "book", size: 15, style: { color: "var(--accent)" } }),
          React.createElement("span", { style: { fontWeight: 600, fontSize: 13 } }, "Specs"),
          React.createElement("span", { className: "grow" }),
          React.createElement("span", { className: "muted tabular", style: { fontSize: 11 } }, flat.length + " reqs")),
        React.createElement("div", { className: "scroll-y", style: { flex: 1, padding: 6 } },
          D.specDocs.map((d) => React.createElement(SpecTreeRow, { key: d.path, doc: d, reqs: d.reqs, selId: sel, onSel: setSel })))),
      React.createElement("div", { className: "col", style: { flex: 1, minWidth: 0 } },
        cur ? React.createElement(SpecDetail, { key: cur.r.id, req: cur.r, doc: cur.d }) : React.createElement(SpecDetail, {})));
  }
  window.SCREENS.specs = Specs;

  // =================== DRIFT QUEUE ===================
  function DriftRow({ link, selected, onToggle }) {
    const [open, setOpen] = useState(false);
    return React.createElement("div", { style: { borderBottom: "1px solid var(--border-subtle)" } },
      React.createElement("div", { className: "row gap-10", style: { padding: "10px 14px", cursor: "pointer", background: selected ? "var(--accent-soft)" : "transparent" },
        onMouseEnter: (e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }, onMouseLeave: (e) => { if (!selected) e.currentTarget.style.background = "transparent"; } },
        React.createElement("input", { type: "checkbox", checked: selected, onChange: onToggle, onClick: (e) => e.stopPropagation(), style: { accentColor: "var(--accent)", width: 14, height: 14 } }),
        React.createElement("div", { className: "row gap-10 grow", style: { minWidth: 0 }, onClick: () => setOpen(!open) },
          React.createElement("div", { style: { width: 92, flexShrink: 0 } }, React.createElement(UI.StatePill, { state: link.state })),
          React.createElement("span", { className: "mono", style: { fontSize: 12, color: "var(--node-spec)", flexShrink: 0, width: 130 } }, link.specId),
          React.createElement("span", { className: "secondary", style: { fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 1 220px" } }, link.specTitle),
          React.createElement(Icon, { name: "arrowRight", size: 13, style: { color: "var(--text-muted)", flexShrink: 0 } }),
          React.createElement("span", { className: "mono grow", style: { fontSize: 11.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, link.target),
          link.axis && React.createElement(UI.Pill, { color: "var(--warn)", bg: "var(--warn-soft)" }, link.axis),
          React.createElement("span", { className: "mono muted", style: { fontSize: 11, flexShrink: 0, width: 48, textAlign: "right" } }, link.prov === "—" ? "" : link.prov),
          React.createElement("span", { className: "mono muted tabular", style: { fontSize: 11, flexShrink: 0, width: 32, textAlign: "right" } }, link.age),
          React.createElement(Icon, { name: open ? "chevronDown" : "chevronRight", size: 13, style: { color: "var(--text-muted)", flexShrink: 0 } }))),
      open && React.createElement("div", { style: { padding: "0 14px 14px 50px", background: "var(--bg-canvas)" } },
        React.createElement("div", { className: "row", style: { gap: 22, padding: "10px 0", flexWrap: "wrap" } },
          meta("Spec", link.specId), meta("Target", link.target), meta("Provenance", link.prov), meta("Drift axis", link.axis || "\u2014"), meta("Age", link.age)),
        React.createElement("div", { className: "row gap-8" },
          link.state === "drifted" && React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Read-only \u2014 fixes run via workflows" }, React.createElement(Icon, { name: "wrench", size: 12 }), "Fix"),
          link.state === "broken" && React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Read-only \u2014 verification runs automatically" }, React.createElement(Icon, { name: "refresh", size: 12 }), "Re-verify"),
          link.state === "orphaned" && React.createElement("button", { className: "btn btn-primary btn-sm", disabled: true, title: "Read-only \u2014 relinking is disabled" }, React.createElement(Icon, { name: "graph", size: 12 }), "Re-attach"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => window.go("specs", { query: { sel: link.specId } }) }, "Open spec"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => window.go("graph", { query: { focus: "spec:" + link.specId } }) }, "Show in graph"))));
  }

  function Drift() {
    const [stateF, setStateF] = useState({ drifted: true, broken: true, orphaned: true });
    const [selected, setSelected] = useState(new Set());
    const links = D.driftLinks.filter((l) => stateF[l.state]);
    const toggle = (i) => setSelected((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
    const allClean = links.length === 0;
    const counts = { drifted: 0, broken: 0, orphaned: 0 };
    D.driftLinks.forEach((l) => counts[l.state]++);

    return React.createElement("div", { className: "col", style: { flex: 1, minHeight: 0 } },
      React.createElement("div", { style: { padding: "16px 18px 0" } },
        React.createElement(UI.PageHead, { icon: "drift", title: "Drift queue", sub: D.driftLinks.length + " links need attention" })),
      // filter bar
      React.createElement("div", { className: "row gap-8", style: { padding: "0 18px 12px", flexWrap: "wrap" } },
        React.createElement(Icon, { name: "filter", size: 13, style: { color: "var(--text-muted)" } }),
        ["drifted", "broken", "orphaned"].map((s) => React.createElement("button", { key: s, onClick: () => setStateF((f) => ({ ...f, [s]: !f[s] })), className: "row gap-6", style: {
          height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 500, cursor: "pointer", textTransform: "capitalize",
          border: "1px solid " + (stateF[s] ? "transparent" : "var(--border-subtle)"), background: stateF[s] ? (UI.STATE[s].bg) : "var(--bg-panel)", color: stateF[s] ? UI.STATE[s].color : "var(--text-muted)" } },
          s, React.createElement("span", { className: "tabular", style: { opacity: 0.7 } }, counts[s]))),
        React.createElement("div", { className: "grow" }),
        selected.size > 0 && React.createElement(React.Fragment, null,
          React.createElement("span", { className: "secondary", style: { fontSize: 12 } }, selected.size + " selected"),
          React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: true, title: "Read-only \u2014 verification runs automatically" }, React.createElement(Icon, { name: "refresh", size: 12 }), "Re-verify all"),
          React.createElement("button", { className: "btn btn-secondary btn-sm" }, React.createElement(Icon, { name: "reveal", size: 12 }), "Open all"))),
      // list or empty
      allClean ? React.createElement(UI.Empty, { icon: "check", title: "All links in good standing \u2728", body: "Nothing has drifted. Every spec link points at code that still matches." }) :
        React.createElement("div", { className: "scroll-y", style: { flex: 1, borderTop: "1px solid var(--border-subtle)" } },
          links.map((l, i) => React.createElement(DriftRow, { key: i, link: l, selected: selected.has(i), onToggle: () => toggle(i) }))));
  }
  window.SCREENS.drift = Drift;
})();
