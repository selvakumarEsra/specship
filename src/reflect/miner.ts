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
  destructiveMin: 2, // R5: a destructive shell op seen ≥N times
  editHotspotTotal: 8, // R6: same file Edited ≥N times overall
  editHotspotSessions: 2, // R6: …across ≥N sessions
  correctionMin: 2, // R7: same corrective instruction repeated ≥N times
  specshipColdReadMin: 15, // R8: reads/greps in a session to count as read-heavy
  specshipColdSessions: 2, // R8: ≥N read-heavy sessions with zero specship calls
  heavyOutputBytes: 50000, // R9: a Bash call whose result exceeds N "tokens"
  heavyOutputMin: 2, // R9: …seen ≥N times
  refDocSessions: 3, // R10: a doc file Read across ≥N distinct sessions
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
  // Round 2 detectors.
  out.push(...ruleDestructiveCommands(db, ctx));
  out.push(...ruleEditHotspot(db, ctx));
  out.push(...ruleRecurringCorrection(db, ctx));
  // Round 3 detectors.
  out.push(...ruleSpecshipCold(db, ctx));
  out.push(...ruleHeavyOutput(db, ctx));
  out.push(...ruleReferenceDoc(db, ctx));
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

/** Destructive shell-operation categories the agent should treat with care. */
const DESTRUCTIVE: Array<{ key: string; label: string; re: RegExp }> = [
  { key: 'rm-rf', label: 'recursive force-delete (`rm -rf`)', re: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\b|\brm\s+-[a-z]*f[a-z]*r[a-z]*\b/i },
  { key: 'git-force-push', label: 'force push (`git push --force`)', re: /\bgit\s+push\b[^|;&]*(--force\b|--force-with-lease\b|\s-f\b)/i },
  { key: 'git-reset-hard', label: 'hard reset (`git reset --hard`)', re: /\bgit\s+reset\b[^|;&]*--hard\b/i },
  { key: 'git-clean', label: 'force clean (`git clean -fd`)', re: /\bgit\s+clean\b[^|;&]*-[a-z]*f/i },
  { key: 'drop-db', label: 'dropping a table/database (`DROP …`)', re: /\bdrop\s+(table|database|schema)\b/i },
];

/**
 * R5 → memory_rule (project CLAUDE.md): destructive shell operations showed up
 * in the transcripts. A high-severity caution rule is the durable response — we
 * deliberately propose a *rule* rather than auto-generating a fragile guard
 * script (a guard-hook variant is a future detector).
 */
function ruleDestructiveCommands(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(`SELECT session_id, input_summary AS cmd FROM claude_tool_calls WHERE tool_name = 'Bash' AND input_summary != ''`)
    .all() as Array<{ session_id: string; cmd: string }>;
  const buckets = new Map<string, { count: number; sessions: Set<string>; sample: string }>();
  for (const r of rows) {
    for (const d of DESTRUCTIVE) {
      if (d.re.test(r.cmd)) {
        const b = buckets.get(d.key) ?? { count: 0, sessions: new Set<string>(), sample: r.cmd };
        b.count++;
        b.sessions.add(r.session_id);
        buckets.set(d.key, b);
      }
    }
  }
  const out: Proposal[] = [];
  for (const d of DESTRUCTIVE) {
    const b = buckets.get(d.key);
    if (!b || b.count < THRESHOLDS.destructiveMin) continue;
    out.push(
      buildProposal(ctx, {
        type: 'memory_rule',
        scope: 'project',
        severity: 'high',
        nameSeed: `caution-${d.key}`,
        title: `Treat ${d.label} with care`,
        body: `${d.label} ran ${b.count} times across ${b.sessions.size} session(s). A standing caution keeps an irreversible operation from being run without a beat of confirmation.`,
        content: `Before running ${d.label}, pause and confirm the target is correct — these operations are irreversible. Prefer a dry-run or a narrower, reversible alternative when one exists.`,
        evidence: {
          sessions: [...b.sessions].slice(0, 8),
          prompts: [],
          detail: `${d.label} × ${b.count} across ${b.sessions.size} session(s)`,
        },
      }),
    );
  }
  return out;
}

/**
 * R6 → memory_rule (project CLAUDE.md): a file is edited over and over across
 * sessions — a hotspot whose contract is worth documenting so future edits
 * don't relearn it from scratch.
 */
