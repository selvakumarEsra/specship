---
id: SLIM-DOC
title: Slim package & simplified install
owner: specship-core
priority: high
version: 1
---

<!-- id: SLIM-DOC -->
# Slim package & simplified install

The npm package ships 14.1 MB unpacked / 954 files, over a third of it one
grammar (`tree-sitter-scala.wasm`, 4.96 MB) and another 3 MB of source maps
nobody consumes; `specship install` asks up to three interactive questions.
Cut the shipped footprint and reduce install to at most one question, without
dropping any supported language or breaking offline installs.

Non-goals: removing language support, changing what an install writes
(targets, hooks, commands, skills stay as-is), platform bundles
(`scripts/build-bundle.sh` operates on the repo, not the package), download-on-
demand grammars (conflicts with local-first/offline).

<!-- id: REQ-SLIM-001 -->
## The npm package MUST NOT ship development artifacts

Source maps (398 files, 3.0 MB) and the dev/release tooling under `scripts/`
(agent-eval, add-lang, release helpers — referenced by nothing at runtime)
ship to every install today.

## Acceptance
<!-- id: REQ-SLIM-001.A1 -->
- `npm pack` contains no `*.map` files and none of `scripts/` (no runtime code references them; `preuninstall` uses `dist/bin/uninstall.js`).
<!-- id: REQ-SLIM-001.A2 -->
- A pack-size guard test enumerates the packed tarball and fails on: any `*.map`, any `scripts/` entry, unpacked size above budget, or packed size above budget. Budgets are a ratchet — set just above measured, only lowered.
<!-- id: REQ-SLIM-001.A3 -->
- The build still emits source maps locally for development (exclusion is at pack time, not compile time).

<!-- id: REQ-SLIM-002 -->
## Oversized grammar wasm MUST ship compressed and load transparently

`tree-sitter-scala.wasm` is 4.96 MB (583 KB gzipped); `tree-sitter-pascal.wasm`
is 717 KB (83 KB gzipped). Compression is lossless and decompression is local,
so offline behavior is unchanged.

implementations:
  - src/extraction/grammars.ts:resolveVendoredGrammar
  - src/extraction/grammars.ts:loadGrammarsForLanguages

## Acceptance
<!-- id: REQ-SLIM-002.A1 -->
- Grammar wasm files above a size threshold are shipped as `.wasm.gz`; the wasm loader transparently decompresses (zlib) when the `.wasm` is absent but `.wasm.gz` is present, with no behavior change for callers.
<!-- id: REQ-SLIM-002.A2 -->
- Scala and Pascal extraction still pass their existing extraction tests when loaded from the compressed artifacts (dist-shaped fixture or copy-assets output).
<!-- id: REQ-SLIM-002.A3 -->
- A corrupt `.wasm.gz` fails with a clear error naming the file, not a silent parse degradation.
<!-- id: REQ-SLIM-002.A4 -->
- Total unpacked package size lands at or below 7 MB (from 14.1 MB), enforced by REQ-SLIM-001.A2's guard.

<!-- id: REQ-SLIM-003 -->
## Interactive install MUST ask at most one question

Interactive installs currently prompt for location, status line, and indexing.
Everything except location has a sensible default; asking three questions
costs more than it protects.

implementations:
  - src/installer/install-defaults.ts:resolveStatusLine
  - src/installer/install-defaults.ts:resolveAutoAllow
  - src/installer/install-defaults.ts:describeInstallDefaults
  - src/installer/index.ts:runInstallerWithOptions
  - src/installer/init-offer.ts:decideInstallInit
  - src/installer/targets/claude.ts:writeStatusLineEntry

## Acceptance
<!-- id: REQ-SLIM-003.A1 -->
- An interactive `specship install` asks only the install-location question; status line (default: on, never overwriting an existing status line) and initial indexing (default: yes) proceed without prompting.
<!-- id: REQ-SLIM-003.A2 -->
- The install summary names every defaulted decision and its opt-out flag (`--skip-statusline`, `--skip-index`), so nothing happens invisibly.
<!-- id: REQ-SLIM-003.A3 -->
- Existing flags keep working: `--statusline`/`--skip-statusline`, `--skip-index`, `-y/--yes` (still fully non-interactive), `--location`. Non-TTY runs never prompt (unchanged).
<!-- id: REQ-SLIM-003.A4 -->
- A user with an existing status line configured is not prompted and not overwritten (current guarantee preserved under the new default).
