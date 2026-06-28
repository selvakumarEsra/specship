/**
 * Maintainability harness (REQ-MAINT-001).
 *
 * Derives four maintainability signals from the existing knowledge graph, with
 * NO additional file parse — coupling, size hotspots, dependency cycles, and
 * dead-code candidates. Pure read over `QueryBuilder`; deterministic (every
 * output array is sorted by a stable key), so a re-run on an unchanged index is
 * byte-identical and the report can underpin a future CI gate (REQ-STRATEGY-003).
 *
 * Realizes the first harness-engineering expansion lane (REQ-STRATEGY-001).
 */

import * as fs from 'fs';
import * as path from 'path';
import picomatch from 'picomatch';
import { QueryBuilder } from '../db/queries';
import { Edge, Node, NodeKind } from '../types';

/** Flag thresholds. Defaults work out of the box; a project may override (REQ-MAINT-002). */
export interface MaintainabilityThresholds {
  /** A symbol/file with fan-in or fan-out ≥ this is a coupling hotspot. */
  highDegree: number;
  /** A symbol whose line span ≥ this is oversized. */
  largeSymbolLines: number;
  /** A file with ≥ this many defined symbols is a god-file. */
  godFileSymbols: number;
}

export const DEFAULT_THRESHOLDS: MaintainabilityThresholds = {
  highDegree: 20,
  largeSymbolLines: 200,
  godFileSymbols: 40,
};

/**
 * Generated / vendored files excluded from the analysis by default — they aren't
 * source-of-truth, so flagging them is noise (e.g. a bundled `chunk-*.js` shows
 * as a huge coupling hub, a `.d.ts` as dead code). A project may add more via
 * `maintainability.exclude` in specship.config.json. Globs over the
 * project-relative file path.
 */
export const DEFAULT_EXCLUDE: string[] = [
  '**/*.d.ts',
  '**/*.min.js',
  '**/*.map',
  '**/dist/**',
  '**/build/**',
  '**/vendor/**',
  '**/public/web/**',
  '**/chunk-*.js',
];

/** Definable code symbols considered by the size / coupling / dead-code signals. */
const SYMBOL_KINDS: ReadonlySet<NodeKind> = new Set<NodeKind>([
  'function', 'method', 'class', 'struct', 'interface', 'trait', 'protocol', 'enum', 'type_alias',
]);

/**
 * Edge kinds that represent a *use* / dependency (so they count toward coupling
 * and reachability). `contains` (structural parent→child) and `exports` are not
 * uses. Heuristic-provenance `calls`/`references` edges ARE uses — which is why a
 * symbol reached only via a synthesized dynamic-dispatch edge is never flagged
 * dead (REQ-MAINT-001.A4).
 */
function isUseEdge(kind: Edge['kind']): boolean {
  return kind !== 'contains' && kind !== 'exports';
}

const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec|_test)\.|_test\.[a-z]+$|\.test\.[a-z]+$|\.spec\.[a-z]+$/i;

export interface CouplingFinding {
  nodeId: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  kind: NodeKind;
  fanIn: number;
  fanOut: number;
  /** Why this surfaced — the threshold it breached (REQ-MAINT-002.A3). */
  reason: string;
}

export interface OversizedFinding {
  nodeId: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  kind: NodeKind;
  startLine: number;
  endLine: number;
  lines: number;
  reason: string;
}

export interface GodFileFinding {
  filePath: string;
  symbolCount: number;
  reason: string;
}

export interface CycleFinding {
  /** Files forming a dependency cycle (sorted). */
  files: string[];
  reason: string;
}

export interface DeadCodeFinding {
  nodeId: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  kind: NodeKind;
  startLine: number;
  reason: string;
}

export interface MaintainabilityReport {
  thresholds: MaintainabilityThresholds;
  coupling: CouplingFinding[];
  oversized: OversizedFinding[];
  godFiles: GodFileFinding[];
  cycles: CycleFinding[];
  deadCode: DeadCodeFinding[];
  /** True when nothing crossed a threshold — an explicit clean result, not empty/ambiguous. */
  clean: boolean;
}

/**
 * Compute the maintainability report from the graph. Pure read — never writes.
 */
