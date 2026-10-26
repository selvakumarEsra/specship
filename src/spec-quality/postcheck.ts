/**
 * Mechanical post-implement checks (PIPETRUST-DOC, REQ-PIPETRUST-005).
 *
 * On 2026-10-26 every `spec-implement` run needed a human to finish it, for
 * reasons a script can see: test evidence linked by `it()` title strings (no
 * edge, so the requirement could never reach `verified`), criteria with no
 * test, source changes with no CHANGELOG entry, generated reference docs not
 * regenerated. Postcheck checks those mechanically after implement so the
 * workflow can fix them before a human ever looks.
 *
 * File-based by design: it runs inside a workflow worktree, which has no
 * SpecShip index, so it reads the spec file and the test files directly.
 *
 *   1. `verifies:` coverage — every bullet is `path:Symbol` with a real,
 *      space-free symbol defined in the test file; every acceptance criterion
 *      id appears in at least one of those test files.
 *   2. CHANGELOG — when files under `src/` changed against the base ref, the
 *      `## [Unreleased]` section of CHANGELOG.md changed too.
 *   3. Project checks — each `postcheck.commands` entry in specship.config.json
 *      (`{ name, check, fix? }`); with `fix`, the fix command runs first.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { checkEnforcedRules } from '../knowledge/enforce';

export interface PostcheckFinding {
  check: 'verifies' | 'changelog' | 'command' | 'knowledge' | 'mutation';
  message: string;
}

export interface PostcheckResult {
  ok: boolean;
  findings: PostcheckFinding[];
  /** One line per check that ran, for the report. */
  ran: string[];
}

export interface PostcheckCommand {
  name: string;
  check: string;
  fix?: string;
}

export interface PostcheckOptions {
  projectRoot: string;
  requirementId: string;
  /** Run each configured command's `fix` before its `check`. */
  fix?: boolean;
  /** Base ref for the CHANGELOG check; defaults to the recorded run base, then the merge-base with the default branch. */
  base?: string;
  /** Inject command execution (tests). Returns the exit code. */
  run?: (command: string, cwd: string) => { code: number; output: string };
  /** Inject git diff lookups (tests). */
  changedFiles?: (base: string) => string[];
  /** Inject the base CHANGELOG content (tests). */
  baseFile?: (base: string, relPath: string) => string | null;
}

const ID_MARKER = /^<!--\s*id:\s*([A-Za-z0-9._-]+)\s*-->\s*$/;

/** The requirement's block of the spec file: from its id marker to the next requirement-level marker. */
export function requirementBlock(source: string, requirementId: string): string | null {
  const lines = source.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = (lines[i] ?? '').match(ID_MARKER);
    if (!m) continue;
    if (start === -1) {
      if (m[1] === requirementId) start = i;
    } else if (!m[1]!.startsWith(`${requirementId}.`)) {
      return lines.slice(start, i).join('\n');
    }
  }
  return start === -1 ? null : lines.slice(start).join('\n');
}

/** Acceptance criterion ids declared under the requirement. */
export function criterionIds(block: string, requirementId: string): string[] {
  const ids: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(ID_MARKER);
    if (m && m[1]!.startsWith(`${requirementId}.A`)) ids.push(m[1]!);
  }
  return ids;
}

/** Bullets of a `<name>:` link block inside the requirement block. */
export function linkBullets(block: string, blockName: 'verifies' | 'implementations'): string[] {
  const lines = block.split(/\r?\n/);
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (new RegExp(`^${blockName}:\\s*$`).test(line.trim()) && !/^\s/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    const m = line.match(/^\s+-\s+(.+?)\s*$/);
    if (m) {
      out.push(m[1]!);
      continue;
    }
    if (line.trim() === '') continue;
    inBlock = false;
  }
  return out;
}

function symbolDefined(source: string, symbol: string): boolean {
  const s = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `\\b(function\\*?|const|let|var|class|def|fn|func)\\s+${s}\\b|\\b${s}\\s*[:=]\\s*(async\\s+)?(function|\\()`,
  ).test(source);
}

