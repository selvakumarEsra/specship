---
id: EXPLORE-PIN-DOC
title: Explore must return what the agent named
owner: retrieval
priority: high
---

<!-- id: EXPLORE-PIN-DOC -->
# Explore must return what the agent named

`specship_explore` ranks files by graph connectivity and text relevance, then
fills an output budget from the top. Naming a symbol biases that ranking
(`namedSeedIds`, +50 score, first sort key) but does not guarantee the named
thing is returned — and two filters in the named-seed path drop common token
forms before the bias can apply at all:

- **Hyphenated tokens are discarded.** Query tokens are stripped of their file
  extension and then matched against `^[A-Za-z_$][\w$]*(?:(?:::|\.)[\w$]+)*$`.
  `\w` excludes `-`, so `server-instructions.ts` → `server-instructions` →
  fails the filter → never becomes a seed. Kebab-case is the dominant filename
  convention in this codebase and most TypeScript projects, so the most natural
  way to name a file is the one that silently does nothing.
- **Only callable kinds seed.** Survivors are filtered by
  `CALLABLE = {method, function, component, constructor}`. A named `constant`,
  `interface`, `type_alias`, `class`, or `enum` is never seeded — naming
  `SPECSHIP_STEER_HOOKS` has no effect on ranking.

Observed 2026-08-16: two consecutive explore calls that named
`server-instructions.ts` and `SPECSHIP_STEER_HOOKS` explicitly returned neither,
returned an unrelated file in full twice, and sent the agent to `Grep`. This is
the mechanism CLAUDE.md names as the thing to protect against — the agent falls
back to Read/Grep the instant an answer is insufficient — and it compounds:
a miss on an exact-name query teaches the model that explore is unreliable for
targeted lookups, so the next borderline question skips the tool pre-emptively.
Compliance decays from retrieval misses, not only from weak instructions.

<!-- id: REQ-EXPLORE-PIN-001 -->
## A file the agent names by path MUST appear in the output

When a query token resolves to a file that exists in the index — by full
project-relative path, by basename with extension, or by basename alone when
unambiguous — that file's source MUST appear in the response's source sections.
Presence is not subject to the connectivity gate, the relevance sort, or the
low-value/generated-file deprioritization: the agent asking for a file by name
is a stronger signal than any of them.

Pinned files take first claim on the output budget, capped at 4 per call so a
name-heavy query cannot consume the whole response; ranked files split the
remainder. When a pinned file does not fit its allocation, it is sectioned down
to the symbols matching the query rather than dropped — presence is guaranteed,
completeness is not. The overall output budget is unchanged, preserving the
monotonic-budget invariant.

implementations:
  - src/mcp/tools.ts:resolveNamedFilePaths

## Acceptance
<!-- id: REQ-EXPLORE-PIN-001.A1 -->
- A query naming an indexed file by project-relative path returns that file in
  a source section, including when the file has zero graph connectivity to
  every other matched symbol.
<!-- id: REQ-EXPLORE-PIN-001.A2 -->
- A query naming an indexed file whose path matches a low-value or generated
  pattern still returns that file, bypassing the test/generated exclusions.
<!-- id: REQ-EXPLORE-PIN-001.A3 -->
- A query naming 6 indexed files returns at least 4 of them; the response
  states which named files were omitted for budget.
<!-- id: REQ-EXPLORE-PIN-001.A4 -->
- Total response size for a query naming 4 large files stays within the
  project's resolved output budget — pinning displaces ranked files rather
  than raising the cap.
<!-- id: REQ-EXPLORE-PIN-001.A5 -->
- A query naming a path that is not in the index returns normally and states
  that the named path was not found, rather than failing silently.

<!-- id: REQ-EXPLORE-PIN-002 -->
## Token extraction MUST accept the character forms real filenames use

The named-token filter MUST admit the separators that appear in identifiers and
filenames across the supported languages — at minimum hyphen (`-`) for
kebab-case paths, in addition to the currently-accepted `_`, `$`, `.`, `::`,
and `/`. Stripping a token's file extension MUST NOT be a precondition for
matching it against a file path, since the extension is the strongest signal
that a token names a file rather than a symbol.

implementations:
  - src/mcp/tools.ts:extractNamedTokens

## Acceptance
<!-- id: REQ-EXPLORE-PIN-002.A1 -->
- The token `server-instructions.ts` resolves to `src/mcp/server-instructions.ts`
  and seeds that file.
<!-- id: REQ-EXPLORE-PIN-002.A2 -->
- The token `git-hooks` resolves to `src/sync/git-hooks.ts` when that basename
  is unambiguous in the index.
<!-- id: REQ-EXPLORE-PIN-002.A3 -->
- Admitting hyphens does not cause prose words in a natural-language query
  (e.g. "point-of-use", "well-known") to seed unrelated files: a token seeds
  only when it matches an indexed path or symbol name.

<!-- id: REQ-EXPLORE-PIN-003 -->
## Named-symbol seeding MUST NOT be restricted to callable kinds

A symbol the agent names by exact name seeds the subgraph regardless of its
NodeKind. Constants, interfaces, type aliases, classes, enums, and structs are
as likely to be the subject of a question as functions are — a configuration
constant is frequently the precise thing being asked about. The callable filter
exists to keep overload floods bounded; that concern is already handled by the
overload-disambiguation cap (`cands.length <= 3`, type-token biasing), which
applies independently of kind.

implementations:
  - src/mcp/tools.ts:SEEDABLE_KINDS

## Acceptance
<!-- id: REQ-EXPLORE-PIN-003.A1 -->
- A query naming an indexed `constant` returns the source containing its
  declaration.
<!-- id: REQ-EXPLORE-PIN-003.A2 -->
- A query naming an indexed `interface` or `type_alias` returns its
  declaration.
<!-- id: REQ-EXPLORE-PIN-003.A3 -->
- Naming a symbol with more than 3 definitions across kinds stays bounded by
  the existing overload cap — the response does not grow with the number of
  same-named non-callable definitions.

<!-- id: REQ-EXPLORE-PIN-004 -->
## Exact-name recall MUST be measured, not assumed

Named-token recall is a retrieval-quality property with no current test
coverage and no benchmark, which is why this defect survived. A fixture-based
check MUST assert exact-name recall for the token forms in REQ-EXPLORE-PIN-002
and the kinds in REQ-EXPLORE-PIN-003, and the agent-eval harness MUST report
exact-name recall as a tracked metric so a future ranking change cannot
silently regress it.

implementations:
  - __tests__/explore-named-tokens.test.ts
  - scripts/agent-eval/probe-recall.mjs

## Acceptance
<!-- id: REQ-EXPLORE-PIN-004.A1 -->
- A test suite asserts that for each of a fixture set of named tokens covering
  kebab-case paths, extension-bearing paths, bare basenames, and non-callable
  kinds, the named target appears in the explore output.
<!-- id: REQ-EXPLORE-PIN-004.A2 -->
- The agent-eval harness reports an exact-name recall figure per run, and a
  drop in that figure fails the A/B pass bar.
