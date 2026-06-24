# SpecShip Token Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface, in the desktop dashboard, the tokens SpecShip *consumed* (measured) and an *estimated* tokens-saved figure, per prompt → session → project → all-projects, on a new "SpecShip Impact" page.

**Architecture:** All pure, testable logic (tool classification, symbol extraction, graph-grounded read-equivalent estimation) lives in the `src/` library where the root vitest suite imports it directly. The `packages/server` ingestor computes three new `claude_tool_calls` columns (`is_specship`, `displaced_chars`, `resolution`) at ingest using that logic. A new Fastify endpoint aggregates them in SQL; a new Angular page renders them. Estimation fails safe toward under-claiming (unresolvable → 0, disclosed).

**Tech Stack:** TypeScript, better-sqlite3 / node-sqlite3-wasm, Fastify (`packages/server`), Angular signals (`packages/web-ng`), vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-24-specship-token-impact-design.md`

---

## File Structure

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
    runMigrations(db as any); // applies up to CURRENT_SCHEMA_VERSION
    const cols = db.prepare(`PRAGMA table_info(claude_tool_calls)`).all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['is_specship', 'displaced_chars', 'resolution']));
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

> NOTE: confirm the exported migration runner name (`runMigrations` / `applyMigrations`) and signature in `src/db/migrations.ts` and match the test to it.

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run __tests__/specship-impact-migration.test.ts` → FAIL (columns missing / version < 9).

- [ ] **Step 3: Implement** — in `src/db/migrations.ts`: set `CURRENT_SCHEMA_VERSION = 9` and append:

```ts
{
  version: 9,
  description: 'specship-impact: classify specship tool calls + store read-displacement',
  up: (db) => {
    if (!hasColumn(db, 'claude_tool_calls', 'is_specship'))
      db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN is_specship INTEGER NOT NULL DEFAULT 0;`);
    if (!hasColumn(db, 'claude_tool_calls', 'displaced_chars'))
      db.exec(`ALTER TABLE claude_tool_calls ADD COLUMN displaced_chars INTEGER;`);
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
    expect(isSourceReturningTool('mcp__specship__specship_node')).toBe(true);
    expect(isSourceReturningTool('mcp__specship__specship_explore')).toBe(true);
    expect(isSourceReturningTool('mcp__specship__designer_session')).toBe(false);
    expect(isSourceReturningTool('mcp__specship__specship_link_assert')).toBe(false);
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