export function computeMaintainability(
  queries: QueryBuilder,
  thresholds: MaintainabilityThresholds = DEFAULT_THRESHOLDS,
  exclude: string[] = DEFAULT_EXCLUDE,
): MaintainabilityReport {
  // Scope analysis to source files — drop generated/vendored ones up front so
  // they never appear as findings and never inflate a kept node's degree.
  const isExcluded = exclude.length
    ? picomatch(exclude, { dot: true })
    : () => false;
  const nodes = queries.getAllNodes().filter((n) => !isExcluded(n.filePath));
  const byId = new Map<string, Node>(nodes.map((n) => [n.id, n]));

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  // file → set of files it imports (for cycle detection)
  const fileImports = new Map<string, Set<string>>();

  for (const n of nodes) {
    const out = queries.getOutgoingEdges(n.id);
    for (const e of out) {
      if (!byId.has(e.target)) continue; // edge to an excluded/missing node — ignore
      if (isUseEdge(e.kind)) {
        fanOut.set(e.source, (fanOut.get(e.source) ?? 0) + 1);
        fanIn.set(e.target, (fanIn.get(e.target) ?? 0) + 1);
      }
      if (e.kind === 'imports') {
        const srcFile = n.filePath;
        const tgtFile = byId.get(e.target)?.filePath;
        if (srcFile && tgtFile && srcFile !== tgtFile) {
          let set = fileImports.get(srcFile);
          if (!set) { set = new Set<string>(); fileImports.set(srcFile, set); }
          set.add(tgtFile);
        }
      }
    }
  }

  // --- coupling + size + dead-code (per symbol) ---
  const coupling: CouplingFinding[] = [];
  const oversized: OversizedFinding[] = [];
  const deadCode: DeadCodeFinding[] = [];
  const symbolsPerFile = new Map<string, number>();

  for (const n of nodes) {
    if (!SYMBOL_KINDS.has(n.kind)) continue;
    symbolsPerFile.set(n.filePath, (symbolsPerFile.get(n.filePath) ?? 0) + 1);

    const fi = fanIn.get(n.id) ?? 0;
    const fo = fanOut.get(n.id) ?? 0;
    if (fi >= thresholds.highDegree || fo >= thresholds.highDegree) {
      coupling.push({
        nodeId: n.id, name: n.name, qualifiedName: n.qualifiedName, filePath: n.filePath, kind: n.kind, fanIn: fi, fanOut: fo,
        reason: `fan-in ${fi} / fan-out ${fo} (threshold ≥ ${thresholds.highDegree})`,
      });
    }

    const lines = Math.max(0, (n.endLine ?? 0) - (n.startLine ?? 0));
    if (lines >= thresholds.largeSymbolLines) {
      oversized.push({
        nodeId: n.id, name: n.name, qualifiedName: n.qualifiedName, filePath: n.filePath, kind: n.kind, startLine: n.startLine ?? 0, endLine: n.endLine ?? 0, lines,
        reason: `${lines} lines (threshold ≥ ${thresholds.largeSymbolLines})`,
      });
    }

    // dead-code: no use-edges in, not part of the public surface, not a test fixture
    if (fi === 0 && !n.isExported && !TEST_FILE.test(n.filePath)) {
      deadCode.push({
        nodeId: n.id, name: n.name, qualifiedName: n.qualifiedName, filePath: n.filePath, kind: n.kind, startLine: n.startLine ?? 0,
        reason: 'no incoming use-edges; not exported',
      });
    }
  }

  // --- god files ---
  const godFiles: GodFileFinding[] = [];
  for (const [filePath, count] of symbolsPerFile) {
    if (count >= thresholds.godFileSymbols) {
      godFiles.push({ filePath, symbolCount: count, reason: `${count} symbols (threshold ≥ ${thresholds.godFileSymbols})` });
    }
  }

  // --- dependency cycles (Tarjan SCC over the file-import graph) ---
  const cycles = findCycles(fileImports);

  // deterministic ordering
  coupling.sort((a, b) => (b.fanIn + b.fanOut) - (a.fanIn + a.fanOut) || cmp(a.nodeId, b.nodeId));
  oversized.sort((a, b) => b.lines - a.lines || cmp(a.nodeId, b.nodeId));
  godFiles.sort((a, b) => b.symbolCount - a.symbolCount || cmp(a.filePath, b.filePath));
  deadCode.sort((a, b) => cmp(a.filePath, b.filePath) || a.startLine - b.startLine || cmp(a.nodeId, b.nodeId));

  const clean = coupling.length === 0 && oversized.length === 0 && godFiles.length === 0 && cycles.length === 0 && deadCode.length === 0;
  return { thresholds, coupling, oversized, godFiles, cycles, deadCode, clean };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// =============================================================================
// Report tiering (HEALTH-GATEWAY-DOC) — which finding classes are trustworthy
// enough for the default human report, and which are lower-confidence opt-ins.
// =============================================================================

/** Finding classes shown by default — demonstrably precise (REQ-HEALTH-001). */
export const HIGH_PRECISION_CLASSES = ['oversized', 'godFiles', 'cycles'] as const;

/**
 * Lower-confidence finding classes — hidden unless explicitly requested
 * (REQ-HEALTH-002). Dead-code is high-volume/heuristic; coupling fan-in is
 * inflated by method-name-collision artifacts.
 */
export const LOW_CONFIDENCE_CLASSES = ['coupling', 'deadCode'] as const;

/**
 * True when no high-precision finding crossed a threshold — the default gateway
 * view is clean even if lower-confidence (dead-code/coupling) findings exist
 * (REQ-HEALTH-001.A3).
 */
export function highPrecisionClean(r: MaintainabilityReport): boolean {
  return r.oversized.length === 0 && r.godFiles.length === 0 && r.cycles.length === 0;
}

/**
 * Tarjan's strongly-connected-components over the file-import graph. Returns
 * every SCC of size > 1 (a genuine import cycle), each as a sorted file list,
 * the whole list sorted for determinism.
 */
function findCycles(graph: Map<string, Set<string>>): CycleFinding[] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  // stable node order so the SCC partition is deterministic
  const order = [...graph.keys()].sort(cmp);

  const strongconnect = (v: string): void => {
    idx.set(v, index); low.set(v, index); index++;
    stack.push(v); onStack.add(v);
    const neighbors = [...(graph.get(v) ?? [])].sort(cmp);
    for (const w of neighbors) {
      if (!idx.has(w)) {
        // w may be an import target with no outgoing edges — still a graph node
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort(cmp));
    }
  };

  for (const v of order) if (!idx.has(v)) strongconnect(v);
  return sccs
    .sort((a, b) => cmp(a[0] ?? '', b[0] ?? ''))
    .map((files) => ({ files, reason: `${files.length} files form an import cycle` }));
}

