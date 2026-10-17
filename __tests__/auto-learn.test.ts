/**
 * Auto-learn lanes (ALEARN-DOC): style-convention + domain-fact proposal
 * lanes on the reflection engine, conventions injection at session start,
 * and the guarded auto-sweep. Same fixture style as reflect-engine.test.ts —
 * real SQLite, temp dirs, no mocks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DatabaseConnection } from '../src/db';
import { SqliteDatabase } from '../src/db/sqlite-adapter';
import {
  mineProposals,
  previewProposal,
  applyProposal,
  undoProposal,
  ReflectContext,
} from '../src/reflect';

let dir: string;
let conn: DatabaseConnection;
let db: SqliteDatabase;
let ctx: ReflectContext;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-alearn-'));
  conn = DatabaseConnection.initialize(path.join(dir, 'test.db'));
  db = conn.getDb();
  fs.mkdirSync(path.join(dir, 'home', '.claude', 'memory'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'proj'), { recursive: true });
  ctx = { projectRoot: path.join(dir, 'proj'), homeDir: path.join(dir, 'home') };
});

afterEach(() => {
  try { conn.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

let promptSeq = 0;
function seedSession(id: string): void {
  db.prepare(`INSERT OR IGNORE INTO claude_projects (path, name, first_seen, last_seen) VALUES (?,?,?,?)`)
    .run(ctx.projectRoot, 'p', 1, 1);
  db.prepare(
    `INSERT OR IGNORE INTO claude_sessions (id, project_path, source_file, started_at, prompt_count) VALUES (?,?,?,?,?)`,
  ).run(id, ctx.projectRoot, 'f.jsonl', 1, 0);
}
function seedPrompt(sessionId: string, text: string): string {
  const id = `pr-${promptSeq++}`;
  db.prepare(`INSERT INTO claude_prompts (id, session_id, text, ts, is_sidechain) VALUES (?,?,?,?,0)`)
    .run(id, sessionId, text, promptSeq);
  return id;
}

// ---- REQ-ALEARN-001: style-convention lane ----

function styleProposals() {
  return mineProposals(db, ctx).filter((p) => p.type === 'style_rule');
}

function minesRecurringStyleCorrectionAcrossSessions(): void {
  seedSession('s1');
  seedSession('s2');
  seedPrompt('s1', "don't use console.log, use our logger");
  seedPrompt('s2', "don't use console.log, use our logger");
  const props = styleProposals();
  expect(props).toHaveLength(1);
  expect(props[0].targetKind).toBe('conventions');
  expect(props[0].targetPath).toContain(path.join('.specship', 'conventions.md'));
  expect(props[0].title.toLowerCase()).toContain('console.log');
  expect(props[0].evidence.sessions.sort()).toEqual(['s1', 's2']);
}

function silentBelowRecurrenceOrWithoutStyleVocab(): void {
  // Same correction but only one session → silence.
  seedSession('s1');
  seedPrompt('s1', "don't use console.log, use our logger");
  expect(styleProposals()).toHaveLength(0);
  // Recurring correction with no style vocabulary → not a style_rule.
  seedSession('s2');
  seedPrompt('s1', 'stop asking me before every command');
  seedPrompt('s2', 'stop asking me before every command');
  expect(styleProposals()).toHaveLength(0);
}

function conventionsApplyIsIdempotentAndUndoRestores(): void {
  seedSession('s1');
  seedSession('s2');
  seedPrompt('s1', 'always use named exports, never default exports');
  seedPrompt('s2', 'always use named exports, never default exports');
  const [p] = styleProposals();
  expect(p).toBeDefined();

  const convPath = p.targetPath;
  // Pre-existing content SpecShip did not write survives apply + undo.
  fs.mkdirSync(path.dirname(convPath), { recursive: true });
  fs.writeFileSync(convPath, '# Conventions\n\nhand-written preamble\n');
  const before = fs.readFileSync(convPath, 'utf-8');

  expect(applyProposal(p, ctx.homeDir)).toBe('applied');
  const applied = fs.readFileSync(convPath, 'utf-8');
  expect(applied).toContain('hand-written preamble');
  expect(applied).toContain('named exports');
  expect(applyProposal(p, ctx.homeDir)).toBe('unchanged');
  expect(undoProposal(p, ctx.homeDir)).toBe('undone');
  expect(fs.readFileSync(convPath, 'utf-8').trim()).toBe(before.trim());
}

function styleLaneNeverTargetsClaudeMd(): void {
  seedSession('s1');
  seedSession('s2');
  seedPrompt('s1', 'prefer snake_case for python functions');
  seedPrompt('s2', 'prefer snake_case for python functions');
  for (const p of styleProposals()) {
    expect(p.targetPath).not.toContain('CLAUDE.md');
    expect(p.targetPath).toContain('.specship');
  }
}

describe('style-convention lane (REQ-ALEARN-001)', () => {
  it('mines a recurring style correction across 2+ sessions (A1)', minesRecurringStyleCorrectionAcrossSessions);
  it('stays silent below the recurrence bar or without style vocabulary (A1)', silentBelowRecurrenceOrWithoutStyleVocab);
  it('apply is idempotent into .specship/conventions.md and undo restores (A2)', conventionsApplyIsIdempotentAndUndoRestores);
  it('never targets CLAUDE.md (A3)', styleLaneNeverTargetsClaudeMd);
});

// ---- REQ-ALEARN-003: domain-fact draft lane ----

function domainProposals() {
  return mineProposals(db, ctx).filter((p) => p.type === 'domain_fact');
}

function minesDomainFactForGapEntityRecurringInPrompts(): void {
  ctx.domainGapEntities = [
    { name: 'PortfolioRebalancer', kind: 'class' },
    { name: 'UnmentionedThing', kind: 'class' },
  ];
  seedSession('s1');
  seedSession('s2');
  seedPrompt('s1', 'the PortfolioRebalancer must never sell below cost basis');
  seedPrompt('s2', 'explain how PortfolioRebalancer handles partial fills');
  const props = domainProposals();
  expect(props).toHaveLength(1);
  const p = props[0];
  expect(p.targetKind).toBe('domain_fact');
  expect(p.targetPath).toContain(path.join('specs', 'domain'));
  // Content is a well-formed domain-fact skeleton (A1).
  const payload = p.payload as { kind: string; content: string };
  expect(payload.content).toContain('id: DOM-');
  expect(payload.content).toContain('type:');
  expect(payload.content).toContain('PortfolioRebalancer');
}

function domainLaneSilentWithoutSeedOrRecurrence(): void {
  // No gap seed supplied → no proposals at all.
  seedSession('s1');
  seedPrompt('s1', 'the PortfolioRebalancer must never sell below cost basis');
  expect(domainProposals()).toHaveLength(0);
  // Seeded but entity mentioned in only one session → silence.
  ctx.domainGapEntities = [{ name: 'PortfolioRebalancer', kind: 'class' }];
  expect(domainProposals()).toHaveLength(0);
}

function domainFactApplyWritesFileUndoRemoves(): void {
  ctx.domainGapEntities = [{ name: 'PortfolioRebalancer', kind: 'class' }];
  seedSession('s1');
  seedSession('s2');
  seedPrompt('s1', 'PortfolioRebalancer rounds lots down');
  seedPrompt('s2', 'PortfolioRebalancer skips halted symbols');
  const [p] = domainProposals();
  expect(p).toBeDefined();

  // Mining/preview never creates the file (A3 — only apply writes).
  previewProposal(p);
  expect(fs.existsSync(p.targetPath)).toBe(false);

  expect(applyProposal(p, ctx.homeDir)).toBe('applied');
  expect(fs.existsSync(p.targetPath)).toBe(true);
  expect(applyProposal(p, ctx.homeDir)).toBe('unchanged');
  expect(undoProposal(p, ctx.homeDir)).toBe('undone');
  expect(fs.existsSync(p.targetPath)).toBe(false);

  // A non-SpecShip file at the path is refused, not clobbered.
  fs.mkdirSync(path.dirname(p.targetPath), { recursive: true });
  fs.writeFileSync(p.targetPath, '# someone else wrote this\n');
  expect(applyProposal(p, ctx.homeDir)).toBe('conflict');
  expect(fs.readFileSync(p.targetPath, 'utf-8')).toContain('someone else');
}

describe('domain-fact draft lane (REQ-ALEARN-003)', () => {
  it('mines a draft for a gap entity recurring across sessions (A1)', minesDomainFactForGapEntityRecurringInPrompts);
  it('stays silent without the gap seed or recurrence (A1)', domainLaneSilentWithoutSeedOrRecurrence);
  it('apply writes specs/domain, undo removes, conflicts refused (A2, A3)', domainFactApplyWritesFileUndoRemoves);
});

// ---- REQ-ALEARN-002: conventions injected at session start ----

import { buildCheatsheetPayload, renderConventionsSection } from '../src/activation/cheatsheet';

function cheatsheetUnchangedWithoutConventions(): void {
  const base = buildCheatsheetPayload({})!.systemMessage;
  expect(buildCheatsheetPayload({}, {})!.systemMessage).toBe(base);
  expect(buildCheatsheetPayload({}, { conventions: null })!.systemMessage).toBe(base);
  expect(buildCheatsheetPayload({}, { conventions: '' })!.systemMessage).toBe(base);
}

function cheatsheetListsConventionRules(): void {
  const file = [
    '<!-- SPECSHIP_LEARNING:abc -->',
    '## Convention: use named exports',
    '',
    'always use named exports, never default exports',
    '<!-- /SPECSHIP_LEARNING:abc -->',
    '',
    '<!-- SPECSHIP_LEARNING:def -->',
    '## Convention: use our logger',
    '',
    "don't use console.log, use our logger",
    '<!-- /SPECSHIP_LEARNING:def -->',
  ].join('\n');
  const msg = buildCheatsheetPayload({}, { conventions: file })!.systemMessage;
  expect(msg).toContain('named exports');
  expect(msg).toContain('logger');
  expect(msg).toContain('Project conventions');
}

function conventionsSectionIsBudgetBounded(): void {
  const blocks: string[] = [];
  for (let i = 0; i < 30; i++) {
    blocks.push(`<!-- SPECSHIP_LEARNING:x${i} -->`, `## Convention rule number ${i}`, '', `rule body ${i}`, `<!-- /SPECSHIP_LEARNING:x${i} -->`);
  }
  const section = renderConventionsSection(blocks.join('\n'), 8);
  const lines = section.split('\n').filter((l) => l.startsWith('•'));
  expect(lines.length).toBeLessThanOrEqual(8);
  expect(section).toContain('more — see .specship/conventions.md');
}

describe('conventions at session start (REQ-ALEARN-002)', () => {
  it('output is byte-identical without conventions (A1)', cheatsheetUnchangedWithoutConventions);
  it('lists each confirmed rule (A1)', cheatsheetListsConventionRules);
  it('is budget-bounded with a +N more pointer (A2)', conventionsSectionIsBudgetBounded);
});

// ---- REQ-ALEARN-004: guarded auto-sweep + awaiting-review line ----

import { shouldAutoSweep, recordAutoSweep, loadReflectConfig } from '../src/reflect/auto-sweep';

function cooldownGatesTheSweep(): void {
  const proj = path.join(dir, 'proj');
  const t0 = 1_000_000_000_000;
  expect(shouldAutoSweep(proj, t0, {})).toBe(true);
  recordAutoSweep(proj, t0);
  // Inside the window → gated (A1).
  expect(shouldAutoSweep(proj, t0 + 60_000, {})).toBe(false);
  // Past the default 6 h window → due again.
  expect(shouldAutoSweep(proj, t0 + 7 * 60 * 60_000, {})).toBe(true);
  // Opt-out wins regardless of time (A1).
  expect(shouldAutoSweep(proj, t0 + 7 * 60 * 60_000, { autoSweep: false })).toBe(false);
}

function reflectConfigReadsProjectFile(): void {
  const proj = path.join(dir, 'proj');
  expect(loadReflectConfig(proj)).toEqual({});
  fs.writeFileSync(path.join(proj, 'specship.config.json'), JSON.stringify({ reflect: { autoSweep: false } }));
  expect(loadReflectConfig(proj)).toEqual({ autoSweep: false });
  fs.writeFileSync(path.join(proj, 'specship.config.json'), '{not json');
  expect(loadReflectConfig(proj)).toEqual({});
}

function cheatsheetShowsOpenProposalCount(): void {
  const base = buildCheatsheetPayload({})!.systemMessage;
  expect(buildCheatsheetPayload({}, { openProposals: 0 })!.systemMessage).toBe(base);
  const withCount = buildCheatsheetPayload({}, { openProposals: 3 })!.systemMessage;
  expect(withCount).toContain('3 learned proposal');
  expect(withCount).toContain('awaiting review');
}

describe('guarded auto-sweep (REQ-ALEARN-004)', () => {
  it('cooldown + opt-out gate the sweep (A1)', cooldownGatesTheSweep);
  it('reflect config loads from specship.config.json', reflectConfigReadsProjectFile);
  it('cheatsheet shows the awaiting-review line only when count > 0 (A2)', cheatsheetShowsOpenProposalCount);
});

// ---- explicit capture verbs (REQ-ALEARN-001 / REQ-ALEARN-003: "Captured") ----

import { capture } from '../src/reflect';

function capturesStyleAndDomainLanes(): void {
  const style = capture(db, ctx, { title: 'no default exports', content: 'Always use named exports.', lane: 'style' });
  expect(style.type).toBe('style_rule');
  expect(style.targetPath).toContain(path.join('.specship', 'conventions.md'));

  const domain = capture(db, ctx, { title: 'Cost basis', content: 'Cost basis is the volume-weighted entry price per lot.', lane: 'domain' });
  expect(domain.type).toBe('domain_fact');
  expect(domain.targetPath).toContain(path.join('specs', 'domain'));
  const payload = domain.payload as { kind: string; content: string };
  expect(payload.content).toContain('id: DOM-');
  expect(payload.content).toContain('Cost basis is the volume-weighted entry price per lot.');

  // Default lane unchanged.
  const skill = capture(db, ctx, { title: 'release flow', content: 'steps…' });
  expect(skill.type).toBe('skill');
}

describe('explicit capture lanes (/specship:learn style|domain)', () => {
  it('stages style_rule and domain_fact proposals on demand', capturesStyleAndDomainLanes);
});
