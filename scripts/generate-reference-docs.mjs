#!/usr/bin/env node
// Reference-doc generation (DOCS-DRIFT-DOC, REQ-DOCSD-001/002).
//
// The facts the site's reference pages state — CLI commands, MCP tool names,
// SPECSHIP_* env vars, supported languages/frameworks — already live in
// source. Hand-maintained copies drift (the docs once advertised a fictional
// `specship claude` CLI). This script derives those sections FROM source and
// writes them between markers; `__tests__/docs-reference.test.ts` regenerates
// and fails the suite when a committed block differs (stale docs can't ship).
//
// Usage:
//   node scripts/generate-reference-docs.mjs           # rewrite the blocks
//   node scripts/generate-reference-docs.mjs --check   # exit 1 on drift
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const start = (id) => `<!-- GENERATED:${id} START — derived from source by scripts/generate-reference-docs.mjs; do not edit by hand -->`;
const end = (id) => `<!-- GENERATED:${id} END -->`;

// ---------------------------------------------------------------------------
// Extractors — each returns markdown for one block.
// ---------------------------------------------------------------------------

/** CLI commands + their one-line descriptions, from the commander program. */
export function cliCommandsBlock(root = ROOT) {
  const src = readFileSync(join(root, 'src', 'bin', 'specship.ts'), 'utf-8');
  const rows = [];
  // Capture the registration receiver so sub-commands render under their
  // group (`const jira = program.command('jira')` → `jira.command('test')`
  // becomes `specship jira test`, not a fictional top-level `specship test`).
  const re = /(?:const (\w+) = )?\b(\w+)\s*[\r\n]+\s*\.command\('([^']+)'\)\s*[\r\n]+\s*\.description\('((?:[^'\\]|\\.)*)'/g;
  const groups = new Map(); // const-name → command name (e.g. jira → 'jira')
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, constName, receiver, name, rawDesc] = m;
    if (constName) groups.set(constName, name.split(' ')[0]);
    const prefix = receiver && groups.has(receiver) ? `${groups.get(receiver)} ` : '';
    let desc = rawDesc.replace(/\\'/g, "'");
    // Internal hook plumbing isn't user-facing surface.
    if (desc.startsWith('Internal hook')) continue;
    if (desc.length > 120) desc = desc.slice(0, 117) + '…';
    rows.push({ name: `${prefix}${name}`, desc });
  }
  const lines = ['| Command | What it does |', '|---|---|'];
  for (const r of rows) lines.push(`| \`specship ${r.name}\` | ${r.desc.replace(/\|/g, '\\|')} |`);
  return lines.join('\n');
}

/** MCP tool names grouped by tier, from the tool-definition sources. */
export function mcpToolsBlock(root = ROOT) {
  const dir = join(root, 'src', 'mcp');
  const names = new Set();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(join(dir, f), 'utf-8');
    const re = /^\s*name: '((?:specship_|designer_)[a-z_0-9]+)',$/gm;
    let m;
    while ((m = re.exec(src)) !== null) names.add(m[1]);
  }
  const all = [...names].sort();
  const core = all.filter((n) => !n.startsWith('specship_jira_') && !n.startsWith('designer_'));
  const jira = all.filter((n) => n.startsWith('specship_jira_'));
  const designer = all.filter((n) => n.startsWith('designer_'));
  const lines = [];
  lines.push('**Core (always available):** ' + core.map((n) => `\`${n}\``).join(' · '));
  lines.push('');
  lines.push('**JIRA integration (opt-in, `specship install --with-jira`):** ' + jira.map((n) => `\`${n}\``).join(' · '));
  lines.push('');
  lines.push('**Designer integration (opt-in + experimental, `--with-designer`):** ' + designer.map((n) => `\`${n}\``).join(' · '));
  return lines.join('\n');
}

/** Every SPECSHIP_* env var referenced in shipped source. */
export function envVarsBlock(root = ROOT) {
  const vars = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) {
        const src = readFileSync(p, 'utf-8');
        for (const m of src.matchAll(/SPECSHIP_[A-Z0-9_]+/g)) vars.add(m[0]);
      }
    }
  };
  walk(join(root, 'src'));
  walk(join(root, 'server', 'src'));
  // Internal test/plumbing knobs that aren't user surface.
  const internal = new Set(['SPECSHIP_SECTION_START', 'SPECSHIP_SECTION_END', 'SPECSHIP_SDD_START', 'SPECSHIP_SDD_END']);
  return [...vars].filter((v) => !internal.has(v)).sort().map((v) => `- \`${v}\``).join('\n');
}

/** Supported languages (tree-sitter + standalone extractors) and frameworks. */
export function languagesBlock(root = ROOT) {
  const langDir = join(root, 'src', 'extraction', 'languages');
  const langs = readdirSync(langDir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => basename(f, '.ts'));
  const standalone = readdirSync(join(root, 'src', 'extraction'))
    .filter((f) => /-extractor\.ts$/.test(f))
    .map((f) => basename(f, '.ts').replace(/-extractor$/, ''));
  const fwDir = join(root, 'src', 'resolution', 'frameworks');
  const frameworks = readdirSync(fwDir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'types.ts')
    .map((f) => basename(f, '.ts'));
  const lines = [];
  lines.push('**Tree-sitter languages:** ' + langs.sort().map((l) => `\`${l}\``).join(' · '));
  lines.push('');
  lines.push('**Standalone extractors:** ' + standalone.sort().map((l) => `\`${l}\``).join(' · '));
  lines.push('');
  lines.push('**Framework resolvers:** ' + frameworks.sort().map((l) => `\`${l}\``).join(' · '));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Block placement — each block lives between its markers in one site page.
// ---------------------------------------------------------------------------

export const BLOCKS = [
  { id: 'cli-commands', file: 'site/src/content/docs/reference/cli.md', render: cliCommandsBlock },
  { id: 'mcp-tools', file: 'site/src/content/docs/reference/mcp-server.md', render: mcpToolsBlock },
  { id: 'env-vars', file: 'site/src/content/docs/reference/cli.md', render: envVarsBlock },
  { id: 'languages', file: 'site/src/content/docs/reference/languages.md', render: languagesBlock },
];

export function applyBlock(content, id, body) {
  const s = start(id);
  const e = end(id);
  const si = content.indexOf(s);
  const ei = content.indexOf(e);
  if (si === -1 || ei === -1) {
    throw new Error(`markers for block "${id}" not found — add ${s} / ${e} to the page first`);
  }
  return content.slice(0, si + s.length) + '\n' + body + '\n' + content.slice(ei);
}

export function currentBlock(content, id) {
  const s = start(id);
  const e = end(id);
  const si = content.indexOf(s);
  const ei = content.indexOf(e);
  if (si === -1 || ei === -1) return null;
  return content.slice(si + s.length, ei).replace(/^\n/, '').replace(/\n$/, '');
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const check = process.argv.includes('--check');
  let drift = 0;
  for (const b of BLOCKS) {
    const p = join(ROOT, b.file);
    const content = readFileSync(p, 'utf-8');
    const fresh = b.render(ROOT);
    const committed = currentBlock(content, b.id);
    if (committed === fresh) continue;
    if (check) {
      console.error(`DRIFT: block "${b.id}" in ${b.file} differs from source — run: node scripts/generate-reference-docs.mjs`);
      drift++;
    } else {
      writeFileSync(p, applyBlock(content, b.id, fresh));
      console.log(`updated block "${b.id}" in ${b.file}`);
    }
  }
  if (check && drift > 0) process.exit(1);
  if (check) console.log('reference docs match source ✓');
}
