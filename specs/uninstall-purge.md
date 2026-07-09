---
id: UNINSTALL-PURGE-DOC
title: Complete uninstall (purge)
owner: core
priority: high
version: 1
---

<!-- id: UNINSTALL-PURGE-DOC -->
# Complete uninstall (purge)

`specship uninstall` completely removes SpecShip — returning the machine to
its pre-install state — rather than only unwiring it from Claude Code. Before
this document, `uninstall` stripped the Claude Code MCP entry, permissions, and
commands but left the `specship` binary on `PATH`, the per-project `.specship/`
indexes, and the user-level `~/.specship/` data (config, JIRA credentials,
worktrees). Users reasonably expected `uninstall` to be the inverse of getting
SpecShip onto the machine, not just the inverse of wiring it into the agent.

This is a **destructive** operation, so it is gated by an explicit confirmation
that lists exactly what will be deleted, and it offers an escape hatch to keep
data. SpecShip is Claude Code only; the agent-wiring removal targets Claude
Code's `settings.json` / `.mcp.json` and no other agent.

One inherent limit: SpecShip keeps no registry of every project it has ever
indexed, so purge removes the CURRENT project's index and cannot auto-discover
`.specship/` indexes in other repositories. It says so rather than pretending a
full sweep happened.

<!-- id: REQ-UNINSTALL-001 -->
## `specship uninstall` MUST completely remove SpecShip by default, behind a confirmation

By default `specship uninstall` removes every SpecShip artifact it can reach:
the Claude Code wiring at BOTH the global and the local (current-project)
location; the current project's `.specship/` index; the user-level
`~/.specship/` directory (its config, JIRA credentials, worktrees, and caches);
and the `specship` program itself (REQ-UNINSTALL-002). Because this is
irreversible, it first shows exactly what will be deleted and asks for
confirmation. Declining removes nothing. A non-interactive `--yes` (alias
`--force`) skips the prompt. The command reports each artifact it removed.

implementations:
  - src/installer/purge.ts:planPurge
  - src/installer/purge.ts:executePurge
  - src/installer/index.ts:runUninstaller

## Acceptance
<!-- id: REQ-UNINSTALL-001.A1 -->
- With confirmation given (or `--yes`), uninstall removes the Claude Code wiring at both the global and local locations, the current project's `.specship/` index, and the user-level `~/.specship/` directory.
<!-- id: REQ-UNINSTALL-001.A2 -->
- Without `--yes`, the command first prints the exact list of paths/targets to be removed and proceeds only on explicit confirmation; declining deletes nothing and exits cleanly.
<!-- id: REQ-UNINSTALL-001.A3 -->
- The purge never deletes anything outside the SpecShip-owned targets (the Claude Code marked entries, `<cwd>/.specship`, `~/.specship`, the install/bin locations) — unrelated files under those parents' siblings are untouched.
<!-- id: REQ-UNINSTALL-001.A4 -->
- The command reports that other projects' `.specship/` indexes are not auto-removed (no registry exists), rather than implying a machine-wide sweep.

<!-- id: REQ-UNINSTALL-002 -->
## The purge MUST remove the `specship` program per its detected install method

The purge removes the running binary using the same install-method detection
`specship update` uses (`detectInstallMethod` over the running file's directory
and the configured install dir). For a **bundle** install it deletes the install
directory (default `~/.specship`, or `SPECSHIP_INSTALL_DIR`) and the `PATH`
symlink (default `~/.local/bin/specship`, or `SPECSHIP_BIN_DIR`). For an **npm**
install it runs `npm rm -g @specship/specship`. When the method is **unknown**,
it removes everything else and prints the exact manual command to remove the
binary rather than guessing. Binary removal is best-effort: if the OS refuses to
delete a file that is in use (e.g. a running executable on Windows), the failure
is caught and the manual command is printed, never crashing the purge.

implementations:
  - src/installer/purge.ts:planPurge
  - src/installer/purge.ts:executePurge
  - src/update/updater.ts:detectInstallMethod

## Acceptance
<!-- id: REQ-UNINSTALL-002.A1 -->
- A bundle-detected install has its install directory and its `PATH` symlink removed (honoring `SPECSHIP_INSTALL_DIR` / `SPECSHIP_BIN_DIR` overrides).
<!-- id: REQ-UNINSTALL-002.A2 -->
- An npm-detected install triggers `npm rm -g @specship/specship`; the SpecShip data directory is still removed regardless.
<!-- id: REQ-UNINSTALL-002.A3 -->
- An unknown method removes the wiring/index/data and prints the exact manual binary-removal command instead of deleting an unrelated path.
<!-- id: REQ-UNINSTALL-002.A4 -->
- A removal that the OS refuses (in-use file) is caught and surfaced with the manual fallback; the overall command still exits reporting what it did remove.

<!-- id: REQ-UNINSTALL-003 -->
## A `--keep-data` escape hatch MUST preserve the pre-purge (wiring-only) behavior

Because purge-by-default is destructive, `specship uninstall --keep-data`
performs only the original behavior — removing the Claude Code wiring and leaving
the `.specship/` indexes, the `~/.specship/` data, and the binary in place — so a
user who only wants to unwire the agent keeps that option. `--keep-data` implies
no data loss and needs no confirmation.

implementations:
  - src/installer/index.ts:runUninstaller

## Acceptance
<!-- id: REQ-UNINSTALL-003.A1 -->
- `specship uninstall --keep-data` removes only the Claude Code wiring and leaves the project index, `~/.specship/`, and the binary intact (no version drift from the pre-purge behavior).
<!-- id: REQ-UNINSTALL-003.A2 -->
- `--keep-data` performs no destructive data/binary removal and requires no confirmation prompt.
