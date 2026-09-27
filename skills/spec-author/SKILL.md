---
name: spec-author
description: Author SpecShip-compatible specs from a feature description — draft the markdown, walk a gap-filling checklist, run a quality review, and write the file under `specs/`. Use this whenever the user wants to write a new requirement, draft a spec for a feature they're about to build, capture acceptance criteria, define a contract, or asks "what should the spec for X look like." Also trigger on phrases like "write a spec", "draft a requirement", "create a REQ", "new spec for", "I want to add a feature and capture the requirements", "spec out", "let's write the requirements for". The skill produces a spec that `specship sync` parses cleanly, grounded in the project's existing code via `mcp__specship__specship_explore`. Do NOT use this skill for reverse-engineering existing code into specs, or for implementing an already-written spec (use `/specship:spec implement` for that).
---

# Spec Author

You're helping the user write a SpecShip-compatible Markdown spec from scratch. Your job is to produce a draft that (a) parses cleanly under `specship sync`, (b) follows the project's quality rubric, and (c) is grounded in the project's actual code so the resulting implementation has a real target.

The user usually starts with a one-line feature description. You're going to turn that into a complete spec, asking only the questions the description doesn't already answer.

## What this skill does NOT do

- **It does not invent business motivation.** If the user doesn't tell you why a feature is needed, don't make it up. Mark the purpose as `[needs user confirmation]` instead.
- **It does not implement code.** Spec only. Implementation is `/specship:spec implement`'s job.
- **It does not promise a perfect spec.** Specs are negotiable; the skill produces a first draft that the user reviews. Every uncertain section carries a `[needs review]` flag so the user knows where to focus.
- **It does not bulk-author.** One requirement, or one document with N children, per invocation. "Spec the whole app" gets refused.

## The format your output must follow

Read `references/format.md` before writing the file. The spec parser at `src/extraction/specs/markdown-spec-extractor.ts` is strict about one thing: **every heading must have an `<!-- id: REQ-X -->` comment immediately above it**. Get this wrong and `specship sync` errors out.

Short version:

```markdown
---
id: AUTH-DOC
title: Authentication
owner: security
priority: high
---

<!-- id: AUTH-DOC -->
# Authentication

This document covers login, session management, and rate-limiting.

<!-- id: REQ-AUTH-001 -->
## Failed logins MUST be rate-limited

The login endpoint rejects more than 5 failed attempts per IP per minute.

implementations:
  - src/auth/login.ts:authenticate
  - src/auth/rate-limit.ts:enforce

verifies:
  - __tests__/auth-rate-limit.test.ts:rejectsSixthAttempt

## Acceptance
<!-- id: REQ-AUTH-001.A1 -->
- A 6th failed attempt within 60 s from the same IP returns 429 with `Retry-After`.
<!-- id: REQ-AUTH-001.A2 -->
- A successful login resets the counter for that IP.
```

`references/format.md` covers the edge cases: optional frontmatter fields, the `implementations:` and `verifies:` block syntax, hierarchy by heading depth, kind inference (document / requirement / acceptance), `.A1`-style child IDs for acceptance bullets.

## The loop

### Step 1 — Scope check

Confirm the user wants:
- **One requirement** under an existing document (most common — pick this if unsure), or
- **A new document with N child requirements** (when they're spec'ing a whole feature area), or
- **Refine an existing draft** (they paste markdown; you review and gap-fill).

If they say "spec the whole app", refuse and ask them to pick a feature area. Bulk-authored specs without per-REQ thinking are unreviewable.

### Step 2 — Ground in the code

If `mcp__specship__specship_explore` is available, call it on terms from the feature description before drafting. Two things this gives you:

- **Realistic file paths and symbol names** for the `implementations:` block. Don't write `implementations: - src/auth.ts:login` if the project has `src/services/auth-service.ts:AuthService.handleLogin`.
- **Existing conventions to align with.** If the codebase already has rate-limiting, your draft should reference the existing rate limiter rather than inventing a new one.

Skip this step only if (a) you don't have specship tools available, or (b) the feature is greenfield (no existing code to ground in).

### Step 3 — Draft the spec

Produce the full markdown body. Cover:

- **Frontmatter** (optional but recommended) — `id`, `title`, `owner`, `priority`.
- **Document body or single requirement** — depending on scope. Use RFC 2119 keywords (MUST / SHOULD / MAY) in the requirement title.
- **Acceptance criteria** — under a `## Acceptance` heading, one bullet per testable condition, each with its own `.A<N>` ID. Each bullet must be independently checkable — "MUST reject more than 5 attempts" not "MUST rate-limit".
- **`implementations:` block** — when you have grounding from Step 2, list the file paths + symbol names the implementation will live in. Speculative; the spec writer can adjust before implementation runs.
- **`verifies:` block** — the test-evidence declaration. Leave it out of a fresh spec unless the tests already exist; it's what promotes a link to `verified`.
- **`[needs user confirmation]` flags** — wherever you made an assumption (owner, priority, edge case behavior, exact threshold). Don't ask the user every question in one pass; mark the gap in the draft and surface it in Step 4.

