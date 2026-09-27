# Gap-fill questions catalog

The user gave you a one-line feature description. Your draft fills in the obvious parts. This catalog is what you use to find the **non-obvious** parts you should ask about before writing the file.

## How to use this catalog

1. Read your draft.
2. For each category below, ask: "did the user's description or my draft cover this?"
3. If yes → move on; no question needed.
4. If no → either ask the user, or insert a `[needs user confirmation]` marker in the draft.

**Limit per round: 3–5 questions.** Don't dump the whole catalog on the user. Pick the ones that matter most for this spec; mark the rest as `[needs review]` and proceed.

The one exception is **Project invariants** at the end: always walk that section, because a spec that contradicts a house invariant gets rejected at review no matter how well-formed it is.

## The catalog

### Identity & ownership

| Q | Why it matters | Example phrasing |
|---|---|---|
| Owner team or person? | A spec without an owner drifts and nobody fixes it. | "Who owns this — `security`, `payments`, or someone else?" |
| Priority? | Helps when the drift queue is long. | "Priority — high, medium, low?" |
| Existing parent doc, or new one? | Decides whether to append or create a file. | "Should this go under your existing `AUTH-DOC`, or is this a new feature area?" |

### Trigger & scope

| Q | Why it matters | Example phrasing |
|---|---|---|
| What's the entry point? | An endpoint? A function call? A scheduled job? A webhook? | "Where does this kick off — REST endpoint, internal function, cron, webhook?" |
| Who/what can invoke it? | Authenticated users? System only? Admins? Anonymous? | "Who's allowed to invoke — authenticated only, admins, anonymous?" |
| Synchronous or async? | Affects the acceptance criteria around timing. | "Is the caller blocked waiting for the result, or is this fire-and-forget?" |
| Idempotent? | Critical for retry semantics. | "If the same input is sent twice, do we want the same result, or distinct ones?" |

### Success path

| Q | Why it matters | Example phrasing |
|---|---|---|
| What's the contract observable from outside? | This IS the spec. If you can't answer it, you don't have a spec yet. | "When this succeeds, what's the contract — the response shape, the side effects, the state change?" |
| What's the latency target, if any? | Often skipped, often relevant. | "Is there a latency expectation — sub-100ms, sub-second, eventually-consistent?" |
| Cache or memoize? | Affects idempotency and observability bullets. | "Should successful results be cached? For how long?" |

### Failure modes

| Q | Why it matters | Example phrasing |
|---|---|---|
| What happens on transient failure? | Retry semantics live here. | "If a downstream call fails transiently, do we retry, return an error, or queue?" |
| What happens on permanent failure? | The unhappy path is half the spec. | "If the operation can't succeed (validation fails, dependency dead), what does the caller see?" |
| What's the timeout? | Even "no timeout" is a decision worth stating. | "Is there a hard timeout? After how long?" |
| Partial-success semantics? | For multi-step operations. | "If step 3 of 5 fails, does the work roll back, or do we leave the partial state?" |

### Edge cases & ambiguity

| Q | Why it matters | Example phrasing |
|---|---|---|
| What about empty/null inputs? | Often unspecified, often the source of bugs. | "What happens on empty input — error, no-op, default?" |
| What about boundary values? | Off-by-one and rate-limit thresholds. | "Exactly 5 attempts allowed, or fewer-than-5?" |
| What about repeated identical inputs in a tight loop? | Race conditions. | "Two parallel requests with the same payload — same result, or do they race?" |
| What about very-large inputs? | Resource exhaustion. | "Is there a max payload size?" |

### Persistence & state

| Q | Why it matters | Example phrasing |
|---|---|---|
| Does this produce persisted state? | If yes, the schema is part of the contract. | "Does this write to a database / audit log / event store?" |
| TTL on persisted state? | Storage costs and privacy concerns. | "Do those records expire? After how long?" |
| Is the state queryable? | Determines whether queries are part of the spec. | "Are those records queryable by other services, or internal-only?" |
| Schema migration on existing data? | Hidden complexity. | "Does this affect any existing rows in the system?" |

### Security & access control

| Q | Why it matters | Example phrasing |
|---|---|---|
| AuthZ — who can call it? | Often implicit but should be stated. | "Authorization — what roles or scopes are required?" |
| Sensitive data in inputs/outputs? | Affects logging and storage requirements. | "Does this handle PII / payment data / secrets?" |
| Rate limiting required? | Even if "no", state it. | "Should this endpoint be rate-limited? Per-IP, per-user, per-tenant?" |
| Audit log requirement? | Compliance-relevant. | "Do we need an audit trail for this operation?" |

### Observability

