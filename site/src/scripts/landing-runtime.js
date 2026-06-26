(function () {
  /* ---- nav scrolled state ---- */
  var nav = document.getElementById('nav');
  var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 10); };
  onScroll(); window.addEventListener('scroll', onScroll, { passive: true });

  /* ---- copy buttons ---- */
  document.querySelectorAll('[data-copy]').forEach(function (el) {
    el.addEventListener('click', function () {
      var t = el.getAttribute('data-copy');
      navigator.clipboard && navigator.clipboard.writeText(t);
      var old = el.innerHTML;
      el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#46C26B" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(function () { el.innerHTML = old; }, 1300);
    });
  });

  /* ---- scroll reveal ---- */
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal:not(.in)').forEach(function (el) { io.observe(el); });

  /* ---- count-up stats ---- */
  var counted = new WeakSet();
  var statIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting || counted.has(e.target)) return;
      counted.add(e.target);
      var el = e.target, target = parseFloat(el.getAttribute('data-count'));
      var raw = el.textContent, suffix = /×/.test(raw) ? '×' : /%/.test(raw) ? '%' : '';
      var hasComma = /,/.test(raw), t0 = performance.now(), dur = 1100;
      function tick(now) {
        var p = Math.min(1, (now - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
        var v = Math.round(target * eased);
        el.textContent = (hasComma ? v.toLocaleString('en-US') : v) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-count]').forEach(function (el) { statIO.observe(el); });

  /* ---- sparkline path ---- */
  (function () {
    var line = document.getElementById('sparkLine'), area = document.getElementById('sparkArea');
    if (!line) return;
    var data = [4.2,5.1,3.8,6.0,11.4,7.2,5.5,4.1,6.8,5.0,3.6,9.8,6.2,4.4,5.9,7.1,4.8,3.9,6.4,8.2,5.3,4.0,6.7,5.5,4.2,7.4,5.1,3.8,6.0,5.7];
    var W = 320, H = 52, pad = 4, max = Math.max.apply(null, data), min = Math.min.apply(null, data);
    var pts = data.map(function (d, i) {
      var x = pad + (i / (data.length - 1)) * (W - pad * 2);
      var y = H - pad - ((d - min) / (max - min)) * (H - pad * 2);
      return [x, y];
    });
    var dStr = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    line.setAttribute('d', dStr);
    area.setAttribute('d', dStr + ' L' + (W - pad) + ' ' + H + ' L' + pad + ' ' + H + ' Z');
  })();

  /* ---- graph builder (hero + showcase) ---- */
  var NODE_COLORS = { code: '#A586F5', spec: '#5B93F2', test: '#46C26B', route: '#29D2BE' };

  function buildGraph(svg, opts) {
    var nodes = opts.nodes, edges = opts.edges, NS = 'http://www.w3.org/2000/svg';
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var animate = opts.animate !== false && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // edges first
    edges.forEach(function (e, i) {
      var a = byId[e.from], b = byId[e.to];
      var p = document.createElementNS(NS, 'path');
      var d = 'M' + a.x + ' ' + a.y + ' L' + b.x + ' ' + b.y;
      p.setAttribute('d', d);
      p.setAttribute('class', 'g-edge' + (e.synth ? ' synth' : ''));
      if (e.drift) p.setAttribute('stroke', '#E5A50A'), p.setAttribute('stroke-opacity', '0.8');
      svg.appendChild(p);
      if (animate) {
        var len = Math.hypot(b.x - a.x, b.y - a.y);
        p.style.strokeDasharray = e.synth ? '4 4' : len;
        if (!e.synth) {
          p.style.strokeDashoffset = len;
          p.style.animation = 'drawEdge .55s ease forwards';
          p.style.animationDelay = (0.15 + i * 0.05) + 's';
        }
      }
    });

    // nodes
    nodes.forEach(function (n, i) {
      var g = document.createElementNS(NS, 'g');
      var col = NODE_COLORS[n.type];
      var r = n.lead ? 11 : (n.type === 'spec' ? 9 : 8);

      // halo
      var halo = document.createElementNS(NS, 'circle');
      halo.setAttribute('cx', n.x); halo.setAttribute('cy', n.y); halo.setAttribute('r', r + 5);
      halo.setAttribute('fill', col); halo.setAttribute('opacity', '0.12');
      g.appendChild(halo);

      // drift ring (pulsing)
      if (n.drift) {
        var ring = document.createElementNS(NS, 'circle');
        ring.setAttribute('cx', n.x); ring.setAttribute('cy', n.y); ring.setAttribute('r', r);
        ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#E5A50A'); ring.setAttribute('stroke-width', '1.5');
        if (animate) ring.style.animation = 'ringPulse 1.9s ease-out infinite';
        g.appendChild(ring);
      }

      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', n.x); c.setAttribute('cy', n.y); c.setAttribute('r', r);
      c.setAttribute('fill', col);
      if (n.drift) c.setAttribute('stroke', '#E5A50A'), c.setAttribute('stroke-width', '1.5');
      c.setAttribute('class', 'node-float');
      g.appendChild(c);

      // inner dot for spec nodes (ring look)
      if (n.type === 'spec') {
        var inner = document.createElementNS(NS, 'circle');
        inner.setAttribute('cx', n.x); inner.setAttribute('cy', n.y); inner.setAttribute('r', r - 4);
        inner.setAttribute('fill', 'var(--bg-panel)');
        g.appendChild(inner);
      }

      // label
      if (n.label) {
        var tx = document.createElementNS(NS, 'text');
        tx.setAttribute('x', n.x + (n.lx || 0)); tx.setAttribute('y', n.y + (n.ly != null ? n.ly : (r + 15)));
        tx.setAttribute('text-anchor', n.anchor || 'middle');
        tx.setAttribute('class', 'g-node-label');
        if (n.type === 'spec') tx.setAttribute('fill', col);
        tx.textContent = n.label;
        g.appendChild(tx);
      }

      if (animate) {
        c.style.transformBox = 'fill-box'; c.style.transformOrigin = 'center';
        c.style.animation = 'popNode .5s cubic-bezier(.34,1.56,.64,1) both, floaty ' + (3.2 + (i % 4) * 0.5) + 's ease-in-out ' + (0.6 + i * 0.08) + 's infinite';
        c.style.animationDelay = (0.2 + i * 0.06) + 's';
        g.style.opacity = '0';
        g.style.animation = 'fadeIn .4s ease forwards';
        g.style.animationDelay = (0.2 + i * 0.06) + 's';
      }
      svg.appendChild(g);
    });
  }

  var heroNodes = [
    { id: 'route', type: 'route', x: 70, y: 250, label: '/explore', ly: 22 },
    { id: 'explore', type: 'code', x: 205, y: 165, label: 'exploreGraph', ly: -16 },
    { id: 'layout', type: 'code', x: 360, y: 110, label: 'applyLayout', ly: -16 },
    { id: 'gspec', type: 'spec', x: 480, y: 70, label: 'REQ-GRAPH-002', ly: -16 },
    { id: 'db', type: 'code', x: 250, y: 300, label: 'SqliteStore', ly: 22 },
    { id: 'auth', type: 'code', x: 400, y: 245, label: 'validateSession', ly: -15 },
    { id: 'expiry', type: 'code', x: 470, y: 350, label: 'checkExpiry', ly: 22 },
    { id: 'aspec', type: 'spec', x: 300, y: 410, label: 'REQ-AUTH-005', ly: 22, drift: true },
    { id: 'atest', type: 'test', x: 150, y: 390, label: 'auth.test', ly: 22 }
  ];
  var heroEdges = [
    { from: 'route', to: 'explore' }, { from: 'explore', to: 'layout' },
    { from: 'layout', to: 'gspec' }, { from: 'explore', to: 'db' },
    { from: 'db', to: 'auth', synth: true }, { from: 'auth', to: 'expiry' },
    { from: 'expiry', to: 'aspec', drift: true }, { from: 'auth', to: 'atest' },
    { from: 'db', to: 'atest', synth: true }
  ];
  var heroSvg = document.getElementById('heroGraph');
  if (heroSvg) buildGraph(heroSvg, { nodes: heroNodes, edges: heroEdges });

  // showcase graph — reveal-triggered
  var showSvg = document.getElementById('showcaseGraph');
  if (showSvg) {
    var showNodes = [
      { id: 'srv', type: 'route', x: 80, y: 90, label: 'MCPServer', ly: -15 },
      { id: 'exp', type: 'code', x: 230, y: 120, label: 'exploreGraph', ly: -15 },
      { id: 'lay', type: 'code', x: 380, y: 70, label: 'applyLayout', ly: -15 },
      { id: 'gsp', type: 'spec', x: 490, y: 130, label: 'REQ-GRAPH-002', ly: 22 },
      { id: 'dbs', type: 'code', x: 250, y: 250, label: 'SqliteStore', ly: 22 },
      { id: 'tst', type: 'test', x: 420, y: 230, label: 'explore.test', ly: 22 },
      { id: 'prc', type: 'code', x: 110, y: 300, label: 'resolveRate', ly: 22 },
      { id: 'psp', type: 'spec', x: 250, y: 360, label: 'REQ-PRICE-001', ly: 22 }
    ];
    var showEdges = [
      { from: 'srv', to: 'exp' }, { from: 'exp', to: 'lay' }, { from: 'lay', to: 'gsp' },
      { from: 'exp', to: 'dbs' }, { from: 'lay', to: 'tst', synth: true }, { from: 'exp', to: 'tst' },
      { from: 'dbs', to: 'prc', synth: true }, { from: 'prc', to: 'psp' }
    ];
    var built = false;
    var showIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !built) { built = true; buildGraph(showSvg, { nodes: showNodes, edges: showEdges }); showIO.disconnect(); }
      });
    }, { threshold: 0.3 });
    showIO.observe(showSvg);
  }
})();