/** Default name of the checked-in project config file at the project root. */
export const CONFIG_FILE_NAME = 'specship.config.json';

/**
 * Resolve effective thresholds (REQ-MAINT-002): defaults < checked-in
 * `specship.config.json` (`maintainability.thresholds`) < explicit override.
 * A missing or unparseable config silently falls back to defaults.
 */
export function resolveThresholds(
  projectRoot: string,
  override?: Partial<MaintainabilityThresholds>,
): MaintainabilityThresholds {
  let fromConfig: Partial<MaintainabilityThresholds> = {};
  try {
    const raw = fs.readFileSync(path.join(projectRoot, CONFIG_FILE_NAME), 'utf-8');
    const cfg = JSON.parse(raw) as { maintainability?: { thresholds?: Partial<MaintainabilityThresholds> } };
    const t = cfg?.maintainability?.thresholds;
    if (t && typeof t === 'object') {
      for (const k of ['highDegree', 'largeSymbolLines', 'godFileSymbols'] as const) {
        if (typeof t[k] === 'number' && Number.isFinite(t[k])) fromConfig[k] = t[k];
      }
    }
  } catch {
    // no config / unparseable → defaults
  }
  return { ...DEFAULT_THRESHOLDS, ...fromConfig, ...(override ?? {}) };
}

/**
 * Resolve the exclude globs: the built-in DEFAULT_EXCLUDE plus any
 * `maintainability.exclude` array from specship.config.json (additive — config
 * extends the defaults rather than replacing them).
 */
export function resolveExclude(projectRoot: string): string[] {
  let extra: string[] = [];
  try {
    const raw = fs.readFileSync(path.join(projectRoot, CONFIG_FILE_NAME), 'utf-8');
    const cfg = JSON.parse(raw) as { maintainability?: { exclude?: unknown } };
    const e = cfg?.maintainability?.exclude;
    if (Array.isArray(e)) extra = e.filter((x): x is string => typeof x === 'string');
  } catch {
    // no config / unparseable → defaults only
  }
  return [...DEFAULT_EXCLUDE, ...extra];
}
