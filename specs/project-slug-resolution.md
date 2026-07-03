---
id: SLUGRES-DOC
title: Claude project slug resolution
owner: specship
priority: high
version: 1
---

<!-- id: SLUGRES-DOC -->
# Claude project slug resolution

Claude Code stores per-project transcripts under `~/.claude/projects/<slug>/`,
where the slug is the project's absolute path with every non-alphanumeric
character replaced by `-` (`/Users/a/dev/claude-projects/x` →
`-Users-a-dev-claude-projects-x`). This encoding is lossy: `-`, `/`, `.`, and
`_` all collapse into `-`, so the naive reverse mapping (`-` → `/`) mangles any
real path that contains a hyphen, dot, or underscore.

Today both the server (`decodeProjectSlug`) and the CLI
(`pickRecentInitializedProject`) use the naive reverse mapping. For a user
whose projects live under a hyphenated directory (e.g.
`~/dev/claude-projects/*`), every slug decodes to a nonexistent path. The
observed failure chain: `specship serve --ui` outside an initialized cwd finds
no candidate project and boots projectless; the desktop UI's project picker
lists every project as `missing`; selecting one sends `?project=<slug>`, which
the server decodes to the same wrong path, fails to open, and silently falls
back to the (absent) primary — every page then renders `no_project` / 409.
The dashboard is unusable end to end.

This document specifies slug→path resolution that recovers the real path from
authoritative local sources instead of guessing from the slug.

<!-- id: REQ-SLUGRES-001 -->
## Slug→path resolution MUST consult authoritative sources before the lossy decode

A shared resolver maps a Claude project slug to its real absolute path using,
in order:

1. **`~/.claude.json` `projects` map** — its keys are real absolute project
   paths recorded by Claude Code. A reverse index is built by slug-encoding
   each key (every character outside `[A-Za-z0-9]` → `-`) and matching against
   the requested slug.
2. **Transcript `cwd` sniffing** — for a slug not covered by the reverse
   index, the newest `.jsonl` transcripts in `~/.claude/projects/<slug>/` are
   scanned (bounded read) for a `"cwd"` value whose slug-encoding equals the
   requested slug. A matching `cwd` is the real path.
3. **Lossy decode fallback** — when neither source resolves the slug, the
   legacy `-` → `/` decode is returned so existing behavior for
   hyphen-free paths is preserved.

The resolver MUST cache its `~/.claude.json` reverse index between calls and
refresh it when the file's mtime changes, so per-request resolution stays
cheap. Failures reading either source MUST degrade to the next source, never
throw.

implementations:
  - packages/server/src/ingest/project-paths.ts:resolveProjectSlug
  - packages/server/src/ingest/project-paths.ts:createSlugResolver

## Acceptance
<!-- id: REQ-SLUGRES-001.A1 -->
- A slug whose real path contains hyphens (e.g. `-Users-a-dev-claude-projects-x`
  for `/Users/a/dev/claude-projects/x` present in `~/.claude.json`) resolves to
  the real path, not the `-`→`/` mangled form.
<!-- id: REQ-SLUGRES-001.A2 -->
- A slug absent from `~/.claude.json` but whose transcript lines contain
  `"cwd":"<real path>"` (with `encodeSlug(real path) === slug`) resolves to
  that `cwd` value.
<!-- id: REQ-SLUGRES-001.A3 -->
- A slug found in neither source resolves to the legacy lossy decode
  (`-Users-a-foo` → `/Users/a/foo`).
<!-- id: REQ-SLUGRES-001.A4 -->
- A missing, unreadable, or malformed `~/.claude.json` does not throw and the
  resolver proceeds to the remaining sources.

<!-- id: REQ-SLUGRES-002 -->
## `/api/projects` MUST report real paths and correct exists/initialized flags

The project-picker enumeration decodes each slug through the resolver, so
`path`, `exists`, and `initialized` reflect the real project directory. A
project living under a hyphenated parent directory MUST NOT be reported as
missing when it exists on disk.

implementations:
  - packages/server/src/routes/projects.ts:enumerate

## Acceptance
<!-- id: REQ-SLUGRES-002.A1 -->
- With `~/.claude.json` listing `/Users/a/dev/claude-projects/x` and that
  directory existing with a `.specship/` folder, `GET /api/projects` returns
  its entry with the real `path`, `exists: true`, `initialized: true`.

<!-- id: REQ-SLUGRES-003 -->
## `?project=<slug>` lookups MUST open the real project

`ProjectRegistry.getBySlug` resolves the slug through the resolver before
opening, so specship-scoped routes (`status`, `graph`, `spec`, `drift`,
`workflows`, …) serve the selected project's data instead of silently falling
back to the boot-time primary.

implementations:
  - packages/server/src/project-registry.ts:ProjectRegistry.getBySlug

## Acceptance
<!-- id: REQ-SLUGRES-003.A1 -->
- With the server booted projectless and a valid initialized project under a
  hyphenated parent, `GET /api/status?project=<its slug>` returns that
  project's status instead of `no_project`.

<!-- id: REQ-SLUGRES-004 -->
## `specship serve --ui` auto-pick MUST find projects under hyphenated paths

The CLI's recent-project auto-pick resolves slugs the same way (reverse index
from `~/.claude.json`, transcript `cwd` sniff, lossy fallback) so launching
the dashboard from a non-project directory selects the most recently active
initialized project rather than booting projectless.

implementations:
  - src/bin/specship.ts:pickRecentInitializedProject

## Acceptance
<!-- id: REQ-SLUGRES-004.A1 -->
- With at least one initialized project recorded in `~/.claude.json` under a
  hyphenated parent directory, `specship serve --ui` launched from an
  unrelated cwd boots with that project as primary (no
  `no primary project` warning).
