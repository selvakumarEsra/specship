/**
 * Graph island (REQ-DASHLEAN-004) — interactive node-link view, no framework.
 *
 * Reads the server-embedded `#graph-data` (so there is no client fetch and no
 * cross-origin concern), runs a small force layout, and draws to canvas with
 * pan (drag), zoom (wheel) and hover tooltips. This is the "island" the SSR
 * page needs; every other page renders without it.
 */
const el = document.getElementById('graph-data');
const canvas = document.getElementById('graph-canvas');
const tip = document.getElementById('graph-tip');
if (el && canvas) {
  const { nodes, edges } = JSON.parse(el.textContent || '{"nodes":[],"edges":[]}');
  const ctx = canvas.getContext('2d');
  const KIND_COLOR = {
    file: '#8b949e', class: '#a371f7', interface: '#79c0ff', function: '#58a6ff',
    method: '#3fb950', spec: '#d2a8ff', route: '#f0883e', struct: '#a371f7',
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // seed positions on a circle (deterministic — no Math.random dependency issues)
  nodes.forEach((n, i) => {
    const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    n.x = Math.cos(a) * 240 + (i % 7) * 6;
    n.y = Math.sin(a) * 240 + (i % 5) * 6;
    n.vx = 0; n.vy = 0;
    n.r = Math.min(14, 3 + Math.sqrt(n.degree || 1));
  });
  const links = edges.map((e) => ({ s: byId.get(e.from), t: byId.get(e.to) })).filter((l) => l.s && l.t);

  let view = { k: 1, x: 0, y: 0 };
  const resize = () => { const r = canvas.getBoundingClientRect(); canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio; };
  resize();
  window.addEventListener('resize', () => { resize(); });

  // --- force layout (a fixed number of ticks, then settle) ---
  let ticks = 0;
  function step() {
    const REP = 5200, SPR = 0.02, LEN = 60, DAMP = 0.86, CENTER = 0.012;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy || 0.01;
        const f = REP / d2; const d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      a.vx -= a.x * CENTER; a.vy -= a.y * CENTER;
    }
    for (const l of links) {
      let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - LEN) * SPR; const fx = (dx / d) * f, fy = (dy / d) * f;
      l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy;
    }
    for (const n of nodes) { n.vx *= DAMP; n.vy *= DAMP; n.x += n.vx; n.y += n.vy; }
  }

  function draw() {
    const W = canvas.width, H = canvas.height, dpr = devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 + view.x * dpr, H / 2 + view.y * dpr);
    ctx.scale(view.k * dpr, view.k * dpr);
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    for (const l of links) { ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke(); }
    for (const n of nodes) {
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = KIND_COLOR[n.kind] || '#8b949e'; ctx.fill();
    }
    ctx.restore();
  }

  function frame() {
    if (ticks < 260) { step(); ticks++; }
    draw();
    requestAnimationFrame(frame);
  }
  frame();

  // --- interaction: pan / zoom / hover ---
  let dragging = false, lx = 0, ly = 0;
  canvas.addEventListener('mousedown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; canvas.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { dragging = false; canvas.style.cursor = 'grab'; });
  window.addEventListener('mousemove', (e) => {
    if (dragging) { view.x += e.clientX - lx; view.y += e.clientY - ly; lx = e.clientX; ly = e.clientY; return; }
    // hover
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left - r.width / 2 - view.x) / view.k;
    const my = (e.clientY - r.top - r.height / 2 - view.y) / view.k;
    let hit = null;
    for (const n of nodes) { const dx = n.x - mx, dy = n.y - my; if (dx * dx + dy * dy < (n.r + 4) * (n.r + 4)) { hit = n; break; } }
    if (hit && tip) { tip.textContent = `${hit.name} · ${hit.kind}`; tip.style.left = (e.clientX - r.left) + 'px'; tip.style.top = (e.clientY - r.top) + 'px'; tip.style.opacity = '1'; }
    else if (tip) tip.style.opacity = '0';
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.1 : 0.9;
    view.k = Math.max(0.15, Math.min(4, view.k * f));
  }, { passive: false });
}
