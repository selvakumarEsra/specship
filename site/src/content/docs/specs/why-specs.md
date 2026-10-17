---
title: Why specs
description: Specifications as the unit of work for AI coding agents — why SpecShip treats them as first-class, linkable, verifiable entities.
---

The current dominant pattern for AI coding agents is **conversational** — you tell the agent what you want, it does it. That works until you need:

- **The same outcome twice.** What did I ask for last week, again?
- **A non-coder to verify the result.** Did the agent build what we agreed?
- **A handoff between agents** (or between you and an agent six months from now).
- **An audit trail** for compliance, change management, or just to remember why this code looks the way it does.

SpecShip's bet is that **a spec — a written, ID-stable requirement** — is the right anchor for all four. The agent reads the spec, writes code, and *links* the code back to the spec with state. A test proves the link. Now there's a paper trail.

## What "spec" means here

A spec is just **Markdown with embedded IDs**. Drop a file in your `specs/` directory:

```markdown
<!-- specs/auth.md -->
---
id: AUTH-DOC
title: Authentication
---

<!-- id: AUTH-DOC -->
# Authentication

<!-- id: REQ-AUTH-005 -->
## Expired tokens MUST be rejected with 401

`checkExpiry` returns false when the JWT is past its `exp` claim.
The response is 401 with `code: token_expired`.

## Acceptance
<!-- id: REQ-AUTH-005.A1 -->
- A token within its expiry is accepted.
<!-- id: REQ-AUTH-005.A2 -->
- A token past its expiry is rejected with 401 and `code: token_expired`.
```

SpecShip parses every Markdown file under `specs/`, extracts the `id`-tagged headings and bullets, and stores them in the same local index as your code's functions, classes, and routes. Each spec entity gets:

- **A stable id** (`REQ-AUTH-005`) — never changes, even if the title is rephrased.
- **A content hash** — so SpecShip knows when the body of the spec changed.
- **Parent/child structure** — `AUTH-DOC` is the document; `REQ-AUTH-005` is a requirement under it; `REQ-AUTH-005.A1` is one of its acceptance criteria.
- **A queryable body** — full-text searchable, and readable in one call via the `specship_spec` tool (`specship spec REQ-AUTH-005` on the CLI).

Two more kinds of file live alongside requirements: **idea briefs** (parked thoughts that haven't become specs yet) and **domain facts** (human-confirmed business terms and rules). See [Ideas, briefs & domain facts](/specs/ideas-and-domain-facts/).

## What "link" means here

A **spec link** is a persistent record connecting one spec entity to one code symbol — typically the function, method, or class that implements a requirement, or the test that proves it. Each link carries:

| Field | Meaning |
|---|---|
| `kind` | `implements` / `tests` / `validates` / `documents` / `depends_on` |
| `state` | `implemented` / `verified` / `drifted` / `broken` / `orphaned` (plus the reserved `drafted` / `implementing`) |
| `provenance` | `agent-asserted` / `code-comment` / `spec-declaration` / `resolver` — how the link was created |
| `drift_axis` | when `drifted`: `spec` (spec changed) or `code` (code changed) |
| `spec_hash_at_link` | snapshot of the spec body when the link was set |
| `node_sig_at_link` | snapshot of the code signature when the link was set |

When the spec body or the code signature moves past those snapshots, the link transitions to `drifted`. When the linked symbol disappears, it becomes `orphaned` (and re-attaches on its own if the symbol comes back). And `verified` is **earned, not assumed**: promotion requires a passing test that is linked to the spec as evidence — a `verifies:` block in the spec, an `@verifies REQ-X` comment on the test, or a test title that names the requirement ID. A green suite alone proves nothing about a spec with no linked tests; those stay `implemented` and are flagged as having no test evidence. The state is the **single source of truth** for "is this requirement actually shipped".

→ [Spec links & drift](/specs/links-and-drift/) covers the full lifecycle; [Test evidence & coverage](/specs/test-evidence/) covers how tests earn `verified`.

## Why this matters in practice

| Without specs | With SpecShip specs |
|---|---|
| _"Did we ever build login rate-limiting?"_ → grep, hope, commit message archaeology | `specship_spec` with `list: true` shows every requirement with one rolled-up status. Anything not `verified` is the answer. |
| _"This auth code looks weird, why is it like this?"_ → blame, hope, ask the senior who quit | `specship_node` on the symbol includes a **Linked specs** section. Follow it to the requirement. |
| _"Agent shipped something — did it match my brief?"_ | The brief IS the spec. The link IS the claim. The passing linked test IS the proof. |
| _"PM/legal asked us to prove the rate-limit is in place."_ | `specship coverage REQ-AUTH-001` → which criteria have passing tests, and which don't. |

## What's NOT a spec

SpecShip's bet is narrow:

- A spec is **a requirement, not a design doc.** "The login endpoint rejects > 5 attempts/minute" is a spec. "Architecture: we use Redis for the counter" is not — that's design, and it lives elsewhere (or not).
- A spec is **stable identity, mutable body.** The `id` never moves; the body can be rewritten freely (and doing so flags its links as drifted so they get re-checked). If the requirement itself fundamentally changes, that's a *new spec*, not an edit.
- A spec is **independent of any one implementation.** `REQ-AUTH-001` describes the behaviour. The link tracks which code implements it. Refactor the code; the link follows or tells you it lost track.

## How the workflow engine uses specs

The bundled workflows take a spec as their input:

- `spec-author` → draft → gap-fill review → quality review → approval → write the spec file.
- `spec-implement REQ-AUTH-005` → plan → approve → implement → verify → link, in an isolated worktree, with the spec as the brief. `spec-implement-mixed` runs the same steps with smaller models on the mechanical legs.
- `spec-fix REQ-AUTH-005` → diagnose a drifted/broken link → approve → fix → re-verify.
- `spec-relink REQ-AUTH-005` → find the new home of an orphaned link's symbol → approve → re-assert.
- `spec-verify` → re-check implemented links across the project.
- `claude-design-implement` → turn a Claude Design (or Figma) design into a spec.

In Claude Code you rarely call these by name — the `/specship:spec` and `/specship:check` commands route to them. See [Spec commands](/specs/spec-commands/).

The agent has direct MCP access to `specship_spec` to read the spec, `specship_link_assert` to declare it built the thing, and `specship_link_verify` to record a test verdict.

→ Next: [Writing specs](/specs/writing-specs/) — the file format, ID conventions, and link blocks.
