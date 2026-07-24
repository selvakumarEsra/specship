# Releasing SpecShip

Released to npm and mirrored as [GitHub Releases](https://github.com/selvakumarEsra/specship/releases).
`CHANGELOG.md` is the source of truth; GitHub Release notes are extracted
from it. The root `CLAUDE.md` carries the non-negotiables; this file is the
full process.

## Writing changelog entries

**Default: write entries under `## [Unreleased]`** — the section reserved
for work landing between releases. **Don't pre-create a `## [X.Y.Z]` block**
for the next release: the Release workflow's first step is
`scripts/prepare-release.mjs`, which automatically promotes everything under
`[Unreleased]` into a new `## [X.Y.Z] - <YYYY-MM-DD>` block at release time.
Pre-staging caused the v0.9.5 sparse-release-notes incident: a sparse
`[0.9.5]` block hand-added before the rest of the work landed got picked by
the extractor over the much-larger `[Unreleased]` section above it.

Formatting rules for any entry:

1. **Write friendly, user-facing notes — not engineer-facing ones.** Group
   under `### New Features` and `### Fixes` (sentence-case). Surface
   `### Breaking Changes` and `### Security` only when the release has them;
   fold improvement-flavored changes into New Features. Omit empty sections.
   (The GitHub Release page extracts each version block **verbatim** via
   `scripts/extract-release-notes.mjs` — dense implementation-focused
   entries rendered as an unreadable wall of text, so the whole CHANGELOG
   was rewritten to this format.)
2. **One plain-language sentence per bullet:** what changed and why it
   matters to a user. Lead with the capability, or the symptom now fixed.
3. **Strip the internals.** No internal file paths (`src/...`), no internal
   symbol/function/class names, no benchmark numbers or node/edge counts.
   **Keep:** language & framework names, things a user types or sets
   (`specship install`, `specship_explore`, `SPECSHIP_*` env vars), and a
   brief `Thanks @user` when a contributor is credited.
4. Issue/PR references by number (`(#403)`); the GitHub renderer auto-links
   them.
5. **Don't add a `[X.Y.Z]: https://...` link reference yourself** —
   `prepare-release.mjs` appends it when it promotes the version.

Multi-word headings like `### New Features` are safe on the normal release
path: `prepare-release.mjs` Case A moves the whole `[Unreleased]` body
verbatim. (Its rarely-used Case B merge splits sub-sections with a
single-word `^### (\w+)$` regex that wouldn't match them — and Case B fires
only when a `[X.Y.Z]` block was pre-created, which the rule above forbids.)

## Release flow (the user runs these)

Releases are built and published by the **GitHub Actions "Release"
workflow** (`.github/workflows/release.yml`). It runs
`scripts/prepare-release.mjs` to promote `[Unreleased]` (auto-committing the
CHANGELOG move back to `main`), bundles a Node runtime per platform
(`scripts/build-bundle.sh`), and publishes the GitHub Release plus the npm
thin-installer (`scripts/pack-npm.sh`: shim package + per-platform
packages). **Publishing manually is wrong** — a plain `npm publish` ships
the root package (non-bundled), which breaks anyone on Node < 22.5.

**Claude does NOT bump the version unless explicitly asked.** The maintainer
typically edits `package.json` themselves (often via the GitHub web UI).
When they do, the only strictly-required edit is `package.json` — the
workflow's "Sync package-lock.json" step detects the mismatch, rewrites the
lock file's version fields, and pushes with `[skip ci]`.

Once `package.json` is at the target version on `main`, trigger
**Actions → Release → Run workflow** (on `main`):

1. Syncs `package-lock.json` if drifted; commits + pushes.
2. `prepare-release.mjs <X.Y.Z>` promotes `[Unreleased]` → `[X.Y.Z] -
   <today>`, appends the link reference, pushes with `[skip ci]`.
3. Builds every platform bundle on one runner; generates `SHA256SUMS`.
4. Creates the GitHub Release with notes from the fresh `[X.Y.Z]` block.
5. Publishes the npm shim + per-platform packages (needs the `NPM_TOKEN`
   repo secret).
