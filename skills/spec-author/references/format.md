# Spec format reference

The SpecShip parser at `src/extraction/specs/markdown-spec-extractor.ts` accepts a strict Markdown subset. This file is the contract — if your draft doesn't match what's described here, `specship sync` will emit `spec_missing_id`, `spec_stranded_id`, or `spec_bad_frontmatter` errors and the spec won't enter the graph.

## File location

```
<project-root>/specs/<slug>.md
```

The directory is configurable but `specs/` is the default. One file can hold one document with many requirements; you don't need one file per REQ.

## Top-to-bottom anatomy

```markdown
---                                          ← YAML frontmatter (optional)
id: AUTH-DOC
title: Authentication
owner: security-team
priority: high
version: 1
---

<!-- id: AUTH-DOC -->                        ← embedded ID for the document
# Authentication                              ← H1 = document body

This document covers login, session         ← document body text
management, and rate-limiting.

<!-- id: REQ-AUTH-001 -->                    ← embedded ID for a requirement
## Failed logins MUST be rate-limited        ← H2 = requirement

The login endpoint rejects more than 5
failed attempts per IP per minute.

implementations:                              ← optional code-link block
  - src/auth/login.ts:authenticate
  - src/auth/rate-limit.ts:enforce

verifies:                                     ← optional test-evidence block
  - __tests__/auth-rate-limit.test.ts:rejectsSixthAttempt

## Acceptance                                 ← unnumbered subheading, OK
<!-- id: REQ-AUTH-001.A1 -->                 ← embedded ID for an acceptance bullet
- A 6th failed attempt within 60 s from
  the same IP returns 429 with `Retry-After`.
<!-- id: REQ-AUTH-001.A2 -->
- A successful login resets the counter
  for that IP.
```

## The five hard rules

### 1. Every heading needs an embedded ID immediately above it

```markdown
<!-- id: REQ-FOO-001 -->         ← required
## Title here                    ← heading
```

If you forget the marker, the parser emits `spec_missing_id` (severity `error`) and the spec doesn't index. The marker must be on the line immediately above the heading — blank lines or other content between them break the pairing.

### 2. Two ID comments in a row produces a stranded-ID warning

```markdown
<!-- id: REQ-A -->
<!-- id: REQ-B -->               ← REQ-A becomes "stranded"
## Title
```

This is `spec_stranded_id` (severity `warning`). The first ID is lost. Don't paste IDs from old drafts without their headings.

### 3. Hierarchy is heading depth

Levels nest naturally: H2 is a child of H1, H3 is a child of H2 (or H1 if no H2 above it), etc. The document spec (`kind: 'document'`) sits above all of them.

