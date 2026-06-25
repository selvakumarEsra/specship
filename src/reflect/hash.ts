/**
 * Stable content hashing for proposals (REQ-REFLECT-007.A1).
 *
 * The hash is computed over the *identity* of a proposal — its type, target,
 * and intended payload — and deliberately EXCLUDES evidence (which session ids
 * contributed) and timestamps, both of which vary run to run. Two reflection
 * passes over the same underlying pattern therefore produce the same hash, so
 * the store converges to a single row rather than duplicating.
 */

import { createHash } from 'crypto';
import { ProposalPayload, ProposalType, TargetKind } from './types';

/** Canonical JSON: object keys sorted recursively so key order can't perturb the hash. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

/**
 * Derive the stable content hash for a proposal's identity.
 */
export function proposalHash(parts: {
  type: ProposalType;
  targetKind: TargetKind;
  targetPath: string;
  payload: ProposalPayload;
}): string {
  const sig = canonical({
    type: parts.type,
    targetKind: parts.targetKind,
    targetPath: parts.targetPath,
    payload: parts.payload,
  });
  return createHash('sha256').update(sig).digest('hex').slice(0, 16);
}