/** REQ-PIPETRUST-005.A1/A2 — `verifies:` bullets are real named test symbols and cover every criterion. */
export function checkVerifiesCoverage(projectRoot: string, specSource: string, requirementId: string): PostcheckFinding[] {
  const findings: PostcheckFinding[] = [];
  const block = requirementBlock(specSource, requirementId);
  if (!block) return [{ check: 'verifies', message: `${requirementId} not found in its spec file` }];

  const testSources: string[] = [];
  for (const bullet of linkBullets(block, 'verifies')) {
    const idx = bullet.lastIndexOf(':');
    const file = idx > 0 ? bullet.slice(0, idx) : bullet;
    const symbol = idx > 0 ? bullet.slice(idx + 1) : '';
    if (!symbol) {
      findings.push({ check: 'verifies', message: `verifies bullet "${bullet}" names no symbol (use path:Symbol)` });
      continue;
    }
    if (/\s/.test(symbol)) {
      findings.push({
        check: 'verifies',
        message: `verifies bullet "${bullet}" names a title string, not a symbol — pass a named function to it() and list that name`,
      });
      continue;
    }
    let source: string;
    try {
      source = fs.readFileSync(path.join(projectRoot, file), 'utf-8');
    } catch {
      findings.push({ check: 'verifies', message: `verifies bullet "${bullet}": file ${file} not found` });
      continue;
    }
    if (!symbolDefined(source, symbol)) {
      findings.push({ check: 'verifies', message: `verifies bullet "${bullet}": no symbol ${symbol} defined in ${file}` });
      continue;
    }
    testSources.push(source);
  }

  for (const id of criterionIds(block, requirementId)) {
    if (!testSources.some((src) => src.includes(id))) {
      findings.push({
        check: 'verifies',
        message: `${id} has no test evidence — no verifies-listed test file mentions it (put the id in the it() title)`,
      });
    }
  }
  return findings;
}

/** The `## [Unreleased]` section of a CHANGELOG, or '' when absent. */
export function unreleasedSection(changelog: string): string {
  const start = changelog.indexOf('## [Unreleased]');
  if (start === -1) return '';
  const next = changelog.indexOf('\n## [', start + 1);
  return changelog.slice(start, next === -1 ? undefined : next);
}

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** Base ref: explicit, else the run base the readiness step recorded, else merge-base with the default branch. */
export function resolveBaseRef(projectRoot: string, explicit?: string): string | null {
  if (explicit) return explicit;
  try {
    const gitDir = git(projectRoot, 'rev-parse --git-dir');
    const recorded = path.join(path.isAbsolute(gitDir) ? gitDir : path.join(projectRoot, gitDir), 'specship-run-base');
    if (fs.existsSync(recorded)) {
      const ref = fs.readFileSync(recorded, 'utf8').trim();
      if (ref) return ref;
    }
  } catch {
    /* not a git repo — fall through */
  }
  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    try {
      return git(projectRoot, `merge-base HEAD ${candidate}`);
    } catch {
      /* try the next */
    }
  }
  return null;
}

/** REQ-PIPETRUST-005.A3 — source changes need a CHANGELOG [Unreleased] change. */
export function checkChangelog(opts: PostcheckOptions): PostcheckFinding[] {
  const base = resolveBaseRef(opts.projectRoot, opts.base);
  if (!base) return [];
  const changed =
    opts.changedFiles?.(base) ??
    git(opts.projectRoot, `diff --name-only ${base}`).split('\n').filter(Boolean);
  if (!changed.some((f) => f.startsWith('src/'))) return [];
  const changelogPath = path.join(opts.projectRoot, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return [];
  const now = unreleasedSection(fs.readFileSync(changelogPath, 'utf8'));
  let before: string | null;
  if (opts.baseFile) before = opts.baseFile(base, 'CHANGELOG.md');
  else {
    try {
      before = git(opts.projectRoot, `show ${base}:CHANGELOG.md`);
    } catch {
      before = null;
    }
  }
  if (before !== null && unreleasedSection(before) === now) {
    return [
      {
        check: 'changelog',
        message: 'files under src/ changed but CHANGELOG.md ## [Unreleased] did not — add a user-facing entry',
      },
    ];
  }
  return [];
}

/** `postcheck.commands` from specship.config.json (empty when absent or malformed). */
export function readPostcheckCommands(projectRoot: string): PostcheckCommand[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'specship.config.json'), 'utf8'));
    const cmds = cfg?.postcheck?.commands;
    if (!Array.isArray(cmds)) return [];
    return cmds.filter(
      (c: unknown): c is PostcheckCommand =>
        !!c && typeof (c as PostcheckCommand).name === 'string' && typeof (c as PostcheckCommand).check === 'string',
    );
  } catch {
    return [];
  }
}

