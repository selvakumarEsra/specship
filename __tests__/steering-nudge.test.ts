import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSteeringNudge, STEERING_TEXT } from '../src/activation/steering';

/**
 * STEER-HOOK-DOC (specs/retrieval-steering-hook.md) — the steer-nudge hook
 * command's decision logic: emit the one steering line only where it can
 * help (REQ-STEER-002).
 */

describe('buildSteeringNudge (REQ-STEER-002)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'steer-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('A1: emits nothing in a directory without .specship/', () => {
    expect(buildSteeringNudge(dir, {})).toBeNull();
  });

  it('emits the steering line in an initialized project', () => {
    fs.mkdirSync(path.join(dir, '.specship'));
    expect(buildSteeringNudge(dir, {})).toBe(STEERING_TEXT);
    expect(STEERING_TEXT).toContain('specship_explore');
    // Broadened wording (REQ-STEER-001, 2026-07-13): covers all code work,
    // not just flow questions, and keeps the explore-first ordering.
    expect(STEERING_TEXT).toContain('FIRST');
    expect(STEERING_TEXT).toMatch(/implementing, fixing/);
  });

  it('A2: emits nothing with SPECSHIP_NO_STEERING=1 even when initialized', () => {
    fs.mkdirSync(path.join(dir, '.specship'));
    expect(buildSteeringNudge(dir, { SPECSHIP_NO_STEERING: '1' })).toBeNull();
  });

  it('a .specship FILE (not dir) does not trigger steering', () => {
    fs.writeFileSync(path.join(dir, '.specship'), 'not a dir');
    expect(buildSteeringNudge(dir, {})).toBeNull();
  });
});
