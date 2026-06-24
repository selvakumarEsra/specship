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
| Form | A **skill** (conversational loop), not a workflow — brainstorming is divergent multi-turn dialogue, which a deterministic DAG + single-comment approval gate fits poorly. Mirrors `spec-author` (also a skill). |
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
   - Spec frontmatter gains **`brief: <slug>/brief.md`** (relative to the specs root).
   - Brief header gains **`spec: <ID>`** (and the spec's path).
4. Point the human to `/ss-spec-review <ID>` then `/ss-implement <ID>`.

### Brief contents
Problem statement · code-grounding findings (relevant files / symbols / conventions) · approaches considered + chosen + rationale · key decisions · edge cases · acceptance criteria · proposed slug · (after handoff) the produced spec ID. Mirrors the design-loop's `decision-record.md` provenance pattern.

## 5. Traceability — make the link first-class

- **Spec → brief:** add an optional `brief:` document-level frontmatter field. `src/extraction/specs/markdown-spec-extractor.ts` already parses frontmatter; **add `brief` to its known-keys set** so it surfaces as a **top-level field** on the spec node (not nested under `metadata`) and round-trips through the index + API.
- **Brief → spec:** the brief's header names the spec `id` + path (human-readable; not indexed as a spec).
- This reuses the same provenance idea the design-import flow already uses (`specs/<slug>/source.md`), so the convention is consistent.

## 6. UI — visualise the brief on the Specs page

- **Server:** add `GET /api/spec/:id/brief` to `packages/server/src/routes/spec.ts` — resolves the spec's `brief:` frontmatter to a path under the project's specs root, reads the markdown, returns `{ path, markdown }` (404 when the spec has no brief; path-traversal guarded to the specs dir).
- **Web-ng:** on the Specs page (`packages/web-ng/src/app/pages/specs/`), when the selected spec has a brief, show a **collapsible "Brainstorm" panel** (locked: a collapsible `@if` block, not a new tab strip — lighter, matches the page) that renders `brief.md` with the existing markdown renderer (the same one Memory/Specs use). Absent brief ⇒ no panel.
- **Types:** extend the spec detail type with an optional `brief` indicator so the page knows whether to fetch.

## 7. Packaging

Ships like `spec-author`:
- `skills/spec-brainstorm/SKILL.md` + `references/` (loop guide, approaches rubric, **confirmation rules**, brief format, handoff-to-spec-author contract).
- `commands/ss-brainstorm.md` (bundled slash command `/ss-brainstorm <requirement>`).
- Installer wiring so `specship install` lays down the command + skill (plus the plugin manifest), with matching `installer-targets` coverage and a CHANGELOG entry.

No workflow YAML. No MCP tool changes. Schema: none required (the `brief` field rides existing frontmatter parsing + node metadata).

## 8. Error handling & edge cases

- **No confirmation** ⇒ no files (the invariant). A partial/ambiguous "maybe" is treated as no.
- **Brief write succeeds but spec-author fails** ⇒ surface the error; the brief exists but is clearly marked as not-yet-spec'd (and the handoff is retryable). Don't leave a half-linked spec.
- **Spec has no brief** ⇒ UI shows no panel; `GET …/brief` returns 404; nothing breaks.
- **Brief path resolution** ⇒ confined to the project's specs root (no traversal outside).
- **Re-brainstorm of the same feature** ⇒ a new confirmation overwrites/append-versions the brief; existing spec ID preserved if one is being refined.

## 9. Testing

- **Skill evals** (like `spec-author/evals/`): the confirmation gate refuses to write without an explicit yes; a confirmed run yields a brief **and** an ID'd spec via spec-author; it grounds in code; the boundary with spec-author has no duplicated drafting.
- **Extractor unit test:** a spec with `brief:` frontmatter exposes it on the spec node/metadata; absent ⇒ undefined.
- **Server test:** `GET /api/spec/:id/brief` returns the markdown for a spec with a brief, 404 without, and rejects path traversal.
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
