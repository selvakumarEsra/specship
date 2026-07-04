---
description: Intent door — view, list, capture or review ideas, author, fast-path, design, implement, review, or extend a spec. No arg = the spec funnel; a SPEC_ID = that spec's detail; `idea`/`ideas`/`list`/`new`/`fast`/`design`/`implement`/`review`/`triage`/`behaviour`/`domain` run the matching flow.
argument-hint: "<SPEC_ID> | idea <one-liner> | ideas | list | new <desc> | fast <desc> | design <URL | intent> | implement <ID> | review <ID> | triage <prompt> | behaviour <ID> | domain"
allowed-tools: Read, Edit, Write, Bash, mcp__specship__specship_spec, mcp__specship__specship_node, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_link_assert, mcp__specship__specship_link_verify, mcp__specship__specship_drifted, mcp__specship__designer_session, mcp__specship__designer_prompt, mcp__specship__designer_ask, mcp__specship__designer_list, mcp__specship__designer_snapshot, mcp__specship__designer_handoff
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
- **`idea <one-liner>`** → park the thought as an idea brief and return to the
  interrupted work, without breaking flow (see *Idea* below). Append-only: no
  gap-fill questions, no review pass, one confirmation line.
- **`list`** → call `specship_spec` with `list: true`: the flat spec inventory —
  idea briefs, then every document's requirements, each carrying exactly one
  rolled-up status (`authored · in-progress · implemented · verified ·
  needs-attention`), closing with per-status totals (REQ-DOORS-008). ONE call;
  render what it returns — no per-spec follow-up calls, no file reading. For
  pipeline-health rollups use the no-argument funnel instead.
- **`ideas`** → call `specship_spec` with `ideas: true`: the ideas review view —
  exactly the idea-state briefs (parked, unpromoted brainstorms), each showing
  id, title, age since capture, and labels, closing with the promotion hand-off
  (`/specship:spec new <brief-id>`) (REQ-IDEAS-002). ONE call; render what it
  returns as-is — no per-idea follow-up calls, no file reading. An empty lane is
  reported cleanly, not as an error. Promote a listed idea with
  `/specship:spec new <brief-id>`.
- **`new <description>`** → the full, gated authoring loop (see *Author* below).
  Use when the design isn't settled. A first token shaped `brief:<slug>` (a
  parked idea's id) instead opens the **brief-seeded** loop: the interview
  starts pre-filled from that brief and asks only what it leaves open, and the
  written spec points back at the brief. Plain text still opens a blank
  interview — the seeded path is additive.
- **`fast <description>`** → the **fast-path** (see below).
- **`design <URL | intent>`** → author from visually-expressed intent: a
  `claude.ai/design` URL, a `figma.com` URL, or no URL (taste loop first). See
  *Design* below.
- **`implement <SPEC_ID>`** → run the bundled workflow:
  `specship workflow run spec-implement --input SPEC_ID=<ID>` (plan → approve →
  implement → verify → link, in an isolated worktree). **If the session is in
  plan mode, exit it first** (present the spec + the workflow's own gates as
  the plan) — the spec IS the plan, the workflow carries its own plan→approve
  gate, and plan mode blocks the `specship workflow run` launch
  (REQ-DOORS-007).
- **`review <SPEC_ID>`** → a read-only rubric pass (see *Review* below); no edits.
- **`triage <prompt>`** → the triage flow (route a bug / error / one-line
  enhancement to the existing spec it belongs to and append to it): see below.
- **`behaviour <SPEC_ID>`** → author + run E2E tests from the requirement's
  acceptance criteria; see below.
