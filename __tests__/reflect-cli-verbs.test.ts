/**
 * REQ-AUDFIX-002 — learned proposals are appliable, undoable and dismissable
 * from the CLI, and every pointer names a surface that exists.
 *
 * Drives the `specship reflect apply|undo|dismiss` verb runner against a real
 * SpecShip project (real SQLite, temp dir). Proposals are captured on the
 * `style` lane so apply writes project-local `.specship/conventions.md`,
 * never the developer's home directory.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ReflectStore, type Proposal } from '../src/reflect';
import { runReflectVerb, resolveProposalPrefix, learnedNotice, isReflectVerb } from '../src/reflect/cli';
import { buildCheatsheetPayload } from '../src/activation/cheatsheet';
import type { SqliteDatabase } from '../src/db/sqlite-adapter';

const fts5Available = ((): boolean => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE VIRTUAL TABLE t USING fts5(x)');
    db.close();
    return true;
  } catch {
    return false;
  }
})();

type SpecShipT = Awaited<ReturnType<typeof import('../src').default.init>>;

let proj: string;
let cg: SpecShipT;
let logs: string[];
let errors: string[];
const sink = { log: (m: string) => logs.push(m), error: (m: string) => errors.push(m) };

function conventionsPath(): string {
  return path.join(proj, '.specship', 'conventions.md');
}
function rawDb(): SqliteDatabase {
  return (cg as unknown as { db: { getDb(): SqliteDatabase } }).db.getDb();
}
function captureStyle(title: string, content: string): Proposal {
  return cg.reflectCapture({ title, content, lane: 'style' });
}

describe.skipIf(!fts5Available)('REQ-AUDFIX-002 — reflect review verbs', () => {
  beforeEach(async () => {
    const { default: SpecShip } = await import('../src');
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-reflect-cli-'));
    cg = await SpecShip.init(proj);
    logs = [];
    errors = [];
  });

  afterEach(() => {
    try { cg.destroy(); } catch { /* ignore */ }
    try { fs.rmSync(proj, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('REQ-AUDFIX-002.A1: apply previews without --yes and writes only with --yes, marking the proposal applied', () => {
    const p = captureStyle('Use tabs', 'Indent with tabs, never spaces.');
    const prefix = p.contentHash.slice(0, 12);
    const before = fs.existsSync(conventionsPath()) ? fs.readFileSync(conventionsPath(), 'utf-8') : null;

    // Preview only.
    expect(runReflectVerb(cg, 'apply', prefix, {}, sink)).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain(conventionsPath());
    expect(out).toContain('Indent with tabs');
    expect(out).toMatch(/--yes/);
    expect(fs.existsSync(conventionsPath()) ? fs.readFileSync(conventionsPath(), 'utf-8') : null).toBe(before);
    expect(cg.reflectGet(p.contentHash)!.state).toBe('open');

    // Confirmed write.
    logs = [];
    expect(runReflectVerb(cg, 'apply', prefix, { yes: true }, sink)).toBe(0);
    expect(fs.readFileSync(conventionsPath(), 'utf-8')).toContain('Indent with tabs');
    expect(cg.reflectGet(p.contentHash)!.state).toBe('applied');
    expect(errors).toEqual([]);
  });

  it('REQ-AUDFIX-002.A2: undo reverses an applied proposal', () => {
    const p = captureStyle('Use tabs', 'Indent with tabs, never spaces.');
    const prefix = p.contentHash.slice(0, 8);
    expect(runReflectVerb(cg, 'apply', prefix, { yes: true }, sink)).toBe(0);
    expect(fs.readFileSync(conventionsPath(), 'utf-8')).toContain('Indent with tabs');

    expect(runReflectVerb(cg, 'undo', prefix, {}, sink)).toBe(0);
    const after = fs.existsSync(conventionsPath()) ? fs.readFileSync(conventionsPath(), 'utf-8') : '';
    expect(after).not.toContain('Indent with tabs');
    expect(cg.reflectGet(p.contentHash)!.state).toBe('undone');

    // Undoing something that is not applied is refused.
    errors = [];
    expect(runReflectVerb(cg, 'undo', prefix, {}, sink)).toBe(1);
    expect(errors.join('\n')).toMatch(/not applied/);
  });

  it('REQ-AUDFIX-002.A2: dismiss hides a proposal from future sweeps', () => {
    const p = captureStyle('Prefer named exports', 'Never use default exports.');
    expect(runReflectVerb(cg, 'dismiss', p.contentHash.slice(0, 6), {}, sink)).toBe(0);
    expect(cg.reflectGet(p.contentHash)!.state).toBe('dismissed');
    expect(cg.reflectList('open').map((x) => x.contentHash)).not.toContain(p.contentHash);
    // A later sweep must not resurface (notify on) the dismissed proposal.
    const { notify } = cg.reflectSweep();
    expect(notify.map((x) => x.contentHash)).not.toContain(p.contentHash);
    expect(cg.reflectGet(p.contentHash)!.state).toBe('dismissed');
  });

  it('REQ-AUDFIX-002.A3: a prefix matching no proposal exits non-zero, names the problem, writes nothing', () => {
    const p = captureStyle('Use tabs', 'Indent with tabs, never spaces.');
    const missing = p.contentHash.startsWith('ffff') ? '0000' : 'ffff';
    for (const verb of ['apply', 'undo', 'dismiss'] as const) {
      errors = [];
      expect(runReflectVerb(cg, verb, missing, { yes: true }, sink)).toBe(1);
      expect(errors.join('\n')).toMatch(/no proposal matches/);
    }
    expect(fs.existsSync(conventionsPath())).toBe(false);
    expect(cg.reflectGet(p.contentHash)!.state).toBe('open');
  });

  it('REQ-AUDFIX-002.A3: an ambiguous prefix exits non-zero, names the problem, writes nothing', () => {
    const p = captureStyle('Use tabs', 'Indent with tabs, never spaces.');
    // Two persisted proposals that share the prefix "abcd".
    const twins = ['abcd1111', 'abcd2222'].map((h) => ({ ...p, contentHash: h + p.contentHash.slice(8) }));
    new ReflectStore(rawDb()).upsertMined(twins);
    for (const verb of ['apply', 'undo', 'dismiss'] as const) {
      errors = [];
      expect(runReflectVerb(cg, verb, 'abcd', { yes: true }, sink)).toBe(1);
      expect(errors.join('\n')).toMatch(/ambiguous/);
    }
    expect(fs.existsSync(conventionsPath())).toBe(false);
    for (const t of twins) expect(cg.reflectGet(t.contentHash)!.state).toBe('open');

    // A longer, unique prefix resolves.
    expect(runReflectVerb(cg, 'dismiss', 'abcd1', {}, sink)).toBe(0);
    expect(cg.reflectGet(twins[0]!.contentHash)!.state).toBe('dismissed');
  });
});