function defaultRun(command: string, cwd: string): { code: number; output: string } {
  const r = spawnSync('bash', ['-c', command], { cwd, encoding: 'utf8' });
  return { code: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** REQ-PIPETRUST-005.A4 — configured check commands, fix first when asked. */
export function checkConfiguredCommands(opts: PostcheckOptions, ran: string[]): PostcheckFinding[] {
  const run = opts.run ?? defaultRun;
  const findings: PostcheckFinding[] = [];
  for (const cmd of readPostcheckCommands(opts.projectRoot)) {
    if (opts.fix && cmd.fix) run(cmd.fix, opts.projectRoot);
    const res = run(cmd.check, opts.projectRoot);
    ran.push(`command ${cmd.name}: ${res.code === 0 ? 'ok' : 'failed'}`);
    if (res.code !== 0) {
      findings.push({
        check: 'command',
        message: `${cmd.name} failed (${cmd.check})${cmd.fix ? '' : ' — no fix configured'}:\n${res.output.trim().split('\n').slice(-15).join('\n')}`,
      });
    }
  }
  return findings;
}

/** Locate the spec file declaring `requirementId` under specs/. */
export function findSpecFile(projectRoot: string, requirementId: string): string | null {
  const marker = `<!-- id: ${requirementId} -->`;
  const walk = (dir: string): string | null => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (e.name.endsWith('.md') && fs.readFileSync(p, 'utf8').includes(marker)) {
        return p;
      }
    }
    return null;
  };
  return walk(path.join(projectRoot, 'specs'));
}

export function runPostcheck(opts: PostcheckOptions): PostcheckResult {
  const ran: string[] = [];
  const findings: PostcheckFinding[] = [];

  const specFile = findSpecFile(opts.projectRoot, opts.requirementId);
  if (!specFile) {
    findings.push({ check: 'verifies', message: `no spec file under specs/ declares ${opts.requirementId}` });
  } else {
    const f = checkVerifiesCoverage(opts.projectRoot, fs.readFileSync(specFile, 'utf8'), opts.requirementId);
    ran.push(`verifies coverage: ${f.length === 0 ? 'ok' : `${f.length} finding(s)`}`);
    findings.push(...f);
  }

  const c = checkChangelog(opts);
  ran.push(`changelog: ${c.length === 0 ? 'ok' : 'missing entry'}`);
  findings.push(...c);

  findings.push(...checkConfiguredCommands(opts, ran));

  // REQ-KNOW-003.A4 — enforced domain-fact rules are a built-in check.
  const enforced = checkEnforcedRules(opts.projectRoot);
  if (enforced.rulesChecked > 0) {
    ran.push(`knowledge check: ${enforced.violations.length === 0 ? 'ok' : `${enforced.violations.length} violation(s)`} (${enforced.rulesChecked} enforced rule(s))`);
  }
  for (const v of enforced.violations) {
    findings.push({
      check: 'knowledge',
      message: `${v.file}:${v.line} violates ${v.factId} (${v.rule}): ${v.text.trim()}`,
    });
  }

  return { ok: findings.length === 0, findings, ran };
}

/** Marker-led rendering; POSTCHECK=passed|failed is the workflow contract. */
export function formatPostcheck(result: PostcheckResult): string {
  const lines = [`POSTCHECK=${result.ok ? 'passed' : 'failed'}`, ...result.ran.map((r) => `- ${r}`)];
  for (const f of result.findings) lines.push(`✗ [${f.check}] ${f.message}`);
  return lines.join('\n');
}
