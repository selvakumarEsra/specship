# SpecShip Token Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface, in the desktop dashboard, the tokens SpecShip *consumed* (measured) and an *estimated* tokens-saved figure, per prompt → session → project → all-projects, on a new "SpecShip Impact" page.

**Architecture:** All pure, testable logic (tool classification, symbol extraction, graph-grounded read-equivalent estimation) lives in the `src/` library where the root vitest suite imports it directly. The `packages/server` ingestor stores three new `claude_tool_calls` columns at ingest: `is_specship` (flag), `resolution` (`resolved`/`unresolved`/`n/a`), and **`displaced_files`** — a JSON array `[[path, size], …]` of the distinct files a source-returning call's symbols resolved to. **Dedup is done at read time, per prompt** (union the files across a prompt's calls), which is correct across the ingestor's batch boundaries and matches the spec's query-time lean. A new Fastify endpoint aggregates via a small JS pass over those rows; a new Angular page renders them. Estimation fails safe toward under-claiming (unresolvable → no files, disclosed).

**Tech Stack:** TypeScript, better-sqlite3 / node-sqlite3-wasm, Fastify (`packages/server`), Angular signals (`packages/web-ng`), vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-24-specship-token-impact-design.md`

---

## File Structure

> **Data-model note:** the per-call savings basis is stored as `displaced_files` (JSON `[[path,size],…]`), **not** a pre-summed scalar — so the aggregate can dedup files per prompt at read time. There is intentionally no `displaced_chars` column; any per-call or per-prompt char total is derived by summing distinct file sizes in JS.

**Create:**
- `src/analytics/specship-impact.ts` — pure helpers: `isSpecshipTool`, `isSourceReturningTool`, `extractRequestedSymbols`. No I/O.
- `__tests__/specship-impact-classify.test.ts` — unit tests for the above.
- `__tests__/specship-impact-estimate.test.ts` — unit tests for `SpecShip.estimateReadEquivalent`.
- `__tests__/specship-impact-ingest.test.ts` — integration: ingest synthetic JSONL → assert new columns.
- `__tests__/specship-impact-endpoint.test.ts` — integration: aggregation query/endpoint totals.
- `packages/server/src/ingest/impact-query.ts` — `computeSpecshipImpact(db, {since, project})` aggregation (testable, route calls it).
- `packages/web-ng/src/app/pages/specship-impact/specship-impact.ts` / `.html` / `.scss` — the new page.

**Modify:**
- `src/db/migrations.ts` — bump `CURRENT_SCHEMA_VERSION` to 9; add v9 migration.
- `src/index.ts` — add `estimateReadEquivalent(symbols: string[])` method.
- `packages/server/src/ingest/ingestor.ts` — extend the `claude_tool_calls` INSERT + compute new columns.
- `packages/server/src/ingest/backfill.ts` (or wherever startup runs) — lazy `displaced_chars` backfill for old rows. (If no such file exists, add the function to `impact-query.ts` and call it from the ingest watcher's initial pass.)
- `packages/server/src/routes/claude.ts` — add `GET /api/claude/specship-impact`; extend session-detail tool-call rows + `/session/:id/summary` with specship fields.
- `packages/web-ng/src/app/app.routes.ts` — add `specship-impact` route.
- `packages/web-ng/src/app/shell/sidebar/sidebar.ts` — add nav item.
- `packages/web-ng/src/app/api/types.ts` — add `SpecshipImpactResponse`; extend tool-call + summary types.
- `packages/web-ng/src/app/pages/session-detail/session-detail.ts` / `.html` — per-prompt chip + per-session line.
- `CHANGELOG.md`, `site/src/content/docs/claude-code/overview.md` — docs.

---

## Task 1: Schema migration v9 (new columns + `is_specship` backfill)

**Files:**
- Modify: `src/db/migrations.ts:12` (version), append to `migrations[]` (after the v8 entry, ~`:404`)
- Test: `__tests__/specship-impact-migration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/specship-impact-migration.test.ts
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../src/db/migrations';

