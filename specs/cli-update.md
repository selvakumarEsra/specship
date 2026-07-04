---
id: CLI-UPDATE-DOC
title: specship update — self-update to the latest release
owner: core
priority: medium
version: 1
---

<!-- id: CLI-UPDATE-DOC -->
# specship update — self-update to the latest release

`specship update` brings an installed SpecShip CLI up to the latest published
release with a single command, choosing the right mechanism for however it was
installed. It exists because the CLI ships through two independent channels —
the self-contained bundle (`install.sh` → `~/.specship`, versioned from GitHub
Releases) and the npm global package (`@specship/specship`) — and a user on an
out-of-date binary otherwise has to remember which channel they used and run the
matching command by hand. That friction is how a shipped fix goes uninstalled:
the version the user runs lags the version that fixed their problem.

This document covers the command's update behavior, install-method detection,
the read-only `--check` mode, failure handling, and the post-update restart
reminder. Scope is **latest-only** — no version pinning or downgrade.

<!-- id: REQ-CLI-UPDATE-001 -->
## `specship update` MUST update the CLI to the latest released version in place

Running `specship update` resolves the latest published release for the detected
install method and installs it over the current install, replacing the running
binary. When the install is already at the latest version it makes no changes
and reports that.

implementations:
  - src/update/updater.ts:runUpdate
  - src/update/run-installer.ts:runInstaller

## Acceptance
<!-- id: REQ-CLI-UPDATE-001.A1 -->
- `specship update` on an out-of-date install replaces the binary with the latest release and, on success, prints the previous and new version (e.g. `0.11.6 → 0.11.8`).
<!-- id: REQ-CLI-UPDATE-001.A2 -->
- `specship update` when already on the latest version prints an "already up to date" message and exits 0 without reinstalling.
<!-- id: REQ-CLI-UPDATE-001.A3 -->
- After a successful update, `specship --version` reports the new version.

<!-- id: REQ-CLI-UPDATE-002 -->
## `specship update` MUST auto-detect the install method and use the matching updater

The command determines whether the running binary came from the self-contained
bundle (`install.sh` → `~/.specship`) or an npm global install, and runs the
corresponding update path. It MUST NOT guess when the two are indistinguishable
— an undetectable install fails with guidance instead.

implementations:
  - src/update/updater.ts:detectInstallMethod
  - src/update/run-installer.ts:installerCommand
  - src/update/run-installer.ts:runInstaller

## Acceptance
<!-- id: REQ-CLI-UPDATE-002.A1 -->
- When the running binary resolves under the bundle install dir (default `~/.specship`, honoring `SPECSHIP_INSTALL_DIR`), update re-runs the bundle installer honoring the existing `SPECSHIP_INSTALL_DIR` and `SPECSHIP_BIN_DIR`.
<!-- id: REQ-CLI-UPDATE-002.A2 -->
- When the running binary resolves under an npm global prefix, update upgrades the global `@specship/specship` package to the latest release.
<!-- id: REQ-CLI-UPDATE-002.A3 -->
- When the install method cannot be determined, update exits non-zero and prints the exact manual command for both the bundle and npm methods.

<!-- id: REQ-CLI-UPDATE-003 -->
## `specship update --check` MUST report status without modifying anything

The `--check` flag reports the current version, the latest available version for
the detected install method, and whether an update is available. It performs no
install and touches no files — it is strictly read-only.

implementations:
  - src/update/updater.ts:runUpdate
  - src/update/resolve-latest.ts:resolveLatestVersion

## Acceptance
<!-- id: REQ-CLI-UPDATE-003.A1 -->
- `specship update --check` prints the current version, the latest version, and whether an update is available.
<!-- id: REQ-CLI-UPDATE-003.A2 -->
- `specship update --check` makes no changes to the installed binary or filesystem.
<!-- id: REQ-CLI-UPDATE-003.A3 -->
- `specship update --check` exits `0` when already up to date and exits `10` when an update is available (a distinct code, separate from the `1` used for real errors such as an unreachable release source), so a script or hook can gate on "update available" without confusing it with a failure.

<!-- id: REQ-CLI-UPDATE-004 -->
## `specship update` MUST fail safely, leaving the existing install intact

Any failure resolving the latest version or running the underlying updater must
surface a clear error and leave the current working install unchanged — a failed
update never yields a half-replaced or broken binary.

implementations:
  - src/update/updater.ts:runUpdate

## Acceptance
<!-- id: REQ-CLI-UPDATE-004.A1 -->
- When the latest-version source is unreachable (network error / non-200), update prints a clear error, exits non-zero, and does not modify the existing install.
<!-- id: REQ-CLI-UPDATE-004.A2 -->
- When the underlying updater (the bundle installer or npm) exits non-zero, update surfaces that failure and exits non-zero rather than reporting success.

<!-- id: REQ-CLI-UPDATE-005 -->
## After a successful update, `specship update` SHOULD advise restarting running SpecShip processes

A SpecShip MCP server or dashboard launched from the old binary keeps the old
code in memory until it is restarted, so the on-disk update alone does not take
effect for an already-running session. The command reminds the user.

implementations:
  - src/update/updater.ts:runUpdate

## Acceptance
<!-- id: REQ-CLI-UPDATE-005.A1 -->
- On a successful in-place update, update prints a reminder to restart any running `specship serve` / Claude Code MCP session so it picks up the new version.
