/* Shared UI primitives + state config. Exposes to window. */
(function () {
  const { useState } = React;
  const Icon = window.Icon;

  // ---- State pill config ----
  const STATE = {
    // workflow run states
    pending:    { label: "Pending",    color: "var(--text-muted)", bg: "rgba(255,255,255,0.05)" },
    running:    { label: "Running",    color: "var(--info)",       bg: "var(--info-soft)" },
    paused:     { label: "Paused",     color: "var(--warn)",       bg: "var(--warn-soft)" },
    completed:  { label: "Completed",  color: "var(--success)",    bg: "var(--success-soft)" },
    failed:     { label: "Failed",     color: "var(--error)",      bg: "var(--error-soft)" },
    cancelled:  { label: "Cancelled",  color: "var(--text-muted)", bg: "rgba(255,255,255,0.05)" },
    skipped:    { label: "Skipped",    color: "var(--text-muted)", bg: "rgba(255,255,255,0.05)" },
    // spec link states
    drafted:      { label: "Drafted",      color: "var(--text-secondary)", bg: "rgba(255,255,255,0.05)" },
    implementing: { label: "Implementing", color: "var(--info)",     bg: "var(--info-soft)" },
    implemented:  { label: "Implemented",  color: "var(--node-spec)", bg: "var(--node-spec-soft)" },
    verified:     { label: "Verified",     color: "var(--success)",  bg: "var(--success-soft)" },
    drifted:      { label: "Drifted",      color: "var(--warn)",     bg: "var(--warn-soft)" },
    broken:       { label: "Broken",       color: "var(--error)",    bg: "var(--error-soft)" },
    orphaned:     { label: "Orphaned",     color: "var(--error)",    bg: "var(--error-soft)" },
    // generic
    success: { label: "Success", color: "var(--success)", bg: "var(--success-soft)" },
    warn:    { label: "Warn",    color: "var(--warn)",    bg: "var(--warn-soft)" },
    error:   { label: "Error",   color: "var(--error)",   bg: "var(--error-soft)" },
    info:    { label: "Info",    color: "var(--info)",    bg: "var(--info-soft)" },
  };

  const STATE_ICON = { drifted: "drift", broken: "cancel", orphaned: "drift", failed: "cancel", verified: "check", completed: "check", paused: "pause", running: "circle" };

  function StatePill({ state, pulse, withDot }) {
    const c = STATE[state] || STATE.info;
    const ic = STATE_ICON[state];
    return React.createElement("span", {
      className: "pill", style: { color: c.color, background: c.bg, animation: pulse ? "pulsePill 600ms ease-out" : undefined },
    },
      withDot && React.createElement("span", { className: "pill-dot", style: { background: c.color } }),
      ic && !withDot && React.createElement(Icon, { name: ic, size: 11 }),
      c.label,
    );
  }

  function Pill({ children, color, bg, dot }) {
    return React.createElement("span", { className: "pill", style: { color: color || "var(--text-secondary)", background: bg || "rgba(255,255,255,0.05)" } },
      dot && React.createElement("span", { className: "pill-dot", style: { background: color } }),
      children);
  }

  function CopyBtn({ text, label }) {
    const [done, setDone] = useState(false);
    return React.createElement("button", {
      className: "btn btn-ghost btn-xs", title: "Copy",
      onClick: (e) => { e.stopPropagation(); navigator.clipboard && navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1100); },
      style: { color: done ? "var(--success)" : undefined },
    }, React.createElement(Icon, { name: done ? "check" : "copy", size: 12 }), label || "");
  }

  // Big delta indicator
  function Delta({ value, suffix, invert }) {
    const up = value >= 0;
    const good = invert ? !up : up;
    return React.createElement("span", { className: "row gap-2 tabular", style: { color: good ? "var(--success)" : "var(--error)", fontSize: "var(--fs-xs)", fontWeight: 600 } },
      React.createElement(Icon, { name: up ? "trendUp" : "trendDown", size: 12 }),
      (up ? "+" : "") + (Math.abs(value) < 1 && value !== 0 ? Math.round(value * 100) + "%" : value) + (suffix || ""));
  }

  // Page header used across screens
  function PageHead({ icon, title, sub, actions }) {
    return React.createElement("div", { className: "row", style: { gap: 12, marginBottom: 18, alignItems: "flex-start" } },
      icon && React.createElement("div", { style: { width: 34, height: 34, borderRadius: 9, background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", display: "grid", placeItems: "center", color: "var(--accent)", flexShrink: 0 } },
        React.createElement(Icon, { name: icon, size: 18 })),
      React.createElement("div", { className: "grow", style: { minWidth: 0 } },
        React.createElement("div", { style: { fontSize: "var(--fs-title)", fontWeight: 600, letterSpacing: "-0.01em" } }, title),
        sub && React.createElement("div", { className: "secondary", style: { marginTop: 2 } }, sub)),
      actions && React.createElement("div", { className: "row gap-8" }, actions));
  }

  function Empty({ icon, title, body, action }) {
    return React.createElement("div", { style: { display: "grid", placeItems: "center", height: "100%", minHeight: 280, textAlign: "center", padding: 40 } },
      React.createElement("div", { style: { maxWidth: 360 } },
        React.createElement("div", { style: { width: 52, height: 52, borderRadius: 14, background: "var(--bg-panel)", border: "1px solid var(--border-subtle)", display: "grid", placeItems: "center", color: "var(--text-muted)", margin: "0 auto 16px" } },
          React.createElement(Icon, { name: icon || "box", size: 24 })),
        React.createElement("div", { style: { fontSize: 15, fontWeight: 600, marginBottom: 6 } }, title),
        body && React.createElement("div", { className: "secondary", style: { lineHeight: 1.55 } }, body),
        action && React.createElement("div", { style: { marginTop: 16 } }, action)));
  }

  // Segmented control
  function Segmented({ options, value, onChange, size }) {
    return React.createElement("div", { style: { display: "inline-flex", background: "var(--bg-canvas)", border: "1px solid var(--border-subtle)", borderRadius: 7, padding: 2, gap: 2 } },
      options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const lab = typeof o === "string" ? o : o.label;
        const active = v === value;
        return React.createElement("button", {
          key: v, onClick: () => onChange(v),
          style: {
            border: "none", cursor: "pointer", borderRadius: 5, padding: size === "sm" ? "3px 9px" : "5px 12px",
            fontSize: "var(--fs-sm)", fontWeight: 500, fontFamily: "var(--font-ui)",
            background: active ? "var(--bg-elevated)" : "transparent",
            color: active ? "var(--text-primary)" : "var(--text-muted)",
            boxShadow: active ? "0 1px 2px rgba(0,0,0,0.3)" : "none", transition: "all 100ms",
          },
        }, lab);
      }));
  }

  // Range selector (shared)
  function RangeSelector({ value, onChange }) {
    return React.createElement(Segmented, { options: [
      { value: "today", label: "Today" }, { value: "week", label: "This week" },
      { value: "month", label: "This month" }, { value: "all", label: "All time" },
    ], value, onChange, size: "sm" });
  }

  // Mini horizontal bar (for cost rows etc.)
  function Bar({ frac, color, height }) {
    return React.createElement("div", { style: { height: height || 4, background: "rgba(255,255,255,0.06)", borderRadius: 999, overflow: "hidden", width: "100%" } },
      React.createElement("div", { style: { width: Math.max(2, frac * 100) + "%", height: "100%", background: color || "var(--accent)", borderRadius: 999 } }));
  }

  function nodeColor(kind, state) {
    if (kind === "spec") {
      if (state === "drifted") return "var(--warn)";
      if (state === "broken" || state === "orphaned") return "var(--error)";
      return "var(--node-spec)";
    }
    if (kind === "test") return "var(--node-test)";
    if (kind === "route") return "var(--node-route)";
    return "var(--node-code)";
  }

  window.UI = { STATE, StatePill, Pill, CopyBtn, Delta, PageHead, Empty, Segmented, RangeSelector, Bar, nodeColor };
})();
