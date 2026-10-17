---
title: The @implements pragma
description: Comment annotations — @implements and @verifies — that declare spec links from inside the code itself, as a backstop when the agent forgets and a link that travels with the symbol.
---

One way to know that a piece of code implements a spec is to write the link **in the code itself**. SpecShip's `@implements <SPEC-ID>` pragma is a comment that does exactly that.

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

When SpecShip indexes this file, it reads the comment attached to `checkExpiry`, finds `@implements REQ-AUTH-005`, and creates or refreshes a spec link:

- **spec**: `REQ-AUTH-005`
- **target**: `src/auth.ts` → `checkExpiry`
- **kind**: `implements`
- **provenance**: `code-comment`
- **state**: starts at `implemented`; promotes to `verified` once a test **linked as evidence** passes

The pragma is the **backstop** for when the agent forgets to call `specship_link_assert`: the link still gets created from the comment on the next sync. The ID must match a spec that exists in the index — a pragma naming an unknown ID is ignored.

## `@verifies` — the test-side twin

Put `@verifies` on a test function to declare it as **test evidence** for a requirement or criterion. It creates a `tests`-kind link, which is what gates promotion to `verified`:

```typescript
/** @verifies REQ-AUTH-005.A2 */
function rejectsExpiredToken() {
  expect(checkExpiry(expiredToken)).toBe(false);
}

it('rejects an expired token', rejectsExpiredToken);
```

The pragma must sit on a **named symbol** (here, the hoisted function handed to `it()`), and that symbol must live in a recognized test file. An `@verifies` on a fixture or a source-file symbol is recorded but flagged, and never counts as evidence.

If your test titles already name the criterion — `it('rejects an expired token (REQ-AUTH-005.A2)', …)` — you don't need `@verifies` at all: SpecShip links titles that mention a requirement ID automatically. See [Test evidence & coverage](/specs/test-evidence/).

`@implements` and `@verifies` are the only two pragmas. For the softer link kinds (`documents`, `validates`, `depends_on`), have the agent assert the link with `specship_link_assert`.

## Where the comment has to be

The pragma is read from the **comment block directly above a declaration** — a function, method, class, and so on — including exported declarations. Several syntaxes work, because SpecShip matches the `@implements <ID>` text inside the comment:

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
/**
 * @implements REQ-AUTH-005
 */
public boolean checkExpiry(Token token) { ... }
```

What does **not** work: a comment at the top of a file that isn't attached to any declaration, a comment inside a function body, or a pragma in a Python docstring inside the function. Those create no link.

Multiple pragmas on one symbol are allowed — each becomes a separate link:

```typescript
/**
 * @implements REQ-AUTH-005
 * @implements REQ-AUTH-007
 */
export function checkExpiry(token: Token): boolean { ... }
```

In Java, `@implements` inside a Javadoc block is just text to the compiler; keep it in a doc comment rather than a bare line so nobody mistakes it for an annotation.

## Pragma vs. the other ways to link

| Property | `@implements` comment | Spec `implementations:` bullet | `specship_link_assert` |
|---|---|---|---|
| **Survives a full re-index** | Yes — re-read from the code. | Yes — re-read from the spec. | Yes — `implements` assertions are written into the spec's `implementations:` block. |
| **Reviewable in a PR** | Yes — in the code diff. | Yes — in the spec diff. | Yes, via the spec-file write-back (`implements` only). |
| **Moves with the symbol** | Yes — the comment travels with the code. | No — the bullet names a path; a move orphans the link until it's updated. | No — keyed on the asserted path and name. |
| **Validated on creation** | Spec ID must exist. | Target resolved on sync; an unresolvable one rests at `orphaned`. | Target must exist, or the call is refused with suggestions. |
| **Confidence** | 0.9 | 0.7 | 1.0 |

When more than one source describes the **same** link, the higher-confidence source owns it: an agent assertion outranks a pragma, which outranks a spec bullet. Nothing is lost either way — the link is the same link.

In practice: let the agent assert links as it works (they're persisted to the spec file automatically), and add a pragma when you want the link to follow the symbol through refactors, or as a safety net for code the agent didn't assert.

## Refactoring with pragmas

Links are keyed on file path + qualified name. Because the pragma is re-read on every sync:

- **Rename the symbol** — the next sync creates a link under the new name from the pragma. The link recorded under the old name no longer resolves and shows as `orphaned` in the drift queue, where you can relink or dismiss it.
- **Move it to another file** — same thing: the pragma produces a link at the new location.
- **Revert a rename or restore a file** — orphaned links re-attach on their own on the next sync.
- **Delete the symbol** — its links go `orphaned`. Restore it, point the requirement at the replacement (`/specship:check relink <SPEC_ID>`), or accept the orphan.

## Checking pragma links

To see what a pragma produced, ask for the spec — `specship_spec` (or `specship spec REQ-AUTH-005`) lists every linked symbol with its state and provenance — or look up the symbol with `specship_node`, whose output includes a **Linked specs** section.

→ Back to [Why specs](/specs/why-specs/).
