/**
 * Parse-error-region warning helpers (REQ-HTMLLEX-003). Kept dependency-light
 * so the CLI can import them without loading the extraction pipeline.
 */

import type { ExtractionError } from '../types';

/**
 * Number of distinct files carrying a `parse_error_region` warning — the
 * index/sync summary count for REQ-HTMLLEX-003.
 */
export function countParseWarningFiles(errors: readonly ExtractionError[]): number {
  const files = new Set<string>();
  for (const e of errors) {
    if (e.code === 'parse_error_region' && e.filePath) files.add(e.filePath);
  }
  return files.size;
}

/**
 * Completion-summary line for `specship index` / `specship sync`
 * (REQ-HTMLLEX-003.A3); `null` when no file carried a parse-error warning.
 */
export function formatParseWarningSummary(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return `${count} file${count === 1 ? '' : 's'} had parse-error regions — some declarations may be missing`;
}
