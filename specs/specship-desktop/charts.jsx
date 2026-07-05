/* SVG chart primitives. Exposes window.Charts. */
(function () {
  const { useState, useRef, useEffect } = React;

  // ---- Sparkline ----
  function Sparkline({ data, color, w = 80, h = 24, fill }) {
    if (!data || !data.length) return null;
    const max = Math.max(...data), min = Math.min(...data);
    const range = max - min || 1;
    const pts = data.map((d, i) => [(i / (data.length - 1)) * w, h - ((d - min) / range) * (h - 4) - 2]);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const area = line + ` L${w} ${h} L0 ${h} Z`;
    return React.createElement("svg", { width: w, height: h, style: { display: "block", overflow: "visible" } },
      fill && React.createElement("path", { d: area, fill: color, opacity: 0.12 }),
      React.createElement("path", { d: line, fill: "none", stroke: color || "var(--accent)", strokeWidth: 1.6, strokeLinejoin: "round", strokeLinecap: "round" }));
  }

  // ---- Line chart with hover ----
  function LineChart({ series, w = 640, h = 200, color = "var(--accent)", yLabel, xTicks = 6, onHover }) {
    const [hi, setHi] = useState(null);
    const pad = { l: 44, r: 12, t: 14, b: 24 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const vals = series.map((s) => s.cost);
    const max = Math.max(...vals) * 1.12, min = 0;
    const x = (i) => pad.l + (i / (series.length - 1)) * iw;
    const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
    const line = series.map((s, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(s.cost).toFixed(1)).join(" ");
    const area = line + ` L${x(series.length - 1)} ${pad.t + ih} L${pad.l} ${pad.t + ih} Z`;
    const yticks = 4;
    return React.createElement("svg", { width: "100%", viewBox: `0 0 ${w} ${h}`, style: { display: "block" },
      onMouseLeave: () => { setHi(null); onHover && onHover(null); },
      onMouseMove: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width * w;
        let idx = Math.round((px - pad.l) / iw * (series.length - 1));
        idx = Math.max(0, Math.min(series.length - 1, idx));
        setHi(idx); onHover && onHover(series[idx]);
      } },
      // gridlines + y labels
      Array.from({ length: yticks + 1 }).map((_, i) => {
        const v = (max / yticks) * i, yy = y(v);
        return React.createElement("g", { key: i },
          React.createElement("line", { x1: pad.l, x2: w - pad.r, y1: yy, y2: yy, stroke: "rgba(255,255,255,0.05)" }),
          React.createElement("text", { x: pad.l - 8, y: yy + 3, textAnchor: "end", fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }, "$" + v.toFixed(0)));
      }),
      React.createElement("path", { d: area, fill: color, opacity: 0.1 }),
      React.createElement("path", { d: line, fill: "none", stroke: color, strokeWidth: 2, strokeLinejoin: "round" }),
      // x ticks
      series.filter((_, i) => i % Math.ceil(series.length / xTicks) === 0).map((s, k, arr) => {
        const i = series.indexOf(s);
        return React.createElement("text", { key: i, x: x(i), y: h - 6, textAnchor: "middle", fontSize: 10, fill: "var(--text-muted)", fontFamily: "var(--font-mono)" }, s.day + "d");
      }),
      hi != null && React.createElement("g", null,
        React.createElement("line", { x1: x(hi), x2: x(hi), y1: pad.t, y2: pad.t + ih, stroke: color, opacity: 0.4, strokeDasharray: "3 3" }),
        React.createElement("circle", { cx: x(hi), cy: y(series[hi].cost), r: 4, fill: color, stroke: "var(--bg-canvas)", strokeWidth: 2 })));
  }

  // ---- Donut ----
  function Donut({ data, size = 140, thickness = 22, centerLabel, centerSub }) {
    const total = data.reduce((a, b) => a + b.cost, 0);
    const r = (size - thickness) / 2, cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    let off = 0;
    return React.createElement("div", { style: { position: "relative", width: size, height: size } },
      React.createElement("svg", { width: size, height: size, style: { transform: "rotate(-90deg)" } },
        React.createElement("circle", { cx, cy, r, fill: "none", stroke: "rgba(255,255,255,0.05)", strokeWidth: thickness }),
        data.map((d, i) => {
          const frac = d.cost / total;
          const dash = frac * circ;
          const el = React.createElement("circle", { key: i, cx, cy, r, fill: "none", stroke: d.color, strokeWidth: thickness,
            strokeDasharray: `${dash} ${circ - dash}`, strokeDashoffset: -off, strokeLinecap: "butt" });
          off += dash; return el;
        })),
      centerLabel && React.createElement("div", { style: { position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" } },
        React.createElement("div", null,
          React.createElement("div", { style: { fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" } }, centerLabel),
          centerSub && React.createElement("div", { className: "muted", style: { fontSize: 10 } }, centerSub))));
  }

  // ---- Stacked horizontal bars (cost by model per project) ----
  function StackedBars({ rows, segments, w = 480, fmt }) {
    const max = Math.max(...rows.map((r) => segments.reduce((a, s) => a + (r.values[s.key] || 0), 0)));
    return React.createElement("div", { className: "col gap-10" },
      rows.map((r) => {
        const total = segments.reduce((a, s) => a + (r.values[s.key] || 0), 0);
        return React.createElement("div", { key: r.label, className: "row gap-10" },
          React.createElement("div", { style: { width: 110, fontSize: 12, color: "var(--text-secondary)", textAlign: "right", flexShrink: 0, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.label),
          React.createElement("div", { className: "row", style: { flex: 1, height: 18, background: "var(--bg-hover)", borderRadius: 4, overflow: "hidden" } },
            segments.map((s) => {
              const v = r.values[s.key] || 0;
              return v ? React.createElement("div", { key: s.key, title: `${s.label}: ${fmt ? fmt(v) : v}`, style: { width: (v / max * 100) + "%", height: "100%", background: s.color } }) : null;
            })),
          React.createElement("div", { className: "tabular", style: { width: 64, fontSize: 12, textAlign: "right", flexShrink: 0, fontFamily: "var(--font-mono)" } }, fmt ? fmt(total) : total));
      }));
  }

  // ---- Bars (vertical mini, e.g. tools) ----
  function HBars({ items, max, color, fmt, labelKey = "name", valueKey = "calls", onItemClick, selectedKey }) {
    const m = max || Math.max(...items.map((i) => i[valueKey]));
    return React.createElement("div", { className: "col gap-6" },
      items.map((it) => { const sel = selectedKey != null && it[labelKey] === selectedKey; return React.createElement("div", { key: it[labelKey], className: "row gap-10",
        onClick: onItemClick ? () => onItemClick(it) : undefined,
        style: { cursor: onItemClick ? "pointer" : "default", borderRadius: 5, padding: onItemClick ? "2px 4px" : 0, margin: onItemClick ? "0 -4px" : 0, background: sel ? "var(--accent-soft)" : "transparent" },
        onMouseEnter: onItemClick ? (e) => { if (!sel) e.currentTarget.style.background = "var(--bg-hover)"; } : undefined,
        onMouseLeave: onItemClick ? (e) => { if (!sel) e.currentTarget.style.background = "transparent"; } : undefined },
        React.createElement("div", { style: { width: 116, fontSize: 12, fontFamily: "var(--font-mono)", color: sel ? "var(--accent)" : "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 0 } }, it[labelKey]),
        React.createElement("div", { className: "grow", style: { height: 16, background: "var(--bg-hover)", borderRadius: 4, overflow: "hidden" } },
          React.createElement("div", { style: { width: (it[valueKey] / m * 100) + "%", height: "100%", background: typeof color === "function" ? color(it) : (color || "var(--accent)"), borderRadius: 4 } })),
        React.createElement("div", { className: "tabular", style: { width: 52, textAlign: "right", fontSize: 12, fontFamily: "var(--font-mono)", flexShrink: 0 } }, fmt ? fmt(it[valueKey]) : it[valueKey]),
        onItemClick && React.createElement(window.Icon, { name: "chevronRight", size: 12, style: { color: sel ? "var(--accent)" : "var(--text-faint)", flexShrink: 0 } })); }));
  }

  // ---- Squarified treemap (Bruls et al.) ----
  function squarifyLayout(data, X, Y, W, H) {
    const total = data.reduce((a, b) => a + b.value, 0) || 1;
    const items = data.map((d) => ({ d, area: d.value / total * (W * H) }));
    const res = []; let rect = { x: X, y: Y, w: W, h: H }; let row = [];
    const sum = (arr) => arr.reduce((a, b) => a + b.area, 0);
    const worst = (arr, len) => { if (!arr.length) return Infinity; const s = sum(arr); const mx = Math.max(...arr.map((a) => a.area)); const mn = Math.min(...arr.map((a) => a.area)); return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn)); };
    const flush = () => {
      const len = Math.min(rect.w, rect.h); const s = sum(row); const thick = s / (len || 1); let off = 0;
      const horizontal = rect.w >= rect.h;
      row.forEach((it) => { const cl = it.area / (thick || 1); if (horizontal) res.push({ ...it.d, x: rect.x, y: rect.y + off, w: thick, h: cl }); else res.push({ ...it.d, x: rect.x + off, y: rect.y, w: cl, h: thick }); off += cl; });
      if (horizontal) rect = { x: rect.x + thick, y: rect.y, w: rect.w - thick, h: rect.h }; else rect = { x: rect.x, y: rect.y + thick, w: rect.w, h: rect.h - thick };
      row = [];
    };
    items.forEach((it) => { const len = Math.min(rect.w, rect.h); if (row.length && worst([...row, it], len) > worst(row, len)) flush(); row.push(it); });
    if (row.length) flush();
    return res;
  }
  // items: [{ key, label, value, intensity (0..1), sub }]
  function Treemap({ items, height = 120, onPick, selKey, color = "var(--warn)" }) {
    const ref = useRef(null); const [w, setW] = useState(0);
    useEffect(() => { if (!ref.current || typeof ResizeObserver === "undefined") return; const ro = new ResizeObserver((es) => setW(es[0].contentRect.width)); ro.observe(ref.current); return () => ro.disconnect(); }, []);
    const W = w || 600;
    const sorted = [...items].sort((a, b) => b.value - a.value);
    const cells = squarifyLayout(sorted, 0, 0, W, height);
    return React.createElement("div", { ref, style: { position: "relative", width: "100%", height, borderRadius: 7, overflow: "hidden", background: "var(--bg-canvas)" } },
      cells.map((c) => {
        const t = Math.max(0, Math.min(1, c.intensity || 0));
        const warm = t > 0.66 ? "var(--error)" : t > 0.33 ? "var(--warn)" : "var(--node-route)";
        const bg = `color-mix(in srgb, ${warm} ${Math.round(20 + t * 58)}%, var(--bg-elevated))`;
        const on = selKey === c.key;
        const big = c.w > 52 && c.h > 26; const mid = c.w > 36 && c.h > 15;
        return React.createElement("div", { key: c.key, onClick: onPick ? () => onPick(c) : undefined, title: c.title || c.label,
          style: { position: "absolute", left: c.x + 1.5, top: c.y + 1.5, width: Math.max(0, c.w - 3), height: Math.max(0, c.h - 3), background: bg, borderRadius: 4, cursor: onPick ? "pointer" : "default", overflow: "hidden", padding: big ? "5px 7px" : "0 5px", display: "flex", flexDirection: "column", justifyContent: big ? "flex-start" : "center", border: on ? "1.5px solid var(--accent)" : "1px solid rgba(0,0,0,0.26)" } },
          mid && React.createElement("span", { className: "mono", style: { fontSize: big ? 10 : 9, fontWeight: 500, color: t > 0.45 ? "#fff" : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.25 } }, c.label),
          big && c.sub && React.createElement("span", { className: "mono tabular", style: { fontSize: 9, color: t > 0.45 ? "rgba(255,255,255,0.8)" : "var(--text-muted)", marginTop: 1 } }, c.sub));
      }));
  }

  window.Charts = { Sparkline, LineChart, Donut, StackedBars, HBars, Treemap, squarifyLayout };
})();