function ruleEditHotspot(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(
      `SELECT input_summary AS file, COUNT(*) AS n, COUNT(DISTINCT session_id) AS s,
              GROUP_CONCAT(DISTINCT session_id) AS sessions
       FROM claude_tool_calls
       WHERE tool_name IN ('Edit', 'Write', 'MultiEdit') AND input_summary != ''
       GROUP BY input_summary
       HAVING n >= ? AND s >= ?
       ORDER BY n DESC
       LIMIT ?`,
    )
    .all(THRESHOLDS.editHotspotTotal, THRESHOLDS.editHotspotSessions, PER_RULE_LIMIT) as Array<{
    file: string;
    n: number;
    s: number;
    sessions: string;
  }>;
  return rows.map((r) => {
    const base = r.file.split('/').pop() || r.file;
    return buildProposal(ctx, {
      type: 'memory_rule',
      scope: 'project',
      severity: 'warn',
      nameSeed: `hotspot-${base}`,
      title: `Document the contract of ${base} — it changes often`,
      body: `${base} was edited ${r.n} times across ${r.s} sessions. Capturing its invariants (and what must stay true after a change) saves rediscovering them on every edit.`,
      content: `\`${base}\` is a frequently-edited hotspot. Before changing it, check \`specship_explore\` for its callers and document the invariants a change must preserve. Consider whether it needs tighter test coverage.`,
      evidence: {
        sessions: (r.sessions || '').split(',').filter(Boolean).slice(0, 8),
        prompts: [],
        detail: `${base} edited × ${r.n} across ${r.s} sessions`,
      },
    });
  });
}

/** Leading cues that mark a prompt as a correction of the agent's behavior. */
const CORRECTION_CUE = /^(no\b|don'?t\b|do not\b|never\b|always\b|stop\b|instead\b|actually\b|you should\b|please don'?t\b)/i;

/**
 * R7 → memory_rule (portable ~/.claude/memory): the user keeps issuing the same
 * corrective instruction. That's a durable preference worth recording so it
 * doesn't have to be repeated — the core Hermes "learn from corrections" idea.
 */
function ruleRecurringCorrection(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
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
    const trimmed = r.text.trim();
    if (!CORRECTION_CUE.test(trimmed)) continue;
    const key = trimmed.replace(/\s+/g, ' ').toLowerCase();
    const g = groups.get(key) ?? { count: 0, prompts: [], sample: trimmed };
    g.count++;
    if (g.prompts.length < 8) g.prompts.push(r.id);
    groups.set(key, g);
  }
  const repeated = [...groups.values()]
    .filter((g) => g.count >= THRESHOLDS.correctionMin)
    .sort((a, b) => b.count - a.count)
    .slice(0, PER_RULE_LIMIT);
  return repeated.map((g) =>
    buildProposal(ctx, {
      type: 'memory_rule',
      scope: 'portable',
      severity: 'warn',
      nameSeed: `correction-${g.sample}`,
      title: `Recurring correction: "${truncate(g.sample, 48)}"`,
      body: `You've given this correction ${g.count} times. Recording it as a durable preference means you shouldn't have to repeat it.`,
      content: `Standing user preference (you have repeated this): ${g.sample}`,
      evidence: {
        sessions: [],
        prompts: g.prompts,
        detail: `Correction repeated ${g.count}×`,
      },
    }),
  );
}

/**
 * R8 → memory_rule (portable ~/.claude/memory): sessions that lean hard on
 * Read/grep while making zero specship calls. SpecShip is indexed here, so a
 * portable habit-note to query it first is the durable fix. Uses the
 * `is_specship` classification on tool calls.
 */
function ruleSpecshipCold(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(
      `SELECT session_id,
              SUM(CASE WHEN tool_name IN ('Read','Grep')
                        OR (tool_name='Bash' AND (input_summary LIKE 'grep%' OR input_summary LIKE '%grep %'
                              OR input_summary LIKE 'find %' OR input_summary LIKE 'rg %'))
                       THEN 1 ELSE 0 END) AS reads,
              SUM(is_specship) AS ss
       FROM claude_tool_calls
       GROUP BY session_id
       HAVING reads >= ? AND ss = 0`,
    )
    .all(THRESHOLDS.specshipColdReadMin) as Array<{ session_id: string; reads: number; ss: number }>;
  if (rows.length < THRESHOLDS.specshipColdSessions) return [];
  const totalReads = rows.reduce((a, r) => a + r.reads, 0);
  return [
    buildProposal(ctx, {
      type: 'memory_rule',
      scope: 'portable',
      severity: 'warn',
      nameSeed: 'query-specship-first',
      title: 'Query SpecShip before reading or grepping',
      body: `${rows.length} read-heavy sessions (${totalReads} Read/grep calls) made no specship calls at all. SpecShip is the pre-built index for this code — a structural query usually answers in one call what a grep+read loop takes many.`,
      content:
        'This project is indexed by SpecShip. For "how does X work" / "where is X" / trace / impact questions, call `specship_explore` (or `specship_search`) FIRST and treat the returned source as already Read — only fall back to Read/grep to confirm a detail it did not cover.',
      evidence: {
        sessions: rows.map((r) => r.session_id).slice(0, 8),
        prompts: [],
        detail: `${rows.length} read-heavy sessions with 0 specship calls`,
      },
    }),
  ];
}

