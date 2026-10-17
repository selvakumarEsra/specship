---
title: Spec links & drift
description: The lifecycle of a spec link — how links are created, the implemented → verified path, drift on either axis, broken and orphaned states, and how links survive re-indexing.
---

A **spec link** is the record that connects one spec entity (a requirement or acceptance criterion) to one code symbol. It carries state. When the spec changes, the code changes, a test fails, or the target disappears, the state transitions automatically. The state is what tells you whether a requirement is actually shipped — and stays shipped.

## Four ways a link is created

| Provenance | Source | Confidence |
|---|---|---|
| **agent-asserted** | The agent called `specship_link_assert` after writing code. | 1.0 |
| **code-comment** | An `// @implements REQ-X` or `// @verifies REQ-X` comment on a symbol, or a test title that names a requirement ID. See [The @implements pragma](/specs/implements-pragma/). | 0.9 |
| **spec-declaration** | A `path:Symbol` bullet in the spec's `implementations:` or `verifies:` block. See [Writing specs](/specs/writing-specs/#link-blocks-implementations-and-verifies). | 0.7 |
| **resolver** | A heuristic match. | ≤ 0.5 |

Links are keyed on their **logical target** — spec ID + file path + qualified name — not on line numbers, so ordinary edits don't disturb them. When two sources describe the same link, the higher-confidence one owns the row; an equal-or-higher signal refreshes it.

## Asserting a link

`specship_link_assert` is how the agent says "I built this":

- **The target is validated first.** A `file:symbol` that doesn't resolve in the index is refused, with the nearest real symbols suggested — no phantom links.
- **The code signature is snapshotted** at assertion time, so code-side drift detection works from that moment on.
- **`implements` links are written into the spec file.** The bullet lands in the requirement's `implementations:` block (created if missing, never duplicated). The link is now git-versioned, visible in PR review, and rebuilt from the file on every index. Other kinds (`tests`, `documents`, `validates`, `depends_on`) are stored in the index only — declare test evidence with a `verifies:` block or `@verifies` comment instead.
- **It's idempotent.** Re-asserting refreshes the signature snapshot.

## The states

```
   (assert / declare / pragma)
             │
             ▼
        implemented ──── passing linked test ────▶ verified
          │   ▲                                      │
          │   └──── target reappears ◀── orphaned    │ failing linked test
          │                                ▲         ▼
          │          target symbol gone ───┘       broken
          │
          └── spec body or code signature changed ──▶ drifted
```

| State | Meaning | How you got here |
|---|---|---|
| **implemented** | Code exists and the link resolves to it. | A new link whose target resolves; or an orphaned link whose target came back. |
| **verified** | A passing test linked to the spec as evidence proves it. | `specship verify --report`, `specship_link_verify` with `pass`, or a workflow's verify step — and only when file-derived test evidence exists. |
| **drifted** | The spec body or the target's signature changed since the link was set. | The next sync noticed. `drift_axis` says which side moved. |
| **broken** | Verification ran and failed. | A linked test failed in an ingested report, or `specship_link_verify` recorded `fail`. |
| **orphaned** | The target symbol can't be found at its logical address. | A delete, a rename, or a move out of the file. |