describe('v9 specship-impact migration', () => {
  it('adds columns and backfills is_specship from tool_name', () => {
    const db = new Database(':memory:');
    // minimal prerequisite tables
    db.exec(`CREATE TABLE claude_prompts (id TEXT PRIMARY KEY);
             CREATE TABLE claude_tool_calls (id INTEGER PRIMARY KEY, prompt_id TEXT, tool_name TEXT, result_length INTEGER DEFAULT 0);`);
    db.exec(`INSERT INTO claude_tool_calls (tool_name) VALUES
             ('mcp__specship__specship_explore'), ('Read'), ('mcp__specship__designer_session');`);
    runMigrations(db as any, 0); // fromVersion=0 → applies ALL migrations up to CURRENT_SCHEMA_VERSION
    const cols = db.prepare(`PRAGMA table_info(claude_tool_calls)`).all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['is_specship', 'displaced_files', 'resolution']));
    const flags = db.prepare(`SELECT tool_name, is_specship FROM claude_tool_calls ORDER BY id`).all();
    expect(flags).toEqual([
      { tool_name: 'mcp__specship__specship_explore', is_specship: 1 },
      { tool_name: 'Read', is_specship: 0 },
      { tool_name: 'mcp__specship__designer_session', is_specship: 1 },
    ]);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
  });
});
```

> NOTE: the runner is `runMigrations(db, fromVersion)` in `src/db/migrations.ts` — `fromVersion` is **required** (pass `0` to apply all, or `getCurrentVersion(db)`). Calling it with one arg runs **zero** migrations and the test fails for the wrong reason. Confirm the export names before writing.

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/specship-impact-migration.test.ts` → FAIL (columns missing / version < 9).

- [ ] **Step 3: Implement** — in `src/db/migrations.ts`: set `CURRENT_SCHEMA_VERSION = 9` and append:

```ts
{
  version: 9,
  description: 'specship-impact: classify specship tool calls + store read-displacement',
  up: (db) => {
    if (!hasColumn(db, 'claude_tool_calls', 'is_specship'))
      db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN is_specship INTEGER NOT NULL DEFAULT 0;`);
    if (!hasColumn(db, 'claude_tool_calls', 'displaced_files'))
      db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN displaced_files TEXT;`); -- JSON [[path,size],…] | NULL
    if (!hasColumn(db, 'claude_tool_calls', 'resolution'))
      db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN resolution TEXT;`);
    db.exec(`UPDATE claude_tool_calls SET is_specship = 1 WHERE tool_name LIKE 'mcp__specship__%';`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_claude_tool_calls_specship ON claude_tool_calls(is_specship);`);
  },
}
```

Also add the three columns + index to `src/db/schema.sql` (`claude_tool_calls`, ~`:392`) so a fresh DB matches a migrated one.

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ingest): v9 migration — specship-impact columns on claude_tool_calls"`

---

## Task 2: Pure classifier + symbol-extraction helpers

**Files:**
- Create: `src/analytics/specship-impact.ts`
- Test: `__tests__/specship-impact-classify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isSpecshipTool, isSourceReturningTool, extractRequestedSymbols } from '../src/analytics/specship-impact';

describe('specship-impact classifiers', () => {
  it('isSpecshipTool matches all mcp__specship__* tools', () => {
    expect(isSpecshipTool('mcp__specship__specship_explore')).toBe(true);
    expect(isSpecshipTool('mcp__specship__designer_session')).toBe(true);
    expect(isSpecshipTool('Read')).toBe(false);
  });
  it('isSourceReturningTool only the code-graph readers', () => {
    for (const t of ['specship_node','specship_explore','specship_callers','specship_callees','specship_impact','specship_search','specship_files'])
      expect(isSourceReturningTool(`mcp__specship__${t}`)).toBe(true);
    expect(isSourceReturningTool('mcp__specship__designer_session')).toBe(false);
    expect(isSourceReturningTool('mcp__specship__specship_link_assert')).toBe(false);
    expect(isSourceReturningTool('mcp__specship__specship_link_verify')).toBe(false);
  });
  it('extractRequestedSymbols pulls names from input_json by tool', () => {
    expect(extractRequestedSymbols('mcp__specship__specship_node',
      JSON.stringify({ symbol: 'handleRequest' }))).toEqual(['handleRequest']);
    expect(extractRequestedSymbols('mcp__specship__specship_explore',
      JSON.stringify({ query: 'mutateElement renderScene' }))).toEqual(['mutateElement', 'renderScene']);
    expect(extractRequestedSymbols('mcp__specship__specship_explore',
      JSON.stringify({ query: 'how does updating an element rerender the canvas' }))).toEqual([]); // NL → none
    expect(extractRequestedSymbols('mcp__specship__specship_node', 'not json')).toEqual([]);
  });
});
```

