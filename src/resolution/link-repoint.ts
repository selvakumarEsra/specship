/**
 * Re-pointed link wording (REQ-LINKACC-005).
 *
 * When a link's target vanishes and the resolver follows the symbol to a new
 * file or name by its body fingerprint, the link records where it came from in
 * `metadata.repointed`. These helpers are the one place every surface reads
 * that record and words it — the `specship_spec` link line and the sync notice
 * — so they never disagree. Pure: no DB, no fs.
 */

import type { SpecLink } from '../types';
import type { RepointLocation, RepointReport } from './spec-link-resolver';

/** The latest re-point recorded on a link, or `null` when it was never re-pointed. */
export function repointedFrom(
  link: Pick<SpecLink, 'metadata'>
): { from: RepointLocation; to: RepointLocation; at: number } | null {
  const r = link.metadata?.repointed as
    | { from?: Partial<RepointLocation>; to?: Partial<RepointLocation>; at?: unknown }
    | undefined;
  if (!r || typeof r !== 'object') return null;
  const ok = (l: Partial<RepointLocation> | undefined): l is RepointLocation =>
    !!l && typeof l.file === 'string' && typeof l.name === 'string';
  if (!ok(r.from) || !ok(r.to)) return null;
  return { from: r.from, to: r.to, at: typeof r.at === 'number' ? r.at : 0 };
}

/** `"re-pointed from src/a.ts:foo (2026-11-06)"` — the `specship_spec` line. */
export function formatRepointedFrom(link: Pick<SpecLink, 'metadata'>): string | null {
  const r = repointedFrom(link);
  if (!r) return null;
  const date = r.at > 0 ? ` (${new Date(r.at).toISOString().slice(0, 10)})` : '';
  return `re-pointed from ${r.from.file}:${r.from.name}${date}`;
}

/**
 * One sync-output line per re-point. A spec-declared link's line names the
 * spec-file edit (or says why none was made, with the bullet to fix by hand).
 */
export function formatRepointNotices(repoints: readonly RepointReport[]): string[] {
  return repoints.map((r) => {
    const head = `↪ link re-pointed: ${r.specId} ${r.from.file}:${r.from.name} → ${r.to.file}:${r.to.name} (same body)`;
    const edit = r.specFileEdit;
    if (!edit) return head;
    if (edit.status === 'persisted') return `${head} — spec updated: ${edit.detail}`;
    if (edit.status === 'unchanged') return `${head} — spec already lists the new location`;
    const block = r.kind === 'tests' ? 'verifies' : 'implementations';
    return (
      `${head} — ⚠ spec file NOT updated (${edit.detail}); change \`${r.from.file}:${r.from.name}\` to ` +
      `\`${r.to.file}:${r.to.name}\` under \`${block}:\` for ${r.specId}, or a full reindex brings the orphan back`
    );
  });
}
