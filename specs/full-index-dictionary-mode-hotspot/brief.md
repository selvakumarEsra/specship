---
slug: full-index-dictionary-mode-hotspot
created: 2026-10-11
label: bug
---
# Project-root walk-up hijack makes `specship index` crawl $HOME for an hour

Diagnosed 2026-10-11 (earlier NameDictionary hypothesis was a symptom, not the cause).

**Root cause chain:**
1. `resolveProjectPath` (src/bin/specship.ts) walks UP from cwd when the exact
   path is not initialized. With the repo's `.specship/specship.db` missing
   (deleted/corrupt), it kept walking and matched `/Users/<user>` — the GLOBAL
   `~/.specship` state dir satisfied the probe — so `specship index`, `sync`
   and `lint` all silently targeted the **home directory**.
2. `$HOME` is not a git repo → `getGitVisibleFiles` fails (`git rev-parse` →
   status 128) → `scanDirectoryWalk` fallback crawls the entire home tree:
   67k+ "source" files found and climbing, then hours of parsing. Two runs
   burned ~47 and ~57 CPU-minutes before being killed.
3. An explicit path argument does NOT protect: `resolveProjectPath(pathArg)`
   still walks up when the exact path is uninitialized. Only `specship init .`
   re-anchors it.

**Fix directions to spec (triage into requirements):**
- Never resolve to a directory that only matches because it holds the GLOBAL
  state dir (`~/.specship` has `daemon.*`/`global`, not a project DB) — or
  stop the walk-up at `$HOME` / filesystem boundaries.
- An explicit `[path]` argument should be taken literally (fail with the
  "not initialized" error instead of walking up).
- Guard the walk fallback: refuse (or warn + cap) when the scan exceeds a
  sane file budget — "indexing 67,000 files" from a repo CLI is always wrong.
- Surface WHERE it is indexing: the spinner never shows the resolved root.

**Repro:** rm .specship/specship.db in an initialized repo (with ~/.specship
present), run `specship index` → watch it scan $HOME.

## Grounding
- src/bin/specship.ts:resolveProjectPath
- src/extraction/index.ts:getGitVisibleFiles
- src/extraction/index.ts:scanDirectoryWalk
