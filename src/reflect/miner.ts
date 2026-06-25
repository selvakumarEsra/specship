/**
 * Proposal miner (REQ-REFLECT-001 / 002).
 *
 * Reads the ingested `claude_*` transcript tables and detects recurring,
 * actionable patterns, emitting one typed Proposal per finding with cited
 * evidence and a severity. Each rule is a bounded SQL query (mirroring the tips
 * engine's shape) feeding `buildProposal`, which resolves the concrete write
 * target and the stable content hash.
 *
 * The *set* of rules is the implementation frontier the spec deliberately left
 * open — new detectors slot in here without touching apply/store/surface.
 *
 * When the transcript tables are absent (a headless `specship reflect` against a
 * project the dashboard has never ingested), the miner returns `[]` so the
 * caller can render the empty state rather than erroring (REQ-REFLECT-001.A2).
 */

import { SqliteDatabase } from '../db/sqlite-adapter';
import { buildProposal } from './targets';
import { Proposal, ReflectContext } from './types';

/** Tuning knobs — thresholds above which a pattern is worth proposing. */
const THRESHOLDS = {
  repeatedReadsPerSession: 10, // R1: same file Read ≥N times in one session
  grepHabitTotal: 12, // R2: grep/find used ≥N times overall
  repeatedPromptCount: 3, // R3: identical ask appears ≥N times
  repeatedCmdSessions: 2, // R4: same bash command in ≥N sessions
  repeatedCmdTotal: 5, // R4: …and ≥N times overall
};

/** Per-rule cap so a noisy corpus can't flood the Improvements list. */
const PER_RULE_LIMIT = 5;

function tableExists(db: SqliteDatabase, name: string): boolean {
  try {
    const row = db
      .prepare(`SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}

/** Mine all rules. Pure read — never writes the DB or disk. */
export function mineProposals(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  if (!tableExists(db, 'claude_tool_calls') || !tableExists(db, 'claude_prompts')) {
    return [];
  }
  const out: Proposal[] = [];
  out.push(...ruleRepeatedReads(db, ctx));
  out.push(...ruleGrepHabit(db, ctx));
  out.push(...ruleRepeatedPrompts(db, ctx));
  out.push(...ruleRepeatedCommands(db, ctx));
  return out;
}

/**
 * R1 → memory_rule (project CLAUDE.md): the agent Read the same file many times
 * in a single session. A project-specific rule steering it to specship_explore
 * for that area is the durable fix.
 */
function ruleRepeatedReads(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(
      `SELECT session_id, input_summary AS file, COUNT(*) AS n
       FROM claude_tool_calls
       WHERE tool_name = 'Read' AND input_summary != ''
       GROUP BY session_id, input_summary
       HAVING n >= ?
       ORDER BY n DESC
       LIMIT ?`,
    )
    .all(THRESHOLDS.repeatedReadsPerSession, PER_RULE_LIMIT) as Array<{
    session_id: string;
    file: string;
    n: number;
  }>;
  return rows.map((r) => {
    const base = r.file.split('/').pop() || r.file;
    return buildProposal(ctx, {
      type: 'memory_rule',
      scope: 'project',
      severity: 'high',
      nameSeed: base,
      title: `Prefer specship_explore over re-reading ${base}`,
      body: `${base} was Read ${r.n} times in a single session. A structural specship_explore query returns its callers, callees, and linked specs in one call — cheaper and complete.`,
      content: `When you need to understand \`${base}\` (or the area around it), call \`specship_explore\` with the relevant symbol names first and treat the returned source as already Read — do not re-Read the file repeatedly.`,
      evidence: {
        sessions: [r.session_id],
        prompts: [],
        detail: `Read(${r.file}) × ${r.n} in one session`,
      },
    });
  });
}

/**
 * R2 → memory_rule (portable ~/.claude/memory): heavy grep/find usage is a
 * cross-project habit, so the learning is portable, not repo-specific.
 */