> NOTE: the NL-vs-symbol-bag rule in `extractRequestedSymbols` for `explore` is heuristic. v1 rule (document it in the file): tokenize the `query` on whitespace; treat it as a symbol bag ONLY if every token looks like an identifier or `Class.method` (regex `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$`) and there are ≤ 6 tokens; otherwise return `[]` (unresolved). Verify the actual input shapes in `src/mcp/tools.ts`: `specship_explore` takes **only `query`** (no `symbols` field); `specship_node`/`callers`/`callees`/`impact` take `symbol`; `specship_search` takes a query string; `specship_files` takes a path filter (treat `files` as resolvable-by-path, contributing that dir's files' sizes, or n/a in v1 — pick one and document).

- [ ] **Step 2: Run, verify FAIL** (module missing).
- [ ] **Step 3: Implement `src/analytics/specship-impact.ts`** with the constants (`SOURCE_RETURNING = new Set([...])`), the two predicates, and `extractRequestedSymbols` per the documented rule. Pure functions only; no imports beyond types.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat(analytics): specship tool classifiers + symbol extraction`

---

## Task 3: `SpecShip.estimateReadEquivalent(symbols)`

**Files:**
- Modify: `src/index.ts` (add method on the `SpecShip` class near `getNodesByName`/`getFile`, ~`:979`–`1044`)
- Test: `__tests__/specship-impact-estimate.test.ts`

- [ ] **Step 1: Write the failing test** — build a real tiny project, index it, then assert:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import SpecShip from '../src/index';

let dir: string;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

describe('estimateReadEquivalent', () => {
  it('sums distinct file sizes for resolved symbols; flags unresolved', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-impact-'));
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export function alpha(){ return 1 }\n'.repeat(20));
    const ss = new SpecShip(dir); await ss.init(); await ss.indexAll();
    const sizeA = fs.statSync(path.join(dir, 'a.ts')).size;

    const hit = ss.estimateReadEquivalent(['alpha']);
    expect(hit.resolved).toBe(true);
    expect(hit.files).toEqual([{ path: 'a.ts', size: sizeA }]); // project-relative path

    const dup = ss.estimateReadEquivalent(['alpha', 'alpha']); // distinct files only
    expect(dup.files).toEqual([{ path: 'a.ts', size: sizeA }]);

    const miss = ss.estimateReadEquivalent(['doesNotExist']);
    expect(miss.resolved).toBe(false);
    expect(miss.files).toEqual([]);

    const empty = ss.estimateReadEquivalent([]);
    expect(empty.resolved).toBe(false);
    expect(empty.files).toEqual([]);
    await ss.close();
  });
});
```

