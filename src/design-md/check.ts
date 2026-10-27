/**
 * design.md checker (DESIGNMD-DOC, REQ-DESIGNMD-004).
 *
 * A design reference is only useful to a low-end model if it is complete,
 * current and exact. This checks all three mechanically: the fixed sections
 * are present and the authored ones are filled in; the recorded sources still
 * hash to what was extracted; every color and custom property in the sources
 * appears in the generated block; and the authored prose has no approximate
 * wording ("roughly 12px" is exactly what a cheap model turns into 10px).
 *
 * Also hosts the `specship design extract|check` CLI entry points, which
 * return text + exit code instead of printing (same shape as the spec lint).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DesignSourceError, colorLiterals, extractDesign } from './extract';
import { DesignMdUpdateError, findGeneratedBlock, updateDesignMd } from './maintain';
import { AUTHORED_SECTIONS, REQUIRED_SECTIONS, renderDesignMd, renderGeneratedBlock } from './render';
import { formatVerify, verifyBuild } from './verify';

export type DesignCheckCode =
  | 'design_missing_section'
  | 'design_missing_generated_block'
  | 'design_empty_section'
  | 'design_vague_wording'
  | 'design_source_missing'
  | 'design_stale'
  | 'design_uncovered_value'
  | 'design_missing_linked_source'
  | 'design_duplicate_section';

export interface DesignCheckFinding {
  code: DesignCheckCode;
  severity: 'error' | 'warning';
  line?: number;
  message: string;
}

const VAGUE: { re: RegExp; label: string }[] = [
  { re: /\bapprox(?:imately|\.)?\b/i, label: 'approximately' },
  { re: /\broughly\b/i, label: 'roughly' },
  { re: /\babout\s+-?\d/i, label: 'about <number>' },
  { re: /~\s*-?\d/, label: '~<number>' },
  { re: /\bsimilar to\b/i, label: 'similar to' },
  { re: /\betc\b\.?/i, label: 'etc.' },
  { re: /\bTBD\b/, label: 'TBD' },
  { re: /\bsomething like\b/i, label: 'something like' },
];

export interface RecordedSource {
  path: string;
  sha256: string;
}

/** Sources recorded on the generated block's first line. */
export function recordedSources(block: string): RecordedSource[] {
  const line = block.split('\n').find((l) => l.startsWith('Sources:')) ?? '';
  return [...line.matchAll(/`([^`]+)`\s+sha256:([0-9a-f]{64})/g)].map((m) => ({ path: m[1]!, sha256: m[2]! }));
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/** `## Heading` → [start index of its body, end index]. */
function sections(content: string): Map<string, { at: number; body: string }> {
  const out = new Map<string, { at: number; body: string }>();
  const heads = [...content.matchAll(/^## (.+?)[ \t]*$/gm)];
  heads.forEach((h, i) => {
    const bodyStart = h.index! + h[0].length;
    const bodyEnd = i + 1 < heads.length ? heads[i + 1]!.index! : content.length;
    if (!out.has(h[1]!)) out.set(h[1]!, { at: h.index!, body: content.slice(bodyStart, bodyEnd) });
  });
  return out;
}

export function checkDesignMd(content: string, opts: { projectRoot: string }): DesignCheckFinding[] {
  const findings: DesignCheckFinding[] = [];
  const secs = sections(content);

  for (const name of REQUIRED_SECTIONS) {
    if (!secs.has(name)) findings.push({ code: 'design_missing_section', severity: 'error', message: `missing section "## ${name}"` });
  }
  // A heading written twice (a filled copy plus a leftover stub) — say so
  // plainly; "section is empty" alone sends the author looking in the wrong place.
  const seen = new Map<string, number>();
  for (const h of content.matchAll(/^## (.+?)[ \t]*$/gm)) {
    const line = lineOf(content, h.index!);
    const first = seen.get(h[1]!);
    if (first !== undefined) {
      findings.push({
        code: 'design_duplicate_section',
        severity: 'error',
        line,
        message: `"## ${h[1]}" appears twice (lines ${first} and ${line}) — keep one: merge the content and delete the other heading`,
      });
    } else seen.set(h[1]!, line);
  }
  for (const name of AUTHORED_SECTIONS) {
    const sec = secs.get(name);
    if (sec && sec.body.replace(/<!--[\s\S]*?-->/g, '').trim() === '') {
      findings.push({
        code: 'design_empty_section',
        severity: 'error',
        line: lineOf(content, sec.at),
        message: `section "## ${name}" is empty — fill it in from the design (or state "None")`,
      });
    }
  }

  const span = findGeneratedBlock(content);
  if (!span) {
    findings.push({
      code: 'design_missing_generated_block',
      severity: 'error',
      message: 'no generated reference block — run `specship design extract <source> --out <design.md>`',
    });
  }

  // Vague wording, outside the generated block and outside HTML comments.
  const masked = (span ? content.slice(0, span.start) + ' '.repeat(span.end - span.start) + content.slice(span.end) : content)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  masked.split('\n').forEach((text, i) => {
    for (const v of VAGUE) {
      if (v.re.test(text)) {
        findings.push({
          code: 'design_vague_wording',
          severity: 'error',
          line: i + 1,
          message: `approximate wording ("${v.label}") — state the exact value from the design`,
        });
      }
    }
  });

  if (span) {
    for (const m of span.block.matchAll(/^Missing linked stylesheet: `([^`]+)`/gm)) {
      findings.push({
        code: 'design_missing_linked_source',
        severity: 'error',
        message: `linked stylesheet ${m[1]} was not captured — save it next to the source, then re-run extract --update`,
      });
    }
    const sources = recordedSources(span.block);
    const readable: RecordedSource[] = [];
    let stale = false;
    for (const s of sources) {
      const abs = path.resolve(opts.projectRoot, s.path);
      let buf: Buffer;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        findings.push({ code: 'design_source_missing', severity: 'warning', message: `recorded source ${s.path} is not readable — coverage not checked` });
        continue;
      }
      readable.push(s);
      if (crypto.createHash('sha256').update(buf).digest('hex') !== s.sha256) {
        stale = true;
        findings.push({
          code: 'design_stale',
          severity: 'error',
          message: `source ${s.path} changed since extraction — run \`specship design extract ${sources.map((x) => x.path).join(' ')} --update <design.md>\``,
        });
      }
    }
    // Coverage only means something against the bytes the block claims to describe.
    if (!stale && readable.length > 0 && readable.length === sources.length) {
      try {
        const x = extractDesign(readable.map((s) => s.path), opts);
        const block = span.block.toLowerCase();
        const missing = new Set<string>();
        for (const p of x.customProperties) if (!span.block.includes(p.name)) missing.add(p.name);
        for (const entry of x.inventories['Colors']) {
          for (const c of colorLiterals(entry.value)) if (!block.includes(c.toLowerCase())) missing.add(c);
        }
        for (const m of [...missing].sort()) {
          findings.push({ code: 'design_uncovered_value', severity: 'error', message: `${m} appears in the source but not in the generated reference` });
        }
      } catch (err) {
        if (!(err instanceof DesignSourceError)) throw err;
      }
    }
  }
  return findings;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CliResult {
  output: string;
  exitCode: number;
}

function takeOption(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, v !== undefined && !v.startsWith('--') ? 2 : 1);
  return v !== undefined && !v.startsWith('--') ? v : undefined;
}

