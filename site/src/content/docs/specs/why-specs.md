---
title: Why specs
description: Specifications as the unit of work for AI coding agents — why SpecShip treats them as first-class graph entities.
---

The current dominant pattern for AI coding agents is **conversational** — you tell the agent what you want, it does it. That works until you need:

- **The same outcome twice.** What did I ask for last week, again?
- **A non-coder to verify the result.** Did the agent build what we agreed?
- **A handoff between agents** (or between you and an agent six months from now).
- **An audit trail** for compliance, change management, or just to remember why this code looks the way it does.

SpecShip's bet is that **a spec — a written, ID-stable requirement** — is the right anchor for all four. The agent reads the spec, writes code, and *links* the code back to the spec with state. Now there's a paper trail.

## What "spec" means here

A spec is just **Markdown with an embedded ID**. Drop a file in your `specs/` directory:

```markdown
<!-- specs/auth.md -->
---
id: AUTH-DOC
title: Authentication
---

<!-- id: REQ-AUTH-001 -->
# Login must rate-limit failed attempts

The login endpoint rejects more than 5 failed attempts per IP per minute.
Repeat attempts past the limit return HTTP 429 with `Retry-After`.

<!-- id: REQ-AUTH-005 -->
# Reject expired tokens with 401

`checkExpiry` returns false when the JWT is past its `exp` claim.
The response is 401 with `code: token_expired`.
```

SpecShip parses every Markdown file under `specs/`, extracts the `id:`-tagged headings, and adds them to the knowledge graph as `spec` nodes alongside the `function`/`class`/`route` nodes from your code. Each spec gets:

- **A stable id** (`REQ-AUTH-005`) — never changes, even if the title rephrases.
- **A content hash** — so we know when the body of the spec changed.
- **Parent/child structure** — `AUTH-DOC` is the parent doc; the requirements live under it.
- **A queryable body** — searchable via FTS5; readable via `specship_spec(REQ-AUTH-005)`.

## What "link" means here

A **spec link** is a persistent record connecting one spec node to one code node — typically the function, method, or class that implements that requirement. Each link carries:

| Field | Meaning |
|---|---|
| `kind` | `implements` / `tests` / `documents` / `validates` |
| `state` | `drafted` / `implementing` / `implemented` / `verified` / `drifted` / `broken` / `orphaned` |
| `provenance` | `agent-asserted` / `pragma` (`@implements` comment) / `heuristic` |
| `drift_axis` | when `drifted`: `spec` (spec changed) or `code` (code changed) |
| `spec_hash_at_link` | snapshot of the spec body when the link was set |
| `node_sig_at_link` | snapshot of the code signature when the link was set |

When the spec body or the code signature drifts past those snapshots, the link's state transitions to `drifted`. When the linked code disappears entirely, it becomes `orphaned`. And `verified` is **earned, not assumed**: promotion requires a passing test that is linked to the spec as evidence — a `verifies:` block in the spec (`- <test-file>:<test-symbol>`) or an `@verifies REQ-X` comment on the test. A green suite alone proves nothing about a spec with no linked tests; those stay `implemented` and are flagged as unevidenced. The state is the **single source of truth** for "is this requirement actually shipped".

## Why this matters in practice

| Without specs | With SpecShip specs |
|---|---|
| _"Did we ever build login rate-limiting?"_ → grep, hope, commit message archaeology | `specship_drifted` lists every link by state. Anything not `verified` is the answer. |
| _"This auth code looks weird, why is it like this?"_ → blame, hope, ask the senior who quit | Every linked symbol has a `linkedSpecs` list. Click → read the spec. |
| _"Agent shipped something — did it match my brief?"_ | The brief IS the spec. The link IS the proof. The drift state IS the validity check. |
| _"PM/legal asked us to prove the rate-limit is in place."_ | `specship spec REQ-AUTH-001` → state `verified`, linked to `src/auth.ts:loginEndpoint`, tested by `test/auth.test.ts:rateLimit`. |

## What's NOT a spec

SpecShip's bet is narrow:

- A spec is **a requirement, not a design doc.** "The login endpoint rejects > 5 attempts/minute" is a spec. "Architecture: we use Redis for the counter" is not — that's design, and it lives elsewhere (or not).
- A spec is **stable identity, mutable body.** The `id:` never moves; the body can be rewritten freely. If the requirement itself fundamentally changes, that's a *new spec*, not an edit.
- A spec is **independent of any one implementation.** `REQ-AUTH-001` describes the behaviour. The link tracks which code implements it. Refactor the code; the link survives.

## How the workflow engine uses specs

Three of the four bundled workflows are named `spec-*` for a reason — the spec is the input:

- `spec-implement REQ-AUTH-005` → plan → code → test → review → merge, with the spec as the brief.
- `spec-fix REQ-AUTH-005` → diagnose the drift → fix → re-verify.
- `spec-verify` → re-run tests across many linked specs, promote `implemented` → `verified`.

The agent has direct MCP access to `specship_spec(<id>)` to read the spec, `specship_link_assert(...)` to declare it built the thing, and `specship_link_verify(...)` to confirm tests pass.

→ Next: [Writing specs](/specs/writing-specs/) — the file format, ID conventions, and a few patterns that scale.
