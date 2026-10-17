---
title: Quality gates
description: specship lint for spec structure, the specship check enforcement gate (drift, behaviour, suppressions, mutation score and more), and the property-test and contract-fuzz lanes that harden agent-written tests.
---

Specs, links, and test evidence only help if something holds the line. SpecShip ships a small set of deterministic gates — no model in the loop — that you can run locally, in a pre-commit habit, or in CI.

| Gate | Checks | Needs an index |
|---|---|---|
| `specship lint` | Spec files are well-formed and complete. | No |
| `specship check` | Drift, behaviour (spec → test → verified), architecture fitness, maintainability, new lint suppressions, and (opt-in) mutation score. | Yes |
| `specship suppressions` | The change under review doesn't silence a linter. | No (needs git) |
| `specship drifted --fail-on …` | No links in the listed states. | Yes |

## `specship lint`

Checks spec files for structural errors and quality warnings. It reads the files directly, so it runs in a fresh checkout before anything has been indexed.

```bash
specship lint                       # every .md under specs/
specship lint specs/auth.md         # specific files or directories
specship lint --json                # machine-readable
```

```
specs/auth.md
  error spec_requirement_without_acceptance:12 — REQ-AUTH-006 has no acceptance criteria — nothing can verify it.
  warn  spec_no_negative_case:5 — REQ-AUTH-005 has no negative-case acceptance criterion (no refusal, failure, or absence is specified).

1 error(s), 1 warning(s) in 14 file(s)
```

**Errors** (exit code 1):

| Code | Problem |
|---|---|
| `spec_missing_id` | A heading has no `<!-- id: … -->` marker (a plain `## Acceptance` container is exempt). |
| `spec_duplicate_id` | The same ID is declared twice. |
| `spec_orphan_acceptance_parent` | An `.A<N>` criterion names a parent requirement that isn't in the file. |
| `spec_requirement_without_acceptance` | A requirement has no acceptance criteria — nothing can verify it. |
| `spec_needs_review_marker` | A `[needs review]` marker was left inside an acceptance criterion. |

**Warnings** (reported, exit code stays 0):

| Code | Problem |
|---|---|
| `spec_requirement_without_rfc2119` | A requirement's title and body state no `MUST` / `SHOULD` / `MAY` (or similar) — its obligation is ambiguous. |
| `spec_no_negative_case` | No criterion mentions a refusal, failure, or absence — happy path only. |
| `spec_missing_non_goals` | The document states no non-goals. |
| `spec_missing_test_plan` | No `verifies:` block, `@verifies`, or test plan anywhere in the file. |
| `spec_bare_path_ref` | An `implementations:` / `verifies:` bullet has no `:Symbol`, so it creates no link. |
| `spec_stranded_id` | An ID marker isn't followed by a heading or bullet. |
| `spec_acceptance_parent_mismatch` | A criterion sits under one requirement but its ID names another. |

Idea briefs (`brief.md`), design hand-off transcripts (`source.md`), and domain facts are not held to a spec's shape and are skipped. Every authoring path in `/specship:spec` runs the lint on the spec it just wrote and won't hand off a spec that still has errors.

## `specship check` — the enforcement gate

One command composes every check and exits non-zero only if a **gating** check fails:

```bash
specship check
```

```
Enforcement gate

  ✓ drift            [gating] pass
  ✓ fitness          [advisory] pass
  ✓ maintainability  [advisory] pass
  • behaviour        [advisory] 1 finding(s)
        REQ-AUTH-006: unverified — no passing test links it
  ✓ suppressions     [advisory] pass
```

| Check | Fails when |
|---|---|
| `drift` | Any link is `drifted`, `broken`, or `orphaned`. |
| `behaviour` | A requirement has a broken linked test, or no passing linked test at all. |
| `fitness` | An architecture-fitness rule from `specship.config.json` is violated. |
| `maintainability` | High-precision code-health findings (oversized symbols, god files, cycles). Lower-confidence signals are listed but don't fail it. |
| `suppressions` | The working-tree change introduces a lint/type suppression comment (see below). Present only in a git repository. |
| `mutation` | A requirement's linked implementation file has a mutant kill rate below threshold. **Opt-in** — absent unless configured. |

### Gating is opt-in

With no configuration every check is **advisory**: `specship check` reports findings and exits 0, so adding it never breaks an existing repo. An advisory run that would have failed ends by printing the exact command to turn gating on.

Turn gating on in `specship.config.json` at your project root:

```json
{
  "enforce": {
    "gate": {
      "drift": true,
      "behaviour": true,
      "suppressions": true
    },
    "behaviour": {
      "exclude": ["REQ-LEGACY-001"]
    }
  }
}
```

Or let the CLI write it for you:

```bash
specship check --enable-gate drift behaviour   # persist gating, then run
specship check --strict                        # gate everything, this run only
```

`behaviour.exclude` lists requirement IDs deliberately out of behaviour-gating scope. `--json` emits the full report (and the same exit code) for CI.

### Scope it to your change: `--since <ref>`

