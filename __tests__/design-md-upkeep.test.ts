/**
 * design.md upkeep gate (DESIGNMD-DOC, REQ-DESIGNMD-007): a UI change must
 * update its spec's design.md in the same change. Real files in a temp
 * project; the git lookups (changed files, base content) are injected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkDesignUpkeep } from '../src/design-md/upkeep';
import { runDesignExtractCli } from '../src/design-md/check';
import { runPostcheck } from '../src/spec-quality/postcheck';

let root: string;
let baseDesign: string;

function write(rel: string, body: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const SPEC = `---
id: LOGIN-DOC
title: Login
design: specs/login/design.md
---

<!-- id: LOGIN-DOC -->
# Login

<!-- id: REQ-LOGIN-001 -->
## The login form MUST submit credentials

implementations:
  - src/Login.tsx:Login
  - src/api.ts:submit

## Acceptance
<!-- id: REQ-LOGIN-001.A1 -->
- Submitting sends the email and password.
`;

function fillAuthored(content: string): string {
  return content.replace(/<!-- design-md: [^\n]*-->/g, '- Card padding `16px` (`.card`).');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-upkeep-'));
  write('specs/login.md', SPEC);
  write('specs/login/snapshot.html', '<html><head><style>.card { padding: 16px; color: #111827; }</style></head><body><div class="card">Hi</div></body></html>');
  runDesignExtractCli(['specs/login/snapshot.html', '--out', 'specs/login/design.md'], { projectRoot: root, date: '2026-10-27' });
  write('specs/login/design.md', fillAuthored(read('specs/login/design.md')));
  baseDesign = read('specs/login/design.md');
  write('src/Login.tsx', 'export function Login() { return null; }');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const upkeep = (changed: string[], specFile: string | null = null) =>
  checkDesignUpkeep({ projectRoot: root, changed, baseContent: () => baseDesign, specFile });

function addLogEntry(): void {
  write(
    'specs/login/design.md',
    read('specs/login/design.md').replace('## Change log\n', '## Change log\n\n- 2026-10-28: Card gains a hover state (REQ-LOGIN-002).'),
  );
}

describe('design.md upkeep (REQ-DESIGNMD-007)', () => {
  it('fails a governed UI change whose design.md Change log did not change (REQ-DESIGNMD-007.A1)', uiChangeWithoutChangeLogFails);
  function uiChangeWithoutChangeLogFails(): void {
    const { findings, checked } = upkeep(['src/Login.tsx']);
    expect(checked).toEqual(['specs/login/design.md']);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('UI changed (src/Login.tsx)');
    expect(findings[0]!.message).toContain('specs/login/design.md has no new Change log entry');
  }

  it('passes the same change once design.md logs it (REQ-DESIGNMD-007.A2)', uiChangeWithChangeLogPasses);
  function uiChangeWithChangeLogPasses(): void {
    addLogEntry();
    expect(upkeep(['src/Login.tsx', 'specs/login/design.md']).findings).toEqual([]);
  }

  it('counts every UI file while implementing the design-backed spec (REQ-DESIGNMD-007.A3)', ownSpecCountsEveryUiFile);
  function ownSpecCountsEveryUiFile(): void {
    // src/LoginButton.tsx is not in implementations: yet.
    expect(upkeep(['src/LoginButton.tsx']).findings).toEqual([]);
    const own = upkeep(['src/LoginButton.tsx'], 'specs/login.md');
    expect(own.findings[0]!.message).toContain('UI changed (src/LoginButton.tsx)');
  }

  it('fails a touched design.md that no longer passes design check (REQ-DESIGNMD-007.A4)', staleOrVagueDesignMdFails);
  function staleOrVagueDesignMdFails(): void {
    addLogEntry();
    write('specs/login/design.md', read('specs/login/design.md').replace('Card padding `16px`', 'Card padding roughly 16px'));
    write('specs/login/snapshot.html', read('specs/login/snapshot.html').replace('#111827', '#0F172A'));
    const messages = upkeep(['src/Login.tsx']).findings.map((f) => f.message).join('\n');
    expect(messages).toContain('design_vague_wording');
    expect(messages).toContain('design_stale');
    expect(messages).not.toContain('no new Change log entry');
  }

  it('ignores non-UI files, ungoverned UI files and projects without design-backed specs (REQ-DESIGNMD-007.A5)', nonUiOrUngovernedChangesAreIgnored);
  function nonUiOrUngovernedChangesAreIgnored(): void {
    expect(upkeep(['src/api.ts', 'README.md'])).toEqual({ findings: [], checked: [] });
    expect(upkeep(['src/Other.tsx'])).toEqual({ findings: [], checked: [] });
    // Editing the design snapshot under specs/ is not a "UI code" change.
    expect(upkeep(['specs/login/snapshot.html'])).toEqual({ findings: [], checked: [] });
    write('specs/login.md', SPEC.replace('design: specs/login/design.md\n', ''));
    expect(upkeep(['src/Login.tsx'])).toEqual({ findings: [], checked: [] });
  }

  it('runs inside specship postcheck and is reported (REQ-DESIGNMD-007.A6)', postcheckRunsTheDesignGate);
  function postcheckRunsTheDesignGate(): void {
    const opts = {
      projectRoot: root,
      requirementId: 'REQ-LOGIN-001',
      base: 'BASE',
      changedFiles: () => ['src/Login.tsx'],
      baseFile: (_b: string, rel: string) => (rel === 'specs/login/design.md' ? baseDesign : null),
      run: () => ({ code: 0, output: '' }),
    };
    const failing = runPostcheck(opts);
    expect(failing.ok).toBe(false);
    expect(failing.findings.find((f) => f.check === 'design')?.message).toContain('no new Change log entry');
    expect(failing.ran).toContain('design.md upkeep (specs/login/design.md): 1 finding(s)');
    addLogEntry();
    const passing = runPostcheck(opts);
    expect(passing.findings.filter((f) => f.check === 'design')).toEqual([]);
    expect(passing.ran).toContain('design.md upkeep (specs/login/design.md): ok');
  }

  it('the implement workflow and the skill tell UI changes to keep design.md current (REQ-DESIGNMD-007.A6)', implementWorkflowAndSkillSayKeepItCurrent);
  function implementWorkflowAndSkillSayKeepItCurrent(): void {
    const repo = path.resolve(__dirname, '..');
    const workflow = fs.readFileSync(path.join(repo, 'src/workflows/defaults/spec-implement.yaml'), 'utf8');
    expect(workflow).toMatch(/Keep it current \(REQ-DESIGNMD-007\)/);
    expect(workflow).toContain('add a dated Change log line naming $INPUT.SPEC_ID');
    const skill = fs.readFileSync(path.join(repo, 'skills/design-md/SKILL.md'), 'utf8');
    expect(skill).toContain('## When code changes the UI');
    expect(skill).toContain('`specship postcheck` enforces this');
  }
});