> NOTE: the NL-vs-symbol-bag rule in `extractRequestedSymbols` for `explore` is heuristic. v1 rule (document it in the file): tokenize the query on whitespace; treat it as a symbol bag ONLY if every token looks like an identifier or `Class.method` (regex `^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)?$`) and there are ≤ 6 tokens; otherwise return `[]` (unresolved). Mirror the input shapes actually used by the MCP tools in `src/mcp/tools.ts` — verify `node` uses `symbol`, `explore` uses `query`/`symbols`, `callers`/`callees`/`impact` use `symbol`.

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
    expect(hit.displacedChars).toBe(sizeA);

    const dup = ss.estimateReadEquivalent(['alpha', 'alpha']); // dedup file
    expect(dup.displacedChars).toBe(sizeA);

    const miss = ss.estimateReadEquivalent(['doesNotExist']);
    expect(miss.resolved).toBe(false);
    expect(miss.displacedChars).toBe(0);

    const empty = ss.estimateReadEquivalent([]);
    expect(empty.resolved).toBe(false);
    await ss.close();
  });
});
```

> NOTE: verify the exact public API (`getNodesByName`, `getFile(path).size`, and the SpecShip constructor/`init`/`indexAll`/`close` signatures) against `src/index.ts`. Adjust calls to match.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** `estimateReadEquivalent(symbols: string[]): { displacedChars: number; resolved: boolean }`:
  - For each symbol: `getNodesByName(symbol)` → collect distinct `file_path`s. (If a name has many hits, take all distinct files — conservative upper bound; cap at e.g. 5 files/symbol to avoid a god-name blowup, documented.)
  - Dedup files across all symbols into a `Set`.
  - `displacedChars = Σ getFile(fp)?.size ?? 0` over the set.
  - `resolved = (set.size > 0)`.
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

Run `npx vitest run __tests__/specship-impact-ingest.test.ts`. **If it errors on resolving the import**, add `packages/**/__tests__` is NOT how this repo works — instead, fallback: temporarily re-export the ingest entry from a path vitest can reach, or extend `vitest.config.ts` `include`/`resolve.alias`. Resolve this before continuing (it gates Tasks 4–7).

- [ ] **Step 2: Write the failing integration test** — index a tiny project, run the ingestor over a synthetic JSONL containing one `specship_node` tool_use whose `input` names a real symbol + its tool_result, then assert the stored row:

```ts
// after indexing project `dir` and building a JSONL at ~/.claude-style path or via ingestAll's claudeRoot option:
const row = db.prepare(`SELECT tool_name, is_specship, displaced_chars, resolution FROM claude_tool_calls WHERE tool_name LIKE 'mcp__specship__%'`).get();
expect(row.is_specship).toBe(1);
expect(row.resolution).toBe('resolved');
expect(row.displaced_chars).toBeGreaterThan(0);
// and a Read row: is_specship 0, resolution null, displaced_chars null
```

Also add an **unresolved fixture**: a `specship_node` call whose symbol doesn't exist OR a session whose project index is absent ⇒ `resolution = 'unresolved'`, `displaced_chars = NULL`, but the row still exists with exact `result_length`.

- [ ] **Step 3: Run, verify FAIL.**
- [ ] **Step 4: Implement.** In `ingestor.ts`:
  - Extend the prepared INSERT (`:353`) to add `is_specship, displaced_chars, resolution` (3 more `?`).
  - Import `isSpecshipTool`, `isSourceReturningTool`, `extractRequestedSymbols` from the built lib, and obtain the session's graph via the project registry (`ProjectRegistry.get(session.project_path)` → `estimateReadEquivalent`). The ingestor must receive a way to resolve a project's SpecShip instance — thread a `resolveGraph?: (projectPath: string) => SpecShipLike | null` option into `IngestOptions` (default provided by the server using `ProjectRegistry`; tests pass a stub that returns the indexed `SpecShip`).
  - Compute per tool call:
    - `is_specship = isSpecshipTool(name) ? 1 : 0`
    - if `is_specship` and `isSourceReturningTool(name)` and `result_length > 0`: `symbols = extractRequestedSymbols(name, input_json)`; if `symbols.length` and graph resolves → `{displacedChars, resolved}`; `resolution = resolved ? 'resolved' : 'unresolved'`, `displaced_chars = resolved ? displacedChars : null`.
    - else if `is_specship` (designer/spec/mutating or zero-length): `resolution = 'n/a'`, `displaced_chars = null`.
    - else (non-specship): `is_specship = 0`, `resolution = null`, `displaced_chars = null`.
  - Apply at both insert sites (`:489`, `:603`); the `:603` pending site has `result_length = 0` → `n/a`.
- [ ] **Step 5: Run, verify PASS.**
- [ ] **Step 6: Commit** — `feat(ingest): compute is_specship/displaced_chars/resolution at ingest`

---

## Task 5: Lazy backfill of `displaced_chars` for pre-existing rows

**Files:**
- Create/Modify: `packages/server/src/ingest/impact-query.ts` (`backfillDisplaced(db, resolveGraph)`)
- Wire: call once from the watcher's initial pass (`packages/server/src/ingest/watcher.ts` initial `triggerSoon`, or server boot)
- Test: extend `__tests__/specship-impact-ingest.test.ts`

- [ ] **Step 1: Write failing test** — seed a row with `is_specship=1, resolution=NULL` (as the v9 migration leaves old rows), run `backfillDisplaced`, assert it becomes `resolved`/`n/a` with `displaced_chars` set/!set accordingly. Rows already resolved are untouched (idempotent).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — select `WHERE is_specship = 1 AND resolution IS NULL`, recompute exactly as Task 4 (reusing the same helper — extract the per-row compute into a shared `classifyToolCall(...)` so Task 4 and Task 5 share it, DRY). Cap batch size; safe to re-run.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat(ingest): backfill displaced_chars for existing specship calls`