> NOTE: verify the exact public API (`getNodesByName`, `getFile(path).size`, and the SpecShip constructor/`init`/`indexAll`/`close` signatures) against `src/index.ts`. Adjust calls to match.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `estimateReadEquivalent(symbols: string[]): { files: { path: string; size: number }[]; resolved: boolean }`:
  - For each symbol: `getNodesByName(symbol)` → collect distinct `file_path`s. (If a name has many hits, take all distinct files — conservative upper bound; cap at e.g. 5 files/symbol to avoid a god-name blowup, documented.)
  - Dedup file paths across all symbols (`Map<path, size>` via `getFile(fp)?.size ?? 0`).
  - Return `{ files: [...{path,size}], resolved: files.length > 0 }`. (Returning the file *list*, not a sum, lets the aggregate dedup per prompt across calls.)
  - `getNodesByName` verified present (`src/index.ts:979`); `getFile().size` is bytes (`FileRecord.size`, `src/types.ts:216`).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat(lib): estimateReadEquivalent — graph-grounded read displacement`

---

## Task 4: Wire computation into the ingestor (+ confirm cross-package test import)

**Files:**
- Modify: `packages/server/src/ingest/ingestor.ts:353-356` (INSERT), `:489-499` and `:603-613` (call sites)
- Test: `__tests__/specship-impact-ingest.test.ts`

- [ ] **Step 1: De-risk the test boundary FIRST.** Write a one-line import test and run it:

```ts
// top of __tests__/specship-impact-ingest.test.ts
import { ingestAll } from '../packages/server/src/ingest/ingestor';
import { describe, it, expect } from 'vitest';
it('cross-package import resolves', () => { expect(typeof ingestAll).toBe('function'); });
```

Run `npx vitest run __tests__/specship-impact-ingest.test.ts`. Root `vitest.config.ts` has `include: ['__tests__/**/*.test.ts']`, so the test IS collected, and `ingestAll` is a real export (`packages/server/src/ingest/ingestor.ts:166`) — this should pass. **If it instead errors resolving a transitive import** from `packages/server` (its own tsconfig), apply the single concrete fix: add `test: { server: { deps: { inline: [/packages\/server/] } } }` to `vitest.config.ts` (force-inline so vitest transpiles it) and re-run. Confirm green before continuing — this step gates Tasks 4–7.

- [ ] **Step 2: Write the failing integration test** — index a tiny project, run the ingestor over a synthetic JSONL containing one `specship_node` tool_use whose `input` names a real symbol + its tool_result, then assert the stored row:

```ts
// after indexing project `dir` and building a JSONL at ~/.claude-style path or via ingestAll's claudeRoot option:
const row = db.prepare(`SELECT tool_name, is_specship, displaced_files, resolution FROM claude_tool_calls WHERE tool_name = 'mcp__specship__specship_node'`).get();
expect(row.is_specship).toBe(1);
expect(row.resolution).toBe('resolved');
expect(JSON.parse(row.displaced_files).length).toBeGreaterThan(0); // [[path,size],…]
// a Read row: is_specship 0, resolution null, displaced_files null
// a designer_session row: is_specship 1, resolution 'n/a', displaced_files null
```

Also add an **unresolved fixture**: a `specship_node` call whose symbol doesn't exist OR a session whose project index is absent ⇒ `resolution = 'unresolved'`, `displaced_files = NULL`, but the row still exists with exact `result_length`.

- [ ] **Step 3: Run, verify FAIL.**
- [ ] **Step 4: Implement.** Add a **shared pure helper** `classifyToolCall({ toolName, inputJson, resultLength }, graph): { isSpecship: 0|1; resolution: 'resolved'|'unresolved'|'n/a'|null; displacedFiles: string|null }` (in `src/analytics/specship-impact.ts`, so Tasks 4 and 5 share it — DRY). Logic:
    - `isSpecship = isSpecshipTool(name) ? 1 : 0`
    - if `isSpecship` and `isSourceReturningTool(name)` and `resultLength > 0`: `symbols = extractRequestedSymbols(name, inputJson)`; if `symbols.length` and `graph` available → `{ files, resolved } = graph.estimateReadEquivalent(symbols)`; `resolution = resolved ? 'resolved' : 'unresolved'`; `displacedFiles = resolved ? JSON.stringify(files.map(f => [f.path, f.size])) : null`.
    - else if `isSpecship` (designer/spec/mutating or zero-length): `resolution = 'n/a'`, `displacedFiles = null`.
    - else (non-specship): `isSpecship = 0`, `resolution = null`, `displacedFiles = null`.
  - **No per-prompt running set needed** — files are stored per call; the aggregate (Task 6) dedups per prompt at read time, which is correct even when a prompt's calls land across ingest batches.
  - In `ingestor.ts`: extend the prepared INSERT (`:353`) to add `is_specship, displaced_files, resolution` (3 more `?`). Thread a `resolveGraph?: (projectPath: string) => SpecShipLike | null` option into `IngestOptions` (server default uses `ProjectRegistry.get`; tests pass a stub returning the indexed `SpecShip`). Call `classifyToolCall` at both insert sites (`:489`, `:603`); the `:603` pending site has `result_length = 0` → `n/a`.
- [ ] **Step 5: Run, verify PASS.**
- [ ] **Step 6: Commit** — `feat(ingest): compute is_specship/displaced_chars/resolution at ingest`

---

## Task 5: Lazy backfill of `displaced_chars` for pre-existing rows

**Files:**
- Create/Modify: `packages/server/src/ingest/impact-query.ts` (`backfillDisplaced(db, resolveGraph)`)
- Wire: call once from the watcher's initial pass (`packages/server/src/ingest/watcher.ts` initial `triggerSoon`, or server boot)
- Test: extend `__tests__/specship-impact-ingest.test.ts`

- [ ] **Step 1: Write failing test** — seed a row with `is_specship=1, resolution=NULL` (as the v9 migration leaves old rows), run `backfillDisplaced`, assert it becomes `resolved`/`n/a` with `displaced_files` set/NULL accordingly. Rows already non-NULL `resolution` are untouched (idempotent).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — select `WHERE is_specship = 1 AND resolution IS NULL`, recompute via the shared `classifyToolCall` from Task 4 (DRY), `UPDATE` `resolution` + `displaced_files`. Cap batch size; safe to re-run (idempotent).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat(ingest): backfill displaced_chars for existing specship calls`

