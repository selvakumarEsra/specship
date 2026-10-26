/**
 * Machine-enforced domain rules (KNOWLEDGE-DOC, REQ-KNOW-003).
 *
 * A domain fact MAY carry an `## Enforced` section whose bullets read
 *
 *     - `<glob>` must not match `/<regex>/`        (flags allowed: `/x/i`)
 *
 * `checkEnforcedRules` scans every project file matching each glob and reports
 * each matching line as a violation naming the fact, file and line. A bullet
 * that doesn't follow the form is returned as malformed (the spec lint turns
 * it into an error — `spec_malformed_enforced_rule`).
 *
 * Read-only over the project tree; never writes.
 */

import * as fs from 'fs';
import * as path from 'path';
import picomatch from 'picomatch';
import { loadDomainFacts } from './facts';

export interface EnforcedRule {
  /** Project-relative glob the rule applies to. */
  glob: string;
  /** The regex source, as written between the slashes. */
  pattern: string;
  /** Regex flags as written (without `g`/`y`, which are meaningless per line). */
  flags: string;
  /** 1-indexed line of the bullet within the parsed body. */
  line: number;
}

export interface MalformedEnforcedBullet {
  /** 1-indexed line of the bullet within the parsed body. */
  line: number;
  text: string;
  reason: string;
}

export interface ParsedEnforcedRules {
  rules: EnforcedRule[];
  malformed: MalformedEnforcedBullet[];
}

export interface EnforcedViolation {
  factId: string;
  /** Project-relative, forward-slashed path. */
  file: string;
  /** 1-indexed line of the match. */
  line: number;
  /** The matching line, trimmed. */
  text: string;
  /** The rule that matched, as `` `glob` must not match `/re/` ``. */
  rule: string;
}

export interface EnforceCheckResult {
  violations: EnforcedViolation[];
  /** Number of well-formed rules evaluated. */
  rulesChecked: number;
}

export interface CheckEnforcedRulesOptions {
  /** Extra directory names to skip during the walk (added to the defaults). */
  skipDirs?: string[];
  /** Files larger than this are skipped (default 2 MiB). */
  maxFileBytes?: number;
}

/** Directories never scanned: dependencies, VCS, build output, tool state. */
export const ENFORCE_SKIP_DIRS = ['node_modules', '.git', 'dist', '.specship', '.claude'];

const ENFORCED_HEADING = /^\s*##\s+Enforced\s*$/i;
const ANY_SECTION_HEADING = /^\s*#{1,2}\s+\S/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const RULE_FORM = /^`([^`]+)`\s+must\s+not\s+match\s+`?\/(.+)\/([a-z]*)`?\s*$/;
const VALID_FLAGS = /^[dimsuvgy]*$/;

/**
 * Parse the `## Enforced` section of a fact body. The section runs to the next
 * `#` / `##` heading; non-bullet prose inside it is ignored, every bullet must
 * be a rule. A body with no such section yields no rules and no malformed bullets.
 */
