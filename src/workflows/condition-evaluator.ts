/**
 * Condition evaluator + `$nodeId.output` substitution.
 *
 * Modeled on Archon's evaluator (packages/workflows/src/dag-executor.ts:331-372).
 *
 * Two responsibilities:
 *   1. Substitute `$nodeId.output[.field]` references in a template string
 *      with the corresponding upstream node output.
 *   2. Evaluate `when:` expressions to gate a node's execution.
 *
 * Design choices:
 *   - Unresolvable field references THROW `OutputRefError` (no silent drop).
 *   - Unparseable `when:` expressions FAIL CLOSED (skip the node) so an
 *     authoring mistake doesn't run a step the author didn't intend.
 *   - Large outputs (>10KB) are spilled to a file and the substitution
 *     emits a `$(cat <file>)` shell command for bash nodes (so they don't
 *     blow up the shell argv); for prompt nodes the raw text is inlined.
 */

import * as fs from 'fs';
import * as path from 'path';

export class OutputRefError extends Error {
  constructor(public ref: string, message: string) {
    super(`OutputRef "${ref}": ${message}`);
    this.name = 'OutputRefError';
  }
}

/**
 * Output of a completed node. `text` is always present; `structured` is
 * set when the runner produced a structured payload (e.g. a prompt node
 * that returned JSON).
 */
export interface NodeOutput {
  text: string;
  structured?: Record<string, unknown>;
}

export interface SubstitutionContext {
  /** Outputs of completed nodes, keyed by node ID. */
  outputs: Map<string, NodeOutput>;
  /**
   * Workflow inputs (e.g., SPEC_ID). Referenced as `$INPUT.<name>` in
   * templates — we keep them in a separate namespace so an input named
   * `output` doesn't collide with a node ID.
   */
  inputs?: Record<string, string>;
  /**
   * Static workflow variables: `$CONTEXT`, `$ARTIFACTS_DIR`, etc.
   * Same namespace as inputs (replaced before $nodeId.output runs).
   */
  variables?: Record<string, string>;
  /** Working directory for spill files (default: `os.tmpdir()`). */
  spillDir?: string;
  /** Override the 10KB spill threshold (in bytes). */
  spillThreshold?: number;
}

