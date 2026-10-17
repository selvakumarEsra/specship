---
title: Writing specs
description: The Markdown format — ID markers, the document/requirement/acceptance hierarchy, implementations and verifies link blocks, frontmatter keys, and patterns that scale.
---

A spec is plain Markdown with frontmatter and `<!-- id: ... -->` comment markers. SpecShip parses every `.md` file under the `specs/` directory at your project root (recursively).

> **Not sure what the spec should say yet?** In Claude Code, run `/specship:spec new <description>` — it grounds the idea in your existing code, explores 2–3 approaches with you one question at a time, and writes the spec only once you confirm. `/specship:spec fast <description>` asks just two questions (primary failure mode, primary non-goal) and drafts the rest. Either way the spec is linted and reviewed before hand-off. See [Spec commands](/specs/spec-commands/).

## Minimal example

```markdown
<!-- specs/auth.md -->
---
id: AUTH-DOC
title: Authentication
owner: alice
priority: P0
---

<!-- id: AUTH-DOC -->
# Authentication

Session-token handling for the public API.

Non-goals: refresh-token rotation (tracked separately).

<!-- id: REQ-AUTH-005 -->
## Expired tokens MUST be rejected with 401

The `checkExpiry` function returns false when the JWT is past its `exp` claim.
Expired tokens return HTTP 401 with `code: token_expired` in the body.

implementations:
  - src/auth.ts:checkExpiry

verifies:
  - __tests__/auth.test.ts:rejectsExpiredToken

## Acceptance
<!-- id: REQ-AUTH-005.A1 -->
- A token within its expiry is accepted.
<!-- id: REQ-AUTH-005.A2 -->
- A token past its expiry is rejected with 401.
<!-- id: REQ-AUTH-005.A3 -->
- A token up to 30 seconds past expiry is still accepted (clock-skew grace).
```

That single file produces:

```
AUTH-DOC (document)
└── REQ-AUTH-005 (requirement)
    ├── REQ-AUTH-005.A1 (acceptance)
    ├── REQ-AUTH-005.A2 (acceptance)
    └── REQ-AUTH-005.A3 (acceptance)
```

— five spec entities, each individually queryable, each separately linkable to code and tests, plus an `implements` link to `checkExpiry` and a `tests` link to `rejectsExpiredToken`.

## The three node kinds

| Kind | How it's written | ID convention |
|---|---|---|
| **document** | The frontmatter `id`, optionally repeated on the first `#` heading (that heading becomes the document, not a requirement). Without a frontmatter `id`, the first `#` heading with an ID marker is the document. | `<AREA>-DOC` |
| **requirement** | An ID marker on its own line, directly above a `#` or `##` heading. | `REQ-<AREA>-<NNN>` |
| **acceptance** | An ID marker directly above a **bullet** (the usual form), or above a `###`-or-deeper heading. | `<REQ-ID>.A<N>` |

An acceptance bullet's parent is read from its ID: `REQ-AUTH-005.A2` belongs to `REQ-AUTH-005`. Without an `.A<N>` suffix it falls back to the nearest requirement above it. If the suffix names a different requirement than the one the bullet sits under, the bullet is parented by its ID and SpecShip warns about the misplacement.

A criterion's text runs from its bullet through any continuation lines, up to the next bullet, ID marker, heading, or blank line.

## ID rules

- **Every heading needs an ID marker** — except a plain `## Acceptance` heading, which is a container and produces no entity. Any other heading without a marker is an error (`spec_missing_id`).
- **The marker sits alone on its own line**, immediately above its heading or bullet. Two markers in a row strand the first one (a warning).
- **Stable.** Once a spec has an ID, **never change it**. Links key on the ID; renaming it detaches them.
- **Unique** within the project. `specship lint` flags duplicates.
- **Conventional but not enforced.** `REQ-AUTH-005` is convention; SpecShip treats the string as an opaque key — but the `.A<N>` suffix *is* meaningful (it sets the parent).

When a requirement is genuinely **dead** — replaced, scope-cut, never-going-to-ship — don't delete it. Mark it superseded in its prose so readers (and agents) stop treating it as a live contract:

```markdown
<!-- id: REQ-AUTH-002 -->
## OAuth 1.0a flow

> **SUPERSEDED (2026-09-25) by REQ-AUTH-009.** Kept for history.
```

This is a prose convention — SpecShip doesn't change the requirement's behaviour because of it. Deleting a requirement outright deletes its links.

## Link blocks: `implementations:` and `verifies:`

Two block keywords declare links from inside the spec. Both take `path:Symbol` bullets:

```markdown
implementations:
  - src/auth/session.ts:refreshSession
  - src/auth/session.ts:SessionStore.load

verifies:
  - __tests__/session.test.ts:refreshesAnExpiredSession
```

| Block | Creates | Purpose |
|---|---|---|
| `implementations:` | `implements` links | The code that realizes the requirement. |
| `verifies:` | `tests` links | The tests that **prove** it — the evidence a requirement needs to reach `verified`. |

Rules worth knowing:

