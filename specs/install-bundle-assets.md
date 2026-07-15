---
id: INSTALL-BUNDLE-ASSETS-DOC
title: Bundled package ships the installer's plugin assets
owner: installer
priority: high
---

<!-- id: INSTALL-BUNDLE-ASSETS-DOC -->
# Bundled package ships the installer's plugin assets

`specship install` copies a set of plugin assets out of the installed package
into the user's Claude Code config: the slash-command files (`commands/`), the
`specship-explorer` subagent (`agents/`), and the plugin manifest / hooks
(`.claude-plugin/`, `hooks/`). The installer resolves these from the package via
`packageAssetPath` in `src/installer/targets/claude.ts`.

The published package now ships in two shapes — the **non-bundled** root package
(which lists `commands`/`agents`/`hooks`/`.claude-plugin` in `files[]`) and the
**bundled** per-platform distribution (which ships only what rides along under
`dist/`, per `scripts/build-server-bundle.mjs` / `scripts/pack-npm.sh`). The
bundled shape dropped the plugin-asset directories, so on a bundled install the
installer hits `ENOENT … /commands/ss-explore.md` and `specship install` fails at
the slash-command step.

This is a release-blocking regression: the first bundled release (`0.11.2`,
current npm `latest`) breaks every new `specship install`. The contract below is
that **install behaves identically on the bundled and non-bundled packages** — it
does not mandate a particular staging mechanism, only that the assets the
installer reads are present where it resolves them in both shapes.

<!-- id: REQ-INSTALL-ASSETS-001 -->
## `specship install` on the bundled package MUST find and install every plugin asset it copies

Every asset the installer reads via `packageAssetPath` — the shipped slash
commands, the `specship-explorer` subagent, and the plugin manifest / hooks — MUST
be present in the bundled distribution at the path the installer resolves, so a
fresh install from the bundled package completes without a missing-file error and
writes the same Claude Code config it writes from the non-bundled package.

implementations:
  - src/installer/targets/claude.ts:packageAssetPath
  - src/installer/targets/claude.ts:writeCommandsEntries
  - src/installer/targets/claude.ts:writeAgentsEntries

## Acceptance
<!-- id: REQ-INSTALL-ASSETS-001.A1 -->
- The bundled distribution MUST contain every plugin-asset file the installer copies — the retrieval- and governance-tier slash commands, the `specship-explorer` subagent, and the plugin manifest / hooks — reachable at the location `packageAssetPath` resolves to from the installed `dist/`.
<!-- id: REQ-INSTALL-ASSETS-001.A2 -->
- Running `specship install` against a freshly-installed bundled package MUST complete without an `ENOENT`/missing-file error and MUST write the expected slash-command files and subagent into the Claude Code commands/agents directories.
<!-- id: REQ-INSTALL-ASSETS-001.A3 -->
- Install against the non-bundled package MUST still succeed unchanged — the resolution path MUST work for both package shapes (no regression).
<!-- id: REQ-INSTALL-ASSETS-001.A4 -->
- `specship uninstall` MUST still remove exactly the asset files a matching install wrote, with no stranded or missed files after the resolution-path change.
<!-- id: REQ-INSTALL-ASSETS-001.A5 -->
- The `installer-targets` contract suite MUST assert the installer resolves its assets from the bundled location, so a build that omits an installer asset from `dist/` fails the test suite rather than only failing at install time.

<!-- id: REQ-INSTALL-ASSETS-002 -->
## A published-install smoke check MUST exercise `specship install` against the bundled artifact

CI MUST run `specship install` against the **bundled** packaged artifact (not just
the non-bundled or from-source path), so a future regression that omits an
installer asset from the bundle fails CI before it reaches npm.

implementations:
  - .github/workflows/smoke-npx.yml

## Acceptance
<!-- id: REQ-INSTALL-ASSETS-002.A1 -->
- A CI job MUST install the bundled packaged artifact and run `specship install` end-to-end, failing the build if install errors (e.g. a missing slash-command or subagent asset).
<!-- id: REQ-INSTALL-ASSETS-002.A2 -->
- The check MUST verify the expected slash-command file(s) and the `specship-explorer` subagent were actually written by the install, not merely that the command exited zero.
