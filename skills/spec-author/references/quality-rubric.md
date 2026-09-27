# Quality rubric

The spec parser is forgiving — it'll accept anything with the right markers. This rubric is what separates a spec that ships from a spec that wastes everyone's time. Apply it before writing the file.

## Seven properties of a good spec

### 1. Specifies the contract, not the implementation

A spec says **what**. Code says **how**. The split is load-bearing because:

- Implementation details belong to the team that owns the code, not the spec author. Forcing them through a spec process is friction.
- Specs that mirror implementation become brittle. Every refactor flags drift; the gate goes noisy; people stop trusting it.
- Implementation can evolve; the contract is what users depend on.

| ❌ Implementation-leak | ✅ Contract |
|---|---|
| MUST use bcrypt with cost factor 12 | Stored passwords MUST resist offline cracking with current GPU hardware |
| MUST be a JWT signed with RS256 and 24 h TTL | Session tokens MUST be cryptographically tamper-evident and expire within 24 h |
| MUST store events in PostgreSQL | Events MUST persist beyond process restart and remain queryable for ≥30 days |
| MUST use Redis for the counter | The rate-limit counter MUST survive a single-instance restart |
| MUST be at `POST /api/login` | MUST be addressable as a single POST endpoint at the auth-service boundary |

Test for implementation-leak: "Could I swap the implementation library tomorrow and still satisfy this?" If no, it's too prescriptive.

### 2. Testable acceptance criteria

Every acceptance bullet is something a test can verify mechanically. Vague verbs ("handles", "supports", "manages") are not testable.

| ❌ Untestable | ✅ Testable |
|---|---|
| Handles failed payments gracefully | A failed-payment webhook produces exactly one row in `billing_events` with `kind: 'retry_attempt'` |
| Validates user input | Email addresses without `@` return 400 with `code: invalid_email` |
| Supports concurrent requests | 100 concurrent requests to the same endpoint complete with no shared-state contamination (measured: distinct response IDs) |
| Logs everything | Every state transition appends a line to `audit.log` with `(timestamp, actor, before, after)` |

If you can't sketch how a test would assert against the bullet, rewrite it until you can. This matters twice over in SpecShip: the bullet is what a `verifies:` link's test has to actually assert, and an untestable bullet can never reach `verified`.

### 3. One concern per REQ

REQs are the unit of drift detection. When the implementation moves and a REQ's link goes `drifted`, you want to know exactly what to re-verify. A REQ that mixes concerns ("logs, validates, AND notifies on failure") means a small change to any one part flags the whole REQ — noise.

| ❌ Mixed concerns | ✅ Split |
|---|---|
| REQ-AUTH-001: Login MUST be rate-limited AND audit-logged | REQ-AUTH-001: Login MUST be rate-limited. + REQ-AUTH-002: Auth failures MUST be audit-logged. |

Test: read the REQ title. If you have to use "and" or "also", split.

### 4. RFC 2119 keyword used correctly

| Keyword | Use when |
|---|---|
| **MUST** / **MUST NOT** | Non-negotiable. Failing this is a bug or compliance breach. |
| **SHOULD** / **SHOULD NOT** | Strongly recommended. Deviation requires written justification. |
| **MAY** | Optional. Pure permission grant. No compliance impact either way. |

Common mistakes:

- **"MUST" inflation** — using MUST for everything dilutes the signal. Reserve it for things you genuinely won't ship without.
- **"SHOULD" hedging** — using SHOULD because you're nervous about MUST. Either it's required or it isn't; pick.
- **Weasel words mixed in** — "MUST ideally", "SHOULD probably", "ought to". Strike the modifiers.

### 5. Parent/child structure that mirrors the conceptual hierarchy

Document → requirements → acceptance bullets. Use heading depth to express this; don't flatten everything to H2.

| ❌ Flat | ✅ Structured |
|---|---|
| `## REQ-AUTH-001: Failed logins rate-limited` <br>`## REQ-AUTH-002: Rate limit returns 429` <br>`## REQ-AUTH-003: Rate limit has Retry-After header` <br>`## REQ-AUTH-004: Counter resets on success` | `# Authentication` <br>`## REQ-AUTH-001 Failed logins MUST be rate-limited` <br>`### Acceptance`<br>`- A1: returns 429` <br>`- A2: includes Retry-After` <br>`- A3: counter resets on success` |

The flat version makes drift detection useless (no concept of "this REQ has 4 acceptance criteria"); the structured version means changing the threshold is one drift event, not four.

### 6. Owner and priority set

Every spec needs:
- **Owner** — who decides on contract changes. A team, a person, or a role. "Engineering" is too broad.
- **Priority** — `high` / `medium` / `low` is fine. Helps when the drift queue is long.

These belong in the frontmatter:

```yaml
---
id: AUTH-DOC
owner: security-team
priority: high
---
```

A spec without an owner is a spec without a stakeholder. It'll drift and nobody will fix it.

### 7. Grounded in code that exists

If `mcp__specship__specship_explore` is available and the feature touches existing code, the draft references real symbols. Don't write:

```markdown
implementations:
  - src/auth.ts:login
```

…if the actual code is at `src/services/auth-service.ts:AuthService.handleLogin`. The wrong path becomes a permanent orphan link, polluting the drift queue.

For greenfield work (no existing code yet), leave `implementations:` empty and omit `verifies:` entirely. The agent fills them in via `specship_link_assert` once the code and tests land.

## Anti-patterns

These are spec-author mistakes that produce specs the team will ignore.

- **Specs that read like product requirements.** "User clicks the login button and sees a friendly error message." Specs are contracts, not UX storyboards. Strip the narrative.
- **Specs that re-state the obvious.** "MUST not crash" applies to all code; it's not a spec, it's an axiom. Same for "MUST be secure" — too broad to test.
- **Specs that future-proof aggressively.** "MUST support OAuth, SAML, OIDC, magic link, and passkeys." If you only need email + password today, spec that. Extend the spec when the second method actually lands.
- **Specs written as TODO lists.** "MUST add a rate limiter, MUST write tests, MUST update docs." That's a task list, not a spec. The spec describes the contract after the work is done.
- **Specs that quote regulations verbatim.** Cite the regulation in the body, paraphrase the operational requirement in the acceptance bullets. Verbatim regulatory text is uninterpretable for testing.

## Sanity check before review

Answer these for your draft:

1. Could a teammate implement this in two different reasonable ways and both satisfy the spec? (If no, you've over-specified — implementation leak.)
2. Could a teammate read the acceptance criteria and write the tests without asking you what you meant? (If no, the criteria are vague.)
3. If a future refactor moves the linked symbol, does the spec still apply unchanged? (If no, the spec depends on implementation, not contract.)
4. Does each REQ title have one concern? (If you used "and", split.)
5. Is there at least one MUST and the right number of SHOULDs? (No MUSTs = the spec isn't required. All MUSTs = MUST is meaningless.)
6. Owner and priority in frontmatter? (If not, add.)
7. Do the `implementations:` paths exist (per `specship_explore` / `specship_node`)? (If unverified, mark `[needs review]`.)

Seven yeses → proceed to gap-fill.
