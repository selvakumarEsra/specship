/**
 * First-run starter-prompt generation (ACTIVATION-DOC).
 *
 * Manufactures one perceivable retrieval moment: a concrete flow/impact question
 * naming real symbols from THIS repo, derived from a flow verified to connect in
 * the graph. A botched first impression is worse than none, so generation never
 * emits a flow whose endpoints don't connect and never sources a flow from a
 * god-file's fan-out; when no good flow exists it falls back to an impact
 * question (which needs only one real symbol and can't fail to connect).
 *
 * Graph access is behind `GraphProbe` so the selection policy is unit-testable;
 * `generateStarterPrompt` wires the real probe over a live `SpecShip` graph.
 */

import type { SpecShip } from '../index';
import type { Node } from '../types';

export interface StarterPrompt {
  kind: 'flow' | 'impact';
  /** The ready-to-ask prompt naming real symbols. */
  prompt: string;
  from: string;
  to?: string;
}

export interface GraphProbe {
  /** Entry points worth tracing from (routes / high-fan-in), god-files excluded. */
  entryCandidates(): Array<{ name: string; file: string }>;
  /** Trace an entry to a reachable leaf; null if it reaches nothing useful. */
  traceFlow(entry: { name: string; file: string }): {
    to: string;
    hops: number;
    files: string[];
    synthesized: boolean;
  } | null;
  /** Highest-fan-in non-god-file symbol, for the impact fallback. */
  topFanInSymbol(): { name: string; file: string } | null;
}

/**
 * Choose the starter prompt. Pure: a flow across ≥2 files over a multi-hop path
 * wins; otherwise an impact question on the busiest symbol; otherwise null.
 */
export function selectStarterPrompt(probe: GraphProbe): StarterPrompt | null {
  for (const entry of probe.entryCandidates()) {
    const flow = probe.traceFlow(entry);
    if (flow && flow.files.length >= 2 && flow.hops >= 2) {
      return {
        kind: 'flow',
        from: entry.name,
        to: flow.to,
        prompt: `How does \`${entry.name}\` reach \`${flow.to}\`?`,
      };
    }
  }
  const top = probe.topFanInSymbol();
  if (top) {
    return { kind: 'impact', from: top.name, prompt: `What breaks if I change \`${top.name}\`?` };
  }
  return null;
}

/**
 * Generic names that are usually name-collision artifacts (e.g. a prepared
 * statement's `all`, an object's `set`) — they make a dumb starter prompt, so
 * they're never chosen as an endpoint. (Human-facing precision bar.)
 */
const NOISE_NAMES = new Set([
  'all', 'get', 'set', 'now', 'find', 'sort', 'map', 'run', 'init', 'close', 'open',
  'next', 'then', 'add', 'has', 'key', 'value', 'data', 'result', 'handle', 'exec',
  'call', 'apply', 'tostring', 'valueof', 'constructor', 'default', 'index', 'main',
  // Generic accessor/field-ish names that read poorly as a flow endpoint.
  'code', 'error', 'message', 'name', 'id', 'type', 'kind', 'status', 'body', 'path',
  'url', 'text', 'log', 'length', 'size', 'count', 'item', 'items', 'args', 'opts',
  'options', 'params', 'ctx', 'req', 'res', 'err', 'val', 'obj', 'fn', 'cb',
]);

/** A short or generic name that would make an unconvincing starter prompt. */
export function isNoiseName(name: string): boolean {
  return name.length <= 2 || NOISE_NAMES.has(name.toLowerCase());
}

/** Test/fixture/build files — never the source or sink of the manufactured moment. */
export function isUninterestingFile(file: string): boolean {
  return (
    /(^|\/)(__tests__|tests?|spec|fixtures?|examples?|node_modules|dist|build)(\/|$)/i.test(file) ||
    /\.(test|spec)\.[a-z]+$/i.test(file)
  );
}

/** Edge kinds that represent a call-like flow worth tracing. */
const FLOW_EDGE_KINDS = new Set(['calls', 'references', 'instantiates']);

/**
 * Node kinds a flow should *end* on — a meaningful call/instantiation sink, not a
 * field/property/variable access (which makes a vague "reach `code`" prompt).
 */
