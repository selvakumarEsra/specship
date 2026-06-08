---
title: Writing specs
description: The Markdown format, ID conventions, document/requirement/acceptance hierarchy, and patterns that scale.
---

A spec is plain Markdown with `id:` frontmatter and `<!-- id: ... -->` comment markers inline. SpecShip parses every `.md` file under your `specs/` directory tree.

## Minimal example

```markdown
<!-- specs/auth.md -->
---
id: AUTH-DOC
title: Authentication
owner: alice
priority: P0
---

<!-- id: REQ-AUTH-005 -->
# Reject expired tokens with 401

The `checkExpiry` function returns false when the JWT is past its `exp` claim.
Expired tokens return HTTP 401 with `code: token_expired` in the body.

## Acceptance

<!-- id: AC-AUTH-005-1 -->
- **Token within expiry**: `checkExpiry` returns true.
- **Token past expiry**: `checkExpiry` returns false. Response is 401.
- **Clock skew tolerance**: a 30s grace window is allowed.
```

That single file produces:

```
AUTH-DOC (document)
└── REQ-AUTH-005 (requirement)
    └── AC-AUTH-005-1 (acceptance)
```

— three spec nodes in the knowledge graph, each individually queryable, each separately linkable to code.

## The three node kinds

| Kind | When to use | ID pattern |
|---|---|---|
| **document** | A whole-area concern (auth, billing, search). Lives at the top of a file via frontmatter. Holds metadata (owner, priority). | `<AREA>-DOC` |
| **requirement** | One testable assertion. Lives under an `<!-- id: ... -->` comment + `#` heading. | `REQ-<AREA>-<NNN>` |
| **acceptance** | A concrete pass/fail criterion that supports a requirement. Lives under a nested `## Acceptance` or a `<!-- id: ... -->` inside the requirement's body. | `AC-<AREA>-<NNN>-<i>` |

The hierarchy is **just convention** — SpecShip doesn't enforce it. A flat `REQ-*` layout works fine if the team prefers it. Two-level (`REQ-*` + `AC-*`) is the most common shape we see.

## ID rules

- **Stable.** Once a spec has an ID, **never change it**. Code links to the ID. Renames break links.
- **Globally unique** within the project.
- **Conventional but not enforced.** `REQ-AUTH-005` is convention; `widget-001` works if you prefer. SpecShip just treats the string as an opaque key.
- **Embedded.** The `<!-- id: ... -->` comment must immediately precede a heading. SpecShip uses the heading as the spec's title.

When a spec is genuinely **dead** — replaced, scope-cut, never-going-to-ship — don't delete it. Mark it obsolete:

```markdown
<!-- id: REQ-AUTH-002 -->
# [DEPRECATED] OAuth 1.0a flow

Superseded by REQ-AUTH-009.
```

Existing links resolve. Searches still find it. History is preserved.

## Document-level frontmatter

The leading `---` block on a document spec accepts these fields (all optional except `id` and `title`):

```yaml
---
id: AUTH-DOC
title: Authentication
owner: alice                # used by `spec-fix` to route the approval gate
priority: P0                # P0 / P1 / P2 / P3
status: active              # active / paused / shipped / deprecated
tags: [security, public-api]
---
```

`owner` and `priority` show up in the desktop UI's Specs page filters. `tags` are searchable via `specship_search`.

## Patterns

### One file per area

The most common shape: `specs/auth.md`, `specs/billing.md`, `specs/search.md`. Each file's frontmatter is the area document. Requirements and acceptance criteria live inline.

This scales to ~30 requirements per file. Past that, split:

```
specs/auth/
├── README.md                 ← AUTH-DOC, the area doc + index
├── login.md                  ← REQ-AUTH-001..010
├── tokens.md                 ← REQ-AUTH-020..030
└── recovery.md               ← REQ-AUTH-040..050
```

### Linking from the requirement

A spec can declare a soft link to its expected implementation via a `@link` annotation, which `specship init` parses and pre-creates a link in `drafted` state:

```markdown
<!-- id: REQ-AUTH-005 -->
# Reject expired tokens with 401

@link src/auth.ts:checkExpiry

The `checkExpiry` function returns false when the JWT is past its `exp` claim.
```

When the agent implements it, that `drafted` link gets promoted to `implemented`. This is a useful breadcrumb for new requirements — you tell the agent *where* to look before it even reads the spec.

### Multi-line code samples in the spec

If the spec needs to be precise about the wire format, put it in a fenced block:

````markdown
<!-- id: REQ-AUTH-005 -->
# Reject expired tokens with 401

```json
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{ "code": "token_expired", "exp": 1700000000 }
```
````

The fenced block is part of the spec's content hash. If you change the JSON shape, the hash changes, the link goes `drifted`, the agent has to re-verify.

### Bridging vague specs

Sometimes the spec is fuzzy because the requirement is genuinely fuzzy ("the UI should feel snappy"). Two patterns work:

1. **Make it testable**: "the dashboard's first paint completes in under 800ms on a mid-range device" — now it's `verifiable`.
2. **Use `documents` link kind**: link the spec with `kind: documents` instead of `kind: implements`. It tells the graph "this code is *about* this requirement" without claiming testability.

## What NOT to put in specs

| Avoid | Why | Where instead |
|---|---|---|
| Architecture diagrams | They aren't requirements; they're design decisions. They go stale. | A `DESIGN.md` outside `specs/`. |
| Code snippets that ARE the implementation | The spec becomes the source of truth and the code becomes redundant. | The spec describes behaviour; the code does the behaviour. |
| Long backstory ("we tried X first, then Y…") | The spec is what we're shipping, not how we got here. | A `decisions/` directory or git history. |
| Open questions | "Maybe we should…" isn't a spec. | An issue tracker. |

## Where they live

By default `specship init` indexes any `.md` file under `specs/` at the project root. Customize via the configuration file:

```yaml
# specship.config.yaml
spec:
  roots:
    - specs/
    - docs/requirements/
  ignore:
    - "**/draft/**"
```

→ Next: [Spec links & drift](/specship/specs/links-and-drift/) — the link lifecycle and how drift detection works.