- **`domain`** → capture a human-confirmed domain fact; see below.
- **any other free text** (not empty, not a `SPEC_ID`, not a known sub-route
  verb — the known verbs are `idea`, `ideas`, `list`, `new`, `fast`, `design`,
  `implement`, `review`, `triage`, `behaviour`, `domain`, so `idea …` routes to
  the capture flow above and `ideas` to the review view, never reaching this
  disambiguation — REQ-IDEAS-001.A6, REQ-IDEAS-002.A5)
  → don't fall through to undefined behaviour. Ask **one** clarifying
  question offering `new`, `fast`, and `triage`, **leading with an inferred
  recommendation** from the input's shape: error-log-shaped input (a stack
  trace, `file:line`, an exception/failure message) → recommend `triage`;
  feature-shaped input (a capability the user wants) → recommend `new` (or
  `fast` if it reads as a quick, settled change). Route to the chosen sub-route
  once answered. The no-argument funnel and bare-`SPEC_ID` detail behaviours
  above are unchanged.

## Idea (`idea <one-liner>`)

The **five-second capture verb** (REQ-IDEAS-001). An idea arrives mid-flow; park
it and get back to what you were doing. This path is deliberately dumb — **no
brainstorm, no gap-fill questions, no diverge, no Post-write review** (those are
for authoring; parking is not authoring). Enrichment is what promotion
(`new <brief-id>`) is for.

**This path SKIPS both authoring gates below.** It does *not* run the "Plan mode
at the write/hand-off boundary" exit dance and it does *not* run the "Post-write
review" pass — capture is append-only. (If the session happens to be in plan
mode, exit it only so the one `Write` can land, nothing more — there is no plan
to present; the whole point is not to interrupt.)

Steps:

1. **Empty guard (A5).** If the one-liner is empty (bare `idea`, or only
   whitespace), **write nothing** — print the one-line usage hint
   `Usage: /specship:spec idea <one-liner>` and return. No file, no sync.
2. **Label prefix (A3).** If the one-liner begins with a bare `word:` prefix
   (a single leading word immediately followed by a colon, e.g.
   `idea perf: cache the snapshots`), take that word as the **label** and the
   remainder (trimmed) as the one-liner. Match only a single leading
   `^(\w+):\s*` — `we should: cache X` has no label (its first word isn't
   colon-terminated). If stripping the label leaves an empty remainder, fall
   back to the empty guard (A5).
3. **Slug.** Kebab-case the one-liner (lowercase, non-alphanumeric → `-`,
   collapse repeats, trim `-`), truncated to a sane length. If
   `specs/<slug>/brief.md` already exists, append `-2`, `-3`, … until the path
   is free — never overwrite an existing brief.
4. **Grounding (A4), opportunistic — never blocking.** If the current
   conversation already makes the code under discussion obvious (files just
   read/edited, symbols named in the exchange), record them as a `## Grounding`
   body section of `file:symbol` / `file` bullets so future review can
   re-ground. If nothing is clearly in scope, **skip it silently** — absence of
   context never blocks or delays capture. Do **not** go search for grounding.
5. **Write the brief (A1).** `Write` `specs/<slug>/brief.md`:
   ```markdown
   ---
   slug: <slug>
   created: <YYYY-MM-DD>   # today, from `date +%F`
   label: <label>          # only when a prefix label was parsed (A3)
   ---
   # <one-liner>

   <one-liner>

   ## Grounding            # only when step 4 captured something (A4)
   - <file>:<symbol>
   ```
   There is **no `spec:` key** — a brief without one reconciles to the `idea`
   state, so it indexes as an `idea`-state `brief:<slug>` on the next sync (A1).
6. **Sync + confirm (A2).** Run `specship sync`, then print exactly **one**
   confirmation line naming the brief — e.g. `Parked as brief:<slug>.` — and
   return to the interrupted work. Ask nothing.

## Plan mode at the write/hand-off boundary (every authoring path)

Plan mode is fine — even natural — for the authoring *conversation* (the
diverge phase is read-only exploration). But the moment the human confirms,
plan mode has served its purpose: **exit it before the confirmed `Write` of
`specs/<slug>.md`, and before launching `implement`** (REQ-DOORS-007). The
human's confirmation inside this flow is the approval plan mode was waiting
for; staying in plan mode past it just blocks the write and stalls the
hand-off. Don't re-plan the spec in the exit — the spec is the plan.

