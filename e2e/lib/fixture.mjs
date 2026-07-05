/**
 * Build a hermetic fixture for the dashboard e2e:
 *   1. a tiny indexed source tree  → graph nodes/edges (specship init + index)
 *   2. seeded Claude transcript JSONL under a fake $HOME → cost/tool-call/heatmap analytics
 *
 * Nothing here touches the developer's real project or ~/.claude — the fake
 * $HOME + a temp project dir keep the run reproducible in CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, WORK, FIXTURE, HOME_DIR } from './paths.mjs';

const SRC_ORDERS = `// Fixture source — enough symbols/edges for a non-empty graph.
export interface Order {
  id: string;
  total: number;
}

export function createOrder(id: string, total: number): Order {
  return { id, total: normalizeTotal(total) };
}

export function normalizeTotal(total: number): number {
  return Math.max(0, Math.round(total * 100) / 100);
}
`;

// A tiny spec so the dashboard's Specs page has real content to render
// read-only (the REQ-DASHLEAN-003 e2e selects a spec and asserts no editor).
const SPEC_ORDERS = `---
id: ORDERS-DOC
title: Orders
owner: fixture
priority: medium
---

<!-- id: ORDERS-DOC -->
# Orders

Fixture spec so the Specs page has content to render read-only.

<!-- id: REQ-ORDERS-001 -->
## Order totals MUST be normalized to non-negative cents

\`createOrder\` normalizes the total before storing it.

implementations:
  - src/orders.ts:createOrder

## Acceptance
<!-- id: REQ-ORDERS-001.A1 -->
- A negative total is clamped to zero.
<!-- id: REQ-ORDERS-001.A2 -->
- A fractional total is rounded to two decimal places.
`;

const SRC_SERVICE = `import { createOrder, Order } from './orders';

export class OrderService {
  private orders: Order[] = [];

  place(id: string, total: number): Order {
    const order = createOrder(id, total);
    this.orders.push(order);
    return order;
  }

  sum(): number {
    return this.orders.reduce((acc, o) => acc + o.total, 0);
  }
}
`;

/** Init + index the fixture via the built library (no interactive CLI prompts). */
async function indexFixture() {
  const mod = await import(pathToFileURL(path.join(REPO_ROOT, 'dist', 'index.js')).href);
  const SpecShip = mod.SpecShip ?? mod.default?.SpecShip ?? mod.default;
  const cg = await SpecShip.init(FIXTURE, { index: false });
  const result = await cg.indexAll();
  if (typeof cg.destroy === 'function') cg.destroy();
  else if (typeof cg.close === 'function') cg.close();
  if (!result || (result.nodesCreated ?? result.nodes ?? 0) === 0) {
    // Not fatal on shape mismatch, but a zero-node index means nothing renders.
    console.warn('[e2e fixture] index produced no nodes:', JSON.stringify(result));
  }
}

/** Encode an absolute path the way Claude Code names its transcript dirs. */
function encodeSlug(absPath) {
  return absPath.replace(/\//g, '-');
}

function seedTranscripts() {
  const slug = encodeSlug(FIXTURE);
  const dir = path.join(HOME_DIR, '.claude', 'projects', slug);
  fs.mkdirSync(dir, { recursive: true });

  const lines = [];
  const model = 'claude-sonnet-4-6';
  // Three sessions, a couple of prompts each, so cost/tool-call/heatmap KPIs
  // all have something to render.
  for (let s = 1; s <= 3; s++) {
    const sessionId = `e2e-sess-${s}`;
    for (let p = 1; p <= 3; p++) {
      const promptId = `p-${s}-${p}`;
      // Relative to now (session s is 4-s days old) — the sessions API's
      // default range is `week`, so fixed dates would age out of the window.
      const base = Date.now() - (4 - s) * 24 * 3600_000 + p * 3600_000;
      const iso = (offsetSec) => new Date(base + offsetSec * 1000).toISOString();
      // user prompt
      lines.push(JSON.stringify({
        type: 'user', sessionId, uuid: `u-${s}-${p}`, promptId,
        timestamp: iso(0), cwd: FIXTURE,
        message: { content: `How does createOrder handle prompt ${p}?` },
      }));
      // assistant turn 1 — a tool_use (Read) with usage
      lines.push(JSON.stringify({
        type: 'assistant', sessionId, uuid: `a-${s}-${p}-1`, timestamp: iso(4),
        message: {
          model,
          usage: { input_tokens: 1500, output_tokens: 600, cache_read_input_tokens: 8000 },
          content: [{ type: 'tool_use', id: `t-${s}-${p}`, name: 'Read', input: { file_path: 'src/orders.ts' } }],
        },
      }));
      // user follow-up carrying the tool_result (same promptId)
      lines.push(JSON.stringify({
        type: 'user', sessionId, uuid: `u-${s}-${p}-r`, promptId, timestamp: iso(5),
        message: { content: [{ type: 'tool_result', tool_use_id: `t-${s}-${p}`, content: SRC_ORDERS }] },
      }));
      // assistant turn 2 — final text with usage
      lines.push(JSON.stringify({
        type: 'assistant', sessionId, uuid: `a-${s}-${p}-2`, timestamp: iso(9),
        message: {
          model,
          usage: { input_tokens: 400, output_tokens: 500 },
          content: [{ type: 'text', text: 'createOrder normalizes the total then returns an Order.' }],
        },
      }));
    }
    fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n');
    lines.length = 0;
  }
}

/** Wipe + rebuild the whole hermetic fixture. Returns the env to spawn serve with. */
export async function buildFixture() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(path.join(FIXTURE, 'src'), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'src', 'orders.ts'), SRC_ORDERS);
  fs.writeFileSync(path.join(FIXTURE, 'src', 'service.ts'), SRC_SERVICE);
  fs.mkdirSync(path.join(FIXTURE, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE, 'specs', 'orders.md'), SPEC_ORDERS);
  fs.mkdirSync(HOME_DIR, { recursive: true });

  await indexFixture();
  seedTranscripts();
  return { ...process.env, HOME: HOME_DIR, USERPROFILE: HOME_DIR };
}
