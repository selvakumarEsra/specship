/**
 * Knowledge that compounds (KNOWLEDGE-DOC): external facts, staleness,
 * enforced rules, fixtures. Named test functions are the linkable symbols the
 * spec's `verifies:` blocks point at.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MarkdownSpecExtractor } from '../src/extraction/specs/markdown-spec-extractor';
import { lintSpecSource } from '../src/spec-lint/lint';
import {
  findStaleExternalFacts,
  resolveInstalledVersion,
  formatStaleReport,
  exitCodeForStale,
} from '../src/knowledge/stale';
import {
  parseEnforcedRules,
  checkEnforcedRules,
  formatEnforceReport,
  exitCodeForEnforce,
} from '../src/knowledge/enforce';
import { renderDomainFactsInline } from '../src/mcp/spec-tools';

const tmpDirs: string[] = [];
function tmpProject(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-knowledge-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function externalFact(opts: {
  id?: string;
  dependency?: string;
  version?: string;
  source?: string;
  fixture?: string;
  body?: string;
}): string {
  const fm = [`id: ${opts.id ?? 'DOM-GEMINI-001'}`, 'title: Policy rule tables', 'type: external'];
  if (opts.dependency !== undefined) fm.push(`dependency: ${opts.dependency}`);
  if (opts.version !== undefined) fm.push(`version: ${opts.version}`);
  if (opts.source !== undefined) fm.push(`source: ${opts.source}`);
  if (opts.fixture !== undefined) fm.push(`fixture: ${opts.fixture}`);
  return `---\n${fm.join('\n')}\n---\n\n# Policy rule tables\n\n${opts.body ?? 'Gemini CLI policy files use `[[rule]]` tables.'}\n`;
}

const noGlobal = () => null;

describe('external facts (REQ-KNOW-001)', () => {
  it('REQ-KNOW-001.A1 an external fact with provenance indexes with no warning', function externalFactIndexesWithProvenance() {
    const src = externalFact({
      dependency: '@google/gemini-cli',
      version: '0.28.0',
      source: 'packages/core/src/policy/toml-loader.ts:loadPoliciesFromToml',
    });
    const result = new MarkdownSpecExtractor('specs/domain/gemini-policy.md', src).extract();
    expect(result.errors).toEqual([]);
    expect(result.specs).toHaveLength(1);
    const fact = result.specs[0]!;
    expect(fact.kind).toBe('domain');
    expect(fact.id).toBe('DOM-GEMINI-001');
    expect(fact.metadata).toMatchObject({
      type: 'external',
      dependency: '@google/gemini-cli',
      version: '0.28.0',
      source: 'packages/core/src/policy/toml-loader.ts:loadPoliciesFromToml',
    });
    expect(lintSpecSource('specs/domain/gemini-policy.md', src)).toEqual([]);
  });

  it('REQ-KNOW-001.A2 an external fact missing provenance is a lint error naming the field', function externalFactWithoutProvenanceIsALintError() {
    const src = externalFact({ dependency: '@google/gemini-cli' });
    // Still indexes.
    const result = new MarkdownSpecExtractor('specs/domain/gemini-policy.md', src).extract();
    expect(result.specs).toHaveLength(1);
    const findings = lintSpecSource('specs/domain/gemini-policy.md', src);
    const err = findings.find((f) => f.code === 'spec_external_fact_missing_provenance');
    expect(err?.severity).toBe('error');
    expect(err?.message).toContain('version');
    expect(err?.message).toContain('source');
    expect(err?.message).not.toContain('missing dependency');
    // A non-external fact is not held to provenance.
    const term = '---\nid: DOM-X-001\ntitle: T\ntype: term\n---\n\nA term.\n';
    expect(lintSpecSource('specs/domain/t.md', term)).toEqual([]);
  });
});

describe('external fact staleness (REQ-KNOW-002)', () => {
  it('REQ-KNOW-002.A1 a changed installed version makes the fact stale, exit non-zero', function versionChangeMakesFactStale() {
    const root = tmpProject();
    write(root, 'specs/domain/gemini.md', externalFact({ dependency: '@google/gemini-cli', version: '0.28.0', source: 'x.ts:y' }));
    write(root, 'node_modules/@google/gemini-cli/package.json', JSON.stringify({ version: '0.29.0' }));
    expect(resolveInstalledVersion('@google/gemini-cli', root, { globalRoot: noGlobal })).toBe('0.29.0');
    const result = findStaleExternalFacts(root, { globalRoot: noGlobal });
    expect(result.stale).toEqual([
      { id: 'DOM-GEMINI-001', dependency: '@google/gemini-cli', verified: '0.28.0', installed: '0.29.0', fixtures: [] },
    ]);
    expect(result.fresh).toEqual([]);
    expect(exitCodeForStale(result)).not.toBe(0);
    const report = formatStaleReport(result);
    expect(report).toContain('0.28.0');
    expect(report).toContain('0.29.0');
  });

  it('REQ-KNOW-002.A2 a matching installed version (global root fallback) is fresh', function matchingVersionIsFresh() {
    const root = tmpProject();
    const globalRoot = tmpProject();
    write(root, 'specs/domain/gemini.md', externalFact({ dependency: '@google/gemini-cli', version: '0.28.0', source: 'x.ts:y' }));
    write(globalRoot, '@google/gemini-cli/package.json', JSON.stringify({ version: '0.28.0' }));
    const result = findStaleExternalFacts(root, { globalRoot: () => globalRoot });
    expect(result.stale).toEqual([]);
    expect(result.unverifiable).toEqual([]);
    expect(result.fresh.map((f) => f.id)).toEqual(['DOM-GEMINI-001']);
    expect(exitCodeForStale(result)).toBe(0);
    expect(formatStaleReport(result)).not.toContain('Stale:');
  });

  it('REQ-KNOW-002.A3 a dependency installed nowhere is unverifiable, never fresh', function missingDependencyIsUnverifiable() {
    const root = tmpProject();
    write(root, 'specs/domain/gemini.md', externalFact({ dependency: '@google/gemini-cli', version: '0.28.0', source: 'x.ts:y' }));
    const result = findStaleExternalFacts(root, { globalRoot: noGlobal });
    expect(result.unverifiable).toEqual([{ id: 'DOM-GEMINI-001', dependency: '@google/gemini-cli' }]);
    expect(result.fresh).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(exitCodeForStale(result)).toBe(0);
    expect(formatStaleReport(result)).toContain('Unverifiable');
  });
});

describe('enforced rules (REQ-KNOW-003)', () => {
  const enforcedFact =
    '---\nid: DOM-GEMINI-002\ntitle: Rule tables\ntype: rule\n---\n\n# Rule tables\n\nPolicy uses `[[rule]]`.\n\n## Enforced\n\n- `src/**/*.ts` must not match `/\\[\\[rules\\]\\]/`\n';

  it('REQ-KNOW-003.A1 a violating file is reported with its line, exit non-zero', function enforcedRuleFlagsViolation() {
    const root = tmpProject();
    write(root, 'specs/domain/rules.md', enforcedFact);
    write(root, 'src/gemini/policy.ts', "const a = 1;\nconst toml = '[[rules]]';\n");
    write(root, 'node_modules/x/index.ts', "'[[rules]]'\n"); // skipped dir
    write(root, 'docs/notes.ts', "'[[rules]]'\n"); // outside the glob
    const parsed = parseEnforcedRules(enforcedFact);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]).toMatchObject({ glob: 'src/**/*.ts', pattern: '\\[\\[rules\\]\\]' });
    const result = checkEnforcedRules(root);
    expect(result.rulesChecked).toBe(1);
    expect(result.violations).toEqual([
      expect.objectContaining({ factId: 'DOM-GEMINI-002', file: 'src/gemini/policy.ts', line: 2 }),
    ]);
    expect(exitCodeForEnforce(result)).not.toBe(0);
    expect(formatEnforceReport(result)).toContain('src/gemini/policy.ts:2');
  });

  it('REQ-KNOW-003.A2 a clean tree passes with a clean summary', function enforcedRulePassesCleanTree() {
    const root = tmpProject();
    write(root, 'specs/domain/rules.md', enforcedFact);
    write(root, 'src/gemini/policy.ts', "const toml = '[[rule]]';\n");
    const result = checkEnforcedRules(root);
    expect(result.violations).toEqual([]);
    expect(result.rulesChecked).toBe(1);
    expect(exitCodeForEnforce(result)).toBe(0);
    expect(formatEnforceReport(result)).toMatch(/clean/);
  });

  it('REQ-KNOW-003.A3 a malformed enforced bullet is a lint error', function malformedEnforcedBulletIsALintError() {
    const src =
      '---\nid: DOM-X-002\ntitle: R\ntype: rule\n---\n\n## Enforced\n\n- `src/**/*.ts` must not match `/ok/i`\n- src/**/*.ts should avoid [[rules]]\n- `src/*.ts` must not match `/(unclosed/`\n';
    const findings = lintSpecSource('specs/domain/r.md', src).filter((f) => f.code === 'spec_malformed_enforced_rule');
    expect(findings.map((f) => f.line)).toEqual([10, 11]);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
    const parsed = parseEnforcedRules(src);
    expect(parsed.rules).toHaveLength(1);
    expect(parsed.rules[0]?.flags).toBe('i');
  });
});

describe('fixtures (REQ-KNOW-006)', () => {
  it('REQ-KNOW-006.A1 a stale fact lists its fixture tests', function staleFactListsItsFixtures() {
    const root = tmpProject();
    write(
      root,
      'specs/domain/gemini.md',
      externalFact({
        dependency: 'gemini-cli',
        version: '0.28.0',
        source: 'x.ts:y',
        fixture:
          '__tests__/contracts/gemini-cli.contract.test.ts:geminiPolicyUsesRuleTables, __tests__/contracts/gemini-cli.contract.test.ts:geminiDenyDecisionIsTopLevel',
      })
    );
    write(root, 'node_modules/gemini-cli/package.json', JSON.stringify({ version: '0.29.0' }));
    const result = findStaleExternalFacts(root, { globalRoot: noGlobal });
    expect(result.stale[0]?.fixtures).toEqual([
      '__tests__/contracts/gemini-cli.contract.test.ts:geminiPolicyUsesRuleTables',
      '__tests__/contracts/gemini-cli.contract.test.ts:geminiDenyDecisionIsTopLevel',
    ]);
    const report = formatStaleReport(result);
    expect(report).toContain('geminiPolicyUsesRuleTables');
    expect(report).toContain('geminiDenyDecisionIsTopLevel');
  });
});

/**
 * REQ-KNOW-005.A1 — an external fact linked to a requirement renders inline
 * with its dependency, verified version, a stale marker when stale, and its
 * enforced rules, so the agent never has to rediscover them.
 */