export function parseEnforcedRules(factBody: string): ParsedEnforcedRules {
  const rules: EnforcedRule[] = [];
  const malformed: MalformedEnforcedBullet[] = [];
  const lines = factBody.split(/\r?\n/);
  let inSection = false;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (ENFORCED_HEADING.test(raw)) {
      inSection = true;
      continue;
    }
    if (ANY_SECTION_HEADING.test(raw)) {
      inSection = false;
      continue;
    }
    if (!inSection) continue;
    const b = raw.match(BULLET);
    if (!b) continue;
    const text = (b[1] ?? '').trim();
    const m = text.match(RULE_FORM);
    if (!m) {
      malformed.push({
        line: i + 1,
        text,
        reason: 'expected the form `<glob>` must not match `/<regex>/`',
      });
      continue;
    }
    const glob = (m[1] ?? '').trim();
    const pattern = m[2] ?? '';
    const rawFlags = m[3] ?? '';
    if (!VALID_FLAGS.test(rawFlags)) {
      malformed.push({ line: i + 1, text, reason: `invalid regex flags "${rawFlags}"` });
      continue;
    }
    const flags = [...new Set(rawFlags.replace(/[gy]/g, ''))].join('');
    try {
      new RegExp(pattern, flags);
    } catch (err) {
      malformed.push({
        line: i + 1,
        text,
        reason: `invalid regex: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (glob.length === 0) {
      malformed.push({ line: i + 1, text, reason: 'empty glob' });
      continue;
    }
    rules.push({ glob, pattern, flags, line: i + 1 });
  }
  return { rules, malformed };
}

function walkFiles(root: string, skip: Set<string>, out: string[], dir = root): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walkFiles(root, skip, out, full);
    } else if (e.isFile()) {
      out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
}

function describeRule(r: EnforcedRule): string {
  return `\`${r.glob}\` must not match \`/${r.pattern}/${r.flags}\``;
}

/**
 * Evaluate every well-formed enforced rule of every domain fact under
 * `<projectRoot>/specs/domain/` against the project tree. Malformed bullets
 * are skipped here (the lint reports them).
 */
export function checkEnforcedRules(
  projectRoot: string,
  opts: CheckEnforcedRulesOptions = {}
): EnforceCheckResult {
  const root = path.resolve(projectRoot);
  const facts = loadDomainFacts(root)
    .map((f) => ({ id: f.id, rules: parseEnforcedRules(f.body).rules }))
    .filter((f) => f.rules.length > 0);
  const rulesChecked = facts.reduce((n, f) => n + f.rules.length, 0);
  if (rulesChecked === 0) return { violations: [], rulesChecked: 0 };

  const skip = new Set([...ENFORCE_SKIP_DIRS, ...(opts.skipDirs ?? [])]);
  const maxBytes = opts.maxFileBytes ?? 2 * 1024 * 1024;
  const files: string[] = [];
  walkFiles(root, skip, files);
  files.sort();

  const lineCache = new Map<string, string[] | null>();
  const readLines = (rel: string): string[] | null => {
    if (lineCache.has(rel)) return lineCache.get(rel) ?? null;
    let lines: string[] | null = null;
    try {
      const full = path.join(root, rel);
      if (fs.statSync(full).size <= maxBytes) {
        const content = fs.readFileSync(full, 'utf8');
        if (!content.includes('\u0000')) lines = content.split(/\r?\n/);
      }
    } catch {
      lines = null;
    }
    lineCache.set(rel, lines);
    return lines;
  };

  const violations: EnforcedViolation[] = [];
  for (const fact of facts) {
    for (const rule of fact.rules) {
      const isMatch = picomatch(rule.glob, { dot: true });
      const re = new RegExp(rule.pattern, rule.flags);
      for (const rel of files) {
        if (!isMatch(rel)) continue;
        const lines = readLines(rel);
        if (!lines) continue;
        for (let i = 0; i < lines.length; i++) {
          const text = lines[i] ?? '';
          if (re.test(text)) {
            violations.push({
              factId: fact.id,
              file: rel,
              line: i + 1,
              text: text.trim(),
              rule: describeRule(rule),
            });
          }
        }
      }
    }
  }
  return { violations, rulesChecked };
}

/** Exit code for `knowledge check`: non-zero when any violation exists. */
export function exitCodeForEnforce(result: EnforceCheckResult): number {
  return result.violations.length > 0 ? 1 : 0;
}

/** Human-readable report for `knowledge check`. */
export function formatEnforceReport(result: EnforceCheckResult): string {
  const out: string[] = [];
  if (result.violations.length === 0) {
    out.push(
      result.rulesChecked === 0
        ? 'Knowledge check: no enforced rules declared in specs/domain/.'
        : `Knowledge check: clean — ${result.rulesChecked} enforced rule${result.rulesChecked === 1 ? '' : 's'} checked, 0 violations.`
    );
    return out.join('\n');
  }
  out.push(
    `Knowledge check: ${result.violations.length} violation${result.violations.length === 1 ? '' : 's'} of ${result.rulesChecked} enforced rule${result.rulesChecked === 1 ? '' : 's'}.`
  );
  let lastGroup = '';
  for (const v of result.violations) {
    const group = `${v.factId}  ${v.rule}`;
    if (group !== lastGroup) {
      out.push('', group);
      lastGroup = group;
    }
    out.push(`  ${v.file}:${v.line}  ${v.text}`);
  }
  return out.join('\n');
}
