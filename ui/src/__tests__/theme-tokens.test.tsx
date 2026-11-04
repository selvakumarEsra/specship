/**
 * REQ-DASHTHEME-001 — the dashboard's colours, spacing, radii and type scale
 * come from the BookMyGame UI tokens (specs/dashboard-theme-bmg.md).
 *
 * The snapshot (`specs/dashboard-theme-bmg/snapshot/_ds_bundle.css`) is the
 * reference; tokens.css is the ONLY file in ui/src that may hold a raw
 * colour literal. The sources are read through node:fs (not `?raw`) for the
 * reason given in node-builtins.d.ts, and parsed with a small local
 * custom-property parser so the ui module never imports from the engine's src/.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { STATE, StatePill } from '../components/ui';
import { ADOPTED_BMG_TOKENS } from '../tokens';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(SRC, '..', '..');
const SNAPSHOT_CSS = readFileSync(join(REPO, 'specs', 'dashboard-theme-bmg', 'snapshot', '_ds_bundle.css'), 'utf8');
const TOKENS_CSS = readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8');

/** The single token definition file — the only place colour literals may live (A3). */
const TOKEN_FILE = 'styles/tokens.css';

function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Every `--name: value;` custom-property definition → name → trimmed value. */
function parseCustomProps(css: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of stripBlockComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** ui/src files (repo-relative to ui/src), excluding tests and the token file. */
function walk(dir: string, rel = ''): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (statSync(abs).isDirectory()) {
      if (r === '__tests__') continue;
      files.push(...walk(abs, r));
    } else if (/\.(tsx?|css)$/.test(name) && r !== TOKEN_FILE) {
      files.push(r);
    }
  }
  return files;
}

const SNAPSHOT = parseCustomProps(SNAPSHOT_CSS);
const TOKENS = parseCustomProps(TOKENS_CSS);

afterEach(cleanup);

describe('REQ-DASHTHEME-001 — dashboard tokens come from BookMyGame UI', () => {
  it('REQ-DASHTHEME-001.A1: every adopted colour, spacing and radius token has the snapshot value', function reqDashtheme001A1() {
    const entries = Object.entries(ADOPTED_BMG_TOKENS);
    // The adoption covers every family the criterion names.
    for (const family of ['--bmg-color-', '--bmg-space-', '--bmg-radius-']) {
      expect(entries.some(([, src]) => src.startsWith(family)), family).toBe(true);
    }
    for (const [dash, src] of entries) {
      // Wiring: the dashboard token points at its BMG source…
      expect(TOKENS.get(dash), dash).toBe(`var(${src})`);
      // …and that source exists in the snapshot with the identical value.
      expect(SNAPSHOT.has(src), `${src} missing from the snapshot`).toBe(true);
      expect(TOKENS.get(src), src).toBe(SNAPSHOT.get(src));
    }
    // No --bmg-* value in tokens.css drifts from (or is absent in) the snapshot.
    for (const [name, value] of TOKENS) {
      if (name.startsWith('--bmg-')) expect(value, name).toBe(SNAPSHOT.get(name));
    }
  });

  it('REQ-DASHTHEME-001.A2: verified, pending and drifted resolve to accent, warning and danger', function reqDashtheme001A2() {
    expect(STATE.verified!.color).toBe('var(--accent)');
    expect(STATE.pending!.color).toBe('var(--warning)');
    expect(STATE.drifted!.color).toBe('var(--danger)');
    // The rest of the spec-state table.
    expect(STATE.completed!.color).toBe('var(--accent)');
    expect(STATE.broken!.color).toBe('var(--danger)');
    expect(STATE.orphaned!.color).toBe('var(--danger)');
    expect(STATE.info!.color).toBe('var(--info)');
    // Those semantic tokens resolve to the BookMyGame status colours.
    expect(TOKENS.get('--accent')).toBe('var(--bmg-color-accent)');
    expect(TOKENS.get('--warning')).toBe('var(--bmg-color-warning)');
    expect(TOKENS.get('--danger')).toBe('var(--bmg-color-danger)');
    expect(TOKENS.get('--info')).toBe('var(--bmg-color-info)');
    // And the rendered pill carries them.
    for (const [state, color] of [['verified', 'var(--accent)'], ['pending', 'var(--warning)'], ['drifted', 'var(--danger)']] as const) {
      const { container } = render(<StatePill state={state} />);
      expect((container.querySelector('.pill') as HTMLElement).style.color, state).toBe(color);
      cleanup();
    }
  });

  it('REQ-DASHTHEME-001.A3: ui/src outside tokens.css has no hex, rgb() or hsl() colour literals', function reqDashtheme001A3() {
    // Hex only as a colour value: not an HTML entity (`&#123;`), not a URL
    // path fragment (`/#x`), not part of a longer word; 3/4/6/8 digits only.
    const HEX = /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
    const FN = /\b(?:rgba?|hsla?)\(/g;
    // Narrow allow-list for non-colour text that still matches, as
    // 'file:line' → why. Empty: nothing in ui/src needs one today.
    const ALLOW: Record<string, string> = {};
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      // Comments are prose, not colour values: blank them out (keeping lines).
      let text = stripBlockComments(readFileSync(join(SRC, file), 'utf8'));
      if (!file.endsWith('.css')) text = text.replace(/(^|\s)\/\/.*$/gm, '$1');
      text.split('\n').forEach((line, i) => {
        const at = `${file}:${i + 1}`;
        if (ALLOW[at]) return;
        if (line.match(HEX) || line.match(FN)) hits.push(`${at}: ${line.trim()}`);
      });
    }
    expect(hits, 'raw colour literals outside ' + TOKEN_FILE + ':\n' + hits.join('\n')).toEqual([]);
  });

  it('REQ-DASHTHEME-001.A4: no per-sport, GP, gold, silver or bronze token is defined', function reqDashtheme001A4() {
    const DOMAIN = /^--(?:bmg-)?(?:color-)?(?:sport|gp|gold|silver|bronze|whatsapp|spend)(?:-|$)/;
    const offenders: string[] = [];
    for (const file of [TOKEN_FILE, ...walk(SRC)]) {
      for (const name of parseCustomProps(readFileSync(join(SRC, file), 'utf8')).keys()) {
        if (DOMAIN.test(name)) offenders.push(`${file}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
    // Sanity: the snapshot does carry them, so the check is not vacuous.
    expect([...SNAPSHOT.keys()].some((n) => DOMAIN.test(n))).toBe(true);
  });
});
