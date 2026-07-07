/**
 * REQ-STATUSLINE-012 — the context header line (model · directory · branch ·
 * version) and its stacking above the identity/telemetry lines (REQ-STATUSLINE-010).
 *
 * The branch is derived from `.git/HEAD` with no subprocess (REQ-STATUSLINE-002),
 * so these tests hand-author `.git/HEAD` in throwaway dirs rather than shelling
 * out to git — which also proves the reader is a pure file read.
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

/** stdin JSON with a full identity + working dir. */
function stdin(dir: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    workspace: { current_dir: dir },
    model: { display_name: 'Opus 4.8', id: 'claude-opus-4-8' },
    version: '2.1.0',
    ...over,
  });
}

// --- renderSegment: pure header rendering ------------------------------------

describe('renderSegment header (REQ-STATUSLINE-012)', () => {
  it('renders model, dir, branch, and version on the first line, above identity (A1)', () => {
    const out = renderSegment(
      base({ header: { model: 'Opus 4.8', dir: '~/dev/specship', branch: 'main', version: '2.1.0' } }),
    );
    const lines = out.split('\n');
    expect(lines[0]).toContain('Opus 4.8');
    expect(lines[0]).toContain('~/dev/specship');
    expect(lines[0]).toContain('main');
    expect(lines[0]).toContain('v2.1.0');
    // identity line stacks directly below the header
    expect(lines[1]).toContain('specship');
  });

  it('omits each element individually when absent, with no dangling separator (A4)', () => {
    const out = renderSegment(base({ header: { model: 'Opus 4.8', dir: null, branch: null, version: null } }));
    const header = out.split('\n')[0];
    expect(header).toContain('Opus 4.8');
    expect(header).not.toContain('◆'); // single element ⇒ no separator at all
    expect(header).toBe('◈ Opus 4.8 ◈');
  });

  it('renders no header line when header is null (A5 / degraded path)', () => {
    const out = renderSegment(base({ header: null }));
    expect(out).not.toContain('\n');
    expect(out).toContain('specship');
  });

  it('renders no header line when the header has no populated element', () => {
    const out = renderSegment(base({ header: { model: null, dir: null, branch: null, version: null } }));
    expect(out).not.toContain('\n');
  });

  it('emits no ANSI in the header under NO_COLOR, but does colorize when color is on (A6)', () => {
    const h = { model: 'Opus 4.8', dir: '~/x', branch: 'main', version: '2.1.0' };
    const plain = renderSegment(base({ header: h, noColor: true })).split('\n')[0];
    expect(ANSI.test(plain)).toBe(false);
    const colored = renderSegment(base({ header: h, noColor: false })).split('\n')[0];
    expect(ANSI.test(colored)).toBe(true);
  });
});

// --- stacking order + newline discipline (REQ-STATUSLINE-010) ----------------

describe('line stacking (REQ-STATUSLINE-010)', () => {
  const header = { model: 'Opus 4.8', dir: '~/x', branch: 'main', version: '2.1.0' };

  it('header + identity + telemetry ⇒ exactly two newlines, in order (A1/A3)', () => {
    const out = renderSegment(base({ header, context: 55 }));
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Opus 4.8'); // header
    expect(lines[1]).toContain('specship'); // identity
    expect(lines[2]).toContain('CTX'); // telemetry
  });

  it('header + identity (no telemetry) ⇒ exactly one newline', () => {
    const out = renderSegment(base({ header }));
    expect(out.split('\n')).toHaveLength(2);
  });

  it('identity only (no header, no telemetry) ⇒ single line (A2)', () => {
    const out = renderSegment(base({ header: null }));
    expect(out).not.toContain('\n');
  });
});

// --- buildSegment integration: real stdin + real .git/HEAD -------------------

describe('buildSegment header integration (REQ-STATUSLINE-012)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-hdr-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeHead(content: string): void {
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), content);
  }

  it('shows model + version + working dir from stdin (A1)', () => {
    const out = buildSegment(stdin(dir), true);
    const header = out.split('\n')[0];
    expect(header).toContain('Opus 4.8');
    expect(header).toContain('v2.1.0');
    expect(header).toContain(dir); // tmp dir is not under $HOME → shown as-is
  });

  it('reads the branch from .git/HEAD without spawning git (A2/A3)', () => {
    writeHead('ref: refs/heads/feature-x\n');
    const header = buildSegment(stdin(dir), true).split('\n')[0];
    expect(header).toContain('feature-x');
  });

  it('shows a short SHA for a detached HEAD (A2)', () => {
    writeHead('0123456789abcdef0123456789abcdef01234567\n');
    const header = buildSegment(stdin(dir), true).split('\n')[0];
    expect(header).toContain('0123456');
    expect(header).not.toContain('0123456789abcdef'); // truncated, not the full sha
  });

  it('follows a linked-worktree .git pointer file (A2/A3)', () => {
    const realGitDir = path.join(dir, 'real-gitdir');
    fs.mkdirSync(realGitDir, { recursive: true });
    fs.writeFileSync(path.join(realGitDir, 'HEAD'), 'ref: refs/heads/wt-branch\n');
    fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${realGitDir}\n`);
    const header = buildSegment(stdin(dir), true).split('\n')[0];
    expect(header).toContain('wt-branch');
  });

  it('omits the branch element for a non-git directory (A2/A4)', () => {
    const header = buildSegment(stdin(dir), true).split('\n')[0];
    expect(header).toContain('Opus 4.8'); // header still renders
    expect(header).not.toContain('⎇'); // no branch marker without a repo
  });

  it('abbreviates a working directory under $HOME to ~ (A1)', () => {
    const home = os.homedir();
    const underHome = fs.mkdtempSync(path.join(home, '.ss-hdr-home-'));
    try {
      const header = buildSegment(stdin(underHome), true).split('\n')[0];
      expect(header).toContain('~' + path.sep);
      expect(header).not.toContain(home + path.sep + path.basename(underHome)); // not the raw absolute path
    } finally {
      fs.rmSync(underHome, { recursive: true, force: true });
    }
  });

  it('renders no header for empty or malformed stdin (A5)', () => {
    // process.cwd() is the repo (has .specship) → a single identity line, no header.
    expect(buildSegment('', true)).not.toContain('\n');
    expect(buildSegment('{ not valid', true)).not.toContain('\n');
  });

  it('emits no ANSI in the header under NO_COLOR (A6)', () => {
    writeHead('ref: refs/heads/main\n');
    const header = buildSegment(stdin(dir), true).split('\n')[0];
    expect(ANSI.test(header)).toBe(false);
  });

  it('renders the header even outside a SpecShip project (idle identity)', () => {
    // no .specship in `dir` → idle identity, but the header still renders.
    const out = buildSegment(stdin(dir), true);
    const lines = out.split('\n');
    expect(lines[0]).toContain('Opus 4.8');
    expect(lines[1]).toContain('idle');
  });
});

// --- REQ-STATUSLINE-002.A3: the header path spawns no child process ----------

describe('header derivation is spawn-free (REQ-STATUSLINE-002.A3)', () => {
  it('the statusline reader source imports no child_process (any subprocess needs it)', () => {
    // A real subprocess spawn (spawn/spawnSync/exec/execSync/execFile/fork) can
    // only come from Node's child_process module, so its absence proves the
    // header/branch path shells out to nothing. (Scanning for bare `exec(` would
    // false-match RegExp.prototype.exec, which this path legitimately uses.)
    for (const f of ['index.ts', 'render.ts']) {
      const src = fs.readFileSync(path.resolve('src/statusline', f), 'utf-8');
      expect(src).not.toMatch(/child_process/);
    }
  });
});