| Q | Why it matters | Example phrasing |
|---|---|---|
| What metric should be emitted? | Counter / timer / gauge. | "What metric do we want — count, latency, error rate?" |
| What log lines? | Specific events to log. | "Any structured log events for this operation?" |
| What alert? | When does this wake somebody up? | "Should an alert fire if this fails repeatedly?" |
| Distributed tracing? | If your system uses it, the span name matters. | "Trace span name — what should it be?" |

### Compatibility & migration

| Q | Why it matters | Example phrasing |
|---|---|---|
| Backwards-compatible with prior version? | If you're changing existing behavior. | "Does this preserve the old behavior for existing callers?" |
| Migration path? | For schema or contract changes. | "How do existing consumers move to the new contract?" |
| Deprecation timeline? | If replacing something. | "Is the old endpoint deprecated? When does it sunset?" |

### Project invariants

Some projects carry invariants that a spec can violate without looking wrong. Walk this section against the **surface the spec touches** — these are questions to answer in the draft, not necessarily questions to put to the user.

In SpecShip itself (and in any project whose `CLAUDE.md` states equivalents), the surfaces are:

| Surface the spec touches | What the spec must account for |
|---|---|
| **MCP tools** (`src/mcp/`) — new tool, changed output, changed budget | Explore budgets are **monotonic**: a change may not shrink what a given budget returns. And `src/mcp/server-instructions.ts` is the **single source of truth** for agent-facing tool guidance — a spec that changes how the agent should use a tool must say that file is updated, not that guidance is duplicated elsewhere. |
| **Installer** (`src/installer/`) — new asset, new target, changed layout | Name **which targets** are affected (Claude Code is the only default target; Gemini CLI is opt-in and MCP-entry-only). Say how **markers** are handled, so install is idempotent and uninstall fully reverses. Require a **CHANGELOG entry** — installer regressions break every new install silently. |
| **Retrieval** — anything that changes how an answer is assembled | The budget is **tool-call count + wall-clock latency**, not tokens. A flow question must still resolve in 1–5 specship calls with zero Read/Grep. An acceptance bullet that lets the answer get slower or need more calls is a regression, however good the output looks. |
| **Extraction** (`src/extraction/`) — new language, new node/edge type | Use the **exact `NodeKind` / `EdgeKind` strings** from `src/types.ts`; inventing a kind silently drops the data. Any new SQL or grammar `.wasm` must be added to **`copy-assets`** or it won't ship in the package. |

Questions worth asking the user when the surface is ambiguous:

- "Does this change what an existing tool returns for the same input?" (→ monotonicity + a CHANGELOG-visible behavior change)
- "Should this ship on a default install, or behind an opt-in flag?" (→ installer tiering)
- "Is this allowed to cost an extra tool call to get a better answer?" (→ the retrieval budget; the answer is usually no)

## Decision framework — which to ask

You can't ask every question. Ranking:

1. **Trigger & scope** — without this, the spec has no boundary. **Always confirm.**
2. **Success path contract** — without this, there's nothing to test. **Always confirm.**
3. **Project invariants** — cheap to check, and a violation invalidates the spec. **Always walk.**
4. **Failure modes** — usually 2/3 of the spec body, often skipped by the user's initial description. **Ask if not covered.**
5. **Owner + priority** — quick to ask, valuable to record. **Ask if not in the description.**
6. **Edge cases** — pick the 1–2 most likely to be wrong; mark the rest `[needs review]`.
7. **Persistence, security, observability, compatibility** — ask only what the feature description suggests is relevant. Don't ask "is there a TTL" for a pure-function spec.

## Example application

User says: *"I want to add a spec for password reset via email."*

You draft a first pass covering: entry endpoint, success response, email content reference, link expiry. The catalog walk gives you:

- Trigger & scope — covered by "via email" (entry point inferred).
- Success path — covered.
- **Failure modes** — what if the email doesn't exist? rate-limited account? mailer down?
- **TTL** — how long is the link valid?
- **Rate limiting** — abuse vector if not rate-limited.
- **Sensitive data** — is the reset link a secret? logged anywhere?
- Observability — `[needs review]` (low priority for this spec).
- Compatibility — `[needs review]` (greenfield, no existing version).
- Owner — user said "auth team" implicitly via the feature name.
- Project invariants — no MCP / installer / retrieval / extraction surface touched; nothing to account for.

Your gap-fill round:

> Before I write the file, four things:
> 1. **Link TTL** — 1 hour? 24 hours? Until first use?
> 2. **Rate limit per email** — how many resets per day per address before we throttle?
> 3. **Non-existent email** — do we return success anyway (to prevent enumeration), or return 404?
> 4. **What's in the email** — link only, or also a code? Are there constraints on the link format (custom domain, length)?

That's 4 questions covering the high-impact gaps. The other catalog categories become `[needs review]` markers in the draft.
