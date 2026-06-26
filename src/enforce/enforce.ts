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
import { MaintainabilityReport } from '../graph/maintainability';

export type CheckName = 'drift' | 'fitness' | 'maintainability' | 'behaviour';

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
}

export interface EnforceDeps {
  /** Links currently in drifted / broken / orphaned state. */
  drift: SpecLink[];
  fitness: FitnessReport;
  maintainability: MaintainabilityReport;
  requirements: RequirementVerification[];
}

export interface CheckOutcome {
  check: CheckName;
  gating: boolean;
  passed: boolean;
  findings: string[];
}

export interface EnforceReport {
  checks: CheckOutcome[];
  /** Names of gating checks that failed. */
  gatedFailures: CheckName[];
  /** True when no gating check failed (CI gate result). */
  passed: boolean;
}

export function evaluateEnforcement(deps: EnforceDeps, config: EnforceConfig = {}): EnforceReport {
  const gate = config.gate ?? {};
  const exclude = new Set(config.behaviour?.exclude ?? []);
  const checks: CheckOutcome[] = [];

  // --- drift ---
  {
    const findings = deps.drift.map((l) => `${l.specId} ${l.state} → ${l.targetQualifiedName}`);
    checks.push({ check: 'drift', gating: gate.drift === true, passed: findings.length === 0, findings });
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
  {
    const m = deps.maintainability;
    const findings = m.clean ? [] : [
      ...(m.coupling.length ? [`${m.coupling.length} coupling hotspot(s)`] : []),
      ...(m.oversized.length ? [`${m.oversized.length} oversized symbol(s)`] : []),
      ...(m.godFiles.length ? [`${m.godFiles.length} god-file(s)`] : []),
      ...(m.cycles.length ? [`${m.cycles.length} dependency cycle(s)`] : []),
      ...(m.deadCode.length ? [`${m.deadCode.length} dead-code candidate(s)`] : []),
    ];
    checks.push({ check: 'maintainability', gating: gate.maintainability === true, passed: m.clean, findings });
  }

  // --- behaviour (spec→test→verify) ---
  {
    const findings: string[] = [];
    for (const req of deps.requirements) {
      if (exclude.has(req.id)) continue; // out of behaviour-gating scope (A4)
      const tests = req.testsLinks;
      const broken = tests.filter((l) => l.state === 'broken');
      const verified = tests.filter((l) => l.state === 'verified');
      if (broken.length > 0) {
        findings.push(`${req.id}: verification broken — ${broken.map((l) => l.targetQualifiedName).join(', ')}`); // A2
      } else if (verified.length === 0) {
        findings.push(`${req.id}: unverified — no passing test links it`); // A3
      }
    }
    checks.push({ check: 'behaviour', gating: gate.behaviour === true, passed: findings.length === 0, findings });
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
