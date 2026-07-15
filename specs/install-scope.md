---
id: INSTALL-SCOPE-DOC
title: specship install is wiring-only — binary acquisition is a separate step
owner: specship
priority: high
---

<!-- id: INSTALL-SCOPE-DOC -->
# `specship install` is wiring-only

Getting the `specship` binary onto a machine and wiring Claude Code are two
different jobs with different constraints:

- **Binary acquisition** — `npm i -g @specship/specship` (online) or the
  release bundle's `install.sh` / `install.ps1` (offline, no npm, no
  compiler). This is where package managers may appear.
- **`specship install`** — pure wiring: the Claude Code setup (MCP entry,
  permissions, hooks, slash commands, subagents, steering) plus preparing the
  target repo's `.specship/` index. By definition the binary already exists
  when this runs.

Today's interactive install violates that split: its "Step 1" offers to run
`npm install -g @specship/specship` — pointless (the running process IS the
binary), wrong on offline machines (no npm), and dangerous on bundle
installs (it would switch the install method underneath the user).

<!-- id: REQ-SCOPE-001 -->
## `specship install` MUST NOT invoke a package manager

The installer never executes npm/npx (or any package manager). In place of
the removed CLI-install step, it performs a read-only PATH check: when the
`specship` command is not resolvable on PATH (Claude Code launches
`specship serve --mcp` by name), it prints guidance naming both acquisition
routes — it never runs them. Uninstall's existing binary-removal path
(`specship uninstall` purging an npm-method install) is out of scope: that
is deliberate teardown, not acquisition.

implementations:
  - src/installer/index.ts:runInstallerWithOptions

## Acceptance
<!-- id: REQ-SCOPE-001.A1 -->
- No code path reachable from `specship install` executes `npm install`/
  `npx` (guarded by a source-scan test on the installer module).
<!-- id: REQ-SCOPE-001.A2 -->
- With `specship` absent from PATH, install still completes the wiring and
  prints guidance naming `npm i -g` and the offline bundle installer.

<!-- id: REQ-SCOPE-002 -->
## `specship install` MUST accept a target repo

`--path <repo>` wires and initializes a specific repository regardless of
the current directory (the project-local files and the `.specship/` index
land in `<repo>`), matching the bundle installer's `--path`. A nonexistent
path fails with a clear message before any wiring. Without `--path`,
behavior is unchanged (cwd).

implementations:
  - src/bin/specship.ts:main

## Acceptance
<!-- id: REQ-SCOPE-002.A1 -->
- `specship install --yes --location local --path <repo>` run from another
  directory writes `<repo>/.mcp.json`, `<repo>/.claude/settings.json`, and
  initializes `<repo>/.specship` — nothing lands in the invoking cwd.
<!-- id: REQ-SCOPE-002.A2 -->
- A nonexistent `--path` exits non-zero with a clear message and writes
  nothing.

<!-- id: REQ-SCOPE-003 -->
## The documentation MUST present the two steps as separate

README and the site's installation page lead with "get the CLI" (npm OR
offline bundle) as step 1 and "`specship install` = wiring only" as step 2;
the site drops the `npx @specship/specship install` one-shot that conflated
acquisition with wiring (it breaks on offline machines and hides the split).

implementations:
  - site/src/content/docs/getting-started/installation.md

## Acceptance
<!-- id: REQ-SCOPE-003.A1 -->
- The installation page's first command acquires the binary; wiring is a
  distinct step described as configuration-only.