Practical translation:
- `# H1` → typically the document body (or a single requirement if there's no other heading)
- `## H2` → requirements
- `### H3` → child requirements OR acceptance bullets parent
- `#### H4+` → child acceptance bullets (rarely used)

### 4. Acceptance bullets get their own ID markers

The convention is `<REQ-ID>.A1`, `.A2`, etc.:

```markdown
<!-- id: REQ-AUTH-001 -->
## Failed logins MUST be rate-limited

## Acceptance
<!-- id: REQ-AUTH-001.A1 -->
- A 6th failed attempt within 60 s ...
<!-- id: REQ-AUTH-001.A2 -->
- A successful login resets the counter ...
```

The `## Acceptance` heading is conventional but not required by the parser — it just helps the human reader. The ID markers on the bullets ARE required if you want them queryable as individual spec nodes.

### 5. Frontmatter ID is optional but useful

If you provide an `id:` field in YAML frontmatter, the document spec uses that ID. If you don't, the document only emits a node when an H1 with an embedded ID is present. Most files should declare frontmatter `id:` so the document is always addressable.

## IDs must be unique within the file

Two markers declaring the same ID do not error — the specs are stored with `INSERT OR REPLACE`, so the **LAST** occurrence overwrites the earlier ones. The earlier heading's title, body, and links are silently gone. Scan for accidental duplicates before writing the file (a common cause: copy-pasting a REQ block and forgetting to bump the number).

## YAML frontmatter fields

All optional except as noted. The parser reads any string-typed field; unknown keys become `metadata`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Document-level spec ID. Conventional: `<AREA>-DOC` (e.g. `AUTH-DOC`). |
| `title` | string | Human title. Falls back to the H1 if absent. |
| `owner` | string | Team or person. Convention: `security`, `payments-team`, `@alice`. |
| `priority` | string | Free-form. Convention: `high` / `medium` / `low`. |
| `version` | string \| number | Spec version. Convention: integer that increments on contract changes. |
| `format` | string | Defaults to `markdown`. Don't set unless you know why. |
| `depends_on` | string \| list | Spec IDs this document depends on. Accepts one id, a comma-separated list, or `[a, b]`. |
| `metadata` | object | Arbitrary nested object. Reserved for future indexing. |

Stop the frontmatter with `---` on its own line. The parser tolerates a missing trailing `---` but emits `spec_bad_frontmatter` as a warning.

## The link blocks: `implementations:` and `verifies:`

Both blocks live in the **body of a requirement** (not at the file level), and both use the same bullet syntax. They differ only in the kind of link they create.

```markdown
<!-- id: REQ-FOO-001 -->
## Some requirement

Body text...

implementations:
  - src/foo/bar.ts:doThing
  - src/foo/baz.ts:Baz.handle

verifies:
  - __tests__/foo.test.ts:doThingRejectsEmptyInput
```

Shared syntax rules:

- Each bullet is `<file-path>:<qualified-symbol>`.
- File paths are project-root-relative.
- Qualified symbols use dots: `Class.method`, `Class.staticMethod`, `module.function`.
- The pattern `[-*]\s+([^\s:]+)\s*:\s*([A-Za-z0-9_$.]+)` is what the parser matches.
- A bullet that has no `:symbol` (a bare path — e.g. a pointer at a slash-command markdown file) creates **no edge**. It's tolerated, doesn't end the block, and emits a `spec_bare_path_ref` warning naming the bullet. Use it only when there genuinely is no code symbol to point at.
- Only the FIRST block of each keyword in a requirement body is read. A block ends at the first non-blank, non-bullet line.

### `implementations:` → link kind `implements`

This block is the **backstop** for spec-to-code links. The agent SHOULD call `specship_link_assert` programmatically after implementing the spec — but if it forgets, the `implementations:` block re-asserts the link on every index. Either way, the link enters state `implemented`.

Leave `implementations:` empty (or omit it) in a fresh spec — the agent fills it in via `link_assert` once the code lands. Specify it up-front when you have a strong sense of where the implementation will live.

### `verifies:` → link kind `tests`

This is the **test-evidence** declaration, and it's what gates promotion from `implemented` to `verified`. A requirement with implementation code but no passing test evidence does not count as verified, no matter how complete the code is.

Point each bullet at a **real test symbol** — an exported test helper or a named test function. A bare `describe(...)` / `it(...)` string is not a symbol in the graph, so it can't be a link target; if the test file has no addressable symbol, either name a helper function the test calls or leave `verifies:` out until there is one.

Omit `verifies:` from a spec being authored before the tests exist. Adding it speculatively produces an orphan link that pollutes the drift queue.

## RFC 2119 keywords in titles + bodies

Use **MUST / SHOULD / MAY** in the requirement title and body. The parser doesn't validate these, but the review checklist does. Conventional usage:

| Keyword | Meaning |
|---|---|
| **MUST** | Required for compliance. Test failure means the spec is broken. |
| **SHOULD** | Strongly recommended. Deviation requires justification. |
| **MAY** | Optional. Choose freely; no compliance impact. |
| **MUST NOT** / **SHOULD NOT** | Negative forms. Same strength as positive. |

Avoid weasel words: "ought to", "could", "supports". They're un-testable and the review will flag them.

## Slug conventions

For the filename:

- **Kebab-case**, no spaces.
- **Feature name**, not date — git history records the when.
- **One file per logical area** when reasonable. `auth.md` is better than `auth-login.md` + `auth-logout.md` + `auth-rate-limit.md` if all three live under `AUTH-DOC`.

## What the parser explicitly DOES NOT support

- **No Markdown extensions** (footnotes, definition lists, task lists with `- [ ]`). They render fine, but the parser doesn't extract structure from them.
- **No HTML other than the `<!-- id: -->` comment.** Don't embed `<div>` or `<table>`.
- **No code blocks treated specially.** Triple-backtick fenced blocks render but are body content, not structure.
- **No links treated specially.** A `[REQ-AUTH-005](#req-auth-005)` link is rendered text, not a queryable cross-reference. Use the markers + heading text; the indexer's name-matcher handles cross-spec lookups.
- **No multi-file specs.** One spec file = one document. Cross-document parent references aren't supported (`depends_on` in frontmatter is the one cross-document relation).

If you find yourself wanting these, write a regular Markdown doc under `docs/` instead and let the spec layer focus on what it parses.

## Quick checklist before writing the file

- [ ] Frontmatter ID set (`id: <AREA>-DOC` or similar).
- [ ] Every heading has `<!-- id: ... -->` immediately above it.
- [ ] No two ID comments in a row (stranded ID).
- [ ] No ID declared twice in the file (the last one silently overwrites the first).
- [ ] Acceptance bullets each have their own `.A<N>` ID.
- [ ] `implementations:` paths (if specified) point at real symbols (verified via `specship_explore` or `specship_node`).
- [ ] `verifies:` bullets (if specified) point at real test symbols, not `describe`/`it` strings.
- [ ] RFC 2119 keywords used correctly (or not at all).
- [ ] No `<div>` / `<table>` / Markdown-extension syntax in the body.
- [ ] Filename is kebab-case, no date prefix, feature-named.

If all ten pass, the file will index cleanly.
