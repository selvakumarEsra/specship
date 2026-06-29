/**
 * Client-side graph layout for the whole-repo Graph view.
 *
 * The design's GraphCanvas renders nodes at given x/y; for the full-graph view
 * we compute those positions here. Three modes mirror the page's segmented
 * control:
 *   - hierarchical — longest-path layering by edge direction (left→right flow)
 *   - force        — Fruchterman–Reingold spring embedding
 *   - anchored     — spec nodes pinned to a column, the rest force-placed
 *
 * Inputs are capped server-side (top-N by degree, ≤400) so the O(n²) force pass
 * stays well under a frame budget. Positions are centred around the origin; the
 * canvas auto-fits whatever range it receives.
 */
export type GraphLayoutMode = 'hierarchical' | 'force' | 'anchored';

export interface LayoutNode { id: string; kind: string; }
export interface LayoutEdge { from: string; to: string; }
export interface LayoutPos { x: number; y: number; }

export function layoutGraph(
  mode: GraphLayoutMode,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, LayoutPos> {
  if (nodes.length === 0) return new Map();
  switch (mode) {
    case 'force': return forceLayout(nodes, edges);
    case 'anchored': return anchoredLayout(nodes, edges);
    default: return hierarchicalLayout(nodes, edges);
  }
}

/** Longest-path layering: x = layer, y = index within layer. Cycle-safe. */
function hierarchicalLayout(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, LayoutPos> {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { out.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of adj) {
    out.get(e.from)!.push(e.to);
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  for (const n of nodes) layer.set(n.id, 0);
  const remaining = new Map(indeg);
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const l = layer.get(id)!;
    for (const to of out.get(id)!) {
      layer.set(to, Math.max(layer.get(to)!, l + 1));
      remaining.set(to, (remaining.get(to) ?? 1) - 1);
      if ((remaining.get(to) ?? 0) <= 0) queue.push(to);
    }
  }

  const MAX_LAYER = 14;
  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = Math.min(layer.get(n.id)!, MAX_LAYER);
    const arr = byLayer.get(l) ?? [];
    arr.push(n.id);
    byLayer.set(l, arr);
  }

  const COL = 210, ROW = 48;
  const pos = new Map<string, LayoutPos>();
  for (const [l, arr] of byLayer) {
    arr.forEach((id, i) => {
      pos.set(id, { x: l * COL, y: (i - (arr.length - 1) / 2) * ROW });
    });
  }
  return pos;
}

/**
 * Fruchterman–Reingold force layout. Deterministic circular seeding (no RNG) so
 * the same graph lays out identically across re-renders. `fixed` ids keep their
 * seeded position (used by anchored mode).
 */
function forceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  fixed?: Set<string>,
  anchors?: Map<string, LayoutPos>,
): Map<string, LayoutPos> {
  const n = nodes.length;
  const R = Math.max(220, n * 9);
  const pos = new Map<string, LayoutPos>();
  nodes.forEach((node, i) => {
    const a = anchors?.get(node.id);
    if (a) { pos.set(node.id, { x: a.x, y: a.y }); return; }
    const angle = (i / n) * Math.PI * 2;
    // golden-ratio radius spread so seeds don't all sit on one ring
    const r = R * (0.35 + 0.65 * ((i * 0.6180339887) % 1));
    pos.set(node.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  });

  const ids = new Set(nodes.map((node) => node.id));
  const adj = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const k = R / Math.sqrt(n);
  let temp = R / 2;
  const ITERS = 120;

  for (let it = 0; it < ITERS; it++) {
    const disp = new Map<string, LayoutPos>();
    for (const node of nodes) disp.set(node.id, { x: 0, y: 0 });

    // repulsion (all pairs)
    for (let i = 0; i < n; i++) {
      const pa = pos.get(nodes[i].id)!;
      const da = disp.get(nodes[i].id)!;
      for (let j = i + 1; j < n; j++) {
        const pb = pos.get(nodes[j].id)!;
        let dx = pa.x - pb.x, dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const rep = (k * k) / dist;
        const ux = dx / dist, uy = dy / dist;
        da.x += ux * rep; da.y += uy * rep;
        const db = disp.get(nodes[j].id)!;
        db.x -= ux * rep; db.y -= uy * rep;
      }
    }

    // attraction (along edges)
    for (const e of adj) {
      const pa = pos.get(e.from)!, pb = pos.get(e.to)!;
      let dx = pa.x - pb.x, dy = pa.y - pb.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const att = (dist * dist) / k;
      const ux = dx / dist, uy = dy / dist;
      const da = disp.get(e.from)!, db = disp.get(e.to)!;
      da.x -= ux * att; da.y -= uy * att;
      db.x += ux * att; db.y += uy * att;
    }

    // apply, capped by temperature; fixed nodes stay put
    for (const node of nodes) {
      if (fixed?.has(node.id)) continue;
      const d = disp.get(node.id)!;
      const dl = Math.hypot(d.x, d.y) || 0.01;
      const p = pos.get(node.id)!;
      p.x += (d.x / dl) * Math.min(dl, temp);
      p.y += (d.y / dl) * Math.min(dl, temp);
    }
    temp *= 0.95;
  }
  return pos;
}

/** Spec nodes pinned to a left column; everything else force-placed around them. */
function anchoredLayout(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, LayoutPos> {
  const specs = nodes.filter((n) => n.kind === 'spec');
  if (specs.length === 0) return forceLayout(nodes, edges);
  const anchorX = -Math.max(340, nodes.length * 5);
  const anchors = new Map<string, LayoutPos>();
  specs.forEach((n, i) => anchors.set(n.id, { x: anchorX, y: (i - (specs.length - 1) / 2) * 64 }));
  const fixed = new Set(specs.map((n) => n.id));
  return forceLayout(nodes, edges, fixed, anchors);
}
