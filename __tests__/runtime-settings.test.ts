import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveSetting, projectSettingsPath, installSettingsPath } from '../src/config/runtime-settings';
import { buildSteeringNudge, STEERING_TEXT } from '../src/activation/steering';
import { detectModelTier } from '../src/mcp/model-context';

/**
 * RUNSET-DOC (specs/runtime-settings.md) — SpecShip-owned settings files:
 * env > <repo>/.specship/settings.json > ~/.specship/settings.json.
 */

describe('runtime settings resolution', () => {
  let repo: string;
  let home: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'runset-repo-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'runset-home-'));
    fs.mkdirSync(path.join(repo, '.specship'));
    fs.mkdirSync(path.join(home, '.specship'));
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  const writeProject = (obj: unknown) => fs.writeFileSync(projectSettingsPath(repo), JSON.stringify(obj));
  const writeInstall = (obj: unknown) => fs.writeFileSync(installSettingsPath(home), JSON.stringify(obj));

  it('001.A1: a project-file value applies to that project only', () => {
    writeProject({ SPECSHIP_NO_STEERING: '1' });
    expect(resolveSetting('SPECSHIP_NO_STEERING', repo, {}, home)).toBe('1');
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'runset-other-'));
    expect(resolveSetting('SPECSHIP_NO_STEERING', other, {}, home)).toBeUndefined();
    fs.rmSync(other, { recursive: true, force: true });
  });

  it('001.A2: the project file beats the install file', () => {
    writeInstall({ SPECSHIP_COMPACT: '0' });
    writeProject({ SPECSHIP_COMPACT: '1' });
    expect(resolveSetting('SPECSHIP_COMPACT', repo, {}, home)).toBe('1');
    // Install file alone still applies where the project says nothing.
    expect(resolveSetting('SPECSHIP_COMPACT', null, {}, home)).toBe('0');
  });

  it('001.A3: an explicit env var beats both files', () => {
    writeInstall({ SPECSHIP_MODEL: 'claude-sonnet-4-6' });
    writeProject({ SPECSHIP_MODEL: 'claude-haiku-4-5' });
    expect(resolveSetting('SPECSHIP_MODEL', repo, { SPECSHIP_MODEL: 'claude-fable-5' }, home)).toBe('claude-fable-5');
  });

  it('001.A4: corrupt files and non-SPECSHIP keys resolve as absent, never throw', () => {
    fs.writeFileSync(projectSettingsPath(repo), '{not json');
    writeInstall({ OTHER_KEY: '1', SPECSHIP_NO_STEERING: 7 as unknown as string });
    expect(resolveSetting('SPECSHIP_NO_STEERING', repo, {}, home)).toBeUndefined();
    expect(resolveSetting('OTHER_KEY', repo, {}, home)).toBeUndefined();
  });

  it('002.A1: a repo settings file silences the steering nudge durably', () => {
    expect(buildSteeringNudge(repo, {}, home)).toBe(STEERING_TEXT);
    writeProject({ SPECSHIP_NO_STEERING: '1' });
    expect(buildSteeringNudge(repo, {}, home)).toBeNull();
  });

  it('002.A2+A3: compaction and model tier resolve through the chain', () => {
    writeProject({ SPECSHIP_MODEL: 'claude-haiku-4-5' });
    expect(detectModelTier(repo, {}, home)).toBe('haiku'); // A3: repo forces tier
    writeInstall({ SPECSHIP_COMPACT: '0' });
    writeProject({ SPECSHIP_MODEL: 'claude-haiku-4-5', SPECSHIP_COMPACT: '1' });
    expect(detectModelTier(repo, {}, home)).toBe('haiku'); // project re-enables over install-off
    writeProject({ SPECSHIP_MODEL: 'claude-haiku-4-5', SPECSHIP_COMPACT: '0' });
    expect(detectModelTier(repo, {}, home)).toBe('full'); // project-level kill-switch
  });
});
