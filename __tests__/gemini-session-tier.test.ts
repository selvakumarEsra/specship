import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readGeminiSessionModel,
  geminiSettingsPaths,
  isGeminiHost,
  __resetGeminiCache,
} from '../src/mcp/gemini-session';
import { detectModelTier, modelTier, compactToolResult } from '../src/mcp/model-context';
import { modelMarkerPath } from '../src/statusline/paths';

/**
 * LOWEND-DOC (specs/low-end-model-tier.md) — REQ-LOWEND-001: a Gemini CLI
 * session must resolve a model tier in-server, from Gemini CLI's own config
 * surface, with `SPECSHIP_MODEL` as the single documented override and
 * `full` whenever nothing is detectable.
 *
 * The Gemini leg is HOST-GATED on `SPECSHIP_HOST=gemini` (stamped into the
 * `mcpServers.specship` entry by the Gemini installer target): a Claude Code
 * session in a repo that happens to contain `.gemini/settings.json` must
 * never be compacted by it. `GH` below is that gate.
 *
 * Every case passes an explicit `homedir` (a tmp dir) so a real
 * `~/.gemini/settings.json` on the dev machine can never leak into an
 * assertion.
 */

/** The Gemini-host env marker the installer writes into the MCP entry. */
const GH = { SPECSHIP_HOST: 'gemini' };

/** A non-compacting sample: full tier must return it byte-identically. */
const SAMPLE = '## Exploration\n\n\n\n> notice\n\n```ts\n1\tconst a = 1;\n```\n';

