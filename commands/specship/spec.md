---
description: Intent door — view, author, fast-path, implement, review, or extend a spec. No arg = the spec funnel; a SPEC_ID = that spec's detail; `new`/`fast`/`implement`/`review`/`triage`/`behaviour`/`domain` run the matching flow.
argument-hint: "<SPEC_ID> | new <desc> | fast <desc> | implement <ID> | review <ID> | triage <prompt> | behaviour <ID> | domain"
allowed-tools: Read, Edit, Write, Bash, mcp__specship__specship_spec, mcp__specship__specship_node, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_link_assert, mcp__specship__specship_link_verify
---

# SpecShip Spec: `$ARGUMENTS`

The **intent door** — one entry for the whole spec lifecycle. Route on the first
token of `$ARGUMENTS`; everything the old `ss-spec*` / `ss-implement` / `ss-triage`
/ `ss-behaviour` / `ss-domain` commands did is reachable here, with no capability
lost.

## Dispatch

- **(no argument)** → call `mcp__specship__specship_spec` with no `spec_id`: the
  project's spec lifecycle funnel (brainstormed ideas → specs → implemented).
- **a bare `SPEC_ID`** (e.g. `REQ-AUTH-005`) → call `specship_spec` with that
  `spec_id`: the body, parent/siblings, and linked code with state. Use this
  before Read-ing the spec file. Jump into linked code via `specship_node`; if
  nothing is linked yet, `specship_explore` on terms from the spec's title.
- **`new <description>`** → the full, gated authoring loop (see *Author* below).
  Use when the design isn't settled.
- **`fast <description>`** → the **fast-path** (see below).
- **`implement <SPEC_ID>`** → run the bundled workflow:
  `specship workflow run spec-implement --input SPEC_ID=<ID>` (plan → approve →
  implement → verify → link, in an isolated worktree).
- **`review <SPEC_ID>`** → a read-only rubric pass (see *Review* below); no edits.
- **`triage <prompt>`** → the triage flow (route a bug / error / one-line
  enhancement to the existing spec it belongs to and append to it): see below.
- **`behaviour <SPEC_ID>`** → author + run E2E tests from the requirement's
  acceptance criteria; see below.
- **`domain`** → capture a human-confirmed domain fact; see below.

## Author (`new <description>`)

The gated authoring loop, run conversationally — diverge, then formalize. Write
NOTHING to disk until the human explicitly confirms.

1. **Scope + ground.** Confirm it's one feature area (refuse "spec the whole
   app"). Call `specship_explore` on terms from the description to find where
   similar features live and which files the work will touch.
2. **Diverge.** Propose 2–3 distinct approaches with trade-offs, lead with a
   recommendation, and clarify the things the graph can't tell you (UX, edge
   cases, non-goals) **one question at a time**. Iterate until the direction is
   settled.
3. **Draft + write.** On confirmation, `Write` `specs/<slug>.md` in the
   `spec-author` format: frontmatter (id/title/owner/priority), `<!-- id: -->`
   markers above every heading, an RFC-2119 keyword per requirement title, one
   concern per requirement, `## Acceptance` with `.A<N>` bullets (happy +
   failure). Mark genuinely-unknowable points `[needs review]`.
4. **Hand off:** `specship sync`, then `/specship:spec review <ID>` and
   `/specship:spec implement <ID>`.

(If a richer authoring skill — e.g. `spec-author` — is available in this
environment, prefer it; this inline flow is the always-present fallback.)

## Review (`review <SPEC_ID>`)

Read-only — do NOT modify the file. Fetch the spec (`specship_spec`), verify each
`implementations:` path exists (`specship_node`), then walk the rubric and output
a numbered findings list grouped **STRUCTURAL** (embedded id markers, no stranded
ids, unique ids, valid frontmatter, valid `implementations:`), **QUALITY**
(RFC-2119 keywords, no weasel words, no implementation leak, testable acceptance,
one concern per REQ, failure-path coverage), **HYGIENE** (owner/priority set, no
stale `[needs review]`/TODO). End with a one-line verdict.

## Fast-path (`fast <description>`)

For a solo dev who wants to record intent and move, **without** the brainstorm /
gap-question interview (REQ-DOORS-002):

1. Ground briefly with `specship_explore` on terms from the description (one call).
2. Draft a complete spec in memory following the `spec-author` format — frontmatter
   (id/title/owner/priority), `<!-- id: -->` markers above every heading, an
   RFC-2119 keyword per requirement, `## Acceptance` with `.A<N>` bullets (happy +
   failure). Pick sensible defaults instead of asking; mark only genuinely
   unknowable points `[needs review]`.
3. `Write` it to `specs/<slug>.md` and tell the user the path.
4. Hand off: `specship sync`, then `/specship:spec implement <ID>` when ready.

The fast-path still produces a well-formed spec that indexes cleanly and is ready
for implementation + linking — it trades the interview for speed, not correctness.

## Triage (`triage <prompt>`)

Classify the input (bug / error log / enhancement). Retrieve candidates: prose →
`specship_spec` with a `query`; an error log → parse the `file:line`/symbol →
`specship_explore`/`specship_node` → the owning requirement. Present the ranked
match + recommended target. **Preview the exact diff → confirm** (offer edit /
new-spec / cancel), then append a new requirement (new concern) or a new `.A<N>`
acceptance criterion (a regression an existing requirement should have covered),
auto-deriving the next collision-checked id, and `specship_link_assert` it. When
nothing clears the match floor, say so and offer `/specship:spec new` instead — never
auto-create. Write nothing until confirmed.

## Behaviour tests (`behaviour <SPEC_ID>`)

Pull the requirement's acceptance criteria and its behaviour surface
(`specship_spec` with `spec_id` + `behaviour_surface: true` → UI tier / backend
tier). For **each** acceptance criterion, author a Playwright test when a UI
exists and/or a backend test, mirroring the repo's existing test conventions.
**Preview the files → confirm → write**, then `specship_link_assert … kind:tests`
at the `.A<N>`, run the suite, and `specship_link_verify` each (pass→verified,
fail→broken; a suite that can't run is reported unrun, never marked broken).

## Domain fact (`domain`)

Run `specship domain-gaps --json` for the real undocumented entities/specs, ask
targeted per-type questions, and **only on explicit confirmation** `Write` a
`domain`-kind fact under `specs/domain/` (frontmatter `id: DOM-<AREA>-NNN`,
`type:` one of term/rule/decision/constraint, linked via `depends_on`/`parent_id`).
Then `specship sync`.

## After editing code for a spec

Call `mcp__specship__specship_link_assert` before reporting done — idempotent, and
it supersedes the `// @implements REQ-X` comment backstop.