function inlineFactShowsProvenanceAndRules(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-fact-'));
  try {
    fs.mkdirSync(path.join(root, 'node_modules', 'acme-cli'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'acme-cli', 'package.json'), JSON.stringify({ version: '2.0.0' }));
    const now = Date.now();
    const fact = {
      id: 'DOM-X-001',
      kind: 'domain' as const,
      title: 'Acme config tables',
      body: '# Acme config tables\n\nAcme reads [[rule]] tables.\n\n## Enforced\n- `src/**/*.ts` must not match `/\\[\\[rules\\]\\]/`\n',
      format: 'markdown' as const,
      sourcePath: 'specs/domain/acme.md',
      contentHash: '',
      createdAt: now,
      updatedAt: now,
      metadata: { type: 'external', dependency: 'acme-cli', version: '1.0.0', source: 'acme/loader.js' },
    };
    const out = renderDomainFactsInline([fact], root).join('\n');
    expect(out).toContain('### DOM-X-001 — Acme config tables · external');
    expect(out).toContain('acme-cli — verified against 1.0.0; installed 2.0.0 (STALE)');
    expect(out).toContain('re-check it against the installed version');
    expect(out).toContain('source: acme/loader.js');
    expect(out).toContain('Enforced (hard constraints');
    expect(out).toContain('`src/**/*.ts` must not match');
    // Fresh when the installed version matches; no stale warning.
    const fresh = renderDomainFactsInline([{ ...fact, metadata: { ...fact.metadata, version: '2.0.0' } }], root).join('\n');
    expect(fresh).toContain('installed 2.0.0 (fresh)');
    expect(fresh).not.toContain('re-check it');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('knowledge reaches the agent with provenance (REQ-KNOW-005)', () => {
  it('an inline external fact shows provenance, staleness and rules (REQ-KNOW-005.A1)', inlineFactShowsProvenanceAndRules);
});
