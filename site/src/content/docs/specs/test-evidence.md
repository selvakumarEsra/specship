---
title: Test evidence & coverage
description: How a requirement proves it is tested — verifies blocks, @verifies comments, auto-linked test titles, the coverage rollup, and verification from a real test-run report.
---

An `implements` link is a **claim**: this code says it satisfies the requirement. A `verified` link is a **proof**: a test linked to the requirement passed. SpecShip keeps the two apart on purpose. A requirement with code but no linked test reads as **untested** — never as met — and it cannot be promoted to `verified` until test evidence exists.

## Three ways to declare test evidence

All three create `tests`-kind links. All three are **file-derived** — re-read from your files on every index, so they survive re-indexing and show up in code review.

### 1. A `verifies:` block in the spec

```markdown
<!-- id: REQ-AUTH-005 -->
## Expired tokens MUST be rejected with 401

verifies:
  - __tests__/auth.test.ts:rejectsExpiredToken

## Acceptance
<!-- id: REQ-AUTH-005.A3 -->
- A token up to 30 seconds past expiry is still accepted.
  verifies:
    - __tests__/auth.test.ts:allowsClockSkew
```

A block at column 0 belongs to the requirement; an indented block under an acceptance bullet belongs to **that criterion** — which is what makes per-criterion coverage possible. Bullets are `path:Symbol`, naming a real symbol, so a linkable test is a **named function** passed to `it()`. Details in [Writing specs](/specs/writing-specs/#link-blocks-implementations-and-verifies).

### 2. An `@verifies` comment on the test

```typescript
/** @verifies REQ-AUTH-005.A3 */
function allowsClockSkew() { /* … */ }
it('accepts a token inside the skew window', allowsClockSkew);
```

See [The @implements pragma](/specs/implements-pragma/#verifies--the-test-side-twin).

### 3. A requirement ID in the test title (automatic)

```typescript
it('accepts a token inside the skew window (REQ-AUTH-005.A3)', () => { /* … */ });
```

SpecShip scans `it(…)`, `test(…)`, and `bench(…)` titles — including modifier chains like `it.each`, `test.skip`, or `it.concurrent.only` — in **test files only**, and links every title that mentions a real spec ID. No boilerplate to maintain: the title you were going to write anyway is the evidence. The link targets the test file and remembers the matching titles, which is what lets a test report be matched back to it.

A spec ID that appears in a *source* file's string never becomes evidence — only recognized test files are scanned.

### What counts as a test file

A path under `__tests__/`, `__test__/`, `tests/`, or `spec/`, or a file named `*.test.*`, `*.spec.*`, `*_test.*`, or `test_*.py`. A `verifies:` bullet or `@verifies` comment pointing anywhere else (a fixture, a helper, a source file) is recorded but flagged as non-test evidence and never satisfies the promotion gate.

### What doesn't count

- A `tests` link the agent asserted for itself with `specship_link_assert`. An implement run must not be able to mint its own evidence and promote itself.
- A green suite with no linked tests. It proves nothing about any particular requirement.

## Coverage: which requirements are actually tested

`specship coverage` answers "which requirements and criteria have test evidence" — per requirement and per acceptance criterion:

```bash
specship coverage                 # the whole project
specship coverage REQ-AUTH-005    # one requirement (or a document ID)
specship coverage --line          # just the one-line summary
specship coverage --json          # the full report, for scripts
```

```
· REQ-AUTH-005 untested — Expired tokens MUST be rejected with 401
    ✔ REQ-AUTH-005.A1 verified · implements:0 tests:1
    · REQ-AUTH-005.A2 untested · implements:1 tests:0
    ~ REQ-AUTH-005.A3 tested · implements:0 tests:1

2 of 3 acceptance criteria for REQ-AUTH-005 have linked tests.
```

Each spec entity gets one verdict, derived **only from `tests` links**:

| Verdict | Meaning |
|---|---|
| `untested` | No test evidence at all — including when implementation exists. |
| `tested` | Tests are linked, but none has a passing verification yet. |
| `verified` | Every linked test is verified. |
| `broken` | At least one linked test failed (worst state wins). |

A requirement's verdict is the **worst** of its criteria's verdicts — one untested criterion makes the requirement untested, as in the example above. A requirement with no acceptance criteria counts as its own single criterion.

The same numbers back the `specship_spec` tool (`coverage: true`), the dashboard's Traceability page and coverage chips, and the figure shown at the implement workflow's approval gate — so nobody's count can disagree with anyone else's.

## Verification from a real test run

`verified` used to mean "an agent read a log and said it passed". `specship verify --report` replaces that with an auditable fact: it reads a test-runner report, matches each reported test case to the `tests` links that claim it, and moves those links.

```bash
npx vitest run --reporter=json --outputFile=test-report.json
specship verify --report test-report.json
```

```
✔ Read 412 test case(s) from test-report.json (run run-1760600000000).
  ✔ REQ-AUTH-005.A1 implemented → verified — rejects an expired token
  ✗ REQ-AUTH-005.A3 implemented → broken — accepts a token inside the skew window

1 verified, 1 broken, 37 unchanged, 18 unmatched.
```

- **Format:** vitest's JSON report (`--reporter=json`).
- **Matching:** by file first — evidence must live in the file the link points at — then by title: a title recorded by the test-title scan, a full test name that contains the spec ID, or a full test name that contains the linked test function's name.
- **Verdict per link:** any failed case → `broken`; otherwise at least one passed case → `verified`; only skipped cases → unchanged (a skipped test proves nothing).
- **Audit trail:** each moved link records the run ID (`--run-id <id>` to set your own), the report path, a timestamp, and the exact test names the verdict rests on.
- **Nothing silent:** cases that match no link are counted and sampled in the output. A malformed or unreadable report fails with a non-zero exit **before** anything is changed.
- `--json` emits the full result for CI.

From inside Claude Code, the agent records a verdict for a single link with `specship_link_verify` (`pass` / `fail`), passing the test names it actually ran as evidence. Promoting an `implements` link this way is **refused** when the requirement has no file-derived test evidence — the refusal tells you exactly how to declare some.

## Evidence that tests are strong, not just present

A passing test proves the test exists and passed, not that it would notice the code breaking. Two opt-in checks in [Quality gates](/specs/quality-gates/) close that gap:

- **Property-based tests** for criteria phrased as invariants ("never", "for all", round-trips) — the behaviour flow authors them with Hypothesis or fast-check.
- **A mutation-score check** that flags requirements whose linked implementation files have a low mutant kill rate.

→ Next: [Quality gates](/specs/quality-gates/) — lint, the enforcement gate, and agent-test hardening.
