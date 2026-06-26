/**
 * Architecture-fitness functions (REQ-FITNESS-001 / 002).
 *
 * Evaluates declarative architecture rules against the knowledge graph's
 * dependency edges and reports concrete violations. Three rule types — forbidden
 * dependency, layering allow-list, and module isolation (leaf/sink) — each an
 * edge constraint. Selectors are globs over the project-relative file path
 * (picomatch), so "module/dir A" addresses cleanly across languages.
 *
 * Deterministic (sorted output). A rule whose selector matches no node is
 * reported as a CONFIG ERROR, never a silent pass (REQ-FITNESS-002.A3) — a typo
 * can't produce a false-green. Pure read over QueryBuilder.
 *
 * Realizes the second harness-engineering expansion lane (REQ-STRATEGY-002).
 */

import * as fs from 'fs';
import * as path from 'path';
import picomatch from 'picomatch';
import { QueryBuilder } from '../db/queries';
import { Edge, Node } from '../types';

/** A glob over the project-relative file path (e.g. `src/ui/**`). */
export type Selector = string;

export interface ForbiddenRule {
  type: 'forbidden';
  name: string;
  /** Dependencies FROM nodes matching this selector… */
  from: Selector;
  /** …TO nodes matching this selector are violations. */
  to: Selector;
}

export interface LayersRule {
  type: 'layers';
  name: string;
  /** layer name → selector that assigns nodes to it (first match wins, config order). */
  layers: Record<string, Selector>;
  /** layer name → layers it MAY depend on. Same-layer is always allowed. */
  allow: Record<string, string[]>;
}

export interface IsolationRule {
  type: 'isolation';
  name: string;
  module: Selector;
  /** leaf: nothing outside may depend INTO the module. sink: it may depend on nothing outside. */
  mode: 'leaf' | 'sink';
}

export type FitnessRule = ForbiddenRule | LayersRule | IsolationRule;

export interface FitnessViolation {
  rule: string;
  ruleType: FitnessRule['type'];
  source: string;
  target: string;
  location: string; // file:line of the source symbol
  edgeKind: string;
  detail: string;
}

export interface FitnessConfigError {
  rule: string;
  message: string;
}

export interface FitnessReport {
  ruleCount: number;
  violations: FitnessViolation[];
  configErrors: FitnessConfigError[];
  /** True when there are no violations AND no config errors. */
  clean: boolean;
}

