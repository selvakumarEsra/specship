/**
 * REQ-STATUSLINE-013 — the rotating, dimmed usage-tip line: deterministic
 * time-bucketed rotation (A2), the curated set's size + honesty (A3), placement
 * as the last line below telemetry with the lines above unchanged (A1), the
 * `SPECSHIP_NO_STATUSLINE_TIPS` opt-out (A4), the empty-stdin degraded path (A5),
 * NO_COLOR stripping (A6), and the pure/no-I/O path (A7).
 *
 * @verifies REQ-STATUSLINE-013
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { renderSegment, RenderInput } from '../src/statusline/render';
import { buildSegment } from '../src/statusline/index';
import { StatuslineCache } from '../src/statusline/types';
import { STATUSLINE_TIPS, STATUSLINE_TIP_INTERVAL_MS, selectStatuslineTip } from '../src/statusline/tips';

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

/** stdin JSON with a full identity + working dir (so a header — and thus a tip — renders). */
function stdin(dir: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    workspace: { current_dir: dir },
    model: { display_name: 'Opus 4.8', id: 'claude-opus-4-8' },
    version: '2.1.0',
    ...over,
  });
}

const HEADER = { model: 'Opus 4.8', dir: '~/x', branch: 'main', version: '2.1.0' };

// --- selectStatuslineTip: deterministic time-bucketed rotation (A2) ----------

describe('selectStatuslineTip rotation (REQ-STATUSLINE-013.A2)', () => {
  it('returns the same tip for two now-values in the same interval bucket', () => {
    const t = STATUSLINE_TIP_INTERVAL_MS * 7;
    expect(selectStatuslineTip(t)).toBe(selectStatuslineTip(t + STATUSLINE_TIP_INTERVAL_MS - 1));
  });

  it('advances by one tip each interval and wraps to the first after the last', () => {
    const len = STATUSLINE_TIPS.length;
    const start = STATUSLINE_TIP_INTERVAL_MS * 3;
    const first = selectStatuslineTip(start);
    const startIdx = STATUSLINE_TIPS.indexOf(first);
    for (let k = 1; k <= len; k++) {
      const tip = selectStatuslineTip(start + k * STATUSLINE_TIP_INTERVAL_MS);
      expect(tip).toBe(STATUSLINE_TIPS[(startIdx + k) % len]);
    }
    // a full cycle of `len` intervals returns to the first tip
    expect(selectStatuslineTip(start + len * STATUSLINE_TIP_INTERVAL_MS)).toBe(first);
  });

  it('matches floor(now / interval) mod count exactly', () => {
    const len = STATUSLINE_TIPS.length;
    for (const bucket of [0, 1, 2, len, len + 1, 999]) {
      const now = bucket * STATUSLINE_TIP_INTERVAL_MS + 5;
      expect(selectStatuslineTip(now)).toBe(STATUSLINE_TIPS[bucket % len]);
    }
  });
});

// --- curated set: size + honesty (A3) ----------------------------------------

describe('curated tip set (REQ-STATUSLINE-013.A3)', () => {
  it('contains at least four distinct tips', () => {
    expect(STATUSLINE_TIPS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(STATUSLINE_TIPS).size).toBe(STATUSLINE_TIPS.length);
  });

  it('names no tokens-, cost-, or time-saved figure and no percentage', () => {
    for (const tip of STATUSLINE_TIPS) {
      const lower = tip.toLowerCase();
      expect(lower).not.toMatch(/sav(e|ed|es|ing)/); // "saved", "saving", …
      expect(lower).not.toMatch(/faster|cheaper|fewer tokens/);
      expect(tip).not.toMatch(/%/);
    }
  });

  it('keeps each tip to a single line', () => {
    for (const tip of STATUSLINE_TIPS) expect(tip).not.toContain('\n');
  });
});

// --- placement: last line, below telemetry, lines above unchanged (A1) -------