function ruleGrepHabit(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT session_id) AS s
       FROM claude_tool_calls
       WHERE tool_name = 'Bash'
         AND (input_summary LIKE 'grep%' OR input_summary LIKE '%grep %'
              OR input_summary LIKE 'find %' OR input_summary LIKE 'rg %')`,
    )
    .get() as { n: number; s: number } | undefined;
  if (!row || row.n < THRESHOLDS.grepHabitTotal) return [];
  const sessRows = db
    .prepare(
      `SELECT DISTINCT session_id FROM claude_tool_calls
       WHERE tool_name = 'Bash' AND (input_summary LIKE '%grep %' OR input_summary LIKE 'grep%'
             OR input_summary LIKE 'find %' OR input_summary LIKE 'rg %')
       LIMIT 8`,
    )
    .all() as Array<{ session_id: string }>;
  return [
    buildProposal(ctx, {
      type: 'memory_rule',
      scope: 'portable',
      severity: 'warn',
      nameSeed: 'prefer-specship-search-over-grep',
      title: 'Prefer specship_search over grep/find',
      body: `grep/find ran ${row.n} times across ${row.s} sessions. specship_search hits the pre-built FTS index and returns symbol locations directly — usually one call instead of a grep+read loop.`,
      content:
        'For "where is X" / "find the symbol named X" questions, reach for `specship_search` (or `specship_explore` for "how does X work") before shelling out to grep/find/rg — SpecShip is the pre-built search index, so a grep+read loop repeats work it already did.',
      evidence: {
        sessions: sessRows.map((s) => s.session_id),
        prompts: [],
        detail: `grep/find/rg × ${row.n} across ${row.s} sessions`,
      },
    }),
  ];
}

/** Normalize a prompt for grouping: trim, lowercase, collapse whitespace. */
function normalizePrompt(t: string): string {
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * R3 → skill (commands/ss-<name>.md): the user typed essentially the same ask
 * many times. A reusable slash command captures the routine.
 */
function ruleRepeatedPrompts(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(
      `SELECT id, text FROM claude_prompts
       WHERE text IS NOT NULL AND length(text) BETWEEN 12 AND 200
         AND text NOT LIKE '<%' AND text NOT LIKE '%<command-name>%'
         AND is_sidechain = 0
       ORDER BY ts DESC
       LIMIT 4000`,
    )
    .all() as Array<{ id: string; text: string }>;
  const groups = new Map<string, { count: number; prompts: string[]; sample: string }>();
  for (const r of rows) {
    const key = normalizePrompt(r.text);
    if (!key) continue;
    const g = groups.get(key) ?? { count: 0, prompts: [], sample: r.text.trim() };
    g.count++;
    if (g.prompts.length < 8) g.prompts.push(r.id);
    groups.set(key, g);
  }
  const repeated = [...groups.values()]
    .filter((g) => g.count >= THRESHOLDS.repeatedPromptCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, PER_RULE_LIMIT);
  return repeated.map((g) =>
    buildProposal(ctx, {
      type: 'skill',
      severity: 'warn',
      nameSeed: g.sample,
      title: `Capture "${truncate(g.sample, 48)}" as a command`,
      body: `This ask appeared ${g.count} times. A slash command turns the repeated instruction into one reusable invocation.`,
      content: `Run the following routine:\n\n${g.sample}`,
      evidence: {
        sessions: [],
        prompts: g.prompts,
        detail: `Same ask repeated ${g.count}×`,
      },
    }),
  );
}

/**
 * R4 → hook (.claude/settings.json): the agent ran the same shell command after
 * edits across multiple sessions. A PostToolUse hook automates the manual step.
 */
function ruleRepeatedCommands(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(
      `SELECT input_summary AS cmd, COUNT(*) AS n, COUNT(DISTINCT session_id) AS s,
              GROUP_CONCAT(DISTINCT session_id) AS sessions
       FROM claude_tool_calls
       WHERE tool_name = 'Bash' AND input_summary != ''
         AND input_summary NOT LIKE 'grep%' AND input_summary NOT LIKE '%grep %'
         AND input_summary NOT LIKE 'find %' AND input_summary NOT LIKE 'cd %'
         AND input_summary NOT LIKE 'ls%' AND input_summary NOT LIKE 'cat %'
       GROUP BY input_summary
       HAVING s >= ? AND n >= ?
       ORDER BY n DESC
       LIMIT ?`,
    )
    .all(
      THRESHOLDS.repeatedCmdSessions,
      THRESHOLDS.repeatedCmdTotal,
      PER_RULE_LIMIT,
    ) as Array<{ cmd: string; n: number; s: number; sessions: string }>;
  return rows.map((r) =>
    buildProposal(ctx, {
      type: 'hook',
      severity: 'info',
      nameSeed: r.cmd,
      title: `Automate \`${truncate(r.cmd, 40)}\` with a hook`,
      body: `\`${truncate(r.cmd, 80)}\` was run ${r.n} times across ${r.s} sessions, mostly by hand. A PostToolUse hook can run it automatically after edits.`,
      content: r.cmd,
      hook: { event: 'PostToolUse', matcher: 'Edit|Write', command: r.cmd },
      evidence: {
        sessions: (r.sessions || '').split(',').filter(Boolean).slice(0, 8),
        prompts: [],
        detail: `\`${truncate(r.cmd, 60)}\` × ${r.n} across ${r.s} sessions`,
      },
    }),
  );
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