/** Edge kinds that are real dependencies (exclude structural containment/exports). */
function isDepEdge(kind: Edge['kind']): boolean {
  return kind !== 'contains' && kind !== 'exports';
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Evaluate the rules against the graph. Pure read.
 */
export function evaluateFitness(queries: QueryBuilder, rules: FitnessRule[]): FitnessReport {
  const nodes = queries.getAllNodes();
  const byId = new Map<string, Node>(nodes.map((n) => [n.id, n]));
  const files = [...new Set(nodes.map((n) => n.filePath))];

  const violations: FitnessViolation[] = [];
  const configErrors: FitnessConfigError[] = [];

  // A selector is "live" if at least one indexed file matches it.
  const matcherCache = new Map<string, (f: string) => boolean>();
  const matcher = (sel: Selector): (f: string) => boolean => {
    let m = matcherCache.get(sel);
    if (!m) { m = picomatch(sel, { dot: true }); matcherCache.set(sel, m); }
    return m;
  };
  const selectorMatchesAny = (sel: Selector): boolean => {
    const m = matcher(sel);
    return files.some((f) => m(f));
  };

  // Pre-validate selectors → config errors (REQ-FITNESS-002.A3).
  const liveRules: FitnessRule[] = [];
  for (const rule of rules) {
    const dead: string[] = [];
    if (rule.type === 'forbidden') {
      if (!selectorMatchesAny(rule.from)) dead.push(`from: "${rule.from}"`);
      if (!selectorMatchesAny(rule.to)) dead.push(`to: "${rule.to}"`);
    } else if (rule.type === 'isolation') {
      if (!selectorMatchesAny(rule.module)) dead.push(`module: "${rule.module}"`);
    } else if (rule.type === 'layers') {
      for (const [layer, sel] of Object.entries(rule.layers)) {
        if (!selectorMatchesAny(sel)) dead.push(`layer ${layer}: "${sel}"`);
      }
    }
    if (dead.length) {
      configErrors.push({ rule: rule.name, message: `selector matches no indexed file — ${dead.join(', ')}` });
    } else {
      liveRules.push(rule);
    }
  }

  if (liveRules.length > 0) {
    for (const n of nodes) {
      const out = queries.getOutgoingEdges(n.id);
      for (const e of out) {
        if (!isDepEdge(e.kind)) continue;
        const tgt = byId.get(e.target);
        if (!tgt) continue;
        const loc = `${n.filePath}:${n.startLine ?? 0}`;
        for (const rule of liveRules) {
          const v = evalEdge(rule, n, tgt, e, loc, matcher);
          if (v) violations.push(v);
        }
      }
    }
  }

  violations.sort(
    (a, b) => cmp(a.rule, b.rule) || cmp(a.location, b.location) || cmp(a.source, b.source) || cmp(a.target, b.target),
  );
  configErrors.sort((a, b) => cmp(a.rule, b.rule) || cmp(a.message, b.message));

  return {
    ruleCount: rules.length,
    violations,
    configErrors,
    clean: violations.length === 0 && configErrors.length === 0,
  };
}

function evalEdge(
  rule: FitnessRule,
  src: Node,
  tgt: Node,
  edge: Edge,
  loc: string,
  matcher: (sel: Selector) => (f: string) => boolean,
): FitnessViolation | null {
  const base = { rule: rule.name, ruleType: rule.type, source: src.qualifiedName, target: tgt.qualifiedName, location: loc, edgeKind: edge.kind };

  if (rule.type === 'forbidden') {
    if (matcher(rule.from)(src.filePath) && matcher(rule.to)(tgt.filePath)) {
      return { ...base, detail: `forbidden dependency: ${rule.from} → ${rule.to}` };
    }
    return null;
  }

  if (rule.type === 'isolation') {
    const inMod = matcher(rule.module);
    const srcIn = inMod(src.filePath);
    const tgtIn = inMod(tgt.filePath);
    if (rule.mode === 'leaf' && tgtIn && !srcIn) {
      return { ...base, detail: `${rule.module} is a leaf — nothing outside may depend into it` };
    }
    if (rule.mode === 'sink' && srcIn && !tgtIn) {
      return { ...base, detail: `${rule.module} is a sink — it may depend on nothing outside` };
    }
    return null;
  }

  // layers
  const layerOf = (file: string): string | null => {
    for (const [layer, sel] of Object.entries(rule.layers)) {
      if (matcher(sel)(file)) return layer;
    }
    return null;
  };
  const ls = layerOf(src.filePath);
  const lt = layerOf(tgt.filePath);
  if (ls && lt && ls !== lt) {
    const allowed = rule.allow[ls] ?? [];
    if (!allowed.includes(lt)) {
      return { ...base, detail: `layer "${ls}" may not depend on "${lt}" (allowed: ${allowed.length ? allowed.join(', ') : 'none'})` };
    }
  }
  return null;
}

/** Default name of the checked-in project config file at the project root. */
export const FITNESS_CONFIG_FILE = 'specship.config.json';

/**
 * Load fitness rules from the checked-in `specship.config.json` (`fitness.rules`).
 * Missing/unparseable config → no rules. Each entry is taken as-is; an invalid
 * shape surfaces later as a config error during evaluation.
 */
export function loadFitnessRules(projectRoot: string): FitnessRule[] {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, FITNESS_CONFIG_FILE), 'utf-8');
    const cfg = JSON.parse(raw) as { fitness?: { rules?: unknown } };
    const rules = cfg?.fitness?.rules;
    if (Array.isArray(rules)) {
      return rules.filter(
        (r): r is FitnessRule =>
          !!r && typeof r === 'object' && typeof (r as { name?: unknown }).name === 'string'
          && ['forbidden', 'layers', 'isolation'].includes((r as { type?: string }).type ?? ''),
      );
    }
  } catch {
    // no config / unparseable → no rules
  }
  return [];
}
