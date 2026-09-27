# Review checklist

After gap-fill, run this checklist against the draft before writing the file. It's also the rubric `/specship:spec review` uses for review-only mode.

Output findings as a numbered list keyed to specific lines in the draft. Don't be polite — if something is broken, say so. The user will appreciate a sharp review more than a soft one.

## Structural checks (must pass before writing)

These produce HARD findings — block writing the file until fixed.

### S1. Every heading has an embedded ID immediately above it

Mental scan: for each heading, was the previous non-blank line `<!-- id: ... -->`?

Failure: spec won't parse. `specship sync` will reject with `spec_missing_id`.

Finding format: *"Line N: heading `## Foo` has no `<!-- id: -->` marker on line N-1."*

### S2. No stranded IDs (two ID comments in a row)

Mental scan: for each `<!-- id: ... -->`, is the next non-blank line a heading?

Failure: parser emits `spec_stranded_id` warning. The first ID is silently lost.

Finding format: *"Line N: `<!-- id: REQ-X -->` is followed by another `<!-- id: -->` on line N+1, not a heading. The first ID will be discarded."*

### S3. IDs are unique within the file

Two markers with the same ID do not error. Specs are stored with `INSERT OR REPLACE`, so the **LAST occurrence overwrites earlier ones** — the earlier heading's title, body, and links are silently gone, and nothing warns. This makes duplicates worse than they look: the REQ the reader sees first is not the REQ in the graph.

Finding format: *"Lines N and M both declare `<!-- id: REQ-AUTH-001 -->`. The occurrence at line M overwrites the one at line N — the earlier requirement's body and links are lost. Renumber one of them."*

### S4. Frontmatter is well-formed