describe('tip placement (REQ-STATUSLINE-013.A1)', () => {
  it('appends the tip as the final line below telemetry, leaving the lines above byte-for-byte unchanged', () => {
    const withTip = renderSegment(base({ header: HEADER, context: 55, tip: STATUSLINE_TIPS[0] }));
    const noTip = renderSegment(base({ header: HEADER, context: 55 }));

    const lines = withTip.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('Opus 4.8'); // header
    expect(lines[1]).toContain('specship'); // identity
    expect(lines[2]).toContain('CTX'); // telemetry
    expect(lines[3]).toContain(STATUSLINE_TIPS[0]!); // tip, last

    // header + identity + telemetry identical to the no-tip render
    expect(lines.slice(0, 3).join('\n')).toBe(noTip);
  });

  it('renders the tip below the identity line even when there is no telemetry', () => {
    const out = renderSegment(base({ header: HEADER, tip: STATUSLINE_TIPS[1] }));
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('specship');
    expect(lines[2]).toContain(STATUSLINE_TIPS[1]!);
  });
});

// --- opt-out / absence: no tip line, output identical to pre-feature (A4) -----

describe('tip omission (REQ-STATUSLINE-013.A4)', () => {
  it('emits no tip line when tip is null and the output equals the tip-less render', () => {
    const withNull = renderSegment(base({ header: HEADER, context: 55, tip: null }));
    const withoutField = renderSegment(base({ header: HEADER, context: 55 }));
    expect(withNull).toBe(withoutField);
    expect(withNull).not.toContain('💡');
  });
});

describe('buildSegment tip opt-out + degraded path (REQ-STATUSLINE-013.A4/A5)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-tip-'));
    delete process.env.SPECSHIP_NO_STATUSLINE_TIPS;
  });
  afterEach(() => {
    delete process.env.SPECSHIP_NO_STATUSLINE_TIPS;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('renders a tip by default for an identified session', () => {
    const out = buildSegment(stdin(dir), true);
    expect(out).toContain('💡');
    // the rendered tip is one of the curated set
    const tipLine = out.split('\n').pop()!;
    expect(STATUSLINE_TIPS.some((t) => tipLine.includes(t))).toBe(true);
  });

  it('omits the tip when SPECSHIP_NO_STATUSLINE_TIPS is set (A4)', () => {
    const on = buildSegment(stdin(dir), true);
    process.env.SPECSHIP_NO_STATUSLINE_TIPS = '1';
    const off = buildSegment(stdin(dir), true);
    expect(off).not.toContain('💡');
    // dropping the tip removes exactly the last line; the rest is unchanged
    expect(off).toBe(on.split('\n').slice(0, -1).join('\n'));
  });

  it('treats an empty opt-out value as unset (still renders the tip)', () => {
    process.env.SPECSHIP_NO_STATUSLINE_TIPS = '';
    expect(buildSegment(stdin(dir), true)).toContain('💡');
  });

  it('renders no tip for empty or malformed stdin — degraded output stays a single line (A5)', () => {
    // process.cwd() is the repo (has .specship) → a single identity line, no header, no tip.
    expect(buildSegment('', true)).not.toContain('\n');
    expect(buildSegment('', true)).not.toContain('💡');
    expect(buildSegment('{ not valid', true)).not.toContain('💡');
  });
});

// --- NO_COLOR strips the dim styling but keeps the text (A6) ------------------

describe('tip NO_COLOR handling (REQ-STATUSLINE-013.A6)', () => {
  it('emits no ANSI on the tip line under NO_COLOR, but does colorize when color is on', () => {
    const plainTip = renderSegment(base({ tip: STATUSLINE_TIPS[0], noColor: true })).split('\n').pop()!;
    expect(ANSI.test(plainTip)).toBe(false);
    expect(plainTip).toContain(STATUSLINE_TIPS[0]!);

    const coloredTip = renderSegment(base({ tip: STATUSLINE_TIPS[0], noColor: false })).split('\n').pop()!;
    expect(ANSI.test(coloredTip)).toBe(true);
    expect(coloredTip).toContain(STATUSLINE_TIPS[0]!);
  });
});

// --- purity: the tip path opens no DB, spawns nothing, does no network (A7) ---

describe('tip path is pure (REQ-STATUSLINE-013.A7)', () => {
  it('tips.ts imports no child_process, filesystem, network, or sqlite module', () => {
    const src = fs.readFileSync(path.resolve('src/statusline/tips.ts'), 'utf-8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/from ['"]fs['"]|require\(['"]fs['"]\)/);
    expect(src).not.toMatch(/from ['"](net|http|https|dns|tls)['"]/);
    expect(src).not.toMatch(/sqlite/i);
  });
});