const SINK_KINDS = new Set(['function', 'method', 'class', 'route']);
const MAX_HOPS = 6;
const MAX_NODES_EXPLORED = 4000;
const MAX_ENTRY_CANDIDATES = 40;

/** Build a `GraphProbe` over a live SpecShip graph. */
export function realProbe(cg: SpecShip): GraphProbe {
  const godFiles = new Set(cg.getMaintainability().godFiles.map((g) => g.filePath));
  // A worthwhile endpoint: not in a god-file, not a test/fixture/build file, and
  // not a generic noise name.
  const worthwhile = (n: Node) => !godFiles.has(n.filePath) && !isUninterestingFile(n.filePath) && !isNoiseName(n.name);
  const fanIn = (id: string) => cg.getIncomingEdges(id).length;

  return {
    entryCandidates() {
      // Routes keep their `GET /path` names (not noise), but still skip fixtures.
      const routes = cg.getNodesByKind('route').filter((n) => !godFiles.has(n.filePath) && !isUninterestingFile(n.filePath));
      const fns = [...cg.getNodesByKind('function'), ...cg.getNodesByKind('method')]
        .filter(worthwhile)
        .sort((a, b) => fanIn(b.id) - fanIn(a.id));
      return [...routes, ...fns]
        .slice(0, MAX_ENTRY_CANDIDATES)
        .map((n) => ({ name: n.name, file: n.filePath, id: n.id })) as Array<{
        name: string;
        file: string;
      }>;
    },

    traceFlow(entry) {
      const start = cg.getNodesByName(entry.name).find((n) => n.filePath === entry.file);
      if (!start) return null;
      const visited = new Set<string>([start.id]);
      let explored = 0;
      let best: { to: string; hops: number; files: string[]; synthesized: boolean } | null = null;
      let bestScore = -1;
      // Prefer a richer flow: a synthesized (dynamic-dispatch) hop dominates,
      // then more hops, then more files — a deeper path shows off more of the
      // system than the first shallow utility call near the handler.
      const score = (synth: boolean, hops: number, files: number) =>
        (synth ? 1000 : 0) + hops * 10 + files;
      let frontier: Array<{ id: string; depth: number; files: Set<string>; synthesized: boolean }> = [
        { id: start.id, depth: 0, files: new Set([start.filePath]), synthesized: false },
      ];

      while (frontier.length && explored < MAX_NODES_EXPLORED) {
        const next: typeof frontier = [];
        for (const cur of frontier) {
          if (cur.depth >= MAX_HOPS) continue;
          for (const edge of cg.getOutgoingEdges(cur.id)) {
            if (!FLOW_EDGE_KINDS.has(edge.kind)) continue;
            if (visited.has(edge.target)) continue;
            visited.add(edge.target);
            explored++;
            const target = cg.getNode(edge.target);
            if (!target) continue;
            const files = new Set(cur.files);
            files.add(target.filePath);
            const synthesized = cur.synthesized || edge.provenance === 'heuristic';
            const depth = cur.depth + 1;
            // Only end on a worthwhile, callable leaf (not noise / test /
            // god-file, and a function/method/class — not a field access) so the
            // prompt names a meaningful sink.
            if (files.size >= 2 && depth >= 2 && SINK_KINDS.has(target.kind) && worthwhile(target)) {
              const s = score(synthesized, depth, files.size);
              if (s > bestScore) {
                bestScore = s;
                best = { to: target.name, hops: depth, files: [...files], synthesized };
              }
            }
            next.push({ id: target.id, depth, files, synthesized });
          }
        }
        frontier = next;
      }
      return best;
    },

    topFanInSymbol() {
      const candidates = [...cg.getNodesByKind('function'), ...cg.getNodesByKind('method')].filter(worthwhile);
      let best: Node | null = null;
      let bestFanIn = 0;
      for (const n of candidates) {
        const f = fanIn(n.id);
        if (f > bestFanIn) {
          bestFanIn = f;
          best = n;
        }
      }
      return best ? { name: best.name, file: best.filePath } : null;
    },
  };
}

/** Generate the starter prompt for a live project, or null if none fits. */
export function generateStarterPrompt(cg: SpecShip): StarterPrompt | null {
  return selectStarterPrompt(realProbe(cg));
}