/**
 * `specship design extract <source...> [--out <design.md> [--title <t>] [--origin <url>]] [--update <design.md>]`
 * Without --out/--update, prints the generated block.
 */
export function runDesignExtractCli(argv: string[], opts: { projectRoot: string; date?: string }): CliResult {
  const args = [...argv];
  const out = takeOption(args, '--out');
  const update = takeOption(args, '--update');
  const title = takeOption(args, '--title');
  const origin = takeOption(args, '--origin');
  const date = opts.date ?? today();
  const sources = args.filter((a) => !a.startsWith('--'));
  if (out && update) return { output: 'use either --out (new file) or --update (existing file), not both', exitCode: 1 };

  let x;
  try {
    x = extractDesign(sources, opts);
  } catch (err) {
    if (err instanceof DesignSourceError) return { output: err.message, exitCode: 1 };
    throw err;
  }

  if (update) {
    const target = path.resolve(opts.projectRoot, update);
    let existing: string;
    try {
      existing = fs.readFileSync(target, 'utf-8');
    } catch {
      return { output: `cannot read ${update} — create it with --out first`, exitCode: 1 };
    }
    try {
      const res = updateDesignMd(existing, renderGeneratedBlock(x), date);
      if (!res.changed) return { output: `${update} is already current`, exitCode: 0 };
      fs.writeFileSync(target, res.content);
      const n = res.diff.added.length + res.diff.removed.length + res.diff.changed.length;
      return { output: `updated ${update} (${n} value change${n === 1 ? '' : 's'} logged)`, exitCode: 0 };
    } catch (err) {
      if (err instanceof DesignMdUpdateError) return { output: `${update}: ${err.message}`, exitCode: 1 };
      throw err;
    }
  }

  if (out) {
    const target = path.resolve(opts.projectRoot, out);
    if (fs.existsSync(target)) return { output: `${out} already exists — use --update ${out} to refresh it`, exitCode: 1 };
    const name = title ?? path.basename(path.dirname(target));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderDesignMd(x, { title: name, origin, date }));
    return {
      output: `wrote ${out} — fill in the authored sections, then run \`specship design check ${out}\``,
      exitCode: 0,
    };
  }

  return { output: renderGeneratedBlock(x), exitCode: 0 };
}