---

## Task 6: `GET /api/claude/specship-impact` + aggregation function

**Files:**
- Create: `packages/server/src/ingest/impact-query.ts` → `computeSpecshipImpact(db, { since, project })`
- Modify: `packages/server/src/routes/claude.ts` (register route, ~with the other `/api/claude/*` routes)
- Test: `__tests__/specship-impact-endpoint.test.ts`

- [ ] **Step 1: Write failing test** for `computeSpecshipImpact`: seed `claude_sessions` (two projects) + `claude_prompts` + `claude_tool_calls` with known `result_length` / `displaced_files` (JSON `[[path,size],…]`) / `resolution` / `is_specship` / `prompt_id`. Include a prompt with **two resolved calls that share a file** to prove per-prompt dedup. Assert:
  - `spendTokens = ceil(Σ result_length(is_specship) / 4)`
  - **Per-prompt savings (deduped):** for each prompt, `promptReadEquiv = Σ size over the UNION of `displaced_files` paths across that prompt's resolved calls`; `promptSpend = Σ result_length over that prompt's is_specship calls`; `promptSaved = max(0, promptReadEquiv − promptSpend)`. Then `savedTokens = ceil(Σ promptSaved / 4)`. The shared-file prompt must count that file's size **once**.
  - `unresolvedCalls = count(resolution='unresolved')`; `totalSpecshipCalls = count(is_specship=1)`.
  - `byTool` rows; `byProject` only when `project` omitted; `project` filter scopes correctly (decoded slug).
  - `netTokens = savedTokens − spendTokens − overheadTokens`.