## Author (`new <description | brief:<slug>>`)

The gated authoring loop, run conversationally — diverge, then formalize. Write
NOTHING to disk until the human explicitly confirms.

**Seeded from a brief (`new brief:<slug>`).** A first token shaped `brief:<slug>`
means this is the promotion of a parked idea, not a blank author. This path is
purely additive — a plain description still falls straight to the loop below
(A4). When the argument is `brief:`-shaped:

- **Resolve** the brief first: call `specship_spec` with `spec_id:
  "brief:<slug>"` (or `Read specs/<slug>/brief.md`).
- **Not found (A3):** if `specship_spec` reports no such brief, **stop** — print
  a one-line not-found notice pointing at `/specship:spec ideas` to browse the
  parked ideas (and offer plain `new <description>`). Never fall through to a
  blank interview.
- **Found (A1):** treat the brief's problem statement, evidence, and code
  grounding as **already-answered** interview inputs. Pre-fill step 1's
  scope/ground and step 2's diverge from the brief, and interview **only** on
  what the brief leaves open (UX, edge cases, non-goals). Still run
  `specship_explore` on the brief's terms in step 1 — the brief's captured
  grounding may be stale.

Then run the loop below, skipping every question the brief already answers; on
the write (step 3) the spec points back at the brief so the funnel promotes it.

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
   failure). Mark genuinely-unknowable points `[needs review]`. **Seeded from a
   brief:** the frontmatter MUST also carry `brief: <brief-slug>/brief.md` — the
   value is relative to the spec file's own directory, so a spec at
   `specs/<slug>.md` names `<brief-slug>/brief.md` (A2). After the step-4 sync,
   the funnel's brief↔spec reconciliation flips that brief to `specified` and it
   drops out of the `ideas` view automatically — no extra bookkeeping.
4. **Sync + review:** `specship sync`, then run the shared **Post-write review**
   (see below) — it is automatic, not optional. Then hand off with
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

## Post-write review (automatic, every authoring path)

The uniform review backstop — **no spec reaches disk unreviewed**. After **any**
authoring path (`new`, `fast`, `design`) has written and `specship sync`-ed a
spec, run the same rubric pass automatically. This is not a separate interview
and not the opt-in `review <SPEC_ID>` route; it always runs, once, on the
just-written spec:

1. Walk the **STRUCTURAL / QUALITY / HYGIENE** rubric defined in *Review* above
   against the new spec.
2. **Fix STRUCTURAL findings automatically** — missing/stranded/duplicate id
   markers, invalid frontmatter, broken `implementations:` paths — then re-`sync`.
3. For **QUALITY findings that would change implementation behaviour** (a vague
   or untestable acceptance criterion, a leaked implementation detail, a missing
   failure path), surface them as **one** proceed/adjust prompt — apply the
   adjustments or proceed as-is on the user's call. No extra gap-fill interview.
4. HYGIENE nits are noted in passing; they don't block the hand-off.

This is what enforces REQ-DOORS-002.A3 ("speed does not sacrifice correctness")
for the fast-path rather than leaving it aspirational.

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
4. `specship sync`, then run the shared **Post-write review** (below) — it is
   part of the single guided step, so speed doesn't skip the backstop. Then hand
   off with `/specship:spec implement <ID>` when ready.

The fast-path still produces a well-formed spec that indexes cleanly and is ready
for implementation + linking — it trades the interview for speed, not correctness.

## Design (`design <URL | intent>`)

Author from **visually-expressed intent** — a third authoring modality alongside
`new` and `fast`. Route on the argument's shape; each path ends by feeding the
bundled `claude-design-implement` workflow, which snapshots the design byte-for-byte,
extracts tokens, drafts a spec (contract only — no hex/pixels), and pauses at a
gap-fill approval gate before writing. Keep this entry thin: delegate to the
workflow and the `designer-loop` skill rather than re-explaining either.