/** `specship design check <design.md> [--json]` */
export function runDesignCheckCli(argv: string[], opts: { projectRoot: string }): CliResult {
  const args = [...argv];
  const json = args.includes('--json');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) return { output: 'usage: specship design check <design.md> [--json]', exitCode: 1 };

  const results: { file: string; findings: DesignCheckFinding[] }[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(path.resolve(opts.projectRoot, file), 'utf-8');
    } catch {
      results.push({ file, findings: [{ code: 'design_missing_generated_block', severity: 'error', message: `cannot read ${file}` }] });
      continue;
    }
    results.push({ file, findings: checkDesignMd(content, opts) });
  }
  const errors = results.reduce((n, r) => n + r.findings.filter((f) => f.severity === 'error').length, 0);
  if (json) return { output: JSON.stringify({ results, errors }, null, 2), exitCode: errors > 0 ? 1 : 0 };

  const lines: string[] = [];
  for (const r of results) {
    if (r.findings.length === 0) {
      lines.push(`${r.file}: ok`);
      continue;
    }
    for (const f of r.findings) lines.push(`${r.file}${f.line ? `:${f.line}` : ''}  ${f.severity}  ${f.code}  ${f.message}`);
  }
  lines.push(errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : 'design check passed');
  return { output: lines.join('\n'), exitCode: errors > 0 ? 1 : 0 };
}

/** `specship design verify <build.html> --against <design.md>` (REQ-DESIGNMD-008). */
export function runDesignVerifyCli(argv: string[], opts: { projectRoot: string }): CliResult {
  const args = [...argv];
  const against = takeOption(args, '--against');
  const build = args.filter((a) => !a.startsWith('--'))[0];
  if (!build || !against) return { output: 'usage: specship design verify <build.html> --against <design.md>', exitCode: 1 };
  let designMd: string;
  try {
    designMd = fs.readFileSync(path.resolve(opts.projectRoot, against), 'utf-8');
  } catch {
    return { output: `cannot read ${against}`, exitCode: 1 };
  }
  try {
    const result = verifyBuild(designMd, build, opts);
    return { output: formatVerify(result, build), exitCode: result.ok ? 0 : 1 };
  } catch (err) {
    if (err instanceof DesignSourceError) return { output: err.message, exitCode: 1 };
    throw err;
  }
}
