/**
 * Published-package size budget + `npm pack` manifest reader, shared by
 * pack-guard.test.ts (SLIM-DOC) and dashtheme-fonts.test.ts
 * (REQ-DASHTHEME-002.A5) so both judge the package against ONE budget.
 *
 * Size budgets are a RATCHET: set just above the measured size of a clean
 * build after the REQ-SLIM-001/002 slimming — 2.19 MB packed / 5.74 MB
 * unpacked / 503 files, down from 2.94 MB / 14.10 MB / 954. Lower them when
 * the package shrinks; never raise them to make a failing build pass —
 * investigate what got added instead. A failure right after pulling this
 * change usually means a stale `dist/` (rebuild: content-hashed SPA bundles
 * used to accumulate under dist/ui/assets).
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

// Raised 2.40 MB → 2.45 MB (2026-11-04, REQ-DASHTHEME-002): the dashboard's
// fonts became the BookMyGame design system's own Space Grotesk + Bricolage
// Grotesque woff2 files (4 files, 148,748 B) replacing self-hosted Geist sans
// (5 files, 76,420 B). Measured clean build: 2,339,137 → 2,412,366 B packed
// (+73,229 B — woff2 is already compressed, so the net font bytes pass
// through the tarball gzip almost 1:1); 6,229,047 → 6,301,560 B unpacked;
// 580 → 579 files. Checked for stale dist assets first — none (dist/ui/assets
// is wiped per build).
// Raised 2.45 MB → 2.50 MB (2026-11-05, AGENTSWITCH-DOC): clean builds packed
// 2,440,452 B / 583 files before REQ-AGENTSWITCH-006 and 2,450,373 B / 587
// files after 006 + 007 (installed-agents record, agent detection). Measured
// with `npm pack --dry-run` on a fresh dist; headroom covers 008/009/001–005.
// Raised 2.50 MB → 2.60 MB (2026-11-05, REQ-AGENTSWITCH-011..016): a clean
// build packs 2,500,367 B / 622 files; the Gemini CLI extension
// (gemini-extension/, 17 files / 109,610 B unpacked — a second copy of the
// commands, skills and agent in Gemini's format) plus the discovery and
// rendering modules are the growth. Measured with `npm pack --dry-run`.
export const MAX_PACKED_BYTES = 2_600_000;
// Raised 6.20 MB → 6.25 MB and 560 → 580 files (2026-10-27): the headless-agent
// adapters (dist/workflows/agents/, REQ-AGENTADAPT-005–007) and the shared
// criterion-id parser add 10 files / ~23 KB; no stale dist assets.
// Raised 6.25 MB → 6.35 MB (2026-10-27): the design.md extractor/checker
// (dist/design-md/, DESIGNMD-DOC) and the shipped design-md skill add ~46 KB;
// checked for stale dist files first — none.
// Raised 6.35 MB → 6.40 MB (2026-11-04, integration of htmllex + MULTIDEV-DOC +
// DASHSIMPLE/DASHTHEME): main packs 6,316,289 B; the merged tree 6,388,725 B.
// ~50 KB is the compiled MULTIDEV code (diffed file-by-file against main on
// feat/multidev-branches); the rest is the dashboard's new screens net of the
// deleted agent pages and Geist fonts. Clean build, no stale assets.
// Raised 6.40 MB → 6.45 MB (2026-11-05, REQ-AGENTSWITCH-006): HEAD packs
// 6,398,315 B / 583 files on a clean build; the installed-agents record
// (dist/installer/agent-record.*) plus the install/update replay wiring adds
// 21,037 B / 2 files. Both measured with `npm pack --dry-run`; no stale dist.
// Raised 6.45 MB → 6.48 MB (2026-11-05, REQ-AGENTSWITCH-008): a clean build
// (fresh worktree, no prior dist/) packs 6,454,951 B; the automatic agent
// set-up (dist/installer/auto-migrate.*, 27,411 B / 4 files incl. maps) plus
// the write journal in targets/shared and the trigger wiring is the growth.
// Raised 6.48 MB → 6.60 MB (2026-11-05, REQ-AGENTSWITCH-004): clean builds
// unpack to 6,479,178 B / 590 files before and 6,510,610 B / 598 files after
// the per-agent transcript adapters (+31,432 B / 8 files). Measured with
// `npm pack --dry-run` on a fresh dist; headroom covers REQ-AGENTSWITCH-005/010.
// Raised 6.60 MB → 6.80 MB (2026-11-05, REQ-AGENTSWITCH-016): clean build
// unpacks to 6,679,578 B, of which the Gemini extension is 109,610 B.
// Raised 6.80 MB → 6.85 MB (2026-11-06, REQ-LINKACC-008): a clean build (fresh
// worktree, no prior dist/) unpacks to 6,807,938 B; the dependency-version
// claim checker (dist/spec-lint/version-claims.*, 28,353 B / 4 files incl.
// maps) plus its lint and specship_spec wiring is the growth. Measured with
// `npm pack --dry-run`; no stale dist assets.
// Raised 6.85 MB → 6.90 MB (2026-11-06, REQ-LINKACC-011): clean builds (fresh
// worktrees, no prior dist/) unpack to 6,846,415 B at the merge of
// REQ-LINKACC-010 and 6,851,285 B after (+4,870 B): the shared
// SpecShip.assertSpecLink (resolve → spec write-back → record) and its typed
// result, also compiled into the bundled desktop server. Measured with
// `npm pack --dry-run`; no stale dist assets.
export const MAX_UNPACKED_BYTES = 6_900_000;
// Raised 530 → 560 (2026-10-26) after investigating a 531-file build: no stale
// dist assets; the growth is new feature modules (dist/spec-quality/,
// dist/pulse/, and the 0.30/0.31 knowledge + throughput modules that follow).
// Raised 580 → 600 (2026-10-27): the design.md modules (dist/design-md/:
// extractor, checker, upkeep gate, build verifier — DESIGNMD-DOC) and the
// design-md skill add 17 files; checked for stale dist files first — none.
// Raised 600 → 640 (2026-11-05, REQ-AGENTSWITCH-016): 622 files on a clean
// build — the Gemini extension adds 17.
export const MAX_FILE_COUNT = 640;

/** REQ-SLIM-002.A4's own ceiling, independent of the ratchet above. */
export const SLIM_A4_UNPACKED_CEILING = 7_000_000;

export interface PackFile {
  path: string;
  size: number;
}

export interface PackManifest {
  entryCount: number;
  size: number;
  unpackedSize: number;
  files: PackFile[];
}

export const repoRoot = path.resolve(__dirname, '..');

/**
 * `npm pack --dry-run --json` for the repo root. Shells out to the packer
 * (a few seconds on a cold cache); writes nothing to disk.
 */
export function readPackManifest(): PackManifest {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(stdout) as PackManifest[];
  return parsed[0]!;
}