/** Pattern matching `$nodeId` or `$nodeId.output` or `$nodeId.output.field` or `$VAR`. */
const REF_PATTERN = /\$([A-Z_][A-Z0-9_]*|[a-zA-Z_][a-zA-Z0-9_-]*)(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?(?:\.([a-zA-Z_][a-zA-Z0-9_]*))?/g;

const DEFAULT_SPILL_THRESHOLD = 10 * 1024;

/**
 * Substitute references in a template. Returns the substituted string.
 * Throws OutputRefError for unresolvable named-field references.
 *
 * `forBash`: when true and a substituted value exceeds the spill threshold,
 * writes the value to a temp file and substitutes `$(cat <file>)` instead
 * of the raw text — preventing shell argv overflow.
 */
export function substituteRefs(
  template: string,
  ctx: SubstitutionContext,
  opts: { forBash?: boolean; nodeId?: string } = {}
): string {
  const spillDir = ctx.spillDir ?? require('os').tmpdir();
  const threshold = ctx.spillThreshold ?? DEFAULT_SPILL_THRESHOLD;

  return template.replace(REF_PATTERN, (match, name, second, third) => {
    // Static variables ($CONTEXT, $ARTIFACTS_DIR, $INPUT.NAME): UPPER_SNAKE name.
    if (/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      // `$INPUT.SPEC_ID` style: name='INPUT', second='SPEC_ID'
      if (name === 'INPUT' && second) {
        const v = ctx.inputs?.[second];
        if (v === undefined) {
          throw new OutputRefError(
            match,
            `input "${second}" not provided to this workflow`
          );
        }
        return v;
      }
      // `$ARTIFACTS_DIR`, `$CONTEXT`, etc.
      const v = ctx.variables?.[name];
      if (v !== undefined) return v;
      // Fall through to node-id lookup (an UPPER_SNAKE word might be a node ID).
    }

    // Node-output reference. Second segment must be `output` for v1.
    if (second !== 'output') {
      // Bare `$nodeId` with no `.output` is treated as plain text (no substitution).
      // This lets prompt authors include literal `$variableName` references
      // without escaping when they're not addressing a node.
      if (second === undefined) return match;
      throw new OutputRefError(
        match,
        `expected ".output" after node ID; got ".${second}"`
      );
    }

    const out = ctx.outputs.get(name);
    if (!out) {
      throw new OutputRefError(
        match,
        `node "${name}" has not produced output yet (not run, skipped, or failed)`
      );
    }

    let value: unknown;
    if (third) {
      // Field access: prefer structured, fall back to JSON-parsed text.
      if (out.structured !== undefined && third in out.structured) {
        value = out.structured[third];
      } else {
        try {
          const parsed = JSON.parse(out.text);
          if (parsed && typeof parsed === 'object' && third in parsed) {
            value = (parsed as Record<string, unknown>)[third];
          } else {
            throw new OutputRefError(
              match,
              `field "${third}" not found in node "${name}" output`
            );
          }
        } catch (err) {
          if (err instanceof OutputRefError) throw err;
          throw new OutputRefError(
            match,
            `node "${name}" output is not JSON-parseable; can't access field "${third}"`
          );
        }
      }
    } else {
      value = out.text;
    }

    const asString = typeof value === 'string' ? value : JSON.stringify(value);

    // Spill very large values to a file for bash nodes (argv overflow).
    if (opts.forBash && asString.length > threshold) {
      const filename = `cg-spill-${opts.nodeId ?? 'node'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
      const spillPath = path.join(spillDir, filename);
      try {
        fs.writeFileSync(spillPath, asString);
        return `"$(cat ${shellEscape(spillPath)})"`;
      } catch {
        // Fall through to inline if we can't spill — better than failing.
      }
    }

    if (opts.forBash) {
      // Single-quote-wrap for shell safety. Embedded single quotes get escaped.
      return shellSingleQuote(asString);
    }
    return asString;
  });
}

/**
 * Evaluate a `when:` condition expression. Fail-closed: on parse error,
 * returns false (the node skips).
 *
 * Grammar (subset, no parens):
 *   expr   := and (`||` and)*
 *   and    := cmp (`&&` cmp)*
 *   cmp    := value op value
 *   op     := `==` | `!=` | `<` | `>` | `<=` | `>=`
 *   value  := $ref | 'string' | "string" | bare_word | number
 */
export function evaluateCondition(
  expression: string,
  ctx: SubstitutionContext
): boolean {
  // First substitute $refs to their values (using a "raw" form — no quoting,
  // no spilling). We do this before tokenizing so the parser sees literal
  // values, not symbolic refs.
  let substituted: string;
  try {
    substituted = substituteRefs(expression, ctx, { forBash: false });
  } catch (err) {
    if (err instanceof OutputRefError) {
      // Unresolvable ref in a `when:` expression — fail closed.
      return false;
    }
    throw err;
  }

  try {
    return evalOr(substituted);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mini expression evaluator (no recursion through full grammar — linear scan).
// ---------------------------------------------------------------------------

function evalOr(expr: string): boolean {
  return splitTopLevel(expr, '||').some((sub) => evalAnd(sub.trim()));
}

function evalAnd(expr: string): boolean {
  return splitTopLevel(expr, '&&').every((sub) => evalCmp(sub.trim()));
}

function splitTopLevel(expr: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i <= expr.length - sep.length; i++) {
    const ch = expr[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (inSingle || inDouble) continue;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && expr.startsWith(sep, i)) {
      out.push(expr.slice(last, i));
      last = i + sep.length;
      i += sep.length - 1;
    }
  }
  out.push(expr.slice(last));
  return out;
}

const OP_PATTERN = /(==|!=|<=|>=|<|>)/;

function evalCmp(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  const match = trimmed.match(OP_PATTERN);
  if (!match) {
    // No operator — treat as truthy test: non-empty string is true.
    return parseValue(trimmed).trim().length > 0;
  }
  const op = match[1] as string;
  const idx = match.index!;
  const left = parseValue(trimmed.slice(0, idx).trim());
  const right = parseValue(trimmed.slice(idx + op.length).trim());

  if (op === '==') return left === right;
  if (op === '!=') return left !== right;

  // Numeric comparisons require both sides to be parseable as numbers.
  const ln = Number(left);
  const rn = Number(right);
  if (!Number.isFinite(ln) || !Number.isFinite(rn)) return false;
  switch (op) {
    case '<': return ln < rn;
    case '>': return ln > rn;
    case '<=': return ln <= rn;
    case '>=': return ln >= rn;
  }
  return false;
}

function parseValue(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return s.slice(1, -1);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Shell escaping helpers
// ---------------------------------------------------------------------------

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function shellEscape(s: string): string {
  // Escape spaces and shell metachars for the `cat` argument.
  if (/^[A-Za-z0-9_./@:+-]+$/.test(s)) return s;
  return shellSingleQuote(s);
}
