/**
 * design.md — pixel-exact design reference (DESIGNMD-DOC).
 *
 * Real files in temp dirs: the extractor reads a Claude Design-shaped snapshot
 * with a linked stylesheet, a Figma code export and a Figma variables export;
 * the checker and the updater run against the files the CLI writes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractDesign } from '../src/design-md/extract';
import { parseCss } from '../src/design-md/css';
import { GENERATED_END, GENERATED_START, REQUIRED_SECTIONS, renderDesignMd, renderGeneratedBlock } from '../src/design-md/render';
import { updateDesignMd } from '../src/design-md/maintain';
import { checkDesignMd, runDesignCheckCli, runDesignExtractCli, runDesignVerifyCli } from '../src/design-md/check';
import { compareOutlines, compareRuleOrder, outlineElements, verifyBuild } from '../src/design-md/verify';
import { claudeTarget } from '../src/installer/targets/claude';

const ICON = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M4 4h16v16H4z" stroke="#9AA3B2"/></svg>';

const SNAPSHOT = `<!doctype html>
<html><head><title>Demo page title</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600">
<link rel="stylesheet" href="styles.css">
<style>
  :root { --bg: #0B0D11; --accent: #5B93F2; --radius-card: 12px; --space-3: 12px; }
  /* a comment with #FFFFFF that is not a value */
  .card { background: var(--bg); padding: 16px 20px; border-radius: var(--radius-card);
          box-shadow: 0 1px 2px rgba(0,0,0,0.24); font: 600 13.5px/1.4 "Geist", sans-serif; }
  .btn { color: #E8EBF0; font-size: 13px; font-weight: 450; transition: background 120ms cubic-bezier(.2,0,0,1); }
  .btn:hover { background: rgba(255,255,255,0.06); }
  .btn:focus-visible { outline: 2px solid #5B93F2; outline-offset: 2px; }
  .btn:disabled { opacity: 0.4; }
  .card { & .title { letter-spacing: -0.01em; } }
  @media (max-width: 768px) { .card { padding: 12px; } }
  @keyframes pulse { 0% { opacity: 1 } 100% { opacity: .5 } }
</style></head>
<body><main class="shell"><section class="card" role="region"><h2 class="title">Spec detail</h2>
<button class="btn" type="button" style="margin-left: 8px; color: #46C26B">Run</button>
<img src="logo.svg" alt=""></section>
<nav class="side"><a class="item">${ICON}Dashboard</a><a class="item">${ICON}Graph &amp; flow</a></nav></main></body></html>`;

const STYLES = `.sidebar { width: 280px; background: #11141A; border-right: 1px solid rgba(255,255,255,0.06); }`;

const FIGMA_CODE = `export default function Card() {
  return (
    <div className="flex gap-[10px] p-4 bg-[#0F172A] rounded-[12px] w-[320px]">
      <span className="text-[14px] text-[#94A3B8] tracking-[-0.01em]" style={{ lineHeight: 1.5, marginTop: 4 }}>Hi</span>
      <img src="/assets/icon.svg" />
    </div>
  );
}`;

const FIGMA_VARIABLES = JSON.stringify({
  color: { primary: { $value: '#1E40AF' }, surface: '#FFFFFF' },
  'radius/card': '12px',
  spacing: { md: { value: '16px' } },
});

const DATE = '2026-10-27';

let root: string;

function write(rel: string, body: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return rel;
}

function fillAuthored(content: string): string {
  const fill: Record<string, string> = {
    'Screens & layout': '### Spec detail\n\n- Background `#0B0D11` (`:root --bg`); content padding `16px 20px` (`.card`).',
    'Components & states': '### Button (`.btn`)\n\n- `13px` / `450`, color `#E8EBF0`.\n- `:hover`: background `rgba(255,255,255,0.06)`.',
    'Interactions & motion': '- `.btn` background `120ms cubic-bezier(.2,0,0,1)`; keyframes `pulse`.',
    'Responsive behaviour': '- At `(max-width: 768px)` `.card` padding becomes `12px`.',
    Assets: '- `logo.svg` in `.card`; Geist from Google Fonts.',
  };
  let out = content;
  for (const [name, body] of Object.entries(fill)) {
    out = out.replace(new RegExp(`(## ${name.replace(/[&]/g, '\\$&')}\\n\\n)<!-- design-md:[^\\n]*-->`), `$1${body}`);
  }
  return out;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-md-'));
  write('specs/demo/snapshot.html', SNAPSHOT);
  write('specs/demo/styles.css', STYLES);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('extraction (REQ-DESIGNMD-001)', () => {
  it('lists every custom property verbatim with its selector (REQ-DESIGNMD-001.A1)', customPropertiesAreCapturedVerbatim);
  function customPropertiesAreCapturedVerbatim(): void {
    const x = extractDesign(['specs/demo/snapshot.html'], { projectRoot: root });
    expect(x.customProperties).toContainEqual({ selector: ':root', name: '--accent', value: '#5B93F2' });
    expect(x.customProperties).toContainEqual({ selector: ':root', name: '--radius-card', value: '12px' });
    // The linked local stylesheet is read and recorded as a source.
    expect(x.sources.map((s) => s.path)).toEqual(['specs/demo/snapshot.html', 'specs/demo/styles.css']);
    expect(x.rules.some((r) => r.selector === '.sidebar')).toBe(true);
    expect(x.fontLinks).toEqual(['https://fonts.googleapis.com/css2?family=Geist:wght@400;600']);
    // Commented-out text is not a value.
    expect(x.inventories.Colors.map((c) => c.value)).not.toContain('#FFFFFF');
  }

  it('keeps state rules, media rules, nesting, keyframes and inline styles verbatim (REQ-DESIGNMD-001.A2)', rulesKeepStatesMediaAndKeyframes);
  function rulesKeepStatesMediaAndKeyframes(): void {
    const x = extractDesign(['specs/demo/snapshot.html'], { projectRoot: root });
    const sel = (s: string, media?: string) => x.rules.find((r) => r.selector === s && r.media === media);
    expect(sel('.btn:hover')?.declarations).toEqual([{ property: 'background', value: 'rgba(255,255,255,0.06)' }]);
    expect(sel('.btn:focus-visible')?.declarations).toContainEqual({ property: 'outline', value: '2px solid #5B93F2' });
    expect(sel('.btn:disabled')?.declarations).toEqual([{ property: 'opacity', value: '0.4' }]);
    expect(sel('.card', '@media (max-width: 768px)')?.declarations).toEqual([{ property: 'padding', value: '12px' }]);
    expect(sel('.card .title')?.declarations).toEqual([{ property: 'letter-spacing', value: '-0.01em' }]);
    expect(x.keyframes).toEqual([{ name: 'pulse', body: '0% { opacity: 1 } 100% { opacity: .5 }' }]);
    const inline = x.rules.find((r) => r.selector.startsWith('inline button.btn'));
    expect(inline?.declarations).toEqual([
      { property: 'margin-left', value: '8px' },
      { property: 'color', value: '#46C26B' },
    ]);
    const block = renderGeneratedBlock(x);
    expect(block).toContain('.btn:focus-visible { outline: 2px solid #5B93F2; outline-offset: 2px; }');
    expect(block).toContain('#### @media (max-width: 768px)');
    expect(x.outline).toEqual([
      'html',
      '  body',
      '    main.shell',
      '      section.card[role="region"]',
      '        h2.title',
      '          "Spec detail"',
      '        button.btn[type="button"] { margin-left: 8px; color: #46C26B; }',
      '          "Run"',
      '        img',
      '      nav.side',
      '        a.item',
      `          svg = ${ICON}`,
      '          "Dashboard"',
      '        a.item',
      `          svg = ${ICON}`,
      '          "Graph & flow"',
    ]);
    expect(x.outline.join('\n')).not.toContain('Demo page title');
    // Inline SVG is kept verbatim, once, and its colors are inventoried.
    expect(x.svgs).toEqual([{ id: 'svg-1', markup: ICON, count: 2 }]);
    expect(x.inventories.Colors.map((c) => c.value)).toContain('#9AA3B2');
    // Inline styles sit on their element in the outline, not in the sheet rules.
    expect(block.slice(block.indexOf('### Style rules (verbatim)'))).not.toContain('inline button.btn');
  }

  it('keeps the html theme class, every class and the attributes that render (REQ-DESIGNMD-001.A2)', outlineKeepsAllClassesAndAttributes);
  function outlineKeepsAllClassesAndAttributes(): void {
    write('specs/tw/snapshot.html', `<html class="dark"><body><form class="space-y-6">
<input class="w-full pl-10 pr-4 py-3 bg-gray-950 border border-gray-800 rounded-lg focus:ring-2" type="email" placeholder="Enter your email">
<button class="disabled w-full" type="submit" disabled>Sign In</button>
<p>Don't have an account? <a href="/signup">Sign up</a></p>
<input type="checkbox" checked value="yes"></form></body></html>`);
    const x = extractDesign(['specs/tw/snapshot.html'], { projectRoot: root });
    expect(x.outline).toEqual([
      'html.dark',
      '  body',
      '    form.space-y-6',
      '      input.w-full.pl-10.pr-4.py-3.bg-gray-950.border.border-gray-800.rounded-lg.focus:ring-2[type="email"][placeholder="Enter your email"]',
      '      button.disabled.w-full[type="submit"][disabled]',
      '        "Sign In"',
      '      p',
      '        "Don\'t have an account? "',
      '        a',
      '          "Sign up"',
      '      input[type="checkbox"][value="yes"][checked]',
    ]);
  }

  it('keeps a real space between inline siblings, drops pretty-print whitespace (REQ-DESIGNMD-001.A2)', interElementSpaceIsKept);
  function interElementSpaceIsKept(): void {
    write('specs/sp/snapshot.html', '<html><body><div><span>Why now:</span> <span>You are</span></div>\n  <p>x</p></body></html>');
    const x = extractDesign(['specs/sp/snapshot.html'], { projectRoot: root });
    expect(x.outline).toEqual(['html', '  body', '    div', '      span', '        "Why now:"', '      " "', '      span', '        "You are"', '    p', '      "x"']);
  }

  it('decodes entity-escaped inline styles from a live capture (REQ-DESIGNMD-001.A2)', inlineStyleEntitiesAreDecoded);
  function inlineStyleEntitiesAreDecoded(): void {
    write('specs/live/snapshot.html', '<html><body><h1 style="font-family: &quot;Instrument Serif&quot;, serif; font-size: 40px">Hi</h1></body></html>');
    const x = extractDesign(['specs/live/snapshot.html'], { projectRoot: root });
    expect(x.outline[2]).toBe('    h1 { font-family: "Instrument Serif", serif; font-size: 40px; }');
    expect(x.inventories['Font families'].map((e) => e.value)).toEqual(['"Instrument Serif", serif']);
  }

  it('counts each value and names the selectors that use it (REQ-DESIGNMD-001.A3)', valueInventoriesCountUsage);
  function valueInventoriesCountUsage(): void {
    const x = extractDesign(['specs/demo/snapshot.html'], { projectRoot: root });
    const accent = x.inventories.Colors.find((c) => c.value === '#5B93F2');
    expect(accent).toEqual({ value: '#5B93F2', count: 2, usedBy: [':root', '.btn:focus-visible'].sort() });
    expect(x.inventories['Font sizes'].map((e) => e.value)).toContain('13px');
    expect(x.inventories['Font weights'].map((e) => e.value)).toContain('450');
    expect(x.inventories.Spacing.map((e) => e.value)).toEqual(expect.arrayContaining(['16px 20px', '12px', '8px']));
    expect(x.inventories.Radii.map((e) => e.value)).toContain('var(--radius-card)');
    expect(x.inventories.Shadows.map((e) => e.value)).toContain('0 1px 2px rgba(0,0,0,0.24)');
    expect(x.inventories.Motion.map((e) => e.value)).toContain('background 120ms cubic-bezier(.2,0,0,1)');
    expect(x.inventories.Breakpoints.map((e) => e.value)).toEqual(['(max-width: 768px)']);
    expect(x.inventories.Sizes.map((e) => e.value)).toContain('280px');
    expect(x.assets.map((a) => a.value)).toContain('logo.svg');
  }

  it('produces byte-identical output for the same source (REQ-DESIGNMD-001.A4)', extractionIsDeterministic);
  function extractionIsDeterministic(): void {
    const a = renderGeneratedBlock(extractDesign(['specs/demo/snapshot.html'], { projectRoot: root }));
    const b = renderGeneratedBlock(extractDesign(['specs/demo/snapshot.html'], { projectRoot: root }));
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(a.split('\n')[1]).toMatch(/^Sources: `specs\/demo\/snapshot\.html` sha256:[0-9a-f]{64} · `specs\/demo\/styles\.css` sha256:[0-9a-f]{64}$/);
  }

  it('reads Figma variables and code exports (REQ-DESIGNMD-001.A5)', figmaSourcesContributeTokens);
  function figmaSourcesContributeTokens(): void {
    write('specs/fig/figma/card.tsx', FIGMA_CODE);
    write('specs/fig/figma/variables.json', FIGMA_VARIABLES);
    const x = extractDesign(['specs/fig/figma/card.tsx', 'specs/fig/figma/variables.json'], { projectRoot: root });
    expect(x.variables).toEqual([
      { name: 'color/primary', value: '#1E40AF' },
      { name: 'color/surface', value: '#FFFFFF' },
      { name: 'radius/card', value: '12px' },
      { name: 'spacing/md', value: '16px' },
    ]);
    const colors = x.inventories.Colors.map((c) => c.value);
    expect(colors).toEqual(expect.arrayContaining(['#0F172A', '#94A3B8', '#1E40AF', '#FFFFFF']));
    expect(x.inventories.Spacing.map((e) => e.value)).toEqual(expect.arrayContaining(['10px', '4px', '16px']));
    expect(x.inventories.Sizes.map((e) => e.value)).toContain('320px');
    expect(x.inventories.Radii.map((e) => e.value)).toContain('12px');
    expect(x.inventories['Font sizes'].map((e) => e.value)).toContain('14px');
    expect(x.inventories['Letter spacing'].map((e) => e.value)).toContain('-0.01em');
    expect(x.inventories['Line heights'].map((e) => e.value)).toContain('1.5');
    expect(x.utilityClasses.map((u) => u.value)).toEqual(expect.arrayContaining(['p-4']));
    expect(x.assets.map((a) => a.value)).toContain('/assets/icon.svg');
    expect(x.inventories.Colors.find((c) => c.value === '#0F172A')?.usedBy).toEqual(['specs/fig/figma/card.tsx:3']);
  }

  it('fails on a missing source and writes nothing (REQ-DESIGNMD-001.A6)', missingSourceFailsWithoutWriting);
  function missingSourceFailsWithoutWriting(): void {
    const res = runDesignExtractCli(['specs/nope/snapshot.html', '--out', 'specs/nope/design.md'], { projectRoot: root, date: DATE });
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('specs/nope/snapshot.html');
    expect(fs.existsSync(path.join(root, 'specs/nope/design.md'))).toBe(false);
    // A missing linked stylesheet is recorded, not silently dropped.
    fs.rmSync(path.join(root, 'specs/demo/styles.css'));
    const x = extractDesign(['specs/demo/snapshot.html'], { projectRoot: root });
    expect(x.missingLinks).toEqual(['specs/demo/styles.css']);
    expect(renderGeneratedBlock(x)).toContain('Missing linked stylesheet: `specs/demo/styles.css`');
  }
});

describe('layout (REQ-DESIGNMD-002)', () => {
  it('writes every required section in order (REQ-DESIGNMD-002.A1)', newFileHasEveryRequiredSection);
  function newFileHasEveryRequiredSection(): void {
    const res = runDesignExtractCli(['specs/demo/snapshot.html', '--out', 'specs/demo/design.md', '--title', 'Demo'], { projectRoot: root, date: DATE });
    expect(res.exitCode).toBe(0);
    const content = fs.readFileSync(path.join(root, 'specs/demo/design.md'), 'utf-8');
    const headings = [...content.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual([...REQUIRED_SECTIONS]);
    expect(content.startsWith('# Demo — design reference')).toBe(true);
  }

  it('fences the generated block and records sources with hashes (REQ-DESIGNMD-002.A2)', generatedBlockRecordsItsSource);
  function generatedBlockRecordsItsSource(): void {
    const x = extractDesign(['specs/demo/snapshot.html'], { projectRoot: root });
    const content = renderDesignMd(x, { title: 'Demo', date: DATE });
    const start = content.indexOf(GENERATED_START);
    const end = content.indexOf(GENERATED_END);
    expect(start).toBeGreaterThan(content.indexOf('## Generated reference'));
    expect(end).toBeGreaterThan(start);
    expect(content.slice(start).split('\n')[1]).toContain(`\`specs/demo/snapshot.html\` sha256:${x.sources[0]!.sha256}`);
  }

  it('states the verbatim / exact-token fidelity rules (REQ-DESIGNMD-002.A3)', fidelityRulesAreStated);
  function fidelityRulesAreStated(): void {
    const content = renderDesignMd(extractDesign(['specs/demo/snapshot.html'], { projectRoot: root }), { title: 'Demo', date: DATE });
    const rules = content.slice(content.indexOf('## Fidelity rules'), content.indexOf('## Screens & layout'));
    expect(rules).toContain('verbatim');
    expect(rules).toContain('Never round, approximate or substitute');
    expect(rules).toContain('only when its value is exactly equal');
    expect(rules).toContain('Add no CSS the design does not have');
    expect(rules).toContain('where they disagree with the outline, the outline wins');
  }
});

describe('maintenance (REQ-DESIGNMD-003)', () => {
  function created(): string {
    runDesignExtractCli(['specs/demo/snapshot.html', '--out', 'specs/demo/design.md'], { projectRoot: root, date: DATE });
    const file = path.join(root, 'specs/demo/design.md');
    fs.writeFileSync(file, fillAuthored(fs.readFileSync(file, 'utf-8')));
    return file;
  }

  it('replaces only the generated block (REQ-DESIGNMD-003.A1)', updateReplacesOnlyTheGeneratedBlock);
  function updateReplacesOnlyTheGeneratedBlock(): void {
    const file = created();
    const before = fs.readFileSync(file, 'utf-8');
    write('specs/demo/styles.css', STYLES.replace('280px', '296px'));
    const res = runDesignExtractCli(['specs/demo/snapshot.html', '--update', 'specs/demo/design.md'], { projectRoot: root, date: '2026-10-28' });
    expect(res.exitCode).toBe(0);
    const after = fs.readFileSync(file, 'utf-8');
    const head = (s: string) => s.slice(0, s.indexOf(GENERATED_START));
    expect(head(after)).toBe(head(before));
    expect(after).toContain('296px');
    expect(after).toContain('`.btn` background `120ms cubic-bezier(.2,0,0,1)`');
  }

  it('logs added, removed and changed values; no-op leaves the file identical (REQ-DESIGNMD-003.A2)', updateLogsValueChanges);
  function updateLogsValueChanges(): void {
    const file = created();
    write('specs/demo/snapshot.html', SNAPSHOT.replace('--accent: #5B93F2', '--accent: #4C7FE0').replace('--space-3: 12px; ', ''));
    runDesignExtractCli(['specs/demo/snapshot.html', '--update', 'specs/demo/design.md'], { projectRoot: root, date: '2026-10-28' });
    const after = fs.readFileSync(file, 'utf-8');
    const log = after.slice(after.indexOf('## Change log'));
    expect(log).toContain('- 2026-10-28: source re-extracted;');
    expect(log).toContain('changed token --accent on :root: `#5B93F2` → `#4C7FE0`');
    expect(log).toContain('removed token --space-3 on :root');
    expect(log).toContain('added Colors: #4C7FE0');
    expect(log.indexOf('2026-10-28')).toBeLessThan(log.indexOf(DATE));

    const again = runDesignExtractCli(['specs/demo/snapshot.html', '--update', 'specs/demo/design.md'], { projectRoot: root, date: '2026-10-29' });
    expect(again.output).toContain('already current');
    expect(fs.readFileSync(file, 'utf-8')).toBe(after);
  }

  it('refuses to update a file without markers (REQ-DESIGNMD-003.A3)', updateRefusesAFileWithoutMarkers);
  function updateRefusesAFileWithoutMarkers(): void {
    write('specs/demo/design.md', '# Hand-written\n\nNo markers here.\n');
    const res = runDesignExtractCli(['specs/demo/snapshot.html', '--update', 'specs/demo/design.md'], { projectRoot: root, date: DATE });
    expect(res.exitCode).toBe(1);
    expect(fs.readFileSync(path.join(root, 'specs/demo/design.md'), 'utf-8')).toBe('# Hand-written\n\nNo markers here.\n');
    expect(() => updateDesignMd('nothing', `${GENERATED_START}\n${GENERATED_END}`, DATE)).toThrow(/refusing/);
  }
});

describe('checker (REQ-DESIGNMD-004)', () => {
  function complete(): string {
    runDesignExtractCli(['specs/demo/snapshot.html', '--out', 'specs/demo/design.md'], { projectRoot: root, date: DATE });
    return fillAuthored(fs.readFileSync(path.join(root, 'specs/demo/design.md'), 'utf-8'));
  }
  const codes = (content: string) => checkDesignMd(content, { projectRoot: root }).map((f) => f.code);

  it('flags missing sections, missing markers and unfilled authored sections (REQ-DESIGNMD-004.A1)', missingSectionIsAnError);
  function missingSectionIsAnError(): void {
    runDesignExtractCli(['specs/demo/snapshot.html', '--out', 'specs/demo/design.md'], { projectRoot: root, date: DATE });
    const fresh = fs.readFileSync(path.join(root, 'specs/demo/design.md'), 'utf-8');
    expect(codes(fresh).filter((c) => c === 'design_empty_section')).toHaveLength(5);
    const noAssets = complete().replace(/## Assets\n[\s\S]*?(?=## Generated reference)/, '');
    expect(codes(noAssets)).toContain('design_missing_section');
    expect(codes('# x\n')).toContain('design_missing_generated_block');
    const twice = complete().replace('## Interactions & motion', '## Components & states\n\n<!-- design-md: stub -->\n\n## Interactions & motion');
    const dup = checkDesignMd(twice, { projectRoot: root }).filter((f) => f.code === 'design_duplicate_section');
    expect(dup).toHaveLength(1);
    expect(dup[0]!.message).toContain('"## Components & states" appears twice');
  }

  it('rejects approximate wording outside the generated block, with the line (REQ-DESIGNMD-004.A2)', vagueWordingIsAnError);
  function vagueWordingIsAnError(): void {
    for (const phrase of ['roughly 12px', 'approximately', 'about 12px', '~12px', 'similar to the header', 'paddings etc.', 'TBD']) {
      const content = complete().replace('content padding `16px 20px` (`.card`).', `content padding ${phrase}.`);
      const vague = checkDesignMd(content, { projectRoot: root }).filter((f) => f.code === 'design_vague_wording');
      expect(vague.length, phrase).toBeGreaterThan(0);
      expect(content.split('\n')[vague[0]!.line! - 1]).toContain(phrase);
    }
    expect(codes(complete())).not.toContain('design_vague_wording');
  }

  it('reports a source value missing from the generated block (REQ-DESIGNMD-004.A3)', uncoveredSourceValueIsAnError);
  function uncoveredSourceValueIsAnError(): void {
    const tampered = complete().replace(/#46C26B/g, '#000000');
    const findings = checkDesignMd(tampered, { projectRoot: root });
    expect(findings.find((f) => f.code === 'design_uncovered_value')?.message).toContain('#46C26B');
  }

  it('reports a changed source as stale with the update command (REQ-DESIGNMD-004.A4)', changedSourceIsStale);
  function changedSourceIsStale(): void {
    const content = complete();
    write('specs/demo/styles.css', `${STYLES}\n.x { color: #123456; }`);
    const stale = checkDesignMd(content, { projectRoot: root }).find((f) => f.code === 'design_stale');
    expect(stale?.message).toContain('specs/demo/styles.css');
    expect(stale?.message).toContain('specship design extract specs/demo/snapshot.html specs/demo/styles.css --update');
  }

  it('passes a complete, current, exact file and reports JSON (REQ-DESIGNMD-004.A5)', cleanFilePasses);
  function cleanFilePasses(): void {
    write('specs/demo/design.md', complete());
    expect(checkDesignMd(complete(), { projectRoot: root })).toEqual([]);
    const text = runDesignCheckCli(['specs/demo/design.md'], { projectRoot: root });
    expect(text.exitCode).toBe(0);
    expect(text.output).toContain('design check passed');
    const json = runDesignCheckCli(['specs/demo/design.md', '--json'], { projectRoot: root });
    expect(JSON.parse(json.output)).toEqual({ results: [{ file: 'specs/demo/design.md', findings: [] }], errors: 0 });
    write('specs/demo/design.md', '# broken\n');
    expect(runDesignCheckCli(['specs/demo/design.md'], { projectRoot: root }).exitCode).toBe(1);
  }
});

describe('skill + workflows (REQ-DESIGNMD-005/006)', () => {
  const repo = path.resolve(__dirname, '..');
  const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf-8');

  it('install ships the design-md skill and uninstall removes it (REQ-DESIGNMD-005.A1)', skillShipsWithTheInstall);
  function skillShipsWithTheInstall(): void {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'design-md-home-'));
    const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, cwd: process.cwd() };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.chdir(root);
    try {
      claudeTarget.install('local', { autoAllow: false });
      const skill = path.join(root, '.claude', 'skills', 'design-md');
      expect(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf-8')).toContain('name: design-md');
      expect(fs.existsSync(path.join(skill, 'references', 'sources.md'))).toBe(true);
      expect(fs.existsSync(path.join(skill, 'references', 'authored-sections.md'))).toBe(true);
      claudeTarget.uninstall('local');
      expect(fs.existsSync(skill)).toBe(false);
    } finally {
      process.chdir(prev.cwd);
      if (prev.HOME === undefined) delete process.env.HOME; else process.env.HOME = prev.HOME;
      if (prev.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prev.USERPROFILE;
      fs.rmSync(home, { recursive: true, force: true });
    }
  }

  it('the skill reads Claude Design and Figma through their tools and never plain-fetches (REQ-DESIGNMD-005.A2)', skillCoversBothSources);
  function skillCoversBothSources(): void {
    const skill = read('skills/design-md/SKILL.md');
    const sources = read('skills/design-md/references/sources.md');
    for (const tool of ['designer_session', 'designer_snapshot']) expect(skill + sources).toContain(tool);
    for (const tool of ['get_metadata', 'get_design_context', 'get_variable_defs', 'get_screenshot']) expect(sources).toContain(tool);
    expect(skill).toContain('Never plain-fetch a design link');
    expect(skill).toContain('claude mcp add --transport http figma https://mcp.figma.com/mcp');
    expect(skill).toContain('designer setup');
  }

  it('the skill extracts, then finishes only on a passing check (REQ-DESIGNMD-005.A3)', skillEndsOnAPassingCheck);
  function skillEndsOnAPassingCheck(): void {
    const skill = read('skills/design-md/SKILL.md');
    expect(skill).toContain('specship design extract');
    expect(skill).toMatch(/specship design check[\s\S]*finished only when it passes/);
    expect(skill).toContain('--update');
  }

  it('the design import workflow writes and checks design.md and records it on the spec (REQ-DESIGNMD-006.A1)', workflowsUseDesignMd);
  function workflowsUseDesignMd(): void {
    const importer = read('src/workflows/defaults/claude-design-implement.yaml');
    expect(importer).toContain('specship design extract specs/$INPUT.SLUG/snapshot.html');
    expect(importer).toContain('specship design check specs/$INPUT.SLUG/design.md');
    expect(importer).toContain('design: specs/<SLUG>/design.md');
  }

  it('the implement workflow builds UI from the spec\'s design.md verbatim (REQ-DESIGNMD-006.A2)', implementReadsDesignMd);
  function implementReadsDesignMd(): void {
    const implement = read('src/workflows/defaults/spec-implement.yaml');
    expect(implement).toMatch(/frontmatter\s+carries a `design:` key, read that design\.md before ANY UI edit/);
    expect(implement).toContain('verbatim');
  }

  it('/specship:spec design names design.md as the implementer\'s reference (REQ-DESIGNMD-006.A3)', specDesignRouteNamesDesignMd);
  function specDesignRouteNamesDesignMd(): void {
    const route = read('commands/specship/spec.md');
    expect(route).toContain('specs/<slug>/design.md');
    expect(route).toMatch(/the implementer builds the UI from `specs\/<slug>\/design\.md`/);
  }
});

describe('build verification (REQ-DESIGNMD-008)', () => {
  const PAGE = `<html><body><div class="card"><form class="f"><input class="w-full" placeholder="Email"></form>
<div class="footer"><p>Don't have an account? <a class="link">Sign up</a></p></div></div></body></html>`;

  function designFor(html: string): string {
    write('specs/v/snapshot.html', html);
    runDesignExtractCli(['specs/v/snapshot.html', '--out', 'specs/v/design.md'], { projectRoot: root, date: DATE });
    return read('specs/v/design.md');
  }
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

  it('passes a build whose outline equals design.md (REQ-DESIGNMD-008.A1)', verifyPassesAFaithfulBuild);
  function verifyPassesAFaithfulBuild(): void {
    const design = designFor(PAGE);
    write('build/index.html', PAGE.replace('<html>', '<!doctype html><html>'));
    expect(verifyBuild(design, 'build/index.html', { projectRoot: root }).ok).toBe(true);
  }

  it('reports misnesting and changed elements with the first differing lines (REQ-DESIGNMD-008.A2)', verifyReportsMisnesting);
  function verifyReportsMisnesting(): void {
    const design = designFor(PAGE);
    // The footer closed outside the card: one container closed a line early.
    write('build/index.html', PAGE.replace('</form>\n<div class="footer">', '</form></div>\n<div class="footer">').replace('</div></div></body>', '</div></body>'));
    const r = verifyBuild(design, 'build/index.html', { projectRoot: root });
    expect(r.ok).toBe(false);
    expect(r.mismatches[0]!.expected!.trim()).toBe('div.footer');
    expect(r.mismatches[0]!.expected).not.toBe(r.mismatches[0]!.actual);
    write('build/index.html', PAGE.replace('class="link"', 'class="link-x"'));
    expect(verifyBuild(design, 'build/index.html', { projectRoot: root }).mismatches[0]!.actual).toContain('a.link-x');
  }

  it('never fails on differences that render the same (REQ-DESIGNMD-008.A3)', verifyIgnoresEquivalentDifferences);
  function verifyIgnoresEquivalentDifferences(): void {
    const r = compareOutlines(
      ['  svg.i = <svg width="2" height="3"><path d="M0"/></svg>', '  span { color: red; }', '  a', '    "Sign up"'],
      ['  svg.i = <svg class="i" height="3" width="2"><path d="M0"/></svg>', '  span', '  a', '    " Sign up "'],
    );
    expect(r.ok).toBe(true);
    expect(r.notes.map((n) => n.kind)).toEqual(['style', 'space']);
    // …but a space next to an inline sibling renders: losing it fails.
    const glued = compareOutlines(['  p', '    b', '      "Why now:"', '    " You are"'], ['  p', '    b', '      "Why now:"', '    "You are"']);
    expect(glued.ok).toBe(false);
    expect(glued.mismatches[0]!.line).toBe(4);
  }

  it('reports cascade-order inversions that change an element, and only those (REQ-DESIGNMD-008.A2)', verifyChecksRuleOrder);
  function verifyChecksRuleOrder(): void {
    const els = outlineElements(['div.spin.border-white.border-t-transparent', 'hr', 'body']);
    const rule = (selector: string, property: string, value: string) => ({ selector, declarations: [{ property, value }] });
    const white = rule('.border-white', 'border-color', '#fff');
    const top = rule('.border-t-transparent', 'border-top-color', 'transparent');
    // Shorthand vs longhand on the same element, inverted: reported.
    const inv = compareRuleOrder([white, top], [top, white], els);
    expect(inv).toHaveLength(1);
    expect(inv[0]!.expected).toBe('.border-white before .border-t-transparent');
    expect(compareRuleOrder([white, top], [white, top], els)).toEqual([]);
    // Rules no element shares (hr / body), or equal values: never reported.
    const hr = rule('hr', 'color', 'red');
    const body = rule('body', 'color', 'blue');
    expect(compareRuleOrder([hr, body], [body, hr], els)).toEqual([]);
    const a = rule('.border-white', 'transform', 'none');
    const b = rule('.border-t-transparent', 'transform', 'none');
    expect(compareRuleOrder([a, b], [b, a], els)).toEqual([]);
  }

  it('exits 0 on a match, 1 on a mismatch, non-zero with a reason on bad input (REQ-DESIGNMD-008.A4)', verifyCliExitCodes);
  function verifyCliExitCodes(): void {
    designFor(PAGE);
    write('build/ok.html', PAGE);
    write('build/bad.html', PAGE.replace('<p>', '<section><p>').replace('</p>', '</p></section>'));
    expect(runDesignVerifyCli(['build/ok.html', '--against', 'specs/v/design.md'], { projectRoot: root }).exitCode).toBe(0);
    const bad = runDesignVerifyCli(['build/bad.html', '--against', 'specs/v/design.md'], { projectRoot: root });
    expect(bad.exitCode).toBe(1);
    expect(bad.output).toContain('expected:');
    write('specs/v/empty.md', '# no outline here\n');
    expect(runDesignVerifyCli(['build/ok.html', '--against', 'specs/v/empty.md'], { projectRoot: root }).output).toContain('no Element outline');
    expect(runDesignVerifyCli(['build/missing.html', '--against', 'specs/v/design.md'], { projectRoot: root }).exitCode).toBe(1);
    expect(runDesignVerifyCli(['build/ok.html'], { projectRoot: root }).output).toContain('usage');
  }

  it('the skill says verify, fix, repeat until it matches (REQ-DESIGNMD-008.A5)', skillVerifiesUntilItMatches);
  function skillVerifiesUntilItMatches(): void {
    const skill = fs.readFileSync(path.resolve(__dirname, '..', 'skills/design-md/SKILL.md'), 'utf-8');
    expect(skill).toContain('specship design verify <build.html> --against specs/<slug>/design.md');
    expect(skill).toContain('You are done when it matches.');
  }
});

describe('css reader', () => {
  it('keeps empty custom properties, which Tailwind composes filters from (REQ-DESIGNMD-001.A1)', emptyCustomPropertiesAreKept);
  function emptyCustomPropertiesAreKept(): void {
    const css = parseCss('*, ::before { --tw-blur: ; --tw-x: 0; color: ; } .b { backdrop-filter: var(--tw-blur); }');
    expect(css.rules[0]!.declarations).toEqual([
      { property: '--tw-blur', value: '' },
      { property: '--tw-x', value: '0' },
    ]);
    write('specs/e/s.css', '*, ::before { --tw-blur: ; }');
    const block = renderGeneratedBlock(extractDesign(['specs/e/s.css'], { projectRoot: root }));
    expect(block).toContain('*, ::before { --tw-blur: ; }');
  }

  it('keeps semicolons inside url() and strings', () => {
    const css = parseCss('.a { background: url("data:image/png;base64,xx"); content: "a;b"; color: red }');
    expect(css.rules[0]!.declarations.map((d) => d.property)).toEqual(['background', 'content', 'color']);
  });
});