- **`claude.ai/design` URL** → the import path. The URL is of the form
  `https://claude.ai/design/p/<project-id>/?file=<File+Name>.html`; derive `SLUG`
  from the `file=` query param (`Data+Flow.html` → `data-flow`) unless a second
  token overrides it. Run:
  ```bash
  specship workflow run claude-design-implement \
    --input CONNECTOR_URL="<URL>" \
    --input FILE_LABEL="<File Name>" \
    --input SLUG="<slug>"
  ```
  Add `--input OWNER="<team>"` / `--input PRIORITY="high|medium|low"` to populate
  frontmatter; otherwise they surface as `[needs review]` at the gap-fill gate.
- **`figma.com` URL** → the Figma import path via the remote Figma MCP. **Probe
  for the Figma MCP first.** If it is **not** installed, tell the user to run
  `claude mcp add --transport http figma https://mcp.figma.com/mcp` and **stop** —
  never blind-`fetch` the URL. If it **is** present, snapshot/import the Figma
  design through it, then feed the same `claude-design-implement` workflow with
  the imported bundle (`--input HANDOFF_DIR=…`).
- **no URL (bare intent, or empty)** → run the **taste loop first**, then import.
  Follow the **`designer-loop` skill** (`~/.claude/skills/designer-loop/SKILL.md`)
  — it is the authority. In brief: probe the designer runtime with
  `designer_session({ action: "status" })` (if it errors "CDP not up"/"Not signed
  in", tell the user to run `designer setup` and stop — the loop needs the live
  browser, never a blind fetch); survey the repo's capabilities with
  `specship_explore`/`specship_search` and relay them verbatim into the prompt;
  drive `claude.ai/design` through `designer_prompt`/`designer_ask` while the
  **human tastes** the variants (you relay, you don't propose your own); iterate
  until the human says **"that's it"** (Gate 1). Then `designer_handoff` the
  chosen variant and feed its bundle into the same workflow via its `HANDOFF_DIR`
  input:
  ```bash
  specship workflow run claude-design-implement \
    --input HANDOFF_DIR="<absolute path to handoff-<ts>/>" \
    --input CHOSEN_FILE="<chosen variant>.html" \
    --input FILE_LABEL="<File Label>" \
    --input SLUG="<slug>"
  ```

When the workflow finishes it hands off with `/specship:spec implement <first REQ ID>`;
the implementer reads `specs/<slug>/snapshot.html` for visual fidelity. After the
spec is written and synced, the shared **Post-write review** (above) runs like any
other authoring path.

## Triage (`triage <prompt>`)

Triage is the **single intake for anything broken** — the user can't be expected
to know whether their failing behaviour is a "bug" (append a criterion) or "drift"
(a stale spec↔code link); triage decides.

Classify the input (bug / error log / enhancement). Retrieve candidates: prose →
`specship_spec` with a `query`; an error log → parse the `file:line`/symbol →
`specship_explore`/`specship_node` → the owning requirement. Present the ranked
match + recommended target.

**Before proposing an append, consult the drift queue** (`specship_drifted`): if
the matched spec has links in the `drifted` or `broken` state, its real problem is
a stale link, not a missing criterion — recommend the gate door's fix flow,
`/specship:check fix <SPEC_ID>`, instead of appending. When the matched spec's
links are healthy, proceed with the append:

**Preview the exact diff → confirm** (offer edit / new-spec / cancel), then append
a new requirement (new concern) or a new `.A<N>` acceptance criterion (a regression
an existing requirement should have covered), auto-deriving the next
collision-checked id, and `specship_link_assert` it. When nothing clears the match
floor, say so and offer `/specship:spec new` instead — never auto-create. Write
nothing until confirmed.

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
