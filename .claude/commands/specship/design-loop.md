---
description: Run the full design→code loop — taste a claude.ai/design with the human via the designer MCP, then snapshot → spec → review → hand off to /specship:spec implement. Two human gates.
argument-hint: [intent — what you want to design]
allowed-tools: Read, Write, Edit, Bash, mcp__specship__designer_session, mcp__specship__designer_prompt, mcp__specship__designer_ask, mcp__specship__designer_list, mcp__specship__designer_snapshot, mcp__specship__designer_handoff, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_node, mcp__specship__specship_spec, mcp__specship__specship_files
---

# SpecShip Design Loop: `$ARGUMENTS`

One continuous pipeline: **intent → taste → design → handoff → spec → `/specship:spec implement`**.
You (the orchestrator) drive `claude.ai/design` through the `designer` MCP while the
**human tastes** the variants, then promote the chosen design into a SpecShip spec via the
bundled `claude-design-implement` workflow. Two human gates:

- **Gate 1 (aesthetic):** the human says *"that's it"* in the taste loop. Driven here, conversationally.
- **Gate 2 (contract):** the human walks the spec's `[needs review]` markers at the workflow's approval gate.

This is the deeper companion to `/specship:design-implement` — that command imports a design you've
*already* settled on (by URL); this one runs the taste loop first, then hands the resulting
bundle to the same workflow. `$ARGUMENTS` is the human's opening intent (optional).

## Preflight

1. **Designer runtime ready?** The designer tools are part of SpecShip's MCP now
   (`mcp__specship__designer_*`), so they're always present. Probe the *runtime* with
   `designer_session({ action: "status" })`: a clean status means you're ready. If it errors
   with "CDP not up" or "Not signed in", the one-time Chrome setup hasn't run — tell the human to
   run `designer setup` (creates the debug-Chrome profile + login) and stop. Do NOT fall back to a
   blind fetch; the taste loop needs the live browser.
2. **SpecShip initialized?** `specship status` should succeed. If not, `specship init -i` first.

## Phase A — Taste loop (Gate 1)

Follow the **`designer-loop` skill** (`~/.claude/skills/designer-loop/SKILL.md`) — it is the
authority on this loop. The condensed version, if the skill isn't installed:

> The human is the designer; Claude Design has taste; you are translation + plumbing. Don't
> propose your own variants, don't interview about aesthetics — scope questions only.

1. **Read the room — capabilities drive the design.** Before relaying any intent, survey the
   target repo for what it actually *does* and feed that into the prompt verbatim. Use
   `specship_explore` / `specship_search` to pull: entities + their fields, operations /
   endpoints, states (loading / empty / error / success), failure modes, hard constraints
   (auth, rate limits), and existing design tokens. The human's intent tells Claude *how*; the
   codebase tells it *what*. Transfer capability facts unabridged — summarizing is filtering.
2. **Create / resume the session.** `designer_session({ key: "<slug>", action: "create",
   name: "<seed intent>", fidelity: "highfi" })`. Reuse a stable `key` derived from the intent
   so parallel loops don't collide.
3. **Relay a minimal, faithful prompt.** `designer_prompt({ key, prompt })` — intent +
   capability facts; let Claude's taste make the aesthetic calls. Ask for the variant shape you
   want ("3 full-page files", "states as toggles") and lock any hard brand tokens explicitly.
4. **Hand the human the URL** returned in `url`. That live surface has working tweak sliders and
   the variant switcher — it is the default taste path. Ask *"what do you think?"*, not
   "accept or reject?".
5. **Interpret + iterate.** Translate each reaction into the next `designer_prompt` (or a cheap
   `designer_ask` to consult Claude on a small adjustment). Repeat 3–4 until the human says
   **"that's it."** Capture their final reaction verbatim — it goes in the record.

Stay in the loop until Gate 1 is explicitly passed. "Almost" is not "yes."

## Bridge — promote the chosen design

1. `designer_handoff({ key, openFile: "<chosen variant>.html" })`. This fetches the project
   export zip into `./artifacts/<key>/handoff-<ts>/` — `project/*` (all variants + assets) plus
   `decision-record.md` (the verbatim transcript + the human's final reaction). Note the
   **absolute path** of that `handoff-<ts>/` directory and the **chosen variant filename**.
2. Derive `FILE_LABEL` (human label) and `SLUG` (kebab-case) from the chosen file / intent. If
   the slug is ambiguous, ask the human — one scope question, not an interview.

## Phase B — Spec pipeline (Gate 2)

Run the bundled workflow against the bundle on disk (no re-fetch, no CDP):

```bash
specship workflow run claude-design-implement \
  --input HANDOFF_DIR="<absolute path to handoff-<ts>/>" \
  --input CHOSEN_FILE="<chosen variant>.html" \
  --input FILE_LABEL="<File Label>" \
  --input SLUG="<slug>" \
  --json
```

(Add `--input OWNER="<team>"` / `--input PRIORITY="high|medium|low"` to populate frontmatter;
otherwise they default to empty and surface as `[needs review]`.)

The workflow runs headless to its approval gate, then **pauses** (status `paused`). It:
snapshots `project/<chosen>.html` byte-for-byte into `specs/<slug>/snapshot.html`, folds
`decision-record.md` into `specs/<slug>/source.md`, extracts `specs/<slug>/tokens.css`, and
drafts the spec.

**At the pause (Gate 2):** read the run's approval message / the drafted spec artifact, present
it to the human, and walk the `[needs review]` markers + gap-fill questions together. Then:

- **Approve:** `specship workflow approve <runId> --comment "<gap-fill answers>"` then
  `specship workflow resume <runId>`. The answers are captured into the spec.
- **Needs changes:** collect the feedback and re-run the workflow (a reject cancels the run;
  existing REQ IDs are preserved across re-imports, so in-flight work survives).

## Phase C — Hand off to implementation

When the workflow completes it prints the bridge message. Relay it to the human:
- the spec path `specs/<slug>.md` and its REQ IDs,
- the reference files (`snapshot.html`, `tokens.css`, `source.md`),
- the exact next step: **`/specship:spec implement <first REQ ID>`**.

Remind them: the implementer reads `snapshot.html` for visual fidelity — the spec is
contract-only.

## Anti-patterns

- **Skipping the capability survey.** Designing before reading what the repo *does* produces
  designs that look good and don't fit. Phase A step 1 is load-bearing.
- **Proposing your own variants / interviewing about taste.** Claude Design proposes; you relay.
  Scope questions only.
- **Auto-promoting.** Don't `designer_handoff` on every iteration — only once Gate 1 passes.
- **Re-fetching in the workflow.** Always pass `HANDOFF_DIR` (the bundle you just fetched), never
  `CONNECTOR_URL` — that re-drives Chrome from a headless subprocess and is fragile. The URL path
  is what `/specship:design-implement` is for.
- **Putting hex/pixels in the spec.** Reference tokens by name; values live in `tokens.css`.
- **Skipping Gate 2.** The gap-fill questions are where the static design's blind spots (failure
  modes, real-time updates, keyboard order) get closed.

If `designer_session` errors with a CDP / sign-in problem, stop and route the human to
`designer setup` (debug-Chrome profile + login) — this command cannot run the taste loop without
the live browser. To import a design you've already settled on by URL, use
`/specship:design-implement <url>` instead.
