/**
 * Usage-limit sub-segment — REQ-STATUSLINE-008.
 *
 * Primary source: Claude Code's status-line stdin `rate_limits` (Pro/Max), which
 * carries per-window `used_percentage` and `resets_at` (Unix epoch seconds). An
 * external file (`$SPECSHIP_USAGE_FILE`) is an optional override. SpecShip shows
 * the percentage USED, and omits any window whose data isn't real — never an
 * estimate.
 *
 * Timezone is pinned to Asia/Singapore so the local-time reset assertions are
 * deterministic regardless of the host's zone.
 */

process.env.TZ = 'Asia/Singapore';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readUsageLimits, usageFromStatuslineInput } from '../src/statusline/usage-limits';
import { renderSegment } from '../src/statusline/render';

// Asia/Singapore is UTC+8, so 08:00Z == 16:00 (4pm) local, 06:00Z == 14:00 (2pm) local.
const NOW = Date.parse('2026-06-30T03:00:00Z'); // 2026-06-30 11:00 SGT
const FRESH = '2026-06-30T02:55:00Z'; // 5 min before NOW
const SESSION_RESET = '2026-06-30T08:00:00Z'; // same local day -> 4pm
const WEEKLY_RESET = '2026-07-06T06:00:00Z'; // other local day -> 7/6, 2pm

const ESC = String.fromCharCode(27); // start of any ANSI sequence

function completeFile(updatedAt = FRESH): string {
  return JSON.stringify({
    updatedAt,
    session: { pctUsed: 58, resetAt: SESSION_RESET },
    weekly: { pctUsed: 27, resetAt: WEEKLY_RESET },
  });
}

describe('REQ-STATUSLINE-008 — readUsageLimits (optional override file)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-usage-'));
    file = path.join(dir, 'usage-limits.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('parses a present, fresh, complete file into validated percent-used (A1)', () => {
    fs.writeFileSync(file, completeFile());
    const u = readUsageLimits({ file, now: NOW });
    expect(u).not.toBeNull();
    expect(u!.session!.pctUsed).toBe(58);
    expect(u!.weekly!.pctUsed).toBe(27);
    expect(u!.session!.resetAt).toBe(Date.parse(SESSION_RESET));
  });

  it('returns null when the file is absent (A4)', () => {
    expect(readUsageLimits({ file, now: NOW })).toBeNull();
  });

  it('returns null when the file is stale beyond the freshness window (A5)', () => {
    fs.writeFileSync(file, completeFile('2026-06-30T02:30:00Z')); // 30 min before NOW
    expect(readUsageLimits({ file, now: NOW })).toBeNull();
  });

  it('returns null on unparseable JSON (A5)', () => {
    fs.writeFileSync(file, '{ not json');
    expect(readUsageLimits({ file, now: NOW })).toBeNull();
  });

  it('returns null when a required window is missing (A5)', () => {
    fs.writeFileSync(file, JSON.stringify({ updatedAt: FRESH, session: { pctUsed: 58, resetAt: SESSION_RESET } }));
    expect(readUsageLimits({ file, now: NOW })).toBeNull();
  });

  it('returns null when a percentage is out of range (A5)', () => {
    fs.writeFileSync(file, JSON.stringify({
      updatedAt: FRESH,
      session: { pctUsed: 142, resetAt: SESSION_RESET },
      weekly: { pctUsed: 27, resetAt: WEEKLY_RESET },
    }));
    expect(readUsageLimits({ file, now: NOW })).toBeNull();
  });
});

describe('REQ-STATUSLINE-008 — usageFromStatuslineInput (Claude stdin rate_limits)', () => {
  const fiveHourReset = Date.parse(SESSION_RESET) / 1000; // epoch SECONDS
  const weeklyReset = Date.parse(WEEKLY_RESET) / 1000;

  function input(rate_limits: unknown): string {
    return JSON.stringify({ workspace: { current_dir: '/x' }, rate_limits });
  }

  it('uses used_percentage directly and maps resets_at (epoch s) to ms', () => {
    const u = usageFromStatuslineInput(input({
      five_hour: { used_percentage: 58, resets_at: fiveHourReset },
      seven_day: { used_percentage: 27, resets_at: weeklyReset },
    }));
    expect(u).not.toBeNull();
    expect(u!.session!.pctUsed).toBe(58);
    expect(u!.weekly!.pctUsed).toBe(27);
    expect(u!.session!.resetAt).toBe(Date.parse(SESSION_RESET)); // seconds -> ms
  });

  it('allows a window to be independently absent', () => {
    const u = usageFromStatuslineInput(input({ five_hour: { used_percentage: 58, resets_at: fiveHourReset } }));
    expect(u).not.toBeNull();
    expect(u!.session).not.toBeNull();
    expect(u!.weekly).toBeNull();
  });

  it('returns null when rate_limits is absent (non-Pro/Max or pre-first-response)', () => {
    expect(usageFromStatuslineInput(JSON.stringify({ workspace: { current_dir: '/x' } }))).toBeNull();
  });

  it('returns null on unparseable input', () => {
    expect(usageFromStatuslineInput('{ not json')).toBeNull();
  });
});

describe('REQ-STATUSLINE-008 — renderSegment usage sub-segment', () => {
  const usage = {
    session: { pctUsed: 58, resetAt: Date.parse(SESSION_RESET) },
    weekly: { pctUsed: 27, resetAt: Date.parse(WEEKLY_RESET) },
  };

  it('renders both windows with percent used and local reset times (A1/A2)', () => {
    const line = renderSegment({ cache: null, marker: null, run: null, usage, now: NOW, noColor: true });
    expect(line).toContain('5h');
    expect(line).toContain('58%');
    expect(line).toContain('(4pm)'); // same local day -> time only
    expect(line).toContain('7d');
    expect(line).toContain('27%');
    expect(line).toContain('(7/6, 2pm)'); // other local day -> date + time
    expect(line).toMatch(/[❮▰▱❯]/); // art-deco bar glyphs
  });

  it('omits the sub-segment entirely when usage is absent (A4)', () => {
    const line = renderSegment({ cache: null, marker: null, run: null, noColor: true });
    expect(line).not.toContain('5h');
    expect(line).not.toContain('%');
  });

  it('renders only the windows that are present', () => {
    const line = renderSegment({
      cache: null, marker: null, run: null,
      usage: { session: { pctUsed: 58, resetAt: Date.parse(SESSION_RESET) }, weekly: null },
      now: NOW, noColor: true,
    });
    expect(line).toContain('5h');
    expect(line).not.toContain('7d');
  });

  it('emits no ANSI escapes for the sub-segment under NO_COLOR (A7)', () => {
    const line = renderSegment({ cache: null, marker: null, run: null, usage, now: NOW, noColor: true });
    expect(line).not.toContain(ESC);
  });
});
