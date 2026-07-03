---
id: IDEAS-LANE-DOC
title: Ideas lane — capture, review, promote, and tracker import/sync
owner: core
priority: high
version: 1
---

<!-- id: IDEAS-LANE-DOC -->
# Ideas lane

Ideas arrive mid-flow and die of capture friction: parking one today means
hand-authoring a `specs/<slug>/brief.md` with the right frontmatter — an agent
can do it, a human mid-task won't. The storage primitive already exists and is
right (SPEC-FUNNEL-DOC: a brief indexes as an `idea`, linking a spec's `brief:`
frontmatter promotes it to `specified`, and the inventory surfaces ideas
first). What's missing is the ergonomics around it: a five-second capture verb,
a review view with age and labels, and a promotion ritual that seeds the
authoring interview instead of retyping.

The same lane is the future intake for external trackers: Jira/Linear items
imported through the agent's own tracker MCP connection (SpecShip bundles no
tracker client and holds no credentials — the same probe-first posture as the
Figma import path, REQ-DOORS-004.A2), with the tracker key as the brief/spec
identity and lifecycle moments pushed back outward. Capture is deliberately
dumb — no interview, no enrichment; that is what promotion is for.

<!-- id: REQ-IDEAS-001 -->
## The intent door MUST offer an `idea` verb that captures without breaking flow

`/specship:spec idea <one-liner>` parks the thought as an idea brief and
returns to the interrupted work. Capture is append-only: no gap-fill
questions, no review pass, one confirmation line. When the session's context
makes it cheap, the brief records where the thought occurred (the files or
symbols under discussion) so future review can re-ground it.

implementations:
  - commands/specship/spec.md

## Acceptance
<!-- id: REQ-IDEAS-001.A1 -->
- `/specship:spec idea <one-liner>` writes a brief under the specs root whose
  frontmatter carries a slug and creation date, and that indexes as an
  `idea`-state `brief:<slug>` entity on the next sync.
<!-- id: REQ-IDEAS-001.A2 -->
- Capture asks the user nothing — no clarifying questions, no interview — and
  confirms with a single line naming the brief id.
<!-- id: REQ-IDEAS-001.A3 -->
- Labels given at capture (e.g. `idea perf: cache the snapshots`) are recorded
  in the brief's frontmatter and preserved in the graph as brief metadata.
<!-- id: REQ-IDEAS-001.A4 -->
- When the conversation context identifies the code being worked on, the brief
  records that grounding (file paths / symbol names); absence of context never
  blocks or delays capture.
<!-- id: REQ-IDEAS-001.A5 -->
- `idea` with no text writes nothing and answers with a one-line usage hint.
<!-- id: REQ-IDEAS-001.A6 -->
- `idea` is a known sub-route verb: the free-text disambiguation
  (REQ-DOORS-005) does not trigger on it.

<!-- id: REQ-IDEAS-002 -->
## The intent door MUST offer an `ideas` review view with age and labels

The backlog that is never reviewed is a graveyard. `/specship:spec ideas`
shows only the idea-state briefs — each with its age, labels, and the next
action (promote via `new <brief-id>`) — from a single `specship_spec` call.

implementations:
- src/mcp/spec-tools.ts:buildIdeas
- src/mcp/spec-tools.ts:handleSpecshipSpec
- src/resolution/brief-link-resolver.ts:ideaCaptureFields
- commands/specship/spec.md

## Acceptance
<!-- id: REQ-IDEAS-002.A1 -->
- `/specship:spec ideas` lists exactly the idea-state briefs, each entry
  showing id, title, age since capture, and labels, resolved from a single
  `specship_spec` call — no per-idea follow-up calls, no file reading.
<!-- id: REQ-IDEAS-002.A2 -->
- The list-mode inventory's Ideas section (REQ-FUNNEL-007.A5) carries the same
  age and labels on each idea entry, so both surfaces agree.
<!-- id: REQ-IDEAS-002.A3 -->
- The view closes by naming the promotion hand-off (`/specship:spec new
  <brief-id>`).
<!-- id: REQ-IDEAS-002.A4 -->
- With zero idea-state briefs the view reports an empty lane cleanly — no
  error, and a pointer to the `idea` capture verb.
<!-- id: REQ-IDEAS-002.A5 -->
- `ideas` is a known sub-route verb: the free-text disambiguation
  (REQ-DOORS-005) does not trigger on it.

