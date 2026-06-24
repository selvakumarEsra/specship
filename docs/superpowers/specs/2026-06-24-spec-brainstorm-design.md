# `spec-brainstorm` — Design

**Date:** 2026-06-24
**Status:** Design (pre-implementation)

## 1. Goal

Add the **divergent** front-end of SpecShip's spec-driven flow: a `spec-brainstorm` capability that analyses a requirement, grounds it in the existing code, explores approaches, and loops with the human — then, **only on explicit confirmation**, produces a traceable design brief and hands off to `spec-author` to create an ID'd spec. Surface the brief in the dashboard so the *why* behind a spec is visible.

Chain: `/ss-brainstorm <requirement>` → (human confirms) → `spec-author` → `/ss-spec-review <ID>` → `/ss-implement <ID>`.

## 2. Decisions (settled in brainstorming)

| Decision | Choice |
|---|---|
| Output | A confirmed **design brief**; `spec-author` turns it into the formal spec (not spec-brainstorm writing the spec directly). |
| Form | A **conversational loop**, not a workflow (brainstorming is divergent multi-turn dialogue, which a deterministic DAG + single-comment approval gate fits poorly). **Delivered as a self-contained slash command** `commands/ss-brainstorm.md` — full instructions in the body — because SpecShip's installer ships `commands/` + `agents/` but **not** skills (verified: `spec-author`'s `SKILL.md` is an external pre-install; `/ss-spec-author` only references it). This matches how `ss-fix` / `ss-implement` / `ss-design-loop` are self-contained command bodies. |
| Confirmation gate | **Nothing is written to disk until the human explicitly confirms.** No confirm ⇒ zero output (no brief, no spec). |
| On confirm | Write the brief, then hand off to `spec-author`, which assigns/uses the real spec **ID** and writes `specs/<ID>.md`. Confirmation reliably yields a real ID'd spec, not a floating brief. |
| Traceability | **Bidirectional** brief ↔ spec links (added requirement). |
| UI | The dashboard **Specs page visualises the brainstorm brief** for a spec (added requirement). |
| ID ownership | `spec-author` owns the `specs/` ID namespace; the brief only *proposes* a slug. |

## 3. The loop & the confirmation gate (load-bearing)

`spec-brainstorm` runs entirely conversationally in the current session:

