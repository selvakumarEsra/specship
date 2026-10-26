/**
 * Knowledge proposals store (REQ-KNOW-004 A2–A4).
 *
 * Drives `src/knowledge/proposals.ts` against a temp project: proposals in
 * `.specship/knowledge/proposals/`, confirmed facts in `specs/domain/`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  listProposals,
  applyProposal,
  rejectProposal,
  formatProposalList,
  proposalsDir,
  ProposalRefusedError,
} from '../src/knowledge/proposals';

let root: string;

function writeDomain(name: string, id: string, type = 'term'): void {
  const dir = path.join(root, 'specs', 'domain');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    `---\nid: ${id}\ntitle: ${name}\ntype: ${type}\n---\n\n# ${name}\n\nBody.\n`,
  );
}

function writeProposal(slug: string, frontmatter: string, body = 'A proposed fact.'): string {
  const dir = proposalsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${slug}.md`);
  fs.writeFileSync(p, `---\n${frontmatter}\n---\n\n# ${slug}\n\n${body}\n`);
  return p;
}

function domainFiles(): string[] {
  const dir = path.join(root, 'specs', 'domain');
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-proposals-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function applyMovesProposalWithNextFreeId(): void {
  writeDomain('drift.md', 'DOM-SPECSHIP-001');
  writeDomain('rule.md', 'DOM-SPECSHIP-004', 'rule');
  writeDomain('other.md', 'DOM-BILLING-009');
  // An existing file with the proposal's slug — apply must not overwrite it.
  writeDomain('hook-order.md', 'DOM-SPECSHIP-002');
  const proposalFile = writeProposal(
    'hook-order',
    'id: DOM-<AREA>-NEW\ntitle: Hooks run in registration order\ntype: rule\ndepends_on: REQ-GEMINI-009',
  );

  const listed = listProposals(root);
  expect(listed).toEqual([
    { id: 'hook-order', title: 'Hooks run in registration order', type: 'rule', path: proposalFile },
  ]);
  expect(formatProposalList(listed)).toContain('hook-order');

  const result = applyProposal(root, 'hook-order');
  // Area defaults to the dominant prefix (SPECSHIP); next free = max(004)+1.
  expect(result).toEqual({ id: 'DOM-SPECSHIP-005', path: 'specs/domain/hook-order-2.md' });
  const written = fs.readFileSync(path.join(root, result.path), 'utf-8');
  expect(written).toMatch(/^---\nid: DOM-SPECSHIP-005\n/);
  expect(written).toContain('title: Hooks run in registration order');
  expect(written).not.toContain('DOM-<AREA>-NEW');
  // The pre-existing slug file is untouched.
  expect(fs.readFileSync(path.join(root, 'specs/domain/hook-order.md'), 'utf-8')).toContain(
    'DOM-SPECSHIP-002',
  );
  expect(fs.existsSync(proposalFile)).toBe(false);
  expect(listProposals(root)).toEqual([]);

  // An explicit `area:` wins and is stripped from the written fact.
  writeProposal('invoice', 'area: billing\ntitle: Invoice\ntype: term');
  const billing = applyProposal(root, 'invoice');
  expect(billing).toEqual({ id: 'DOM-BILLING-010', path: 'specs/domain/invoice.md' });
  expect(fs.readFileSync(path.join(root, billing.path), 'utf-8')).not.toMatch(/^area:/m);
}

function rejectDeletesProposal(): void {
  writeDomain('drift.md', 'DOM-SPECSHIP-001');
  const before = domainFiles();
  const proposalFile = writeProposal('noise', 'title: Noise\ntype: term');

  rejectProposal(root, 'noise');

  expect(fs.existsSync(proposalFile)).toBe(false);
  expect(domainFiles()).toEqual(before);
  expect(() => rejectProposal(root, 'noise')).toThrow(/No pending proposal/);
  expect(() => rejectProposal(root, '../escape')).toThrow(/Invalid proposal id/);
}

function invalidProposalIsNotApplied(): void {
  writeDomain('drift.md', 'DOM-SPECSHIP-001');
  const before = domainFiles();
  // An external fact without provenance (no dependency / version / source).
  const proposalFile = writeProposal('gemini-rules', 'title: Gemini uses [[rule]] tables\ntype: external');

  let refused: unknown;
  try {
    applyProposal(root, 'gemini-rules');
  } catch (e) {
    refused = e;
  }
  expect(refused).toBeInstanceOf(ProposalRefusedError);
  const findings = (refused as ProposalRefusedError).findings;
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.every((f) => f.severity === 'error')).toBe(true);
  const text = findings.map((f) => f.message).join('\n');
  for (const field of ['dependency', 'version', 'source']) expect(text).toContain(field);

  expect(fs.existsSync(proposalFile)).toBe(true);
  expect(domainFiles()).toEqual(before);
}

describe('knowledge proposals (REQ-KNOW-004)', () => {
  it('REQ-KNOW-004.A2: apply writes the fact with the next free DOM id and removes the proposal', applyMovesProposalWithNextFreeId);
  it('REQ-KNOW-004.A4: reject deletes the proposal and writes nothing to specs/domain', rejectDeletesProposal);
  it('REQ-KNOW-004.A3: a proposal that fails lint is refused and left in place', invalidProposalIsNotApplied);
});
