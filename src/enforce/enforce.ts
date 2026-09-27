/**
 * Enforcement mode (REQ-ENFORCE-001 / 002 / 003).
 *
 * Composes SpecShip's checks — spec↔code drift, architecture fitness,
 * maintainability, and the spec→test→verify behaviour chain — into a single
 * report whose gating subset can fail CI. Strictly opt-in: with no gating
 * configuration every check is advisory and the run passes, so turning SpecShip
 * on in an existing repo never breaks a build (REQ-ENFORCE-002.A2).
 *
 * `evaluateEnforcement` is a pure function over a `deps` snapshot so it is
 * testable without a database; SpecShip.getEnforce() assembles the snapshot.
 *
 * The behaviour chain reuses the existing spec-link machinery: a `tests` link
 * from a requirement (or its acceptance criteria) to a test symbol, in the
 * `verified` (passing) or `broken` (ran-and-failed) state.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SpecLink } from './../types';
import { FitnessReport } from '../fitness/fitness';
import { MaintainabilityReport, highPrecisionClean } from '../graph/maintainability';

export type CheckName = 'drift' | 'fitness' | 'maintainability' | 'behaviour';

/**
 * Project-relative, forward-slashed, no `./` prefix. Link target paths, spec
 * source paths and git's output all have to compare in one shape before
 * change-scoping can match them (REQ-AUTHG-006).
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Which checks gate (fail CI) vs merely advise. Absent key → advisory. */
export interface GateConfig {
  drift?: boolean;
  fitness?: boolean;
  maintainability?: boolean;
  behaviour?: boolean;
}

export interface EnforceConfig {
  gate?: GateConfig;
  /** Requirement IDs explicitly out of behaviour-gating scope (REQ-ENFORCE-003.A4). */
  behaviour?: { exclude?: string[] };
}

/** Tests-link summary for one requirement (its own + its acceptance criteria's). */
export interface RequirementVerification {
  id: string;
  title: string;
  /** All `tests`-kind links for the requirement and its acceptance children. */
  testsLinks: SpecLink[];
  /** Spec file this requirement is authored in, project-relative (REQ-AUTHG-006). */
  sourcePath?: string;
  /** Every file this requirement's links point at, any kind (REQ-AUTHG-006). */
  linkedFiles?: string[];
}

export interface EnforceDeps {
  /** Links currently in drifted / broken / orphaned state. */
  drift: SpecLink[];
  fitness: FitnessReport;
  maintainability: MaintainabilityReport;
  requirements: RequirementVerification[];
}

/**
 * Change-scoped evaluation (REQ-AUTHG-006): restrict the link-scoped checks to
 * the requirements a set of changed files reaches. Absent → whole repo, the
 * unchanged behaviour (A2).
 */
export interface EnforceScope {
  /** Project-relative, forward-slashed paths. */
  changedFiles: string[];
  /** The ref they were computed from, for the report header. */
  since?: string;
}

export interface CheckOutcome {
  check: CheckName;
  gating: boolean;
  passed: boolean;
  findings: string[];
  /**
   * True when a `--since` scope narrowed this check. Only `drift` and
   * `behaviour` are link-scoped; `fitness` and `maintainability` are
   * repo-global analyses and always run unscoped (REQ-AUTHG-006).
   */
  scoped?: boolean;
}

export interface EnforceReport {
  checks: CheckOutcome[];
  /** Names of gating checks that failed. */
  gatedFailures: CheckName[];
  /** True when no gating check failed (CI gate result). */
  passed: boolean;
}

