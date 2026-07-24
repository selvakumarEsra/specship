---
id: CLAUDEMD-DOC
title: CLAUDE.md governance — audited automatically, fixed with a human
owner: specship
priority: medium
---

<!-- id: CLAUDEMD-DOC -->
# CLAUDE.md governance — audited automatically, fixed with a human

A project's CLAUDE.md hierarchy (root file + nested per-module files) decays
the same way spec links do: paths move, modules appear without a nested
file, the root bloats past what a session can absorb, and root/nested copies
drift apart. SpecShip already owns the moment to notice this — the
hash-guarded sync pass that runs on its hooks — and the pattern to handle
it: detect deterministically, surface like drift, and let a human approve
any rewrite.

Target shape (the claude-md-architect template): a root CLAUDE.md acting as
a **router** — small (≤200 lines), cross-cutting content only, pointing at
nested module CLAUDE.md files (≤100 lines each) that add module-specific
invariants, verification, and glossary without duplicating the root.

Two principles bound this feature:

- **Detection is deterministic; rewriting is not ours to do silently.**
  The audit is pure structure/reference checking — no LLM, no judgment
  calls. Content fixes are drafted in-session through the check door and
  written only on explicit human confirmation (the same doctrine as domain
  facts). SpecShip never edits a CLAUDE.md by itself — this also preserves
  the #529 rule that the installer doesn't write instruction blocks.
- **Event-driven, not scheduled.** The audit rides the existing sync pass
  (which the hooks already run at session start and after edits), so
  findings are at most one session stale with zero new infrastructure. A
  cron adds a schedule to miss; sync is already the heartbeat.

<!-- id: REQ-CLAUDEMD-001 -->
## Sync MUST run a hash-guarded CLAUDE.md audit pass

Every `sync` runs the audit as a best-effort pass (like the spec pass): it
discovers the project's CLAUDE.md files (root + nested, skipping
node_modules/.git/dist and SpecShip's own state dirs), checks them (REQ-002),
and persists the result to `.specship/claudemd-audit.json`. A fingerprint
over the discovered files (paths + sizes + mtimes) guards the pass — when
nothing changed since the stored audit, the pass is a cheap no-op. An audit
failure never fails the sync.

implementations:
  - src/claudemd/audit.ts:auditClaudeMd
  - src/claudemd/audit.ts:runClaudeMdAudit
  - src/index.ts:SpecShip.sync

## Acceptance
<!-- id: REQ-CLAUDEMD-001.A1 -->
- After a sync in a project with CLAUDE.md files, `.specship/claudemd-audit.json`
  exists and lists the discovered files and findings.
<!-- id: REQ-CLAUDEMD-001.A2 -->
- A second sync with no CLAUDE.md or tree changes does not re-run the
  checks (the stored fingerprint matches and the file's timestamp is
  unchanged).
<!-- id: REQ-CLAUDEMD-001.A3 -->
- An unreadable CLAUDE.md or audit write failure leaves the sync result
  unaffected.

<!-- id: REQ-CLAUDEMD-002 -->
## The audit MUST check structure and references deterministically

Checks, each producing a finding with a kind, file, and one-line detail:

- **missing-root** — the project has no root CLAUDE.md.
- **root-too-long** — root exceeds 200 lines (the router bar); the finding
  recommends splitting to nested files.
- **nested-too-long** — a nested file exceeds 100 lines.
- **duplication** — a non-trivial line (≥30 chars after trimming, not a
  heading or list marker alone) appears verbatim in both the root and a
  nested file.
- **stale-path** — a repo-relative path mentioned in a CLAUDE.md (backtick
  or bare `src/...`-style token) that no longer exists on disk.
- **module-candidate** — a directory with its own package manifest (e.g.
  `package.json` not at the root) and no CLAUDE.md of its own; surfaced as
  an opportunity, severity info.

No content-quality judgments (tone, wording, "is this a real invariant") —
those need a human and belong to the fix flow.

implementations:
  - src/claudemd/audit.ts:auditClaudeMd

## Acceptance
<!-- id: REQ-CLAUDEMD-002.A1 -->
- A 250-line root yields `root-too-long`; a 150-line root yields none.
<!-- id: REQ-CLAUDEMD-002.A2 -->
- A line duplicated verbatim between root and a nested file yields
  `duplication` naming both files; short/markup-only repeats do not.
<!-- id: REQ-CLAUDEMD-002.A3 -->
- A CLAUDE.md referencing a deleted `src/` path yields `stale-path`; an
  existing path does not.
<!-- id: REQ-CLAUDEMD-002.A4 -->
- A subdirectory with its own package manifest and no CLAUDE.md yields
  `module-candidate`; the repo root's own manifest does not.

<!-- id: REQ-CLAUDEMD-003 -->
## Findings MUST surface through the existing drift channels

`specship sync --drift-summary` (the SessionStart hook's form) prints one
extra line when the stored audit has findings — count + the check-door
pointer — and stays silent at zero. The check door (`/specship:check`)
gains a `claudemd` flow that reads the audit JSON and presents the findings.
No new door, no statusline change.

implementations:
  - src/bin/specship.ts:main
  - commands/specship/check.md

## Acceptance
<!-- id: REQ-CLAUDEMD-003.A1 -->
- With findings present, `sync --drift-summary` prints a single
  `⚠ N CLAUDE.md finding(s)` line naming `/specship:check claudemd`; with
  zero findings it prints nothing extra.
<!-- id: REQ-CLAUDEMD-003.A2 -->
- The check command document describes the `claudemd` flow: read the audit
  JSON, present findings, offer fixes.

<!-- id: REQ-CLAUDEMD-004 -->
## Fixes MUST be drafted in-session and human-gated — never automatic

The `claudemd` check flow drafts remediations following the
claude-md-architect shape — root-as-router split, nested file creation for
module candidates, dedup by deferring to root, stale-path corrections —
shows the draft, and writes only on explicit confirmation. SpecShip code
paths (sync, hooks, installer) never modify a CLAUDE.md.

implementations:
  - commands/specship/check.md

## Acceptance
<!-- id: REQ-CLAUDEMD-004.A1 -->
- No shipped code path writes to any CLAUDE.md (source-scan level: the
  audit module opens CLAUDE.md files read-only).
<!-- id: REQ-CLAUDEMD-004.A2 -->
- The check command document instructs drafting + explicit confirmation
  before any Write, and defers cross-cutting content to the root rather
  than duplicating it.
