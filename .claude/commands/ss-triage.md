---
description: Route a small change (a bug, an error log, or a one-line enhancement) to the existing spec it belongs to and append to it — a new requirement or acceptance criterion — only on your explicit confirmation. Falls back to authoring a new spec when nothing fits.
argument-hint: <bug | error log | one-line enhancement>
allowed-tools: Read, Edit, Write, Bash, mcp__specship__specship_spec, mcp__specship__specship_explore, mcp__specship__specship_search, mcp__specship__specship_node
---

# SpecShip Triage: `$ARGUMENTS`

A **front door** for small changes. Take the prompt, find the **existing** spec
it belongs to, and **add to it** — a new requirement or a new acceptance
criterion — rather than spawning a fresh spec. Only fall back to authoring a new
spec when nothing fits.

You match and author; SpecShip retrieves and ranks; **the human gates the
write**. This is distinct from `/ss-fix` (which repairs a drifted/broken link
for a *known* spec) and `/ss-brainstorm` + `/ss-spec-author` (which author a
*new* spec from scratch).

**Governing principle — propose, never auto-apply.** A spec file is edited ONLY
on explicit human confirmation. If the human does not confirm, you write
**nothing** — the command is a no-op. Never auto-create a spec.

If `$ARGUMENTS` is empty, ask the human for the bug / error / enhancement.

## 1. Classify the input

Decide which of three classes the prompt is, and say so out loud before any
retrieval or write (REQ-TRIAGE-002.A3):

- **error log** — contains a stack trace, an exception, a `file:line`, or a
  symbol/function name from a crash. Route via the code→spec path (step 2b).
- **bug** — prose describing wrong behaviour, possibly naming a symbol.
- **enhancement** — prose proposing a new/changed capability.

## 2. Retrieve candidate specs

### 2a. Prose (bug / enhancement) → spec query

Call `specship_spec` with a free-text **`query`** built from the salient terms
of the prompt. It returns scored, ranked candidate specs (id, title, kind,
relevance **score**, snippet) over the spec index — enough to act on without a
follow-up fetch (REQ-TRIAGE-002.A1).

```
specship_spec  { "query": "<key terms from the prompt>" }
```

For a bug that names a symbol, you may *also* run step 2b and blend the results
(a spec reached by both the prose query and the code→spec path is the strongest
candidate).

### 2b. Error log → code → spec

Parse the `file:line` / symbol out of the trace, then walk code → owning spec:

- `mcp__specship__specship_explore` (or `specship_search`) naming the symbol(s)
  from the trace to locate the implicated code.
- `mcp__specship__specship_node` on the implicated symbol — its response renders
  the **linked specs** for that node. The owning requirement is the spec the
  crashing code already implements (REQ-TRIAGE-002.A2).

## 3. Present the ranked match + recommended target

Before proposing any change, show the human (REQ-TRIAGE-002.A3):

- the **detected input class** (bug / error log / enhancement),
- the **ranked candidates** with their scores, and
- the **recommended target** — which document (for a new requirement) or which
  requirement (for a new criterion), and why.

**Ambiguity:** when several candidates score closely, present the **top N** and
ask the human to choose — never auto-select among them (REQ-TRIAGE-002.A4).

## 4. No confident match → offer a new spec, don't create one

If the top candidate's score is **below the match floor** (no candidate is
clearly the right home), do NOT extend a spec on your own (REQ-TRIAGE-004):

1. State **"no confident match"** and show the weak candidates **with their
   scores** (A1).
2. Offer the human a choice (A2): route to **`/ss-spec-author`** (or
   `/ss-brainstorm`) to author a new spec; **append anyway** to the top weak
   candidate; or **cancel**.
3. Never create a new spec without an explicit human choice (A3).

Use judgment for the floor — a top score that's roughly on par with unrelated
specs, or a snippet that doesn't actually concern the change, is "no confident
match" even if the number isn't zero. SpecShip ranks; you and the human decide.

## 5. Choose the granularity (requirement vs criterion)

On a confident match, pick what to append by intent (REQ-TRIAGE-003.A2):

- **A distinct new concern** → a **new requirement** under the matched document.
- **A bug / regression an existing requirement should already have covered** →
  a **new acceptance criterion** on that requirement. This leaves the
  requirement's existing code links intact — you are extending its contract,
  not rewriting it. Error logs and most bugs land here as a regression guard.

## 6. Auto-derive the id (next in series, collision-checked)

Inspect the index / target file to find the next free id (REQ-TRIAGE-003.A3):

- **New requirement** → next `REQ-<AREA>-<NNN>` for that document's AREA
  (zero-padded NNN; one past the current max for that AREA).
- **New criterion** → next `REQ-<ID>.A<N>` on the owning requirement (one past
  its current max `A<N>`).

Confirm the id collides with nothing already in the index — read the target spec
file (or `specship_spec` on the document/requirement to list its children /
acceptance bullets) before settling on the number.

## 7. Preview the exact diff → confirm (and ONLY then write)

Show the human the **exact change** (REQ-TRIAGE-003.A1): the target spec file
and the precise block to be inserted, with its `<!-- id: -->` marker. Then ask
for explicit confirmation and offer the alternatives:

> `confirm` · `edit` (adjust the wording first) · `new spec instead` (hand off
> to `/ss-spec-author`) · `cancel`

**If the human does not clearly confirm, stop and write nothing.**

A new **requirement** block:

```markdown
<!-- id: REQ-<AREA>-<NNN> -->
## <Title with a MUST / SHOULD / MAY keyword>

<one-concern normative description>

## Acceptance
<!-- id: REQ-<AREA>-<NNN>.A1 -->
- <testable happy-path bullet>
<!-- id: REQ-<AREA>-<NNN>.A2 -->
- <testable failure-path bullet>
```

A new **acceptance criterion** appended to the owning requirement's
`## Acceptance` list:

```markdown
<!-- id: REQ-<ID>.A<N> -->
- <testable bullet covering the bug / regression>
```

On confirmation, append it with `Edit` (or `Write`) into the matched spec file —
a new requirement after the document's existing requirements; a new criterion at
the end of the owning requirement's `## Acceptance` block. Mirror the file's
existing marker style exactly.

## 8. Index and hand off

```bash
specship sync
```

The appended requirement / criterion must index **cleanly** — `specship sync`
reports no spec error and the new `<!-- id: -->` is unique (REQ-TRIAGE-003.A4).
If sync flags a duplicate or malformed id, fix it before reporting done; a
duplicate-looking append should be flagged, not silently doubled.

Then point the human at:
- `/ss-spec-review <ID>` to review the change, and
- `/ss-implement <ID>` (then `specship_link_assert`) when ready to build.

## Anti-patterns

- **Writing before confirmation** — the single most important rule (step 7).
- **Auto-creating a new spec** on a weak match instead of offering the choice
  (step 4).
- **Rewriting a requirement's existing normative prose** in place — append a
  criterion or a new requirement; don't mutate the contract that code links to.
- **Auto-fixing the bug** — that's `/ss-implement`. Triage routes and records;
  it does not change code.
- **Spawning a new doc for a change that belongs on an existing spec** — the
  whole point is to *add to* the right spec.