> NOTE (dedup): savings is computed **per prompt at read time** — `computeSpecshipImpact` reads the scoped rows, groups by `prompt_id` in JS, and unions each prompt's `displaced_files` paths before summing sizes. This is correct regardless of ingest batch boundaries (every call's resolved files are stored). There is **no** `GROUP BY prompt_id, file` SQL — file identity lives in the JSON, so the grouping is a JS pass, not SQL. SQL is used only to *fetch* the scoped rows + the flat spend/coverage/byTool counts.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `computeSpecshipImpact`** (SQL fetch + JS reduction):
  - Fetch scoped rows: `SELECT tc.prompt_id, tc.tool_name, tc.is_specship, tc.result_length, tc.displaced_files, s.project_path, s.last_model, tc.ts FROM claude_tool_calls tc JOIN claude_sessions s ON s.id = tc.session_id WHERE tc.ts >= ? [AND s.project_path = ?]`.
  - **Spend**: `ceil(Σ result_length where is_specship=1 / 4)`. **Saved**: group rows by `prompt_id`, union `JSON.parse(displaced_files)` paths per prompt (dedup, sum sizes), subtract the prompt's specship spend chars, `max(0,…)`, sum, `/4`. **Coverage**: count `resolution='unresolved'` and `is_specship=1`.
  - `byTool`: group by `tool_name` (calls, spend). `byProject` (only when `project` omitted): rerun the per-prompt reduction grouped by `project_path`. `trend`: bucket by day over the range.
  - `overheadTokens`: `ceil(SPECSHIP_TOOLDEF_CHARS / 4) × (count of distinct sessions that used specship in range)`. Define `SPECSHIP_TOOLDEF_CHARS` as a measured constant (Step 3a).
  - Cost: price spend/saved tokens at each row's model input rate via `resolvePricing`/`computeCost` (treat as input tokens). Unknown model → omit cost contribution.
- [ ] **Step 3a:** measure the tool-def payload once: serialize the specship MCP tool list (from `src/mcp/tools.ts` definitions) to JSON, take `.length`, store as the constant with a comment citing how it was measured.
- [ ] **Step 4:** add the route in `routes/claude.ts` calling `computeSpecshipImpact(getDb(cg), { since: rangeStart(rangeKey(req.query.range)), project: req.query.project ? normalizeProjectFilter(req.query.project) : undefined })`; return its object. Add a route-level test hitting the registered Fastify app if the suite has an app-builder helper; otherwise the function-level test in Step 1 is the coverage.
- [ ] **Step 5: Run, verify PASS.**
- [ ] **Step 6: Commit** — `feat(server): /api/claude/specship-impact aggregation endpoint`

---

## Task 7: Expose specship fields on session detail (chip + summary line data)

**Files:**
- Modify: `packages/server/src/routes/claude.ts` — the session-detail tool-call query (add `is_specship, displaced_files, resolution` to the SELECT) and `/session/:id/summary` (add `specship: { spendTokens, savedTokens, netTokens }`, reusing `computeSpecshipImpact` scoped to the one session)
- Modify: `packages/web-ng/src/app/api/types.ts` — extend `ClaudeToolCall` + `SessionSummaryResponse`
- Test: extend `__tests__/specship-impact-endpoint.test.ts`