/**
 * R9 → memory_rule (project CLAUDE.md): a Bash command that dumps a huge result
 * into context, repeatedly. Scoping its output (or using a structural query) is
 * the durable fix. Uses `result_length`.
 */
function ruleHeavyOutput(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(
      `SELECT input_summary AS cmd, COUNT(*) AS n, MAX(result_length) AS maxlen,
              GROUP_CONCAT(DISTINCT session_id) AS sessions
       FROM claude_tool_calls
       WHERE tool_name = 'Bash' AND input_summary != '' AND result_length > ?
       GROUP BY input_summary
       HAVING n >= ?
       ORDER BY maxlen DESC
       LIMIT ?`,
    )
    .all(THRESHOLDS.heavyOutputBytes, THRESHOLDS.heavyOutputMin, PER_RULE_LIMIT) as Array<{
    cmd: string;
    n: number;
    maxlen: number;
    sessions: string;
  }>;
  return rows.map((r) =>
    buildProposal(ctx, {
      type: 'memory_rule',
      scope: 'project',
      severity: 'warn',
      nameSeed: `heavy-output-${r.cmd}`,
      title: `Scope the output of \`${truncate(r.cmd, 40)}\``,
      body: `\`${truncate(r.cmd, 80)}\` returned up to ~${Math.round(r.maxlen / 1000)}k tokens and ran ${r.n} times. Dumping large output into context is a dominant cost driver.`,
      content: `When you need the result of \`${truncate(r.cmd, 80)}\`, scope it (filter, head, or target a path) — or answer the underlying question with a \`specship_search\`/\`specship_explore\` query instead of reading the full output into context.`,
      evidence: {
        sessions: (r.sessions || '').split(',').filter(Boolean).slice(0, 8),
        prompts: [],
        detail: `~${Math.round(r.maxlen / 1000)}k-token output × ${r.n}`,
      },
    }),
  );
}

/**
 * R10 → memory_rule (project CLAUDE.md): a documentation file read across many
 * separate sessions is context the agent keeps rediscovering. Pointing at it
 * from CLAUDE.md keeps it in context. Distinct from R1 (in-session re-reads of
 * any file) — this keys on cross-session breadth of a *doc* file.
 */
function ruleReferenceDoc(db: SqliteDatabase, ctx: ReflectContext): Proposal[] {
  const rows = db
    .prepare(
      `SELECT input_summary AS file, COUNT(DISTINCT session_id) AS s,
              GROUP_CONCAT(DISTINCT session_id) AS sessions
       FROM claude_tool_calls
       WHERE tool_name = 'Read' AND input_summary != ''
         AND (input_summary LIKE '%.md' OR input_summary LIKE '%.mdx'
              OR input_summary LIKE '%.txt' OR input_summary LIKE '%.rst'
              OR input_summary LIKE '%.adoc')
       GROUP BY input_summary
       HAVING s >= ?
       ORDER BY s DESC
       LIMIT ?`,
    )
    .all(THRESHOLDS.refDocSessions, PER_RULE_LIMIT) as Array<{
    file: string;
    s: number;
    sessions: string;
  }>;
  return rows.map((r) => {
    const base = r.file.split('/').pop() || r.file;
    return buildProposal(ctx, {
      type: 'memory_rule',
      scope: 'project',
      severity: 'warn',
      nameSeed: `reference-${base}`,
      title: `Reference ${base} from CLAUDE.md`,
      body: `${base} was read in ${r.s} separate sessions — context the agent keeps rediscovering. Pointing at it from CLAUDE.md (or importing it with @path) keeps it on hand without a Read each time.`,
      content: `\`${base}\` is frequently-needed context. Add a short pointer to it here (or import it with \`@${r.file}\`) so its guidance is always in context instead of re-Read each session.`,
      evidence: {
        sessions: (r.sessions || '').split(',').filter(Boolean).slice(0, 8),
        prompts: [],
        detail: `${base} read across ${r.s} sessions`,
      },
    });
  });
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
