/**
 * REQ-MODCTX-005 — the user-visible model-compaction indicator on the status
 * line: shown with the tier name on haiku/sonnet (A1), absent and
 * byte-identical on the full tier (A2), hidden by SPECSHIP_COMPACT=0 (A3),
 * plain text under NO_COLOR (A4), and resolution failure drops the element
 * but never the line (A5).
 *
 * @verifies REQ-MODCTX-005
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { renderSegment, RenderInput } from '../src/statusline/render';
import { buildSegment } from '../src/statusline/index';
import { StatuslineCache } from '../src/statusline/types';

const ANSI = /\[[0-9;]*m/;

function fullCache(over: Partial<StatuslineCache> = {}): StatuslineCache {
  return {
    v: 1,
    initialized: true,
    updatedAt: 1,
    pending: { added: 0, modified: 0, removed: 0 },
    drift: 0,
    backend: 'better-sqlite3',
    degraded: false,
    fileCount: 100,
    nodeCount: 2000,
    lastIndexed: 1,
    ...over,
  };
}

function base(over: Partial<RenderInput> = {}): RenderInput {
  return { cache: fullCache(), marker: null, run: null, noColor: true, ...over };
}

/** stdin JSON with an identified session pointing at `dir`. */
function stdin(dir: string, model: { display_name: string; id: string }): string {
  return JSON.stringify({
    workspace: { current_dir: dir },
    model,
    version: '2.1.0',
  });
}

const HAIKU = { display_name: 'Haiku 4.5', id: 'claude-haiku-4-5-20251001' };
const OPUS = { display_name: 'Opus 4.8', id: 'claude-opus-4-8' };

// --- renderSegment: element wording + omission (A1/A2) ------------------------

describe('compact indicator rendering (REQ-MODCTX-005.A1/A2)', () => {
  it('names Haiku on the haiku tier and Sonnet on the sonnet tier', () => {
    expect(renderSegment(base({ compact: 'haiku' }))).toContain('⛁ optimizing for Haiku');
    expect(renderSegment(base({ compact: 'sonnet' }))).toContain('⛁ optimizing for Sonnet');
  });

  it('omits the element when compact is null/absent, byte-identical to today', () => {
    const withNull = renderSegment(base({ compact: null }));
    const withoutField = renderSegment(base());
    expect(withNull).toBe(withoutField);
    expect(withNull).not.toContain('optimizing for');
  });

  it('asserts optimization, never reduction, in the wording', () => {
    const out = renderSegment(base({ compact: 'haiku' }));
    for (const bad of ['trim', 'truncat', 'reduc', 'compact']) {
      expect(out.toLowerCase()).not.toContain(bad);
    }
  });
});

// --- NO_COLOR (A4) ------------------------------------------------------------

describe('compact indicator NO_COLOR handling (REQ-MODCTX-005.A4)', () => {
  it('emits no ANSI under NO_COLOR but colorizes when color is on', () => {
    const plain = renderSegment(base({ compact: 'haiku', noColor: true }));
    expect(ANSI.test(plain)).toBe(false);
    expect(plain).toContain('⛁ optimizing for Haiku');

    const colored = renderSegment(base({ compact: 'haiku', noColor: false }));
    expect(colored).toContain('⛁ optimizing for Haiku');
    expect(ANSI.test(colored)).toBe(true);
  });
});

// --- buildSegment integration: marker → tier → element (A1/A2/A3/A5) ----------

describe('buildSegment compact indicator (REQ-MODCTX-005.A1/A2/A3/A5)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-compact-'));
    fs.mkdirSync(path.join(dir, '.specship'));
    delete process.env.SPECSHIP_COMPACT;
    delete process.env.SPECSHIP_MODEL;
  });
  afterEach(() => {
    delete process.env.SPECSHIP_COMPACT;
    delete process.env.SPECSHIP_MODEL;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('shows the indicator when the session model maps to haiku (A1)', () => {
    const out = buildSegment(stdin(dir, HAIKU), true);
    expect(out).toContain('⛁ optimizing for Haiku');
  });

  it('shows nothing on a frontier model (A2)', () => {
    const out = buildSegment(stdin(dir, OPUS), true);
    expect(out).not.toContain('optimizing for');
  });

  it('a frontier render after a haiku session clears the indicator (marker updates)', () => {
    buildSegment(stdin(dir, HAIKU), true);
    const out = buildSegment(stdin(dir, OPUS), true);
    expect(out).not.toContain('optimizing for');
  });

  it('hides the indicator under SPECSHIP_COMPACT=0 even on haiku (A3)', () => {
    process.env.SPECSHIP_COMPACT = '0';
    const out = buildSegment(stdin(dir, HAIKU), true);
    expect(out).not.toContain('optimizing for');
  });

  it('honors a SPECSHIP_MODEL override without a marker', () => {
    process.env.SPECSHIP_MODEL = 'claude-haiku-4-5';
    const out = buildSegment(stdin(dir, OPUS), true);
    expect(out).toContain('⛁ optimizing for Haiku');
  });

  it('a corrupt model marker drops the element, never the line (A5)', () => {
    const markerPath = path.join(dir, '.specship', 'session', 'model.json');
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, '{ not json');
    // Opus stdin overwrites the corrupt marker via recordSessionModel, so use
    // empty stdin (no model) to exercise the corrupt-marker read path.
    const out = buildSegment(JSON.stringify({ workspace: { current_dir: dir } }), true);
    expect(out).toContain('specship');
    expect(out).not.toContain('optimizing for');
  });
});