Open `---`, close `---`, valid YAML between. Parser emits `spec_bad_frontmatter` warning on malformed but tolerates it (the document just won't have a doc-level ID).

Finding format: *"Frontmatter on lines N–M is missing the closing `---`."* / *"Frontmatter key `<key>` is not parseable as YAML."*

### S5. `implementations:` / `verifies:` block syntax matches the parser

Pattern: `[-*]\s+([^\s:]+)\s*:\s*([A-Za-z0-9_$.]+)`. Common breakages:
- Missing the leading `-` or `*`.
- Path contains spaces.
- Qualified symbol has parentheses or generics — keep it to identifier chars and dots.
- A bare path with no `:symbol` — tolerated, but creates **no edge** and emits `spec_bare_path_ref`. Only acceptable when there genuinely is no code symbol (e.g. a slash-command markdown file).

Finding format: *"Line N: implementations entry `…` doesn't match the parser pattern. The link won't be extracted."*

## Quality checks (block writing on critical, warn on minor)

### Q1. RFC 2119 keyword used (CRITICAL if missing)

Each requirement (H2-level node) should have at least one **MUST / SHOULD / MAY** in the title or body. Drafts without an RFC 2119 word read as wishful thinking, not as contracts.

Finding format: *"REQ-X has no MUST/SHOULD/MAY in title or body. Recommend MUST since this looks like a hard requirement."*

### Q2. Weasel words flagged

Strike on sight: *should probably*, *ought to*, *could*, *might*, *generally*, *normally*, *ideally*, *in most cases*, *handles*, *supports*, *manages*, *implements* (when used vaguely as in "MUST implement authentication").

Finding format: *"Line N uses `…ought to…`. RFC 2119 doesn't have a SHOULD-ish equivalent; pick MUST, SHOULD, or MAY."*

### Q3. Implementation leak (CRITICAL)

Strike on sight: specific library names, algorithm names, language versions, database systems, cache keys, internal class names. Specs describe the contract, not the choice.

| Leak signal | Why |
|---|---|
| `MUST use bcrypt` | Names an algorithm. |
| `MUST be stored in Redis` | Names a system. |
| `MUST inherit from BaseAuthService` | Names an internal class. |
| `MUST return JSON: { "ok": true, ... }` | Specifies the wire format precisely — only OK if the wire format IS the contract (public API). |
| `MUST use the existing rate-limiter` | Hedges; names an implementation choice without saying what behavior is required. |

Finding format: *"REQ-X line N specifies the implementation library `…`. Rewrite as the contract: `…cryptographically tamper-evident with a 24 h TTL…`."*

### Q4. Acceptance bullets are individually testable

Each `## Acceptance` bullet must be checkable by a single test assertion. If a bullet requires reading three other docs to know what to test, it's vague.

Finding format: *"REQ-X.A2 (`bullet text`) is not directly testable. Suggest splitting into Aa: `…` and Ab: `…`, each with a concrete assertion."*

### Q5. Title has one concern

Use "and"/"or" as a tripwire. Two concerns = two REQs.

Finding format: *"REQ-X title `Login MUST be rate-limited AND audit-logged` mixes two concerns. Split into REQ-X (rate-limit) and REQ-Y (audit-log)."*

### Q6. Acceptance bullets cover the failure path

Most drafts cover the happy path. Failure paths are half the spec.

Quick heuristic: count happy-path bullets vs failure-path bullets. If failure-path < 1, that's almost certainly a gap.

Finding format: *"REQ-X has 3 happy-path bullets (A1, A2, A3) but no failure-path bullets. What happens on: (a) invalid input, (b) downstream dependency failure, (c) timeout?"*

### Q7. `implementations:` block points at code that exists (when applicable)

When `mcp__specship__specship_explore` or `mcp__specship__specship_node` is available, verify each `implementations:` entry resolves. Skip for greenfield specs (where the code doesn't exist yet).

Finding format: *"REQ-X line N points at `src/auth/login.ts:authenticate`. `specship_node` returns no symbol at that path. Either the path is wrong (suggestion: `src/services/auth-service.ts:AuthService.handleLogin`) or this is a greenfield spec (then leave `implementations:` empty)."*

### Q8. `verifies:` block points at real test symbols (when present)

`verifies:` is the test-evidence declaration that gates promotion to `verified`, so a wrong entry means the REQ can never reach that state. Check that each bullet names an addressable symbol — a bare `describe(...)` / `it(...)` string is not one.

Finding format: *"REQ-X line N's `verifies:` bullet points at a test-case description, not a symbol. Either name a test helper function, or drop the block until the tests exist."*

### Q9. No project invariant is contradicted

Re-read the **Project invariants** section of `references/gap-questions.md` against the surface this spec touches (MCP tools, installer, retrieval, extraction). A spec that quietly shrinks an explore budget, adds an agent target, trades latency for output quality, or invents a NodeKind is broken regardless of how clean the markdown is.

Finding format: *"REQ-X.A2 allows the explore answer to take two extra tool calls. The retrieval budget is a tool-call count, not a token count — restate the bullet so the call count doesn't grow, or say explicitly why this surface is exempt."*

## Hygiene checks (warn, don't block)

### H1. Frontmatter owner + priority set

Not strictly required, but recommended. `[needs review]` markers are fine for a first draft.

Finding format: *"Frontmatter is missing `owner:` and `priority:`. Consider adding even if you mark them `[needs review]`."*

### H2. No stale `[needs review]` markers

If gap-fill ran and the user answered, the markers should be replaced with their answers. Markers that survive review are still legitimate (the user genuinely doesn't know yet) but flag them anyway.

Finding format: *"Lines N, M, P still carry `[needs review]` markers. List them so the user can address before commit."*

### H3. No TODO / FIXME / WIP in the body

These are work-in-progress signals that shouldn't ship in a spec.

Finding format: *"Line N contains `TODO`. Specs are contracts; address before committing."*

### H4. Body is concise

Spec bodies that read like essays usually contain narrative justification that belongs in the commit message, not the spec.

Finding format (subjective): *"REQ-X body is ~N words. Consider trimming the rationale — keep the spec to the contract; put motivation in the commit message."*

## Sample review output

For the password-reset draft from the gap-questions example:

```
Quality review of specs/password-reset.md:

STRUCTURAL — all pass

QUALITY:
1. Line 12 — REQ-AUTH-005 title uses "should ideally". Drop "ideally";
   either MUST or SHOULD.
2. Line 18 — body specifies `JWT signed with HS256`. Implementation leak.
   Rewrite as contract: "the reset token MUST be unguessable and
   single-use".
3. Line 24 — REQ-AUTH-005.A2 ("Handles expired links gracefully") is
   not testable. Split: A2 = "An expired link returns 410 Gone";
   A2b = "An expired link logs an audit event with reason
   'reset_link_expired'".
4. Line 31 — `implementations:` points at `src/auth/reset.ts:reset` but
   `specship_node` returns no symbol there. This is a greenfield spec —
   leave `implementations:` empty; the agent fills it in via
   `link_assert` after implementation lands.

HYGIENE:
5. Frontmatter has owner but no priority. Suggest `priority: medium`.
6. Line 8 has a stale `[needs review]` marker on the link-TTL question
   you answered during gap-fill — replace with the agreed value (1 hour).

Net: 4 quality issues, 2 hygiene. Recommend addressing items 2 + 3
before writing the file. Items 1, 4, 5, 6 can be addressed in this draft
or as a follow-up commit.
```

The review names line numbers, says what's wrong, suggests a fix. Don't waffle; users want sharp signal.
