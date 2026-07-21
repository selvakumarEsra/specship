/**
 * REQ-MODCTX-001.A6 — seeding the model marker from the SessionStart hook
 * payload: closes the first-prompt blind spot (no assistant turn to
 * tail-read, no status-line render yet). A payload with `model` + an
 * initialized `cwd` records the marker; absent model, unparseable JSON, or
 * an uninitialized cwd record nothing; nothing ever throws.
 *
 * @verifies REQ-MODCTX-001.A6
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { recordModelFromSessionStart, ModelMarker, detectModelTier } from '../src/mcp/model-context';
import { modelMarkerPath, readJsonSafe } from '../src/statusline/paths';

describe('recordModelFromSessionStart (REQ-MODCTX-001.A6)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-seed-'));
    // Initialized project = .specship/ WITH specship.db (findNearestSpecShipRoot's bar).
    fs.mkdirSync(path.join(dir, '.specship'));
    fs.writeFileSync(path.join(dir, '.specship', 'specship.db'), '');
    delete process.env.SPECSHIP_MODEL;
    delete process.env.SPECSHIP_COMPACT;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const marker = () => readJsonSafe<ModelMarker>(modelMarkerPath(dir));

  it('records the marker from a payload with model + initialized cwd', () => {
    recordModelFromSessionStart(JSON.stringify({ model: 'claude-haiku-4-5', cwd: dir }));
    expect(marker()?.model).toBe('claude-haiku-4-5');
    // and the MCP server resolves the tier from it — first prompt is covered
    expect(detectModelTier(dir)).toBe('haiku');
  });

  it('resolves cwd from a subdirectory of the project', () => {
    const sub = path.join(dir, 'src', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    recordModelFromSessionStart(JSON.stringify({ model: 'claude-sonnet-5', cwd: sub }));
    expect(marker()?.model).toBe('claude-sonnet-5');
  });

  it('tolerates an object-shaped model field with an id', () => {
    recordModelFromSessionStart(JSON.stringify({ model: { id: 'claude-haiku-4-5' }, cwd: dir }));
    expect(marker()?.model).toBe('claude-haiku-4-5');
  });

  it('records nothing when model is absent (e.g. after /clear)', () => {
    recordModelFromSessionStart(JSON.stringify({ source: 'clear', cwd: dir }));
    expect(marker()).toBeNull();
  });

  it('records nothing for unparseable stdin, without throwing', () => {
    expect(() => recordModelFromSessionStart('{ not json')).not.toThrow();
    expect(() => recordModelFromSessionStart('')).not.toThrow();
    expect(marker()).toBeNull();
  });

  it('records nothing when cwd is outside any initialized project', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-seed-bare-'));
    try {
      recordModelFromSessionStart(JSON.stringify({ model: 'claude-haiku-4-5', cwd: bare }));
      expect(readJsonSafe<ModelMarker>(modelMarkerPath(bare))).toBeNull();
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('a .specship folder without specship.db does not count as initialized', () => {
    const half = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-seed-half-'));
    fs.mkdirSync(path.join(half, '.specship'));
    try {
      recordModelFromSessionStart(JSON.stringify({ model: 'claude-haiku-4-5', cwd: half }));
      expect(readJsonSafe<ModelMarker>(modelMarkerPath(half))).toBeNull();
    } finally {
      fs.rmSync(half, { recursive: true, force: true });
    }
  });
});