`drafted` and `implementing` exist in the schema but are reserved — links are created directly as `implemented` (or `orphaned` if the declared target doesn't exist yet).

Healthy links spend most of their life in `verified`. The drift queue surfaces everything in `drifted`, `broken`, or `orphaned`.

### Sticky states

`verified` and `broken` are verdicts, so they are **sticky**: a re-index or an unrelated edit to the spec file (say, appending another requirement) never quietly resets them. They only move when something that matters moves — the requirement's own text changes (→ `drifted`), or a new verification runs.

### Orphans re-attach on their own

`orphaned` is deliberately *not* sticky. If the target symbol reappears — a rename is reverted, a file is restored — the next sync re-attaches the link to `implemented` with no re-assertion needed.

## How drift is detected

Drift checks run on every sync — whether triggered by the file watcher, the Claude Code hooks, or `specship sync` / `specship index`. Newly drifted links are announced once, not on every sync.

### Spec-axis drift

For every link, SpecShip compares the requirement's current content hash to `spec_hash_at_link`. If they differ, the spec body changed since the link was set → **drifted** with `drift_axis: spec`.

This catches the case where someone rewrote a requirement and the code wasn't revisited. An unchanged body never trips spec drift, so verified links stay verified across unrelated edits.

### Code-axis drift

For every link whose file changed, SpecShip re-resolves the target symbol and compares its current signature to `node_sig_at_link`. Different → **drifted** with `drift_axis: code`. Not found → **orphaned**.

Lookups tolerate the usual spelling differences: `Class.method` and `Class::method` resolve to the same symbol, and a function that became a method in the same file is still recognized.

## Links survive re-indexing

A full `specship index` or an edit to the spec file keeps every link's state, provenance, and verification history. What can remove a link is deliberate:

- **Removing a requirement** removes its links.
- **Removing a declaration bullet** from `implementations:` / `verifies:` removes exactly the link that bullet declared. Links the agent asserted or a code comment created aren't declared by the file, so they aren't removed this way — if their target goes away they show up as `orphaned` instead.

Because asserted `implements` links are written back into the spec file, even a deleted `.specship/` directory rebuilds them on the next index.

## What "verified" really means

A link reaches `verified` only through a **recorded test verdict**, and only when the spec has **file-derived test evidence** — a `verifies:` bullet, an `@verifies` comment, or a test title naming the requirement, pointing into a real test file. A `tests` link the agent asserted for itself doesn't count, and neither does a "test" that is really a fixture or source file.

Every verification stores its evidence on the link — reason, timestamp, and the test names it rests on — so a `verified` state can be audited later. See [Test evidence & coverage](/specs/test-evidence/).

## The drift queue

In the dashboard (`specship desktop`), the **Drift** page lists every link in a concerning state, with its spec, target, drift axis, provenance, and age. Expanding a row offers:

| Action | Shown for | Effect |
|---|---|---|
| **Fix** | `drifted` | Launches the `spec-fix` workflow for the spec: diagnose → approve → fix → re-verify. |
| **Re-verify** | `broken` | Launches the `spec-verify` workflow. |
| **Re-attach** | `orphaned` | Launches the `spec-relink` workflow: find the moved/renamed symbol → approve → re-assert. |
| **Open spec** | all | Opens the spec on the Specs page. |
| **Show in graph** | all | Focuses the spec in the graph view. |

In Claude Code, `/specship:check drifted` shows the same queue, and `/specship:check fix <SPEC_ID>` / `/specship:check relink <SPEC_ID>` run the repair flows.

On the CLI, `specship drifted` lists the queue (`--state` to filter, `--json` for scripts). Add `--fail-on drifted,broken` to make it a CI gate — or use `specship check`, which folds drift into the broader [enforcement gate](/specs/quality-gates/).

## Link kinds

A link is more than just "spec → code"; it carries a kind:

| Kind | Meaning |
|---|---|
| **implements** | This code is the implementation of this requirement. |
| **tests** | This test proves this requirement — the only kind that counts as evidence. |
| **validates** | This code is a runtime check or contract that enforces the requirement. |
| **documents** | This code is relevant to the requirement (config, schema) but isn't the implementation. |
| **depends_on** | The requirement depends on this symbol (e.g. references its shape). |

A single requirement usually has links of several kinds:

```
REQ-AUTH-005
├── implements  → src/auth.ts:checkExpiry
├── tests       → __tests__/auth.test.ts:rejectsExpiredToken
├── tests       → __tests__/auth.test.ts      (test titles naming REQ-AUTH-005.A3)
└── documents   → src/config.ts:TOKEN_EXP_CLAIM
```

`verified` cares about `tests` links. Drift applies to all of them.

## When to re-link by hand

The agent does most link assertions for you. When a refactor moves code out from under a link:

- **Let the workflow do it** — `/specship:check relink REQ-AUTH-005` (or the Re-attach button) finds the symbol's new home and re-asserts after you approve.
- **Edit the spec** — change the bullet in the `implementations:` block to the new `path:Symbol`; the next sync creates the new link. (A declared link for the old bullet is removed; an agent-asserted one stays `orphaned` until relinked.)
- **Use a comment** — drop `// @implements REQ-AUTH-005` directly above the function; the next sync picks it up.

→ Next: [The `@implements` pragma](/specs/implements-pragma/) — the comment annotation form.
