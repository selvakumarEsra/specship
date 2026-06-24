# spec-brainstorm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a confirmation-gated `/ss-brainstorm` command that analyses a requirement, grounds it in code, loops with the human, and — only on explicit confirmation — writes a design brief and hands off to `/ss-spec-author`, with the brief traceably linked to the spec and viewable in the dashboard.

**Architecture:** A self-contained slash command (the installer ships `commands/`, not skills) carries the conversational loop + confirmation gate + brief format + handoff. Traceability is a `brief:` field in the spec's frontmatter; a new path-guarded `GET /api/spec/:id/brief` reads that file and returns the brief markdown, which the Angular Specs page renders in a collapsible panel. No schema, MCP, or extractor changes.

**Tech Stack:** Markdown command, TypeScript (Fastify `packages/server`), Angular signals (`packages/web-ng`), vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-24-spec-brainstorm-design.md`

---

## File Structure

**Create:**
- `commands/ss-brainstorm.md` — the self-contained `/ss-brainstorm` command (the loop, confirmation gate, brief format, handoff).
- `__tests__/spec-brief-endpoint.test.ts` — server test for `GET /api/spec/:id/brief`.
- `packages/web-ng/src/app/pages/specs/brief-panel.*` — *(optional)* only if the Specs page warrants a child component; otherwise render inline.

**Modify:**
- `src/installer/targets/claude.ts` — add `'ss-brainstorm.md'` to `SHIPPED_COMMANDS`.
- `__tests__/installer-targets.test.ts` — extend the expected shipped-command set (if it asserts an exact list).
- `packages/server/src/routes/spec.ts` — add `GET /api/spec/:id/brief`.
- `packages/web-ng/src/app/pages/specs/specs.ts` + `specs.html` — fetch + render the brief panel.
- `packages/web-ng/src/app/api/types.ts` — a `SpecBriefResponse` type.
- `CHANGELOG.md` — `[Unreleased]` entry.

---

## Task 1: The `/ss-brainstorm` command (+ installer wiring)

**Files:**
- Create: `commands/ss-brainstorm.md`
- Modify: `src/installer/targets/claude.ts` (`SHIPPED_COMMANDS` array, ~`:106`)
- Test: `__tests__/installer-targets.test.ts`

- [ ] **Step 1: Write `commands/ss-brainstorm.md`** with this content (mirror the frontmatter style of `commands/ss-spec-author.md` / `ss-design-loop.md`):

````markdown
---
description: Brainstorm a requirement — analyse, ground in code, explore approaches, loop with you, and ONLY on your explicit confirmation write a design brief and hand off to /ss-spec-author. Nothing is written until you confirm.
argument-hint: <requirement to brainstorm>
allowed-tools: Read, Write, Edit, Bash, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_node, mcp__specship__specship_files, mcp__specship__specship_spec
---

# SpecShip Brainstorm: `$ARGUMENTS`

The **divergent** front of spec-driven development. You explore the problem with the human and DECIDE; `/ss-spec-author` formalizes the decision into a spec. Run this conversationally — do NOT batch.

## The hard rule (read first)

**Write NOTHING to disk until the human EXPLICITLY confirms.** No brief, no spec, no scratch file during the loop. Treat the default as no-write. A vague "maybe", "looks ok", silence, or a follow-up question is **not** confirmation — only an unambiguous "yes, write it" / "confirmed" / "go ahead" counts. If the human ends the conversation without confirming, you have produced zero files, and that is correct.

## The loop

1. **Scope check.** Refuse "brainstorm the whole app" — pick one feature area. If `$ARGUMENTS` is empty, ask what they want to brainstorm.
2. **Ground in code.** Call `mcp__specship__specship_explore` (and `specship_search`) on terms from `$ARGUMENTS` to find where similar features live, conventions to mirror, and which files the work will likely touch. Summarize what you found.
3. **Approaches.** Propose **2–3 distinct approaches** with trade-offs, and lead with your recommendation and why.
4. **Clarify.** Ask the human **one question at a time** about the things the graph can't tell you — UX, edge cases, acceptance criteria, non-goals. Don't dump a list.
5. **Iterate** 3–4 until the human is satisfied with a direction. Then ask: *"Want me to write this up as a brief and hand it to /ss-spec-author?"* — and WAIT for an explicit yes.

## On explicit confirmation (and only then)

1. Derive a kebab-case `<slug>` from the feature.
2. Write the brief to **`specs/<slug>/brief.md`** using the format below. Leave the `spec:` field **unset** for now.
3. Hand off: invoke **`/ss-spec-author`** with the brief — pass the brief's path so spec-author reads it and does NOT re-ground in code (the brief already has the grounding). spec-author assigns the real spec **ID** and writes `specs/<ID>.md`.
4. Once spec-author has written the spec: set the brief's `spec:` field to the new ID, and ensure the spec's frontmatter has **`brief: <slug>/brief.md`** (relative to the spec file's own directory) so the two link both ways.
5. If spec-author fails, STOP and tell the human: the brief exists with `spec:` unset; retry is re-running `/ss-spec-author` with the same brief path. Do not hand-write a spec.
6. Point them at `/ss-spec-review <ID>` then `/ss-implement <ID>`.

## Brief format (`specs/<slug>/brief.md`)

```markdown
---
slug: <slug>
spec:            # set to the REQ-… id after /ss-spec-author writes the spec
created: <date>
---

