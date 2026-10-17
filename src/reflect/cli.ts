/**
 * CLI review verbs for learned proposals (REQ-AUDFIX-002).
 *
 *   specship reflect apply <hash> [--yes]   — preview the change; write only with --yes
 *   specship reflect undo <hash>            — reverse an applied proposal
 *   specship reflect dismiss <hash>         — hide a proposal from future sweeps
 *
 * Mirrors the dashboard API's apply/undo/dismiss wiring (server/src/routes/reflect.ts)
 * on the SpecShip instance's `reflect*` methods. `<hash>` may be any unique
 * prefix of a proposal's content hash (≥ MIN_HASH_PREFIX chars); no match or
 * an ambiguous match exits non-zero and writes nothing.
 *
 * Kept free of commander/chalk so it is unit-testable: output goes through an
 * injected sink and the function returns the process exit code.
 */

import type { ApplyOutcome, PreviewResult, Proposal, ProposalState, UndoOutcome } from './types';

/** The proposal review verbs `specship reflect` accepts as its first argument. */
export const REFLECT_VERBS = ['apply', 'undo', 'dismiss'] as const;
export type ReflectVerb = (typeof REFLECT_VERBS)[number];

/** Shortest hash prefix accepted (the listing shows 12 chars). */
export const MIN_HASH_PREFIX = 4;
/** Hash prefix length shown in listings. */
export const DISPLAY_HASH_LEN = 12;

export function isReflectVerb(s: string | undefined): s is ReflectVerb {
  return !!s && (REFLECT_VERBS as readonly string[]).includes(s);
}

/** The subset of the SpecShip instance the verbs drive. */
export interface ReflectVerbTarget {
  reflectList(state?: ProposalState): Proposal[];
  reflectPreview(hash: string): PreviewResult | null;
  reflectApply(hash: string): ApplyOutcome | null;
  reflectUndo(hash: string): UndoOutcome | null;
  reflectDismiss(hash: string): boolean;
  reflectGet(hash: string): Proposal | null;
}

export interface ReflectVerbSink {
  log(msg: string): void;
  error(msg: string): void;
}

export type PrefixResolution =
  | { ok: true; proposal: Proposal }
  | { ok: false; message: string };

/** Resolve a (possibly abbreviated) content hash to exactly one proposal. */
export function resolveProposalPrefix(proposals: Proposal[], rawPrefix: string | undefined): PrefixResolution {
  const prefix = (rawPrefix ?? '').trim().toLowerCase();
  if (!prefix) {
    return { ok: false, message: 'missing proposal hash — run `specship reflect` to list proposals and their hashes' };
  }
  if (prefix.length < MIN_HASH_PREFIX) {
    return { ok: false, message: `hash prefix "${prefix}" is too short — give at least ${MIN_HASH_PREFIX} characters` };
  }
  const exact = proposals.find((p) => p.contentHash.toLowerCase() === prefix);
  if (exact) return { ok: true, proposal: exact };
  const matches = proposals.filter((p) => p.contentHash.toLowerCase().startsWith(prefix));
  if (matches.length === 0) {
    return { ok: false, message: `no proposal matches hash "${prefix}" — run \`specship reflect\` to list proposals` };
  }
  if (matches.length > 1) {
    const shown = matches
      .slice(0, 5)
      .map((p) => `  ${p.contentHash.slice(0, DISPLAY_HASH_LEN)}  ${p.title}`)
      .join('\n');
    return {
      ok: false,
      message: `hash prefix "${prefix}" is ambiguous — it matches ${matches.length} proposals; use more characters:\n${shown}`,
    };
  }
  return { ok: true, proposal: matches[0]! };
}

export interface ReflectVerbOptions {
  /** Confirm the write for `apply` (without it, apply only previews). */
  yes?: boolean;
  json?: boolean;
}

const short = (h: string): string => h.slice(0, DISPLAY_HASH_LEN);

/**
 * Run one review verb. Returns the exit code (0 success, 1 failure). Nothing is
 * written unless the hash resolves to exactly one proposal (and, for apply,
 * `--yes` is given and the preview has no conflict).
 */
