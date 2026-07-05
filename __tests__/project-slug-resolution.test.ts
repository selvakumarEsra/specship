import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  encodeProjectSlug,
  createSlugResolver,
  resolveProjectSlug,
} from '../server/src/ingest/project-paths';
import { ProjectRegistry } from '../server/src/project-registry';
import { enumerate } from '../server/src/routes/projects';

/**
 * REQ-SLUGRES-001..003 (specs/project-slug-resolution.md).
 *
 * Claude Code's slug encoding is lossy (every non-alphanumeric char → '-'),
 * so the naive '-'→'/' decode mangles any path containing hyphens. The
 * resolver recovers real paths from ~/.claude.json and transcript cwd lines.
 */

let tmp: string;
let claudeJsonPath: string;
let claudeRoot: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slugres-'));
  claudeJsonPath = path.join(tmp, '.claude.json');
  claudeRoot = path.join(tmp, 'projects');
  fs.mkdirSync(claudeRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('encodeProjectSlug', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(encodeProjectSlug('/Users/a/dev/claude-projects/x')).toBe('-Users-a-dev-claude-projects-x');
    expect(encodeProjectSlug('/Users/a/dev/trading_skills')).toBe('-Users-a-dev-trading-skills');
    expect(encodeProjectSlug('/Users/a/.specship/worktrees/w1')).toBe('-Users-a--specship-worktrees-w1');
  });
});

describe('resolveProjectSlug', () => {
  it('A1: resolves a hyphenated real path via the ~/.claude.json projects map', () => {
    const real = '/Users/a/dev/claude-projects/x';
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: { [real]: {} } }));
    const slug = encodeProjectSlug(real);
    expect(resolveProjectSlug(slug, { claudeJsonPath, claudeRoot })).toBe(real);
  });

  it('A2: falls back to transcript cwd sniffing when claude.json misses the slug', () => {
    const real = '/Users/b/dev/my-hyphen-proj';
    const slug = encodeProjectSlug(real);
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: {} }));
    const slugDir = path.join(claudeRoot, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'summary', summary: 'no cwd here' }),
      JSON.stringify({ type: 'user', cwd: real, message: { role: 'user' } }),
    ].join('\n');
    fs.writeFileSync(path.join(slugDir, 'session1.jsonl'), lines);
    expect(resolveProjectSlug(slug, { claudeJsonPath, claudeRoot })).toBe(real);
  });

  it('A2b: accepts an ancestor of the transcript cwd when the cwd is a subdirectory', () => {
    const real = '/Users/b/dev/my-hyphen-proj';
    const slug = encodeProjectSlug(real);
    fs.writeFileSync(claudeJsonPath, JSON.stringify({}));
    const slugDir = path.join(claudeRoot, slug);
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(
      path.join(slugDir, 's.jsonl'),
      JSON.stringify({ cwd: `${real}/server` }) + '\n',
    );
    expect(resolveProjectSlug(slug, { claudeJsonPath, claudeRoot })).toBe(real);
  });

  it('A3: falls back to the legacy lossy decode when neither source resolves', () => {
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: {} }));
    expect(resolveProjectSlug('-Users-a-foo', { claudeJsonPath, claudeRoot })).toBe('/Users/a/foo');
    expect(resolveProjectSlug('not-a-path-slug', { claudeJsonPath, claudeRoot })).toBe('not-a-path-slug');
  });

  it('A4: a missing or malformed ~/.claude.json degrades without throwing', () => {
    // Missing file entirely.
    expect(resolveProjectSlug('-Users-a-foo', { claudeJsonPath, claudeRoot })).toBe('/Users/a/foo');
    // Malformed JSON.
    fs.writeFileSync(claudeJsonPath, '{not json');
    expect(resolveProjectSlug('-Users-a-foo', { claudeJsonPath, claudeRoot })).toBe('/Users/a/foo');
  });

  it('refreshes the claude.json reverse index when the file changes', async () => {
    const real = '/Users/c/dev/claude-projects/y';
    const slug = encodeProjectSlug(real);
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: {} }));
    const resolve = createSlugResolver({ claudeJsonPath, claudeRoot });
    expect(resolve(slug)).toBe('/Users/c/dev/claude/projects/y'); // lossy fallback

    // mtime granularity can be 1s on some filesystems — force a distinct mtime.
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: { [real]: {} } }));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(claudeJsonPath, future, future);
    expect(resolve(slug)).toBe(real);
  });
});

describe('ProjectRegistry.getBySlug (REQ-SLUGRES-003)', () => {
  it('opens the resolver-provided real path, not the lossy decode', async () => {
    const real = '/Users/a/dev/claude-projects/x';
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: { [real]: {} } }));
    const opened: string[] = [];
    const registry = new ProjectRegistry(
      {
        openImpl: async (p: string) => {
          opened.push(p);
          return { close(): void { /* noop */ } } as never;
        },
        resolveSlug: createSlugResolver({ claudeJsonPath, claudeRoot }),
      },
      async () => { throw new Error('default open must not be used'); },
    );
    await registry.getBySlug(encodeProjectSlug(real));
    expect(opened).toEqual([real]);
  });
});

describe('projects enumerate (REQ-SLUGRES-002)', () => {
  it('A1: reports real path + exists/initialized for a hyphenated project', async () => {
    // Real project dir lives inside tmp and contains .specship/.
    const real = path.join(tmp, 'dev', 'claude-projects', 'x');
    fs.mkdirSync(path.join(real, '.specship'), { recursive: true });
    fs.writeFileSync(claudeJsonPath, JSON.stringify({ projects: { [real]: {} } }));
    const slug = encodeProjectSlug(real);
    fs.mkdirSync(path.join(claudeRoot, slug), { recursive: true });
    fs.writeFileSync(path.join(claudeRoot, slug, 's.jsonl'), '{}\n');

    const list = await enumerate(claudeRoot, { claudeJsonPath, claudeRoot });
    const entry = list.find((p) => p.slug === slug);
    expect(entry).toBeDefined();
    expect(entry!.path).toBe(real);
    expect(entry!.exists).toBe(true);
    expect(entry!.initialized).toBe(true);
  });
});