# Brainstorm: <feature>

## Problem
<what we're solving and why>

## Code grounding
<relevant files / symbols / conventions found via specship_explore>

## Approaches considered
1. <A> — <trade-offs>
2. <B> — <trade-offs>
**Chosen: <X>** — <rationale>

## Key decisions
<the calls made during the loop>

## Edge cases & non-goals
<…>

## Acceptance criteria
<…>
```

## Anti-patterns
- **Writing before confirmation.** The single most important rule — see above.
- **Re-interviewing about taste / proposing your own variants without grounding.** Ground first, then propose.
- **Duplicating spec-author.** You decide; spec-author formats. Don't write the formal `specs/<ID>.md` yourself.
- **Treating a question as confirmation.** Only an explicit yes writes files.
````

- [ ] **Step 2: Register the command.** In `src/installer/targets/claude.ts`, add `'ss-brainstorm.md'` to the `SHIPPED_COMMANDS` array (verify the exact array name/location, ~`:106`).

- [ ] **Step 3: Update the installer test.** Open `__tests__/installer-targets.test.ts`. If it asserts the exact set of shipped commands (count or list), add `ss-brainstorm.md`. Run `npx vitest run __tests__/installer-targets.test.ts`.
- Run: expect FAIL first (if the test pins the list), then PASS after adding.

- [ ] **Step 4: Verify install ships it.** First confirm the build copies the new command into `dist/`: check `scripts/copy-assets.*` (called from `npm run build`) copies `commands/*.md` into `dist/commands/` — the installer reads `packageAssetPath('commands', name)` which resolves under `dist/` in a real install. (Existing commands ship this way, so it's likely already covered — just confirm the glob isn't an explicit per-file list.) Then `npm run build` and rely on the installer contract suite (covers install + uninstall), or dry-run `node dist/bin/specship.js install --yes --location local` in a temp dir and confirm `./.claude/commands/ss-brainstorm.md`.

- [ ] **Step 5: CHANGELOG.** Add an `[Unreleased] → ### New Features` bullet (user-facing, no internal paths): a new `/ss-brainstorm` command that brainstorms a requirement with you and only writes a design brief + spec once you confirm.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(commands): /ss-brainstorm — confirmation-gated brainstorm → brief → spec-author"`

---

## Task 2: `GET /api/spec/:id/brief` endpoint

**Files:**
- Modify: `packages/server/src/routes/spec.ts` (add the route near `GET /api/spec/:id`, ~`:84`)
- Test: `__tests__/spec-brief-endpoint.test.ts`

The existing `GET /api/spec/:id` already reads the spec's source file via `safeProjectPath(projectRoot, spec.sourcePath)` + `fs.readFileSync`. The new route reuses that to read the spec file, parse the `brief:` frontmatter line, resolve the brief path **under the specs root**, and return its markdown.

- [ ] **Step 1: Write the failing test** (`__tests__/spec-brief-endpoint.test.ts`). Use the repo's existing server-test pattern (build a temp project, index a `specs/` dir, start/seed, or call the route handler against a seeded `SpecShip`). Cases:
  - A spec whose file frontmatter has `brief: foo/brief.md`, with `specs/foo/brief.md` present → 200 `{ path, markdown }` with the brief content.
  - A spec with **no** `brief:` field → 404.
  - A spec with `brief: ../../etc/passwd` (traversal) → 404/400, never reads outside the specs root.

> NOTE: inspect how other server tests in `__tests__/` exercise `spec.ts` routes (there may be an app-builder helper); match it. If none, test the extracted helper directly (Step 3 factors the logic into a pure function).

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement.** Add to `packages/server/src/routes/spec.ts`:
  - A small pure helper `parseBriefField(specSource: string): string | null` — extract the `brief:` value from the YAML frontmatter block (first `---`…`---`); return null if absent. (Keep it dependency-free, matching the extractor's hand-rolled frontmatter style.)
  - The route:
    ```ts
    app.get('/api/spec/:id/brief', async (req, reply) => {
      const cg = await resolveCg(app, req, reply); if (!cg) return;
      const spec = cg.getSpecQueries().getSpecById(req.params.id);
      if (!spec) return reply.code(404).send({ error: 'spec not found' });
      const projectRoot = cg.getProjectRoot();
      const specAbs = safeProjectPath(projectRoot, spec.sourcePath);
      if (!specAbs || !fs.existsSync(specAbs)) return reply.code(404).send({ error: 'no brief' });
      const briefRel = parseBriefField(fs.readFileSync(specAbs, 'utf-8'));
      if (!briefRel) return reply.code(404).send({ error: 'no brief' });
      // CONVENTION: `brief:` is relative to the SPEC FILE's own directory (so it
      // resolves correctly whether the spec is flat at specs/<id>.md or nested at
      // specs/<area>/<id>.md). safeProjectPath GUARDS against traversal outside the project.
      const briefAbs = safeProjectPath(projectRoot, path.join(path.dirname(spec.sourcePath), briefRel));
      if (!briefAbs || !fs.existsSync(briefAbs)) return reply.code(404).send({ error: 'no brief' });
      return { path: briefRel, markdown: fs.readFileSync(briefAbs, 'utf-8') };
    });
    ```
  - Verify the exact names: `resolveCg`, `safeProjectPath`, `getProjectRoot`, `getSpecQueries().getSpecById`, `spec.sourcePath` — all used by the existing `GET /api/spec/:id` handler in this file. Reuse `path` / `fs` imports already present.
  - **Path-guard is mandatory:** the brief path MUST resolve under the project root via `safeProjectPath` (it already rejects traversal); never read an arbitrary path from frontmatter.

- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5:** `npm run build` clean; `npx vitest run` green.
- [ ] **Step 6: Commit** — `feat(server): GET /api/spec/:id/brief — serve the brainstorm brief for a spec`

---

## Task 3: Specs-page "Brainstorm" panel

**Files:**
- Modify: `packages/web-ng/src/app/api/types.ts` (add `SpecBriefResponse`)
- Modify: `packages/web-ng/src/app/pages/specs/specs.ts` + `specs.html`

- [ ] **Step 1: Type.** Add `export interface SpecBriefResponse { path: string; markdown: string }` to `api/types.ts`.

- [ ] **Step 2: Read the Specs page first.** Open `specs.ts` / `specs.html` to learn how the selected spec is fetched (the `apiResource` for `/api/spec/:id`), how `renderMd`/the markdown renderer is used (the page already renders spec markdown), and the selected-spec signal name. Match those exact APIs.

- [ ] **Step 3: Fetch the brief.** Use the page's REAL signal + project-query API (verified): the selected-spec signal is `this.sel` and the project query is `this.projects.projectQuery()` (mirror the existing `detailResource`). Add:
  ```ts
  briefResource = apiResource<SpecBriefResponse>(this.api,
    () => this.sel() ? `/api/spec/${this.sel()}/brief${this.projects.projectQuery()}` : null);
  ```
  A 404 yields no data (the `apiResource` empty/error state) — treat "no data" as "no brief".

- [ ] **Step 4: Render a collapsible panel** in `specs.html`: a `@if (briefMarkdown())` block — a `<details class="…">` (or the page's existing collapsible pattern) titled **"Brainstorm"** that renders the brief markdown with the same renderer the page already uses for the spec body. Place it near the spec body/Rationale area. Absent brief ⇒ the block doesn't render.

- [ ] **Step 5: Build + manual verify.** `npm run build:web` passes. Then `specship serve --ui`, open a spec that has a `brief:` frontmatter field pointing to an existing `brief.md` → the Brainstorm panel renders and expands; a spec without one shows no panel.

- [ ] **Step 6: Commit** — `feat(web): Specs page renders the linked brainstorm brief`

---

## Task 4: End-to-end + docs polish

- [ ] **Step 1: Manual end-to-end.** In a scratch project: run `/ss-brainstorm "<small feature>"`, decline once (assert NO files written — the gate), then run again and confirm → assert `specs/<slug>/brief.md` exists, a `specs/<ID>.md` exists with `brief:` frontmatter, and the brief's `spec:` is set. Open the dashboard Specs page → the brief panel shows.
- [ ] **Step 2:** Confirm the CHANGELOG entry from Task 1 reads well; add a one-line mention to `site/src/content/docs/specs/` (e.g. `writing-specs.md`) that `/ss-brainstorm` is the divergent front-end that feeds spec-author, if it fits. `npm --prefix site run build` passes.
- [ ] **Step 3: Commit** — `docs: note /ss-brainstorm in changelog + specs docs`

---

## Final verification
- [ ] `npm run build` clean; `npm test` green; `npm --prefix site run build` green (if touched).
- [ ] Manual: the confirmation gate writes nothing on decline; a confirmed run yields a linked brief + ID'd spec; the dashboard panel renders.

## Out of scope (per spec)
- Surfacing the `brief:` link inside `specship_spec` MCP output (needs extractor/schema work — later phase).
- A workflow-YAML version. The brief is not indexed as a spec node.