1. **Scope check** — refuse "brainstorm the whole app"; pick a feature area.
2. **Ground in code** — `specship_explore` / `specship_search` to find where similar features live, conventions to mirror, files the work will touch.
3. **Approaches** — propose **2–3** with trade-offs and a recommendation.
4. **Clarify** — ask questions **one at a time** (UX, edge cases, acceptance criteria — what the graph can't answer).
5. **Iterate** until the human is satisfied.

**Invariant (the firm requirement):** during steps 1–5 **no file is created or modified**. The brief and the spec materialise **only after an explicit affirmative confirmation** from the human (e.g. "confirmed" / "write it"). Abandonment, "no", or silence ⇒ **no output at all**. The skill MUST treat the default as no-write and require an unambiguous yes. This is the primary thing the skill's eval verifies.

## 4. On confirmation → brief + ID'd spec (with traceability)

In order:

1. **Write the brief** to **`specs/<slug>/brief.md`** (locked: subdirectory form, matching the design-import flow's `specs/<slug>/source.md`). The brief's `spec:` field is **omitted (or `(pending)`)** until step 2 succeeds, so a partial-write state is detectable.
2. **Hand off to `spec-author`** by passing it the **brief file path** (no new spec-author "mode" — it reads the brief and, because grounding is already in the brief, **skips its own re-grounding**). `spec-author` writes `specs/<ID>.md` (frontmatter `id`/`title`/`owner`/`priority`, `<!-- id: REQ-… -->` markers, RFC-2119 MUST/SHOULD). **On spec-author failure:** the brief stays with `spec:` unset and the skill surfaces the error; retry = re-run `spec-author` with the same brief path. No half-linked spec is left.
3. **Link both directions:**
   - Spec frontmatter gains **`brief: <slug>/brief.md`** (relative to the spec file's own directory, so it resolves whether the spec is flat or nested).
   - Brief header gains **`spec: <ID>`** (and the spec's path).
4. Point the human to `/ss-spec-review <ID>` then `/ss-implement <ID>`.

### Brief contents
Problem statement · code-grounding findings (relevant files / symbols / conventions) · approaches considered + chosen + rationale · key decisions · edge cases · acceptance criteria · proposed slug · (after handoff) the produced spec ID. Mirrors the design-loop's `decision-record.md` provenance pattern.

## 5. Traceability — link lives in the files, read on demand

- **Spec → brief:** the spec file's frontmatter carries an optional **`brief: <slug>/brief.md`** field (written at handoff). It is **not** pushed through the indexer/DB (no extractor or schema change — the design stays schema-free). Instead the new brief endpoint (§6) **reads the spec's source file and parses `brief:` directly**, exactly like the existing `GET /api/spec/:id` already reads `source` from disk.
- **Brief → spec:** the brief's header names the spec `id` + path (human-readable).
- This reuses the same provenance idea the design-import flow uses (`specs/<slug>/source.md`), so the convention is consistent.
- *(Surfacing the brief link inside `specship_spec` MCP output would need the extractor/metadata work — deferred to a later phase; v1 traceability is the file frontmatter + the dashboard.)*

## 6. UI — visualise the brief on the Specs page

- **Server:** add `GET /api/spec/:id/brief` to `packages/server/src/routes/spec.ts` — resolves the spec's `brief:` frontmatter to a path under the project's specs root, reads the markdown, returns `{ path, markdown }` (404 when the spec has no brief; path-traversal guarded to the specs dir).
- **Web-ng:** on the Specs page (`packages/web-ng/src/app/pages/specs/`), when the selected spec has a brief, show a **collapsible "Brainstorm" panel** (locked: a collapsible `@if` block, not a new tab strip — lighter, matches the page) that renders `brief.md` with the existing markdown renderer (the same one Memory/Specs use). Absent brief ⇒ no panel.
- **Types:** extend the spec detail type with an optional `brief` indicator so the page knows whether to fetch.

## 7. Packaging

Delivered as a **self-contained slash command** (the installer ships commands, not skills):
- **`commands/ss-brainstorm.md`** — the full conversational loop in the command body: scope check, code-grounding, 2–3 approaches, one-question-at-a-time clarify, the **confirmation gate** rules (no write until explicit yes), the brief format, and the handoff that calls **`/ss-spec-author`** with the brief path for the convergent drafting. `allowed-tools` mirrors `ss-spec-author` (Read, Write, Edit, Bash, the read-only `specship_*` tools).
- **Register** `'ss-brainstorm.md'` in `SHIPPED_COMMANDS` (`src/installer/targets/claude.ts`) so `specship install` copies it (global `~/.claude/commands/` or local `./.claude/commands/`). The npm `files` array already includes `commands/`.
- **Installer test** coverage in `__tests__/installer-targets.test.ts` (the contract suite asserts the shipped command set installs + uninstalls) and a CHANGELOG entry.

No separate `SKILL.md`, no `skills/` dir (not shippable by this installer). No workflow YAML. No MCP tool changes. Schema: none (the `brief` field rides existing frontmatter parsing).

> The convergent handoff target `/ss-spec-author` already depends on an externally-installed `spec-author` skill — that's the existing project reality, unchanged by this feature.

## 8. Error handling & edge cases

- **No confirmation** ⇒ no files (the invariant). A partial/ambiguous "maybe" is treated as no.
- **Brief write succeeds but spec-author fails** ⇒ surface the error; the brief exists but is clearly marked as not-yet-spec'd (and the handoff is retryable). Don't leave a half-linked spec.
- **Spec has no brief** ⇒ UI shows no panel; `GET …/brief` returns 404; nothing breaks.
- **Brief path resolution** ⇒ confined to the project's specs root (no traversal outside).
- **Re-brainstorm of the same feature** ⇒ a new confirmation overwrites/append-versions the brief; existing spec ID preserved if one is being refined.

## 9. Testing

- **Skill evals** (like `spec-author/evals/`): the confirmation gate refuses to write without an explicit yes; a confirmed run yields a brief **and** an ID'd spec via spec-author; it grounds in code; the boundary with spec-author has no duplicated drafting.
- **Server test:** `GET /api/spec/:id/brief` parses the spec file's `brief:` frontmatter, returns the brief markdown for a spec with one, 404 without (or no brief field), and rejects path traversal outside the specs root.
- **Installer test:** `/ss-brainstorm` + the skill are installed and removed by uninstall (parameterised contract suite).
- **Web build** passes with the new panel.

## 10. Out of scope (v1)

- No workflow YAML version.
- The brief is not indexed as a spec node (it's provenance, not requirements).
- No automated "approaches" generation beyond what the skill prompts — it's a guided dialogue, not a generator.

## 11. Decisions locked (were open during review)

- **Brief path:** `specs/<slug>/brief.md` (subdirectory form, matching `source.md`).
- **spec-author input:** the skill passes the **brief file path**; spec-author reads it and skips re-grounding. **No new spec-author "mode"** — at most a one-line note in `spec-author`'s skill that a supplied brief means grounding is done. Keeps installer/test scope tight.
- **Specs-page affordance:** a **collapsible panel** (`@if` block), not a tab strip.
- **`brief:` frontmatter:** promoted to the extractor's known-keys → top-level spec-node field.