Apply `references/quality-rubric.md`: no implementation leak, one concern per REQ, testable bullets, parent/child structure, RFC 2119 keywords used correctly.

### Step 4 — Gap-fill

Walk the checklist in `references/gap-questions.md` against your draft. Most categories — failure modes, TTLs, concurrency, observability, security, ownership — will already be answered by Steps 2–3. **Ask the user only about the gaps that remain**, no more than 3–5 questions in one round.

The catalog's **Project invariants** section is the one part you should always walk: a spec that contradicts a house invariant gets rejected at review, no matter how well-formed it is.

Phrase questions so the user can answer in one line each:

> A few details to nail down before I write the file:
> 1. Owner — `security`, or someone else?
> 2. When the 5-attempt threshold is hit, do we just return 429, or also fire a webhook / log?
> 3. Counter reset on successful login — only for that IP, or for all sessions on the account?

Update the draft with their answers. If they say "skip these for now," leave the markers in and proceed.

### Step 5 — Review

Run `references/review-checklist.md` against the final draft. Surface findings as a short numbered list:

> Quality review:
> 1. REQ-AUTH-001.A1 — could be more specific. Suggest naming the response header (`Retry-After`) and the duration.
> 2. The `implementations:` block points at `src/auth/login.ts:authenticate` — that symbol exists per `specship_node` ✓.
> 3. No explicit acceptance criterion for "counter reset on successful login" — add as A3?

Apply the user's choices to the draft.

### Step 6 — Write the file

Use the `Write` tool against `<project-root>/specs/<slug>.md`. Choose the slug from the feature name (kebab-case, no date prefix — the date is in git). If a file with that name already exists, append to it (with the new REQ markers) rather than overwriting; tell the user what you did.

After writing:

```
Wrote specs/<slug>.md.

Next steps:
  1. Review the file (a few `[needs review]` flags remain if you skipped questions in Step 4).
  2. specship sync   # picks up the new spec into the graph
  3. /specship:spec implement <REQ-ID>   # when you're ready to build it
```

## When to use the workflow instead of the skill directly

This skill is the **lightweight path** — runs conversationally in Claude Code, no formal approval gates. For team contexts that want the same discipline `spec-implement` enforces, point the user at:

```
specship workflow run spec-author --input DESCRIPTION="..."
```

That workflow wraps this same loop with two approval gates — one after gap-fill, one before file write — and a git-worktree-isolated artifact directory. Use it when (a) the spec author is reviewing a teammate's draft, or (b) the team has agreed every new spec gets a written review step.

## Anti-patterns

- **Writing the spec without grounding in code.** The result is a beautiful document that points at symbols which don't exist. Use `specship_explore` first.
- **Asking the user every question in the catalog.** Five questions is plenty per round; the rest become `[needs review]` markers the user resolves at their pace.
- **Specifying the implementation.** "MUST use JWT signed with RS256" is implementation. "MUST be cryptographically tamper-evident with a 24 h TTL" is contract. The skill steers toward contract; review and rewrite if you find yourself naming algorithms.
- **One REQ that does too much.** "MUST handle login, logout, and password reset" is three REQs. Split before drafting.
- **Forgetting the embedded `<!-- id: -->` markers.** Every heading needs one immediately above. Without it `specship sync` fails the file with `spec_missing_id`.
- **Reusing an ID already used in the same file.** The later occurrence wins (the store does `INSERT OR REPLACE`), so the earlier heading's content is silently overwritten.
- **Using today's date in the slug.** The date lives in git; the slug should be the feature name (`payment-retry.md`, not `2026-06-18-payment-retry.md`).

## Reference files

The references/ directory is organized by stage:

| File | Stage | What it covers |
|---|---|---|
| `references/format.md` | Step 3 (draft) | Exact markdown the parser accepts |
| `references/quality-rubric.md` | Step 3 (draft) | What makes a "good" spec |
| `references/gap-questions.md` | Step 4 (gap-fill) | Catalog of questions to walk, plus the project invariants |
| `references/review-checklist.md` | Step 5 (review) | What to scan for before finalizing |

Read the relevant reference before each step. Don't paraphrase from memory — the format file in particular is the parser's contract.
