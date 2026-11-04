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
export const MAX_PACKED_BYTES = 2_450_000;
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
export const MAX_UNPACKED_BYTES = 6_400_000;
// Raised 530 → 560 (2026-10-26) after investigating a 531-file build: no stale
// dist assets; the growth is new feature modules (dist/spec-quality/,
// dist/pulse/, and the 0.30/0.31 knowledge + throughput modules that follow).
// Raised 580 → 600 (2026-10-27): the design.md modules (dist/design-md/:
// extractor, checker, upkeep gate, build verifier — DESIGNMD-DOC) and the
// design-md skill add 17 files; checked for stale dist files first — none.
export const MAX_FILE_COUNT = 600;

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