- [ ] **Step 1: Write failing test** — seed a session; assert the summary endpoint returns `specship.spendTokens/savedTokens/netTokens` matching the seeded rows.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** the SELECT additions + summary aggregation (reuse `computeSpecshipImpact` scoped to one session, or a thin per-session SQL). Update the TS types.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat(server): session detail surfaces specship spend/saved`

---

## Task 8: "SpecShip Impact" page (route + sidebar + component)

**Files:**
- Create: `packages/web-ng/src/app/pages/specship-impact/specship-impact.{ts,html,scss}`
- Modify: `app.routes.ts` (add route), `shell/sidebar/sidebar.ts` (nav item under "Claude Code"), `api/types.ts` (`SpecshipImpactResponse`)

- [ ] **Step 1:** add `SpecshipImpactResponse` to `api/types.ts` mirroring the endpoint shape (spendTokens, spendCostUsd, savedTokens, savedCostUsd, overheadTokens, netTokens, netCostUsd, unresolvedCalls, totalSpecshipCalls, byTool[], byProject[], trend[]).
- [ ] **Step 2:** create the component (copy `pages/costs/costs.ts` pattern): `apiResource<SpecshipImpactResponse>(this.api, () => \`/api/claude/specship-impact?range=${this.range()}\`)`, a `range` signal + `Segmented`, computed derivations for tiles/trend/tables.
- [ ] **Step 3:** template (`.html`) — `PageHead`; header tiles (Spend, **Est. saved** with an `est.` badge, Net with `Delta`, Coverage "N unresolved of M calls"); a `LineChart` spend-vs-saved trend; a by-tool table; a by-project table shown only when no project is picked; a methodology disclosure footer (chars÷4; file-size displacement; per-prompt dedup; unresolved=0; cost at input rate). Reuse existing components (`Icon`, `Segmented`, `Delta`, `LineChart`).
- [ ] **Step 4:** register the route in `app.routes.ts` (`path: 'specship-impact'`, lazy `loadComponent`, `data: { nav: 'specship-impact', title: 'SpecShip Impact' }`) and add the sidebar nav item `{ id: 'specship-impact', label: 'SpecShip Impact', icon: 'graph' }`.
- [ ] **Step 5: Build + manual verify** — `npm --prefix packages/web-ng run build` (or the repo's web build) succeeds; then `specship serve --ui`, open `127.0.0.1:4242/specship-impact`, confirm tiles render, the `est.` badge shows, switching the project picker toggles the by-project table, and the empty state appears for a project with no specship usage.
- [ ] **Step 6: Commit** — `feat(web): SpecShip Impact page`

---

## Task 9: Per-prompt chip + per-session line on Session Detail

**Files:**
- Modify: `packages/web-ng/src/app/pages/session-detail/session-detail.ts` (`PromptGroup` + `groups` computed), `session-detail.html`

- [ ] **Step 1:** extend `PromptGroup` with `specshipSpendTokens` / `specshipSavedTokens`, computed in `groups` from the prompt's tool calls (the `is_specship`/`resolution`/`displaced_files` fields now arrive on `ClaudeToolCall` from Task 7): `spend = ceil(Σ result_length over is_specship rows / 4)`; `saved = ceil(max(0, (Σ size over the UNION of displaced_files paths across this prompt's resolved calls) − spendChars) / 4)` — the same per-prompt dedup as the aggregate, applied to one prompt's rows.
- [ ] **Step 2:** render a `SpecShip ~X tok` chip on each prompt row beside the tool-mix chips (only when `specshipSpendTokens > 0`), tooltip "spent ~X · est. saved ~Y".
- [ ] **Step 3:** render the per-session line from `summaryData()?.specship` in the session-summary panel: `SpecShip: spent ~A · est. saved ~B · net C`, with an `est.` marker.
- [ ] **Step 4: Manual verify** — open a session that used specship; confirm chips + the summary line; a session with no specship usage shows neither.
- [ ] **Step 5: Commit** — `feat(web): per-prompt + per-session specship spend on Session Detail`

---

## Task 10: Docs

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`), `site/src/content/docs/claude-code/overview.md`

- [ ] **Step 1:** add a `[Unreleased] → ### New Features` bullet (user-facing, no internal paths/symbols): the dashboard now shows how many tokens SpecShip's tools spent and an *estimated* tokens-saved figure, per prompt/session/project and across all projects, on a new SpecShip Impact page.
- [ ] **Step 2:** add a short "SpecShip Impact" subsection to `claude-code/overview.md` (and the five-ways table) describing the page + that savings is an estimate.
- [ ] **Step 3:** `npm run build` (root) passes; `npm --prefix site run build` passes.
- [ ] **Step 4: Commit** — `docs: SpecShip Impact page (changelog + site)`

---

## Final verification (before handoff to review)

- [ ] `npm run build` (root tsc + asset copy) succeeds.
- [ ] `npm test` green (new tests included).
- [ ] `npm --prefix site run build` succeeds (no broken links/sidebar).
- [ ] Manual: `specship serve --ui` → SpecShip Impact page + Session Detail chip/line behave per spec; estimates flagged; unresolved disclosed.

## Out of scope (Phase 2)
- Per-workflow attribution (needs executor → prompt/session linkage).
- Real tokenizer (replace chars÷4).
