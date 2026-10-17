import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-ESM script module shared with the generator CLI.
import { BLOCKS, currentBlock, cliCommandsBlock } from '../scripts/generate-reference-docs.mjs';
import * as os from 'os';

/**
 * DOCS-DRIFT-DOC (specs/docs-drift-gating.md) — reference docs are generated,
 * never hand-maintained:
 *
 *   001.A1/002.A1 — every committed generated block byte-matches a fresh
 *   generation from source; changing the CLI/tools/env-vars/languages without
 *   regenerating fails here.
 *   001.A2 — generated blocks carry the do-not-edit marker.
 *   003 — a site page declaring `spec:` frontmatter must reference a spec id
 *   that exists under specs/.
 */

const ROOT = path.join(__dirname, '..');

describe('generated reference docs stay in sync with source (REQ-DOCSD-001/002)', () => {
  for (const b of BLOCKS as Array<{ id: string; file: string; render: (root: string) => string }>) {
    it(`block "${b.id}" in ${b.file} matches a fresh generation`, () => {
      const content = fs.readFileSync(path.join(ROOT, b.file), 'utf-8');
      const committed = currentBlock(content, b.id);
      expect(committed, `markers for "${b.id}" missing from ${b.file}`).not.toBeNull();
      expect(
        committed,
        `stale generated block "${b.id}" — run: node scripts/generate-reference-docs.mjs`
      ).toBe(b.render(ROOT));
      // A2: the marker itself carries the do-not-edit warning.
      expect(content).toContain(`GENERATED:${b.id} START — derived from source`);
    });
  }
});

describe('narrative pages with spec frontmatter reference real specs (REQ-DOCSD-003)', () => {
  it('every `spec:` frontmatter id exists under specs/', () => {
    const specIds = new Set<string>();
    const collect = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collect(p);
        else if (e.name.endsWith('.md')) {
          for (const m of fs.readFileSync(p, 'utf-8').matchAll(/<!--\s*id:\s*([^\s]+)\s*-->/g)) {
            specIds.add(m[1]);
          }
        }
      }
    };
    collect(path.join(ROOT, 'specs'));

    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(md|mdx)$/.test(e.name)) {
          const src = fs.readFileSync(p, 'utf-8');
          const fm = src.match(/^---\n([\s\S]*?)\n---/);
          const spec = fm?.[1].match(/^spec:\s*([^\s#]+)/m)?.[1];
          if (spec && !specIds.has(spec)) offenders.push(`${p}: spec "${spec}" not found`);
        }
      }
    };
    walk(path.join(ROOT, 'site', 'src', 'content', 'docs'));
    expect(offenders).toEqual([]);
  });
});

describe('CLI reference lists every user-facing command (REQ-AUDFIX-008)', () => {
  const FIXTURE = [
    "const memory = program",
    "  .command('memory')",
    "  .description('Manage memory rules');",
    "memory",
    "  .command('edit <id>')",
    '  .description("Replace a memory rule\'s body with \\"new\\" content.")',
    "  .action(() => {});",
    "program",
    "  .command('maintainability [path]')",
    "  .alias('maint')",
    "  .description('Report maintainability signals')",
    "  .action(() => {});",
    "const jira = program",
    "  .command(\"jira\")",
    "  .description('JIRA integration');",
    "jira",
    "  .command('transition <key> [state]')",
    "  .description(",
    "    'Transition a JIRA issue to <state>, or list it\\'s transitions.',",
    "  )",
    "  .action(() => {});",
    "program",
    "  .command('hook-session-start')",
    "  .description(\"Internal hook: SessionStart\")",
    "  .action(() => {});",
    "program",
    "  .command('hook-other')",
    "  .alias('ho')",
    "  .description(",
    "    'Internal hook: other',",
    "  )",
    "  .action(() => {});",
  ].join('\n');

  function renderFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-ref-'));
    try {
      fs.mkdirSync(path.join(root, 'src', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'bin', 'specship.ts'), FIXTURE);
      return cliCommandsBlock(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it('REQ-AUDFIX-008.A1: alias-before-description, double-quoted and own-line descriptions are all captured', () => {
    const out = renderFixture();
    expect(out).toContain('| `specship maintainability [path]` | Report maintainability signals |');
    expect(out).toContain('| `specship memory edit <id>` | Replace a memory rule\'s body with "new" content. |');
    expect(out).toContain("| `specship jira transition <key> [state]` | Transition a JIRA issue to <state>, or list it's transitions. |");
    expect(out).toContain('| `specship jira` | JIRA integration |');
  });

  it('REQ-AUDFIX-008.A1: the real CLI source yields maintainability, memory edit and jira transition', () => {
    const out = cliCommandsBlock(ROOT);
    expect(out).toMatch(/\| `specship maintainability \[path\]` \|/);
    expect(out).toMatch(/\| `specship memory edit <id>` \|/);
    expect(out).toMatch(/\| `specship jira transition <key> \[state\]` \|/);
  });

  it('REQ-AUDFIX-008.A2: internal hook commands stay excluded in every registration shape', () => {
    const out = renderFixture();
    expect(out).not.toContain('Internal hook');
    expect(out).not.toContain('hook-session-start');
    expect(out).not.toContain('hook-other');
    expect(cliCommandsBlock(ROOT)).not.toContain('Internal hook');
  });
});