<!-- id: REQ-IDEAS-003 -->
## Promotion MUST seed the authoring interview from the brief

`/specship:spec new <brief-id>` is the deliberate ritual that turns a parked
idea into intent: the full authoring loop opens pre-seeded with the brief's
problem statement, evidence, and code grounding, and the interview asks only
what the brief does not already answer. The written spec points back at the
brief, so the funnel's existing reconciliation flips the idea to `specified`
with no extra bookkeeping.

## Acceptance
<!-- id: REQ-IDEAS-003.A1 -->
- `new` given an argument that resolves to a brief id (e.g. `brief:<slug>`)
  runs the authoring loop seeded with that brief's content; questions already
  answered by the brief are not re-asked.
<!-- id: REQ-IDEAS-003.A2 -->
- The spec written by a seeded promotion carries `brief:` frontmatter naming
  the source brief; after sync the funnel reports that brief `specified`, and
  it no longer appears in the `ideas` view.
<!-- id: REQ-IDEAS-003.A3 -->
- `new` with a brief-id-shaped argument that resolves to nothing reports
  not-found and points at `/specship:spec ideas` — it never silently starts a
  blank interview.
<!-- id: REQ-IDEAS-003.A4 -->
- `new <description>` with a plain description behaves exactly as today — the
  seeded path is additive.

<!-- id: REQ-IDEAS-004 -->
## Tracker items MUST be importable as ideas through the agent's tracker MCP

The lane is also the intake from Jira/Linear. Import runs through the agent's
own tracker MCP connection — SpecShip ships no tracker client, stores no
credentials, and never falls back to blind HTTP; when no tracker MCP is
present, the flow names the missing connection and stops (the Figma-import
posture, REQ-DOORS-004.A2). The tracker key becomes the identity: an imported
item is `brief:<TRACKER-KEY>`, so the id itself is the cross-system tracking
handle.

## Acceptance
<!-- id: REQ-IDEAS-004.A1 -->
- An import invocation (e.g. `/specship:spec ideas import <filter>`) pulls the
  selected tracker items into idea briefs whose slugs are the tracker keys
  (`brief:SCRUM-42`), with the tracker name, key, and item URL recorded in the
  brief's frontmatter metadata.
<!-- id: REQ-IDEAS-004.A2 -->
- When no tracker MCP is connected, the flow tells the user which connection
  to add and stops — it never attempts direct HTTP to the tracker.
<!-- id: REQ-IDEAS-004.A3 -->
- Re-importing an already-imported key refreshes that brief in place — no
  duplicate brief, and the local capture fields (labels, grounding) survive
  the refresh.
<!-- id: REQ-IDEAS-004.A4 -->
- Imported items enter as `idea`-state briefs regardless of tracker issue
  type — one intake, promotion stays deliberate. [needs review: confirm we
  don't want groomed Stories to skip straight to the promotion interview]

<!-- id: REQ-IDEAS-005 -->
## Lifecycle moments MUST push back to the tracker, one way

After import the repo owns the truth. SpecShip pushes outward at lifecycle
moments — promotion updates the tracker item's description from the interview
outcome; verification transitions its status — and never merges tracker-side
edits back automatically. [needs review: one-way push chosen as the default
ownership model; revisit if a team workflow needs tracker-side edits honored.]
A push failure is a notice, never a gate: the local spec flow completes
regardless of tracker availability.

## Acceptance
<!-- id: REQ-IDEAS-005.A1 -->
- Promoting an imported idea updates the tracker item's description with the
  authored contract summary and the spec's repo location, and the written spec
  document's id carries the tracker key so the two systems share one handle.
<!-- id: REQ-IDEAS-005.A2 -->
- Spec lifecycle transitions push tracker status transitions per a
  configurable mapping; with no mapping configured, sensible defaults apply
  (promotion → an "in design/refinement" status; verified implementation → a
  "done" status). [needs review: default mapping names]
<!-- id: REQ-IDEAS-005.A3 -->
- A failed tracker push (offline, auth, missing MCP) surfaces as a one-line
  notice and changes nothing locally — the spec write, links, and verification
  states complete exactly as they would without a tracker.
<!-- id: REQ-IDEAS-005.A4 -->
- No continuous pull: description or status edits made tracker-side after
  import are not merged back automatically; a re-import of that key is the
  explicit way to refresh the brief. [needs review]
