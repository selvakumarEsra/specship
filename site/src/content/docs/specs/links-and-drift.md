---
title: Spec links & drift
description: The full lifecycle of a spec link — drafted → implementing → implemented → verified, with drift, broken, and orphaned states.
---

A **spec link** is the record that connects one spec to one code symbol. It carries state. When the spec changes, the code changes, or the link breaks, the state transitions automatically. The state is what tells you whether a requirement is actually shipped — and stays shipped.

## The state machine

```
                  ┌──────────────────────────┐
                  ▼                          │
   drafted → implementing → implemented → verified
                                  │             │
                                  └──→ drifted ←┘
                                  ▲     │
                                  │     ▼
                                broken (target missing)
                                  │     │
                                  └──→ orphaned (target gone for good)
```

| State | Meaning | How you got here |
|---|---|---|
| **drafted** | Spec exists; link is declared; code may or may not exist yet. | Author wrote `@link src/foo.ts:bar` in the spec, but `bar` isn't built yet. |
| **implementing** | An agent has started implementing this spec. | A workflow's `agent` step started editing the linked target. |
| **implemented** | Code exists and matches the spec's content hash. | `specship_link_assert` succeeded; target signature matches. |
| **verified** | Tests linked to this spec all pass. | A `spec-verify` (or any `tests` link runner) passed and promoted. |
| **drifted** | Either spec body or target signature changed since the link was set. | Drift detector caught it on the next sync. |
| **broken** | Target file exists but the symbol's signature no longer matches what was linked. | A rename, an arg-list change, a return-type flip — anything that breaks the "same function" hypothesis. |
| **orphaned** | Target file or symbol is gone entirely. | A delete, a rename to elsewhere, a move out of the file. |

Healthy links spend most of their life in `verified`. The drift queue surfaces everything that isn't.

## How drift is detected

When SpecShip syncs (after a file watcher event, on a manual `specship sync`, or at the start of a `specship serve --mcp` session), it does two passes:

### Spec-axis drift

For every link, recompute `hash(spec.body)`. Compare to `spec_hash_at_link`. If different → the spec body has changed since the link was set → mark the link **drifted** with `drift_axis: spec`.

This catches the case where a PM rewrote a requirement and forgot to update the code. The link tells you to re-check.

### Code-axis drift

For every link, look up the target symbol in the graph and compute its current signature (name + parameters + return type, or for a method: name + parameters + parent class). Compare to `node_sig_at_link`. If different → mark **drifted** with `drift_axis: code`. If the symbol isn't found at all → mark **broken** (file exists but symbol gone) or **orphaned** (file gone).

This catches refactors that move code but forget to re-link.

## What "verified" really means

A `verified` link is one with **both** of these properties:

1. **Spec hash and code signature both match snapshots.** (Promotes `drifted`/`broken`/`orphaned` back to `implemented` first.)
2. **At least one test linked to this spec passed in a recent run.** (Promotes `implemented` → `verified`.)

Both conditions are checked by `specship_link_verify` and by the `spec-verify` workflow. The result is durable until something drifts.

## The drift queue

In the desktop UI, `Drift queue` filters every link in a concerning state with controls per row:

| Action | Effect |
|---|---|
| **Re-verify** | Re-runs the linked tests. If they pass and signatures match, promotes back to `verified`. |
| **Re-attach** | Searches the graph for a likely new target (rename / move / split). Promotes the link to point at the new target. Used for `broken` and `orphaned`. |
| **Open in editor** | Reveals the linked code in your default editor. |
| **Open spec** | Reveals the spec source for editing. |
| **Fix** | Kicks off the `spec-fix` workflow with this link pre-loaded. |

CLI equivalent: `specship drifted`. The flag `--fail-on=drifted,broken` makes it a CI gate.

## Provenance

Every link records *how* it was created. Three sources:

| Provenance | Source | Trust |
|---|---|---|
| **pragma** | A `// @implements REQ-AUTH-005` comment in the code itself, parsed at index time. | High — the author wrote it. |
| **agent-asserted** | An agent called `specship_link_assert` after writing code. | Medium — agent claims it implemented the spec. |
| **heuristic** | The resolver matched a target's qualified name to a `@link` declaration in the spec. | Lower — text-match guess. |

The desktop UI shows provenance as a small chip on each link row. When something looks fishy, the chip tells you whether to trust it.

## Link kinds

A link is more than just "spec → code"; it carries a kind:

| Kind | Meaning |
|---|---|
| **implements** | This code is the implementation of this requirement. |
| **tests** | This code (a test) validates this requirement. |
| **documents** | This code is relevant to the requirement (e.g. config, schema) but isn't the implementation. |
| **validates** | This code is a runtime check (an assertion, a guard) that enforces the requirement. |

A single spec usually has multiple links of different kinds:

```
REQ-AUTH-005
├── implements  → src/auth.ts:checkExpiry
├── tests       → test/auth.test.ts:expiredTokenReturnsToken_expired
├── tests       → test/auth.test.ts:clockSkewToleranceIs30s
└── documents   → docs/auth-tokens.md
```

The `verified` state cares about `tests` links. The `drifted` state cares about all of them.

## When to re-link by hand

The agent does most link assertions for you. But there are cases where you reach for the CLI:

```bash
# I refactored checkExpiry into a class method. Re-attach the existing link.
specship spec link-assert \
  --spec-id REQ-AUTH-005 \
  --target-file src/auth/SessionValidator.ts \
  --target-qualified-name SessionValidator.checkExpiry \
  --kind implements
```

The pragma + comment approach is friendlier for "this is the spec source of truth": just drop a `// @implements REQ-AUTH-005` above the function and the next sync picks it up.

→ Next: [The `@implements` pragma](/specs/implements-pragma/) — the comment annotation form.