- **The symbol must be a real, indexed symbol in that file.** `Class.method` and `Class::method` are treated as the same symbol. A bare method name without its class never resolves.
- **A test is linkable only as a named function.** An `it('…')` title is a string, not a symbol — hand a named function to `it()` (`it('rejects expired tokens (REQ-AUTH-005.A2)', rejectsExpiredToken)`) and list `rejectsExpiredToken`. (Test titles that mention a requirement ID are also picked up automatically — see [Test evidence & coverage](/specs/test-evidence/).)
- **`verifies:` must point into a test file** (`__tests__/`, `tests/`, `spec/`, `*.test.*`, `*.spec.*`, `*_test.*`, `test_*.py`). A bullet that points at a fixture or source file is recorded but flagged, and never counts as evidence.
- **Bare-path bullets create no link.** A bullet without `:Symbol` (for example a pointer to a Markdown command file) is skipped with a `spec_bare_path_ref` warning naming the file and line; the bullets after it still link normally.
- **One block of each keyword per section** — the first `implementations:` and first `verifies:` in a requirement's body are read. A block ends at the first line that is neither a bullet nor blank.
- **Where the keyword sits decides who owns the block.** A keyword at column 0 belongs to the enclosing requirement (or to the document, if it's in the document's intro). An **indented** keyword directly under an acceptance bullet belongs to that criterion:

```markdown
## Acceptance
<!-- id: REQ-AUTH-005.A2 -->
- A token past its expiry is rejected with 401.
  verifies:
    - __tests__/auth.test.ts:rejectsExpiredToken
```

Per-criterion blocks are what make per-criterion coverage possible. You don't have to maintain these blocks by hand: when the agent calls `specship_link_assert` for an `implements` link, SpecShip writes the bullet into the requirement's `implementations:` block for you (creating it if needed), so the link is git-versioned and survives any re-index.

## Frontmatter

The leading `---` block is a simple `key: value` list (one per line; no nested YAML). Five keys are read as first-class fields; every other key is kept as metadata.

| Key | Meaning |
|---|---|
| `id` | The document's ID. |
| `title` | The document's title (falls back to the first heading). |
| `owner` | Free-form owner / accountable party. |
| `priority` | Free-form priority (`P0`, `high`, …). |
| `version` | Integer version. |

Metadata keys SpecShip itself reads or writes:

| Key | Written by | Meaning |
|---|---|---|
| `brief` | You / `/specship:spec new brief:<slug>` | Path (relative to the spec file) of the idea brief this spec was promoted from — e.g. `rate-limit/brief.md`. Links the brief to the spec. |
| `jira_issue` | JIRA publish | The JIRA issue mirroring this spec (single-requirement files). |
| `jira_issue_<REQ-ID>` | JIRA publish | Per-requirement issue key, for files with several requirements. |
| `jira_fingerprint` / `jira_fingerprint_<REQ-ID>` | JIRA publish | Content fingerprint used to skip unchanged re-publishes. |
| `epicKey` | You / the authoring flow | The JIRA epic new issues are created under (overrides the repo binding's default). |
| `jira_publish` | You | Set to `false` to opt this file out of automatic publish on sync. |
| `jira` | `/specship:spec implement` on a JIRA-bound repo | The issue key the implement run is anchored to. |

The JIRA keys only matter if you use the JIRA integration — see [JIRA integration](/guides/jira/).

## Patterns

### One file per area

The most common shape: `specs/auth.md`, `specs/billing.md`, `specs/search.md`. Each file's frontmatter is the area document. Requirements and acceptance criteria live inline.

Past ~30 requirements, split by sub-area — any `.md` under `specs/` is indexed, at any depth:

```
specs/auth/
├── login.md                  ← AUTH-LOGIN-DOC, REQ-AUTH-001..010
├── tokens.md                 ← AUTH-TOKENS-DOC, REQ-AUTH-020..030
└── recovery.md               ← AUTH-RECOVERY-DOC, REQ-AUTH-040..050
```

Two file names are special: any `brief.md` is parsed as an [idea brief](/specs/ideas-and-domain-facts/), and anything under `specs/domain/` is parsed as a [domain fact](/specs/ideas-and-domain-facts/#domain-facts).

### Write requirements to pass the lint

`specship lint` (no index needed) checks the structure mechanically. Errors: duplicate IDs, headings without markers, `.A<N>` IDs whose parent isn't in the file, requirements with no acceptance criteria, and leftover `[needs review]` markers inside a criterion. Warnings: no `MUST`/`SHOULD`/`MAY` keyword in a requirement, no negative-case criterion (nothing about refusal, failure, or absence), no stated non-goals, and no test-evidence signal. See [Quality gates](/specs/quality-gates/#specship-lint).

### Multi-line code samples in the spec

If the spec needs to be precise about the wire format, put it in a fenced block:

````markdown
<!-- id: REQ-AUTH-005 -->
## Expired tokens MUST be rejected with 401

```json
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{ "code": "token_expired", "exp": 1700000000 }
```
````

The fenced block is part of the spec's content hash. Change the JSON shape and every link on the requirement goes `drifted` until someone re-verifies.

### Bridging vague specs

Sometimes the spec is fuzzy because the requirement is genuinely fuzzy ("the UI should feel snappy"). Two patterns work:

1. **Make it testable**: "the dashboard's first paint completes in under 800ms on a mid-range device" — now a test can prove it.
2. **Link with a softer kind**: have the agent assert the link with `kind: documents` instead of `implements`. It tells the graph "this code is *about* this requirement" without claiming it is the implementation.

## What NOT to put in specs

| Avoid | Why | Where instead |
|---|---|---|
| Architecture diagrams | They aren't requirements; they're design decisions. They go stale. | A design doc outside `specs/` (or let `specship diagram` keep a flow diagram current for you). |
| Code snippets that ARE the implementation | The spec becomes the source of truth and the code becomes redundant. | The spec describes behaviour; the code does the behaviour. |
| Long backstory ("we tried X first, then Y…") | The spec is what we're shipping, not how we got here. | A `decisions/` directory, a domain fact of type `decision`, or git history. |
| Open questions | "Maybe we should…" isn't a spec. | An idea brief (`/specship:spec idea …`) or your issue tracker. |

→ Next: [Spec links & drift](/specs/links-and-drift/) — the link lifecycle and how drift detection works.