export function runReflectVerb(
  cg: ReflectVerbTarget,
  verb: ReflectVerb,
  hashPrefix: string | undefined,
  opts: ReflectVerbOptions,
  out: ReflectVerbSink,
): number {
  const resolved = resolveProposalPrefix(cg.reflectList(), hashPrefix);
  if (!resolved.ok) {
    if (opts.json) out.log(JSON.stringify({ ok: false, error: resolved.message }, null, 2));
    else out.error(resolved.message);
    return 1;
  }
  const p = resolved.proposal;
  const hash = p.contentHash;

  if (verb === 'apply') {
    const preview = cg.reflectPreview(hash);
    if (!preview) {
      out.error(`proposal ${short(hash)} not found`);
      return 1;
    }
    if (!opts.yes || preview.conflict) {
      if (opts.json) {
        out.log(JSON.stringify({ ok: !preview.conflict, applied: false, proposal: p, preview }, null, 2));
      } else {
        out.log(`Proposal ${short(hash)} (${p.state}): ${p.title}`);
        out.log(`Target: ${preview.targetPath}${preview.exists ? '' : ' (new file)'}`);
        out.log('');
        out.log(preview.diff);
        out.log('');
      }
      if (preview.conflict) {
        if (!opts.json) out.error('Cannot apply: a non-SpecShip file already occupies the target path. Nothing was written.');
        return 1;
      }
      if (!opts.json) out.log(`Preview only — nothing written. Re-run with --yes to apply: specship reflect apply ${short(hash)} --yes`);
      return 0;
    }
    const outcome = cg.reflectApply(hash);
    if (outcome === null) {
      out.error(`proposal ${short(hash)} not found`);
      return 1;
    }
    if (outcome === 'conflict') {
      out.error('Cannot apply: a non-SpecShip file already occupies the target path. Nothing was written.');
      return 1;
    }
    if (opts.json) {
      out.log(JSON.stringify({ ok: true, outcome, proposal: cg.reflectGet(hash) }, null, 2));
    } else {
      out.log(
        outcome === 'applied'
          ? `Applied ${short(hash)} → ${preview.targetPath}`
          : `Already in place (${short(hash)} → ${preview.targetPath}); marked applied.`,
      );
      out.log(`Undo with: specship reflect undo ${short(hash)}`);
    }
    return 0;
  }

  if (verb === 'undo') {
    if (p.state !== 'applied') {
      out.error(`proposal ${short(hash)} is ${p.state}, not applied — nothing to undo`);
      return 1;
    }
    const outcome = cg.reflectUndo(hash);
    if (outcome === null) {
      out.error(`proposal ${short(hash)} not found`);
      return 1;
    }
    if (opts.json) out.log(JSON.stringify({ ok: true, outcome, proposal: cg.reflectGet(hash) }, null, 2));
    else out.log(outcome === 'undone' ? `Undid ${short(hash)} (${p.targetPath})` : `Nothing to remove for ${short(hash)}; marked undone.`);
    return 0;
  }

  // dismiss
  if (p.state === 'dismissed') {
    if (opts.json) out.log(JSON.stringify({ ok: true, proposal: p }, null, 2));
    else out.log(`Proposal ${short(hash)} is already dismissed.`);
    return 0;
  }
  if (!cg.reflectDismiss(hash)) {
    out.error(`proposal ${short(hash)} not found`);
    return 1;
  }
  if (opts.json) out.log(JSON.stringify({ ok: true, proposal: cg.reflectGet(hash) }, null, 2));
  else out.log(`Dismissed ${short(hash)} — it won't resurface on future sweeps.`);
  return 0;
}

/** How-to-act footer printed under the proposal listing. */
export const REFLECT_REVIEW_HINT =
  'Preview one with `specship reflect apply <hash>` (add --yes to write), or hide it with `specship reflect dismiss <hash>`.';

/** The sync-time "learned" line (REQ-ALEARN-004 / REQ-AUDFIX-002.A4). */
export function learnedNotice(title: string): string {
  return `🧠 learned: ${title} — review with \`specship reflect\`.`;
}
