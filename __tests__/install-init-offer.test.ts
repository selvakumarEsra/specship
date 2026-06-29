/**
 * Install-time "index the current project?" decision (REQ-HANDSHAKE-004).
 *
 * The decision is a pure function of (is-git-repo, is-initialized, --yes,
 * --skip-index); the interactive prompt and the actual indexing are glue around
 * it. Only the decision is unit-tested here.
 */

import { describe, it, expect } from 'vitest';
import { decideInstallInit } from '../src/installer/init-offer';

describe('decideInstallInit (REQ-HANDSHAKE-004)', () => {
  it('skips when the project is already indexed (A3) — no re-index offer', () => {
    expect(decideInstallInit({ isGitRepo: true, isInitialized: true, yes: false, skipIndex: false })).toBe('skip');
    expect(decideInstallInit({ isGitRepo: true, isInitialized: true, yes: true, skipIndex: false })).toBe('skip');
  });

  it('skips when not inside a git repo (A3)', () => {
    expect(decideInstallInit({ isGitRepo: false, isInitialized: false, yes: false, skipIndex: false })).toBe('skip');
  });

  it('offers interactively inside an un-indexed git repo (A1)', () => {
    expect(decideInstallInit({ isGitRepo: true, isInitialized: false, yes: false, skipIndex: false })).toBe('offer');
  });

  it('auto-indexes by default under --yes inside an un-indexed git repo (A4)', () => {
    expect(decideInstallInit({ isGitRepo: true, isInitialized: false, yes: true, skipIndex: false })).toBe('auto-index');
  });

  it('skips under --yes when --skip-index is set (A4 opt-out)', () => {
    expect(decideInstallInit({ isGitRepo: true, isInitialized: false, yes: true, skipIndex: true })).toBe('skip');
  });

  it('--skip-index is an unconditional opt-out, even interactively', () => {
    // An explicit --skip-index means "do not index" regardless of mode, so it
    // never even prompts.
    expect(decideInstallInit({ isGitRepo: true, isInitialized: false, yes: false, skipIndex: true })).toBe('skip');
  });
});
