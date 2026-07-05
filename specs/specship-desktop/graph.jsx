/* Graph canvas — pan/zoom/drag, node variants, directed edges. window.GraphCanvas */
(function () {
  const { useState, useRef, useEffect, useCallback } = React;
  const Icon = window.Icon;
  const nodeColor = window.UI.nodeColor;

  function GraphCanvas({ nodes: initialNodes, edges, selectedId, onSelect, hiddenIds, height = "100%", interactive = true, padding = 80, fitKey, dotGrid = true }) {
    const [nodes, setNodes] = useState(initialNodes);
    const [view, setView] = useState({ tx: 0, ty: 0, k: 1 });
    const [hover, setHover] = useState(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const wrapRef = useRef(null);
    const drag = useRef(null);
    const fitted = useRef(false);

    useEffect(() => {
      const el = wrapRef.current; if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver((es) => setSize({ w: es[0].contentRect.width, h: es[0].contentRect.height }));
      ro.observe(el); return () => ro.disconnect();
    }, []);

    useEffect(() => { setNodes(initialNodes); fitted.current = false; }, [initialNodes]);

    // Fit to view on mount / fitKey change
    const fitView = useCallback(() => {
      const el = wrapRef.current; if (!el || !nodes.length) return;
      const W = el.clientWidth, H = el.clientHeight;
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 140;
      const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 80;
      const gw = maxX - minX, gh = maxY - minY;
      const k = Math.min(W / gw, H / gh, 1.4) * 0.92;
      setView({ k, tx: (W - gw * k) / 2 - minX * k, ty: (H - gh * k) / 2 - minY * k });
    }, [nodes]);

    useEffect(() => { if (!fitted.current && wrapRef.current) { fitView(); fitted.current = true; } }, [nodes, fitView]);
    useEffect(() => { if (fitKey !== undefined) fitView(); }, [fitKey]);

    // Wheel zoom toward cursor
    const onWheel = (e) => {
      if (!interactive) return;
      e.preventDefault();
      const el = wrapRef.current.getBoundingClientRect();
      const mx = e.clientX - el.left, my = e.clientY - el.top;
      const delta = -e.deltaY * 0.0016;
      setView((v) => {
        const k = Math.min(2.4, Math.max(0.25, v.k * (1 + delta)));
        const ratio = k / v.k;
        return { k, tx: mx - (mx - v.tx) * ratio, ty: my - (my - v.ty) * ratio };
      });
    };

    const startPan = (e) => {
      if (!interactive) return;
      if (e.target.closest("[data-node]")) return;
      drag.current = { type: "pan", sx: e.clientX, sy: e.clientY, ox: view.tx, oy: view.ty };
      e.currentTarget.style.cursor = "grabbing";
    };
    const startNodeDrag = (e, n) => {
      if (!interactive) return;
      e.stopPropagation();
      drag.current = { type: "node", id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
    };
    const onMove = (e) => {
      const d = drag.current; if (!d) return;
      if (d.type === "pan") setView((v) => ({ ...v, tx: d.ox + (e.clientX - d.sx), ty: d.oy + (e.clientY - d.sy) }));
      else {
        const dx = (e.clientX - d.sx) / view.k, dy = (e.clientY - d.sy) / view.k;
        if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
        setNodes((ns) => ns.map((n) => n.id === d.id ? { ...n, x: d.ox + dx, y: d.oy + dy } : n));
      }
    };
    const endDrag = (e) => {
      const d = drag.current;
      if (d && d.type === "node" && !d.moved) onSelect && onSelect(d.id);
      if (wrapRef.current) wrapRef.current.style.cursor = "grab";
      drag.current = null;
    };

    const nodeMap = {};
    nodes.forEach((n) => (nodeMap[n.id] = n));

    // degree (connection count) for hub sizing
    const degree = {};
    edges.forEach((e) => { degree[e.from] = (degree[e.from] || 0) + 1; degree[e.to] = (degree[e.to] || 0) + 1; });

    // edge relationship type → color (spec links vs tests vs plain calls)
    function edgeColor(a, b) {
      if (a.kind === "spec" || b.kind === "spec") return "var(--node-spec)";
      if (a.kind === "test" || b.kind === "test") return "var(--node-test)";
      return null;
    }

    // Node geometry helpers
    function nodeBox(n) {
      if (n.kind === "route") return { w: 18, h: 18, shape: "dot" };
      const w = Math.max(64, n.label.length * (n.kind === "spec" ? 7.6 : 7.2) + 26);
      return { w, h: 30, shape: n.kind === "spec" ? "rect" : "pill" };
    }
    function anchor(n) { const b = nodeBox(n); return { cx: n.x + b.w / 2, cy: n.y + b.h / 2, b }; }

    const neighborSet = new Set();
    if (selectedId) edges.forEach((e) => { if (e.from === selectedId) neighborSet.add(e.to); if (e.to === selectedId) neighborSet.add(e.from); });

    return React.createElement("div", {
      ref: wrapRef, onWheel, onMouseDown: startPan, onMouseMove: onMove, onMouseUp: endDrag, onMouseLeave: endDrag,
      style: { position: "relative", width: "100%", height, overflow: "hidden", cursor: "grab",
        background: dotGrid ? "var(--bg-canvas-2)" : "transparent",
        backgroundImage: dotGrid ? "radial-gradient(circle, var(--dot-grid) 1px, transparent 1px)" : "none",
        backgroundSize: `${22 * view.k}px ${22 * view.k}px`,
        backgroundPosition: `${view.tx}px ${view.ty}px`, userSelect: "none" },
    },
      // Edges layer
      React.createElement("svg", { width: "100%", height: "100%", style: { position: "absolute", inset: 0, pointerEvents: "none" } },
        React.createElement("defs", null,
          React.createElement("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" },
            React.createElement("path", { d: "M0 0 L10 5 L0 10 z", fill: "rgba(160,170,190,0.5)" })),
          React.createElement("marker", { id: "arrowHi", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
            React.createElement("path", { d: "M0 0 L10 5 L0 10 z", fill: "var(--accent)" }))),
        React.createElement("g", { transform: `translate(${view.tx} ${view.ty}) scale(${view.k})` },
          edges.map((e, i) => {
            const a = nodeMap[e.from], b = nodeMap[e.to]; if (!a || !b) return null;
            const A = anchor(a), B = anchor(b);
            const dimmed = (hiddenIds && (hiddenIds.has(e.from) || hiddenIds.has(e.to)));
            const hot = selectedId && (e.from === selectedId || e.to === selectedId);
            const tcol = edgeColor(a, b);
            const baseStroke = tcol ? `color-mix(in srgb, ${tcol} 62%, transparent)` : "rgba(150,160,180,0.32)";
            // curve
            const mx = (A.cx + B.cx) / 2;
            const d = `M ${A.cx} ${A.cy} C ${mx} ${A.cy}, ${mx} ${B.cy}, ${B.cx} ${B.cy}`;
            return React.createElement("path", { key: i, d, fill: "none",
              stroke: hot ? "var(--accent)" : baseStroke,
              strokeWidth: hot ? 2 : (tcol ? 1.5 : 1.2), opacity: dimmed ? 0.12 : (hot ? 0.95 : 0.72),
              strokeDasharray: e.kind === "synth" ? "5 4" : "none",
              markerEnd: hot ? "url(#arrowHi)" : "url(#arrow)" });
          }))),
      // Nodes layer
      React.createElement("div", { style: { position: "absolute", inset: 0, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})`, transformOrigin: "0 0", pointerEvents: "none" } },
        nodes.map((n) => {
          const b = nodeBox(n);
          const col = nodeColor(n.kind, n.state);
          const dim = hiddenIds && hiddenIds.has(n.id);
          const sel = n.id === selectedId;
          const isNeighbor = neighborSet.has(n.id);
          const hov = hover === n.id;
          const baseOpacity = dim ? 0.2 : (selectedId && !sel && !isNeighbor ? 0.55 : 1);
          const dg = degree[n.id] || 0;
          const nodeScale = 1 + Math.min(0.24, dg * 0.045);
          const common = {
            "data-node": n.id, key: n.id,
            onMouseDown: (e) => startNodeDrag(e, n),
            onMouseEnter: () => setHover(n.id), onMouseLeave: () => setHover(null),
            style: {
              position: "absolute", left: n.x, top: n.y, pointerEvents: "auto", cursor: "pointer",
              opacity: baseOpacity, transition: "opacity 120ms",
            },
          };
          if (b.shape === "dot") {
            return React.createElement("div", common,
              React.createElement("div", { style: { width: 18, height: 18, borderRadius: "50%", background: col, transform: `scale(${nodeScale})`,
                boxShadow: sel ? `0 0 0 4px ${col}44, 0 0 14px ${col}` : (hov ? `0 0 0 3px ${col}33` : `0 0 8px ${col}66`),
                border: "2px solid var(--bg-canvas-2)" } }),
              (hov || sel) && React.createElement("div", { style: labelTip }, n.label));
          }
          const drift = n.kind === "spec" && (n.state === "drifted" || n.state === "broken" || n.state === "orphaned");
          return React.createElement("div", common,
            React.createElement("div", { style: {
              minWidth: b.w, height: b.h, padding: "0 12px", display: "flex", alignItems: "center", gap: 7,
              borderRadius: b.shape === "rect" ? 7 : 999, transform: `scale(${nodeScale})`, transformOrigin: "center",
              background: `color-mix(in srgb, ${col} 16%, var(--bg-panel))`,
              border: `1.5px solid ${sel ? col : (drift ? col : `color-mix(in srgb, ${col} 45%, transparent)`)}`,
              color: "var(--node-text)", fontSize: 12.5, fontWeight: 500, whiteSpace: "nowrap",
              fontFamily: "var(--font-mono)",
              boxShadow: sel ? `0 0 0 4px ${col}33, 0 4px 16px ${col}44` : (hov ? `0 0 0 3px ${col}22` : "0 2px 8px rgba(0,0,0,0.4)"),
            } },
              React.createElement("span", { style: { width: 7, height: 7, borderRadius: b.shape === "rect" ? 2 : "50%", background: col, flexShrink: 0, boxShadow: `0 0 6px ${col}` } }),
              n.label,
              drift && React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: n.state === "drifted" ? "var(--warn)" : "var(--error)", marginLeft: 2 } })),
            hov && React.createElement("div", { style: { ...labelTip, top: -22 } }, n.file || n.sub));
        })),
      // Controls
      interactive && React.createElement("div", { style: { position: "absolute", right: 14, bottom: 14, display: "flex", flexDirection: "column", gap: 6 } },
        React.createElement(ZoomBtn, { icon: "plus", onClick: () => setView((v) => ({ ...v, k: Math.min(2.4, v.k * 1.2) })) }),
        React.createElement(ZoomBtn, { icon: "minus", onClick: () => setView((v) => ({ ...v, k: Math.max(0.25, v.k / 1.2) })) }),
        React.createElement(ZoomBtn, { icon: "maximize", onClick: fitView, title: "Fit" })),
      interactive && React.createElement("div", { style: { position: "absolute", left: 14, bottom: 14, display: "flex", flexDirection: "column", gap: 6 } },
        React.createElement(Minimap, { nodes, view, size, nodeMap }),
        React.createElement("div", { style: { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)", background: "rgba(0,0,0,0.4)", padding: "2px 7px", borderRadius: 5, alignSelf: "flex-start" } }, Math.round(view.k * 100) + "%")));
  }

  function Minimap({ nodes, view, size, nodeMap }) {
    if (!nodes.length) return null;
    const MW = 138, MH = 88, pad = 6;
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - 30, maxX = Math.max(...xs) + 120;
    const minY = Math.min(...ys) - 20, maxY = Math.max(...ys) + 50;
    const gw = maxX - minX || 1, gh = maxY - minY || 1;
    const s = Math.min((MW - pad * 2) / gw, (MH - pad * 2) / gh);
    const ox = pad + ((MW - pad * 2) - gw * s) / 2, oy = pad + ((MH - pad * 2) - gh * s) / 2;
    const mx = (x) => ox + (x - minX) * s, my = (y) => oy + (y - minY) * s;
    // viewport rect in graph coords
    const vx0 = (-view.tx) / view.k, vy0 = (-view.ty) / view.k;
    const vw = size.w / view.k, vh = size.h / view.k;
    return React.createElement("svg", { width: MW, height: MH, style: { background: "color-mix(in srgb, var(--bg-canvas-2) 92%, transparent)", border: "1px solid var(--border-subtle)", borderRadius: 7, boxShadow: "0 4px 12px rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" } },
      nodes.map((n) => React.createElement("circle", { key: n.id, cx: mx(n.x), cy: my(n.y), r: n.kind === "route" ? 1.6 : 2.1, fill: nodeColor(n.kind, n.state), opacity: 0.9 })),
      size.w > 0 && React.createElement("rect", { x: Math.max(0, mx(vx0)), y: Math.max(0, my(vy0)), width: Math.min(MW, vw * s), height: Math.min(MH, vh * s), fill: "var(--accent)", fillOpacity: 0.12, stroke: "var(--accent)", strokeWidth: 1, rx: 2 }));
  }

  const labelTip = { position: "absolute", top: 34, left: "50%", transform: "translateX(-50%)", background: "var(--bg-elevated)", border: "1px solid var(--border-strong)", borderRadius: 5, padding: "3px 7px", fontSize: 10.5, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "var(--shadow-pop)", zIndex: 5 };

  function ZoomBtn({ icon, onClick, title }) {
    return React.createElement("button", { onClick, title, className: "btn btn-secondary",
      style: { width: 30, height: 30, padding: 0, justifyContent: "center", borderRadius: 7 } },
      React.createElement(Icon, { name: icon, size: 15 }));
  }

  window.GraphCanvas = GraphCanvas;
})();