describe('readGeminiSessionModel (REQ-LOWEND-001)', () => {
  let cwd: string;
  let home: string;
  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gemsess-'));
    cwd = path.join(base, 'workspace');
    home = path.join(base, 'home');
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    __resetGeminiCache();
  });
  afterEach(() => {
    fs.rmSync(path.dirname(cwd), { recursive: true, force: true });
    __resetGeminiCache();
  });

  function writeSettings(root: string, body: unknown | string): string {
    const dir = path.join(root, '.gemini');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'settings.json');
    fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
    return p;
  }

  it('lists the project settings file before the global one', () => {
    expect(geminiSettingsPaths(cwd, home)).toEqual([
      path.join(cwd, '.gemini', 'settings.json'),
      path.join(home, '.gemini', 'settings.json'),
    ]);
  });

  it('isGeminiHost only accepts the exact installer-stamped marker', () => {
    expect(isGeminiHost(GH)).toBe(true);
    expect(isGeminiHost({})).toBe(false);
    expect(isGeminiHost({ SPECSHIP_HOST: 'claude' })).toBe(false);
  });

  /** @verifies REQ-LOWEND-001.A1 */
  function projectSettingsFlashResolvesLiteWithNoClaudeChannel(): void {
    writeSettings(cwd, { model: 'gemini-3.5-flash' });
    // No Claude Code marker, transcript, or hook seed anywhere.
    expect(fs.existsSync(modelMarkerPath(cwd))).toBe(false);
    expect(readGeminiSessionModel(cwd, GH, home)).toBe('gemini-3.5-flash');
    expect(detectModelTier(cwd, GH, home)).toBe('lite');
  }
  it('A1: a flash model in project settings resolves the lite tier', projectSettingsFlashResolvesLiteWithNoClaudeChannel);

  /**
   * The crossover guard (adversarial-review finding): the same settings file
   * WITHOUT the Gemini host marker — i.e. a Claude Code session in a repo
   * that also uses Gemini CLI — must stay full-tier. @verifies REQ-LOWEND-001.A3
   */
  function noHostMarkerMeansNoGeminiLeg(): void {
    writeSettings(cwd, { model: 'gemini-3.5-flash' });
    expect(readGeminiSessionModel(cwd, {}, home)).toBeNull();
    expect(detectModelTier(cwd, {}, home)).toBe('full');
    expect(compactToolResult(SAMPLE, detectModelTier(cwd, {}, home))).toBe(SAMPLE);
    // GEMINI_MODEL exported in a non-Gemini host is not a signal either.
    expect(readGeminiSessionModel(cwd, { GEMINI_MODEL: 'gemini-3.5-flash' }, home)).toBeNull();
    expect(detectModelTier(cwd, { GEMINI_MODEL: 'gemini-3.5-flash' }, home)).toBe('full');
  }
  it('A3: without SPECSHIP_HOST=gemini the Gemini leg never fires (no Claude crossover)', noHostMarkerMeansNoGeminiLeg);

  /** @verifies REQ-LOWEND-001.A1 */
  function objectModelShapeIsAccepted(): void {
    writeSettings(cwd, { model: { name: 'gemini-3.5-flash-lite' } });
    expect(readGeminiSessionModel(cwd, GH, home)).toBe('gemini-3.5-flash-lite');
    expect(detectModelTier(cwd, GH, home)).toBe('lite');
  }
  it('A1: accepts the `model: { name }` settings shape too', objectModelShapeIsAccepted);

  /** @verifies REQ-LOWEND-001.A1 */
  function geminiModelEnvWins(): void {
    writeSettings(cwd, { model: 'gemini-3.5-pro' });
    expect(readGeminiSessionModel(cwd, { ...GH, GEMINI_MODEL: 'gemini-3.5-flash' }, home)).toBe(
      'gemini-3.5-flash'
    );
    expect(detectModelTier(cwd, { ...GH, GEMINI_MODEL: 'gemini-3.5-flash' }, home)).toBe('lite');
    // A blank env value is not a signal — fall through to the files.
    expect(readGeminiSessionModel(cwd, { ...GH, GEMINI_MODEL: '  ' }, home)).toBe('gemini-3.5-pro');
  }
  it("A1: Gemini CLI's own GEMINI_MODEL env wins over the settings files", geminiModelEnvWins);

  /** @verifies REQ-LOWEND-001.A1 */
  function projectSettingsBeatGlobal(): void {
    writeSettings(home, { model: 'gemini-3.5-pro' });
    expect(detectModelTier(cwd, GH, home)).toBe('full'); // global-only: pro
    writeSettings(cwd, { model: 'gemini-3.5-flash' });
    __resetGeminiCache();
    expect(readGeminiSessionModel(cwd, GH, home)).toBe('gemini-3.5-flash');
  }
  it('A1: project settings take precedence over global settings', projectSettingsBeatGlobal);

  /** @verifies REQ-LOWEND-001.A2 */
  function specshipModelOverrideWinsBothWays(): void {
    // …to full even when auto-detection finds a flash model.
    writeSettings(cwd, { model: 'gemini-3.5-flash' });
    expect(detectModelTier(cwd, { ...GH, SPECSHIP_MODEL: 'full' }, home)).toBe('full');
    expect(
      compactToolResult(SAMPLE, detectModelTier(cwd, { ...GH, SPECSHIP_MODEL: 'full' }, home))
    ).toBe(SAMPLE);
    // …and to lite even when auto-detection finds nothing.
    fs.rmSync(path.join(cwd, '.gemini'), { recursive: true, force: true });
    __resetGeminiCache();
    expect(detectModelTier(cwd, GH, home)).toBe('full');
    expect(detectModelTier(cwd, { ...GH, SPECSHIP_MODEL: 'lite' }, home)).toBe('lite');
    // A model id still works as an override value — with or without the host.
    expect(detectModelTier(cwd, { SPECSHIP_MODEL: 'gemini-3.5-flash' }, home)).toBe('lite');
  }
  it('A2: SPECSHIP_MODEL names a tier or an id and beats auto-detection', specshipModelOverrideWinsBothWays);

  /** @verifies REQ-LOWEND-001.A3 */
  function nothingDetectedIsByteIdenticalFullOutput(): void {
    expect(detectModelTier(cwd, GH, home)).toBe('full');
    expect(compactToolResult(SAMPLE, detectModelTier(cwd, GH, home))).toBe(SAMPLE);
  }
  it('A3: no override + nothing detectable → untouched full-tier output', nothingDetectedIsByteIdenticalFullOutput);

  /** @verifies REQ-LOWEND-001.A4 */
  function malformedOrUnreadableSourcesDegradeSilently(): void {
    writeSettings(cwd, '{ this is not json');
    expect(readGeminiSessionModel(cwd, GH, home)).toBeNull();
    expect(detectModelTier(cwd, GH, home)).toBe('full');

    // Non-string model values are not ids.
    for (const body of [{ model: 42 }, { model: null }, { model: {} }, { model: { name: 7 } }, {}, []]) {
      __resetGeminiCache();
      writeSettings(cwd, body);
      expect(readGeminiSessionModel(cwd, GH, home)).toBeNull();
      expect(detectModelTier(cwd, GH, home)).toBe('full');
    }

    // A directory where the settings file should be.
    __resetGeminiCache();
    fs.rmSync(path.join(cwd, '.gemini'), { recursive: true, force: true });
    fs.mkdirSync(path.join(cwd, '.gemini', 'settings.json'), { recursive: true });
    expect(readGeminiSessionModel(cwd, GH, home)).toBeNull();
    expect(detectModelTier(cwd, GH, home)).toBe('full');

    // A missing workspace entirely.
    expect(readGeminiSessionModel(path.join(cwd, 'nope'), GH, home)).toBeNull();
  }
  it('A4: malformed / unreadable sources never throw and degrade to full', malformedOrUnreadableSourcesDegradeSilently);

  it('caches per file and invalidates when the file changes', () => {
    const p = writeSettings(cwd, { model: 'gemini-3.5-pro' });
    expect(readGeminiSessionModel(cwd, GH, home)).toBe('gemini-3.5-pro');
    // Same bytes, cached: the parse result is reused.
    expect(readGeminiSessionModel(cwd, GH, home)).toBe('gemini-3.5-pro');
    // A changed file (different size and mtime) is re-parsed without a reset.
    fs.writeFileSync(p, JSON.stringify({ model: 'gemini-3.5-flash-latest' }));
    expect(readGeminiSessionModel(cwd, GH, home)).toBe('gemini-3.5-flash-latest');
    expect(modelTier(readGeminiSessionModel(cwd, GH, home))).toBe('lite');
  });
});

describe('modelTier accepts tier names (REQ-LOWEND-001.A2)', () => {
  it('maps bare tier names to themselves, case-insensitively', () => {
    expect(modelTier('lite')).toBe('lite');
    expect(modelTier('standard')).toBe('standard');
    expect(modelTier('full')).toBe('full');
    expect(modelTier('LITE')).toBe('lite');
  });

  it('leaves the model-id mapping and the unknown→full rule intact', () => {
    expect(modelTier('claude-haiku-4-5')).toBe('lite');
    expect(modelTier('Sonnet 4.6')).toBe('standard');
    expect(modelTier('gemini-3.5-flash')).toBe('lite');
    expect(modelTier('lite-model-we-never-heard-of')).toBe('full');
  });
});