---

## Task 6: `GET /api/claude/specship-impact` + aggregation function

**Files:**
- Create: `packages/server/src/ingest/impact-query.ts` → `computeSpecshipImpact(db, { since, project })`
- Modify: `packages/server/src/routes/claude.ts` (register route, ~with the other `/api/claude/*` routes)
- Test: `__tests__/specship-impact-endpoint.test.ts`

- [ ] **Step 1: Write failing test** for `computeSpecshipImpact`: seed `claude_sessions` (two projects) + `claude_tool_calls` with known `result_length` / `displaced_chars` / `resolution` / `is_specship`, then assert:
  - `spendTokens = ceil(Σ result_length(is_specship) / 4)`
  - `savedTokens = ceil(Σ max(0, displaced_chars − result_length) over resolution='resolved', deduped per (prompt_id,file)*) / 4`  *(v1 dedup: see note)*
  - `unresolvedCalls = count(resolution='unresolved')`
  - `byTool` rows; `byProject` only when `project` omitted; `project` filter scopes correctly (decoded slug).
  - `netTokens = savedTokens − spendTokens − overheadTokens`.

> NOTE (dedup): `displaced_chars` is stored per call without the file identity, so per-`(prompt_id,file)` dedup can't be done purely in SQL from the stored scalar. v1 decision: dedup is applied **at compute time in Task 4** (a file counted once per prompt when computing that prompt's calls) — i.e., within a prompt, later calls hitting an already-counted file contribute 0 to `displaced_chars`. Document this in `classifyToolCall`. The endpoint then sums the already-deduped scalars. If cross-call dedup within a prompt proves too coupled at ingest, fall back to storing the resolved file list (json) — but that's a larger change; keep v1 simple with per-prompt running set passed through the prompt's tool-call loop.

- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement `computeSpecshipImpact`** (pure SQL + a small JS post-step for token/cost/overhead):
  - Spend/coverage/byTool/byProject/trend via `SELECT ... FROM claude_tool_calls tc JOIN claude_sessions s ON s.id = tc.session_id WHERE tc.ts >= ? [AND s.project_path = ?]`.
  - `overheadTokens`: `ceil(SPECSHIP_TOOLDEF_CHARS / 4) × (count of distinct sessions that used specship in range)`. Define `SPECSHIP_TOOLDEF_CHARS` as a measured constant (Step 3a).
  - Cost: price `spendTokens`/`savedTokens` at each session's model input rate via `resolvePricing`/`computeCost` (treat as input tokens). Unknown model → omit cost contribution.
- [ ] **Step 3a:** measure the tool-def payload once: serialize the specship MCP tool list (from `src/mcp/tools.ts` definitions) to JSON, take `.length`, store as the constant with a comment citing how it was measured.
- [ ] **Step 4:** add the route in `routes/claude.ts` calling `computeSpecshipImpact(getDb(cg), { since: rangeStart(rangeKey(req.query.range)), project: req.query.project ? normalizeProjectFilter(req.query.project) : undefined })`; return its object. Add a route-level test hitting the registered Fastify app if the suite has an app-builder helper; otherwise the function-level test in Step 1 is the coverage.
- [ ] **Step 5: Run, verify PASS.**
- [ ] **Step 6: Commit** — `feat(server): /api/claude/specship-impact aggregation endpoint`

---

## Task 7: Expose specship fields on session detail (chip + summary line data)

**Files:**
- Modify: `packages/server/src/routes/claude.ts` — the session-detail tool-call query (add `is_specship, displaced_chars, resolution` to the SELECT) and `/session/:id/summary` (add `specship: { spendTokens, savedTokens, netTokens }`)
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

- [ ] **Step 1:** extend `PromptGroup` with `specshipSpendTokens` / `specshipSavedTokens`, computed in `groups` from the prompt's tool calls (`is_specship` rows: spend = ceil(Σ result_length/4); saved = ceil(Σ max(0, displaced_chars−result_length) for resolution='resolved'/4)). These fields now arrive on `ClaudeToolCall` from Task 7.
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
