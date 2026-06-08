---
title: The @implements pragma
description: A comment annotation that declares a spec link from inside the code itself — a backstop for when the agent forgets, and a precommit-time guarantee.
---

The most reliable way to know that a piece of code implements a spec is to write the link **in the code itself**. SpecShip's `@implements <SPEC-ID>` pragma is a comment that does exactly that.

```typescript
/**
 * Validate a session token.
 *
 * @implements REQ-AUTH-005
 */
export function checkExpiry(token: Token): boolean {
  const now = Date.now() / 1000;
  return token.exp > now - 30; // 30s clock skew
}
```

When SpecShip parses this file, it picks up the `@implements REQ-AUTH-005` and creates or updates a spec link:

- `spec_id`: `REQ-AUTH-005`
- `target_qualified_name`: `checkExpiry`
- `target_file_path`: `src/auth.ts`
- `kind`: `implements`
- `provenance`: `pragma` (high-trust)
- `state`: starts at `implemented`; promotes to `verified` once tests pass

## Why the pragma is special

Three properties that other link mechanisms don't have:

| Property | Pragma | Agent-asserted | Heuristic |
|---|---|---|---|
| **Survives a clean re-index** | Yes — re-extracted from the file every time. | No — held in SQLite; lost if `.specship/` is deleted. | Yes — re-resolved every sync. |
| **Reviewable in PR** | Yes — diff shows the pragma added/removed. | No — invisible to PR review. | No — the resolver decides. |
| **Refactor-resistant** | Yes — when the function moves, the pragma moves with it. | Often — the link's qualified name is updated by the spec-relink workflow. | Brittle — depends on the resolver's heuristics. |

Use the pragma when **you (or the agent) want a permanent, reviewable, refactor-safe link**. Use the agent-asserted form during exploration when you're not sure yet.

## Supported comment forms

The pragma is parsed out of any comment block above (or attached to) a symbol declaration. Supported syntaxes:

```typescript
// @implements REQ-AUTH-005

/** @implements REQ-AUTH-005 */

/**
 * @implements REQ-AUTH-005
 */
```

```python
# @implements REQ-AUTH-005
def check_expiry(token): ...

"""@implements REQ-AUTH-005"""
```

```rust
// @implements REQ-AUTH-005
fn check_expiry(token: &Token) -> bool { ... }
```

```go
// @implements REQ-AUTH-005
func CheckExpiry(token Token) bool { ... }
```

```java
// @implements REQ-AUTH-005
public boolean checkExpiry(Token token) { ... }
```

Multi-pragma on one symbol is allowed:

```typescript
/**
 * @implements REQ-AUTH-005
 * @implements REQ-AUTH-007
 */
export function checkExpiry(token: Token): boolean { ... }
```

— each becomes a separate link.

## `@tests`, `@documents`, `@validates`

The same comment form supports the other three link kinds:

```typescript
// @tests REQ-AUTH-005
test('rejects expired tokens', () => { ... });

// @documents REQ-AUTH-005
// (file-level — applies to the whole file)
export const TOKEN_EXP_CLAIM = 'exp';

// @validates REQ-AUTH-005
if (token.exp <= now) throw new TokenExpired();
```

This gives you four pragmas, one per link `kind`. Use the right one — `@implements` for the implementation; `@tests` for the test; `@documents` for schema/config; `@validates` for runtime guards.

## Pragma + agent-asserted: who wins?

When both exist for the same `(spec_id, target_qualified_name)` pair, the **pragma wins**. The agent-asserted link is downgraded to a duplicate marker.

This is intentional. The pragma is more trustworthy and more durable. The agent-asserted form exists for the case where the agent built the thing and the human hasn't (yet) added the pragma.

A common pattern in PR review:

> "Looks good. Add `// @implements REQ-AUTH-005` so the link survives a re-index."

→ then the PR ships with both, and the pragma takes over from the agent's assertion.

## Catching missing pragmas in CI

You can require every `verified` spec to have at least one pragma-provenance link, gating PRs that introduce spec links without comments:

```bash
specship spec audit --require-pragma-on=implements
# fails if any `implements` link is provenance != "pragma"
```

Add it to your CI pipeline as a soft check (warn) or a hard gate (fail). Most teams start with warn.

## Editor support

The Claude Code extension highlights pragmas and shows the linked spec body in a hover card. VS Code without the extension still treats them as plain comments — they're harmless.

If you're using `// @implements` in a language where `@` has another meaning (Java annotations), keep it inside a doc comment to avoid confusion:

```java
/**
 * @implements REQ-AUTH-005
 * (this is a SpecShip pragma, not a Java annotation)
 */
public boolean checkExpiry(Token t) { ... }
```

## Refactoring with pragmas

The pragma travels with the symbol on a rename. If you rename `checkExpiry` to `validateExpiry`, the pragma stays attached, the qualified name changes, and SpecShip updates the link's `target_qualified_name` automatically on the next sync.

If you move the symbol to a different file, same thing — the file path updates.

If you delete the symbol entirely, the link goes `orphaned`. Either restore it, point the link at the replacement (via `specship spec link-assert` or the `spec-relink` workflow), or accept the orphan.

→ Back to [Why specs](/specship/specs/why-specs/).