```bash
specship check --since origin/main
```

Drift, behaviour, and mutation findings are limited to requirements whose spec file — or any file they link to — changed since `<ref>`. That makes the gate practical as a pre-commit habit instead of a repo-wide audit. Fitness and maintainability stay repo-wide (they're whole-graph analyses), and the output labels which checks were scoped. An invalid ref fails loudly instead of silently checking everything. The suppressions scan uses the same ref as its diff base.

## Catching silenced linters: suppressions

Agents under pressure sometimes silence a rule instead of fixing the code. SpecShip detects suppression comments a change **introduces**:

| Marker | Counted in |
|---|---|
| `eslint-disable` (and `-next-line` / `-line`), `@ts-ignore`, `@ts-expect-error`, `biome-ignore` | JS/TS-family files (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.svelte`, `.vue`, `.astro`, …) |
| `# noqa`, `# type: ignore` | Python files |

It's a ratchet: only **added** lines count (including brand-new untracked files), a line that was merely moved doesn't flag, and pre-existing suppressions are out of scope. A marker only counts in comment position in a file type whose linter honors it — mentions in prose, strings, Markdown, or YAML are ignored.

For CI, `specship suppressions` runs the scan on its own:

```bash
specship suppressions                      # changes since HEAD (incl. untracked)
specship suppressions --since origin/main  # changes since a ref
specship suppressions --json
```

It prints `SUPPRESSION_GATE=clean` (exit 0) or `SUPPRESSION_GATE=failed` with each finding (exit 1). If the scan can't run — not a git repository, for example — it prints `SUPPRESSION_GATE=skipped` with a reason rather than claiming a clean pass. Both bundled implement workflows (`spec-implement` and `spec-implement-mixed`) run this scan and halt when the change silences a rule.

## Mutation score (opt-in)

A linked, passing test proves the test exists — not that it would notice the implementation breaking. The mutation check consumes a mutation-testing report you already produce and flags requirements whose linked implementation files have too many surviving mutants.

SpecShip doesn't run the mutation tool. Point it at a report in the standard mutation-testing JSON schema (StrykerJS emits it natively; other tools can convert):

```json
{
  "enforce": {
    "mutation": {
      "report": "reports/mutation/mutation.json",
      "threshold": 0.8
    },
    "gate": { "mutation": true }
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `report` | `reports/mutation/mutation.json` | Project-relative path of the report. |
| `threshold` | `0.8` | Minimum kill rate (0–1) per linked implementation file. |

Killed and timed-out mutants count as caught; survived and no-coverage mutants count against the score. Findings read like `REQ-AUTH-005: weak test evidence — src/auth.ts mutant kill rate 62% < 80% threshold (31/50 killed)`.

The check exists only when `enforce.mutation` (or `gate.mutation`) is set — without it, `specship check` output is unchanged. A missing or unreadable report is reported as **skipped**, never as passing, and a skipped check never fails the gate.

## Behaviour tests that probe more than one example

`/specship:spec behaviour <SPEC_ID>` authors end-to-end tests from a requirement's acceptance criteria (Playwright where a UI exists, and/or backend tests, following your repo's conventions), links them as evidence, runs them, and records the verdicts. Two lanes make those tests harder to fool.

### Property-based tests for invariant criteria

Each acceptance criterion is classified — deterministically, no model — as an **example** or an **invariant**. Invariant cues include "for all/every/any", "never", "always", "must not", "round-trip", "idempotent", "regardless of", "no matter", and "arbitrary".

- **Invariant** criteria are authored as **property-based tests**: Hypothesis (`@given` + strategies) when the linked implementation is Python, fast-check for TypeScript/JavaScript. The test generates inputs and asserts the property instead of hard-coding one case.
- **Example** criteria stay concrete example tests.

Property tests link to their criterion through the same evidence chain as any other test — no new link kind, no new promotion path.

### Contract fuzzing for route-backed requirements

When a requirement links **directly** to API routes, the behaviour surface marks it fuzz-eligible and emits a Schemathesis command scoped to exactly those routes:

```bash
st run <openapi-schema (path or URL)> --include-path-regex '^(/api/sessions/[^/]+)$' --checks all
```

The command is **always presented for review and never executed automatically** — fill in your OpenAPI schema, run it against staging, and the outcome is recorded on the link. A fuzz run never creates test-evidence links on its own.

You can inspect the surface directly with the `specship_spec` tool (`spec_id` + `behaviour_surface: true`): UI and backend tiers, each criterion's test shape, and the fuzz leg when eligible.

## Putting it in CI

A minimal pipeline that uses all of the above:

```bash
specship lint                                   # spec structure — no index needed
specship suppressions --since origin/main       # no silenced linters
specship index                                  # build the index
npx vitest run --reporter=json --outputFile=report.json
specship verify --report report.json            # promote/demote from the real run
specship check --since origin/main              # the configured gate
```

→ See also: [Test evidence & coverage](/specs/test-evidence/) · [Spec links & drift](/specs/links-and-drift/)