export function evaluateEnforcement(
  deps: EnforceDeps,
  config: EnforceConfig = {},
  scope?: EnforceScope,
): EnforceReport {
  const gate = config.gate ?? {};
  const exclude = new Set(config.behaviour?.exclude ?? []);
  const checks: CheckOutcome[] = [];

  // Change scoping (REQ-AUTHG-006.A1): drift and behaviour are link-scoped, so
  // a changed-file set narrows them. Without a scope nothing below filters
  // anything — the gate behaves exactly as it always has (A2).
  const changed = scope ? new Set(scope.changedFiles.map(normalizePath)) : null;
  const touches = (file: string | undefined): boolean =>
    !!file && !!changed && changed.has(normalizePath(file));

  // --- drift ---
  {
    const links = changed ? deps.drift.filter((l) => touches(l.targetFilePath)) : deps.drift;
    const findings = links.map((l) => `${l.specId} ${l.state} → ${l.targetQualifiedName}`);
    checks.push({
      check: 'drift', gating: gate.drift === true, passed: findings.length === 0, findings,
      ...(changed ? { scoped: true } : {}),
    });
  }

  // --- fitness ---
  {
    const findings = [
      ...deps.fitness.configErrors.map((e) => `config error: ${e.rule} — ${e.message}`),
      ...deps.fitness.violations.map((v) => `${v.rule}: ${v.source} → ${v.target} (${v.location})`),
    ];
    checks.push({ check: 'fitness', gating: gate.fitness === true, passed: deps.fitness.clean, findings });
  }

  // --- maintainability ---
  // Gates on `highPrecisionClean`, not `m.clean` (REQ-REVINT-009.A1): the
  // below-gateway signals (dead code, coupling) are lower-confidence and flood
  // any real repo, so gating on them keeps the check permanently red. They
  // still list as advisory findings (A2).
  {
    const m = deps.maintainability;
    const findings = m.clean ? [] : [
      ...(m.coupling.length ? [`${m.coupling.length} coupling hotspot(s)`] : []),
      ...(m.oversized.length ? [`${m.oversized.length} oversized symbol(s)`] : []),
      ...(m.godFiles.length ? [`${m.godFiles.length} god-file(s)`] : []),
      ...(m.cycles.length ? [`${m.cycles.length} dependency cycle(s)`] : []),
      ...(m.deadCode.length ? [`${m.deadCode.length} dead-code candidate(s)`] : []),
    ];
    const passed = highPrecisionClean(m);
    checks.push({ check: 'maintainability', gating: gate.maintainability === true, passed, findings });
  }

  // --- behaviour (spec→test→verify) ---
  {
    const findings: string[] = [];
    for (const req of deps.requirements) {
      if (exclude.has(req.id)) continue; // out of behaviour-gating scope (A4)
      // A requirement is in a scoped run when its own spec file changed or any
      // file it links to changed (REQ-AUTHG-006.A1). Everything else produces
      // no findings at all (A2) — not even an "unverified" one.
      if (changed && !touches(req.sourcePath) && !(req.linkedFiles ?? []).some(touches)) continue;
      const tests = req.testsLinks;
      const broken = tests.filter((l) => l.state === 'broken');
      const verified = tests.filter((l) => l.state === 'verified');
      if (broken.length > 0) {
        findings.push(`${req.id}: verification broken — ${broken.map((l) => l.targetQualifiedName).join(', ')}`); // A2
      } else if (verified.length === 0) {
        findings.push(`${req.id}: unverified — no passing test links it`); // A3
      }
    }
    checks.push({
      check: 'behaviour', gating: gate.behaviour === true, passed: findings.length === 0, findings,
      ...(changed ? { scoped: true } : {}),
    });
  }

  const gatedFailures = checks.filter((c) => c.gating && !c.passed).map((c) => c.check);
  return { checks, gatedFailures, passed: gatedFailures.length === 0 };
}

/** Default name of the checked-in project config file at the project root. */
export const ENFORCE_CONFIG_FILE = 'specship.config.json';

/**
 * Load the enforcement config from `specship.config.json` (`enforce`). Missing
 * or unparseable → `{}` (all checks advisory — the opt-in default).
 */
export function loadEnforceConfig(projectRoot: string): EnforceConfig {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, ENFORCE_CONFIG_FILE), 'utf-8');
    const cfg = JSON.parse(raw) as { enforce?: EnforceConfig };
    if (cfg?.enforce && typeof cfg.enforce === 'object') return cfg.enforce;
  } catch {
    // no config / unparseable → advisory-only
  }
  return {};
}

/** All check names, for `--strict` / `--enable-gate` validation. */
export const ALL_CHECKS: CheckName[] = ['drift', 'fitness', 'maintainability', 'behaviour'];

/**
 * The `--strict` override (REQ-ENFORCE-004.A2): every check gates for this
 * run only. Nothing is read from or written to the project config.
 */
export function strictEnforceConfig(): EnforceConfig {
  return { gate: { drift: true, fitness: true, maintainability: true, behaviour: true } };
}

/**
 * Persist gating for the named checks into `specship.config.json`
 * (REQ-ENFORCE-004.A1 — the command writes the config; the user is never
 * told to hand-edit JSON). Merges into an existing file, preserving every
 * other key (including other `enforce` settings like `behaviour.exclude`).
 * Returns the checks newly enabled (already-gating checks are skipped).
 */
export function enableGateChecks(projectRoot: string, checks: CheckName[]): CheckName[] {
  const file = path.join(projectRoot, ENFORCE_CONFIG_FILE);
  let cfg: { enforce?: EnforceConfig; [key: string]: unknown } = {};
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    // missing / unparseable → start fresh
  }
  if (!cfg.enforce || typeof cfg.enforce !== 'object') cfg.enforce = {};
  if (!cfg.enforce.gate || typeof cfg.enforce.gate !== 'object') cfg.enforce.gate = {};
  const enabled: CheckName[] = [];
  for (const check of checks) {
    if (cfg.enforce.gate[check] !== true) {
      cfg.enforce.gate[check] = true;
      enabled.push(check);
    }
  }
  if (enabled.length > 0) fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
  return enabled;
}
