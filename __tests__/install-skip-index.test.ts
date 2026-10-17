/**
 * REQ-AUDFIX-001 — `specship install --skip-index` must be honored on a
 * project-local install (specs/docs-audit-fixes.md).
 *
 * Drives the real `runInstallerWithOptions` end-to-end in a temp project with
 * HOME redirected, so the assertions are about files on disk (is there a
 * `.specship/` database?) and what the install prints — not about a mock.
 * Only the shimmer progress bar is stubbed: its worker loads a compiled
 * `.js` sibling that doesn't exist when running from `src/`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInstallerWithOptions } from '../src/installer';
import {
  describeInstallDefaults,
  describeInstallChoices,
  describeIndexLaterHint,
  INDEX_LATER_COMMAND,
} from '../src/installer/install-defaults';

vi.mock('../src/ui/shimmer-progress', () => ({
  createShimmerProgress: () => ({ onProgress: () => {}, stop: async () => {} }),
}));

function mkTmpDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cg-skipidx-${label}-`));
}

function setHome(dir: string): { restore: () => void } {
  const keys = ['HOME', 'USERPROFILE', 'APPDATA', 'XDG_CONFIG_HOME'] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  process.env.APPDATA = path.join(dir, '.config');
  process.env.XDG_CONFIG_HOME = path.join(dir, '.config');
  return {
    restore() {
      for (const k of keys) {
        if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
      }
    },
  };
}

describe('REQ-AUDFIX-001 — --skip-index is honored on a project-local install', () => {
  let tmpHome: string;
  let tmpCwd: string;
  let origCwd: string;
  let homeRestore: { restore: () => void };

  beforeEach(() => {
    tmpHome = mkTmpDir('home');
    tmpCwd = mkTmpDir('cwd');
    origCwd = process.cwd();
    process.chdir(tmpCwd);
    homeRestore = setHome(tmpHome);
    // A tiny source file so the default (indexing) path has something to index.
    fs.mkdirSync(path.join(tmpCwd, 'src'));
    fs.writeFileSync(path.join(tmpCwd, 'src', 'hello.ts'), 'export function hello() { return 1; }\n');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    homeRestore.restore();
    process.chdir(origCwd);
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  /** Run a non-interactive local install, capturing everything clack prints. */
  async function runLocalInstall(skipIndex?: boolean) {
    let out = '';
    const capture = (chunk: unknown) => { out += String(chunk); return true; };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture as typeof process.stderr.write);
    const clack = await import('@clack/prompts');
    const outcome = await runInstallerWithOptions(
      { target: 'claude', location: 'local', yes: true, skipIndex },
      { clack },
    );
    vi.restoreAllMocks();
    // clack wraps notes to the terminal width inside a box — strip ANSI, the
    // box rails, and line breaks so assertions read the words, not the layout.
    const text = out
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/[│╮╯╭╰─├┤◇◆●└┌]/g, ' ')
      .replace(/\s+/g, ' ');
    return { outcome, out: text };
  }

  it('REQ-AUDFIX-001.A1: a local install with --skip-index builds no index and creates no .specship/ database', async () => {
    const { outcome } = await runLocalInstall(true);
    expect(outcome?.indexed).toBe(false);
    expect(fs.existsSync(path.join(tmpCwd, '.specship'))).toBe(false);
    // The wiring itself still happened.
    expect(fs.existsSync(path.join(tmpCwd, '.mcp.json'))).toBe(true);
  }, 60_000);

  it('REQ-AUDFIX-001.A2: the summary names the skip as the user\'s choice and the closing hint says how to index later', async () => {
    const { out } = await runLocalInstall(true);
    expect(out).toContain('Your choices');
    expect(out).toContain('your choice (--skip-index)');
    expect(out).not.toContain('this project was indexed');
    expect(out).toContain(`\`${INDEX_LATER_COMMAND}\``);
    // The hint comes after the summary — it closes the run.
    expect(out.lastIndexOf(INDEX_LATER_COMMAND)).toBeGreaterThan(out.indexOf('your choice (--skip-index)'));
  }, 60_000);

  it('REQ-AUDFIX-001.A2: the skip is never listed among the defaults; the choice + hint helpers say so', () => {
    expect(describeInstallDefaults({
      statusLine: 'skipped',
      statusLineDefaulted: false,
      autoAllow: false,
      autoAllowDefaulted: false,
      index: 'skipped',
      indexDefaulted: false,
    })).toEqual([]);
    const choices = describeInstallChoices({ indexSkippedByUser: true }).join('\n');
    expect(choices).toContain('your choice');
    expect(choices).toContain('--skip-index');
    expect(choices).not.toMatch(/default/i);
    expect(describeInstallChoices({ indexSkippedByUser: false })).toEqual([]);
    expect(INDEX_LATER_COMMAND).toBe('specship init');
    expect(describeIndexLaterHint()).toContain('`specship init`');
  });

  it('REQ-AUDFIX-001.A3: a local install without the flag still indexes, unchanged', async () => {
    const { outcome, out } = await runLocalInstall(undefined);
    expect(outcome?.indexed).toBe(true);
    expect(fs.existsSync(path.join(tmpCwd, '.specship'))).toBe(true);
    expect(fs.readdirSync(path.join(tmpCwd, '.specship')).some((f) => f.endsWith('.db'))).toBe(true);
    expect(out).toContain('this project was indexed — skip next time with --skip-index');
    expect(out).not.toContain('Your choices');
    expect(out).not.toContain(`\`${INDEX_LATER_COMMAND}\``);
  }, 120_000);
});
