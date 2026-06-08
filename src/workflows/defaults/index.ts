/**
 * Bundled default workflows.
 *
 * Workflow YAMLs are stored as `.yaml` files in this directory and
 * compile-time embedded by reading them at build time. We don't use a
 * code-generator (matches the rest of the codebase that avoids generated
 * files); instead, the build's `copy-assets` script copies the .yaml
 * files into `dist/workflows/defaults/`, and this module reads them at
 * import time from `__dirname`.
 *
 * Bundled workflows (v1):
 *   - spec-implement.yaml   — implement an unimplemented spec
 *   - spec-fix.yaml         — fix a drifted / broken link
 *   - spec-verify.yaml      — run verification across `implemented` links
 *   - spec-relink.yaml      — re-attach an orphaned link
 *
 * See workflow-discovery.ts for the three-tier precedence model.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface BundledWorkflow {
  /** Filename stem (no .yaml extension). */
  name: string;
  /** Raw YAML source. */
  yaml: string;
}

/**
 * Lazy-loaded bundled defaults from `<dist|src>/workflows/defaults/*.yaml`.
 * Populated on first read. Always re-reads from disk in tests where the
 * file set may have been mutated; production callers call once at startup.
 */
let cached: BundledWorkflow[] | null = null;

export const bundledDefaults: BundledWorkflow[] = loadDefaults();

function loadDefaults(): BundledWorkflow[] {
  if (cached) return cached;
  const out: BundledWorkflow[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(__dirname, { withFileTypes: true });
  } catch {
    cached = [];
    return cached;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.yaml') && !lower.endsWith('.yml')) continue;
    try {
      const yaml = fs.readFileSync(path.join(__dirname, entry.name), 'utf-8');
      const stem = entry.name.replace(/\.(ya?ml)$/i, '');
      out.push({ name: stem, yaml });
    } catch {
      // Skip unreadable files; discovery will surface the gap on next load.
    }
  }
  cached = out;
  return cached;
}