describe('REQ-AUDFIX-002 — prefix resolution + pointers (no DB)', () => {
  const mk = (h: string): Proposal => ({ contentHash: h, title: h } as unknown as Proposal);

  it('REQ-AUDFIX-002.A3: rejects empty, too-short, unknown and ambiguous prefixes', () => {
    const list = [mk('abcd1111'), mk('abcd2222'), mk('ef012345')];
    expect(resolveProposalPrefix(list, undefined).ok).toBe(false);
    const short = resolveProposalPrefix(list, 'ab');
    expect(short.ok === false && short.message).toMatch(/too short/);
    const none = resolveProposalPrefix(list, '9999');
    expect(none.ok === false && none.message).toMatch(/no proposal matches/);
    const amb = resolveProposalPrefix(list, 'ABCD');
    expect(amb.ok === false && amb.message).toMatch(/ambiguous.*2 proposals/);
    const one = resolveProposalPrefix(list, 'ef01');
    expect(one.ok && one.proposal.contentHash).toBe('ef012345');
  });

  it('REQ-AUDFIX-002.A1: only apply/undo/dismiss are treated as verbs (a path stays a path)', () => {
    expect(isReflectVerb('apply')).toBe(true);
    expect(isReflectVerb('undo')).toBe(true);
    expect(isReflectVerb('dismiss')).toBe(true);
    expect(isReflectVerb('/some/path')).toBe(false);
    expect(isReflectVerb(undefined)).toBe(false);
  });

  it('REQ-AUDFIX-002.A4: the sync learned line and the cheatsheet line point at `specship reflect`, not a dashboard page', () => {
    const line = learnedNotice('Use tabs');
    expect(line).toContain('`specship reflect`');
    expect(line).not.toMatch(/dashboard|Improvements/i);

    const msg = buildCheatsheetPayload({}, { openProposals: 2 })!.systemMessage;
    const proposalLine = msg.split('\n').find((l) => l.includes('learned proposal'))!;
    expect(proposalLine).toContain('`specship reflect`');
    expect(proposalLine).not.toMatch(/dashboard|Improvements/i);

    // The sync command renders its learned line through learnedNotice, not an
    // inline string that could drift back to "or the dashboard".
    const bin = fs.readFileSync(path.join(__dirname, '..', 'src', 'bin', 'specship.ts'), 'utf-8');
    expect(bin).toContain('learnedNotice(p.title)');
    expect(bin).not.toMatch(/learned:[^\n]*dashboard/);
  });
});
