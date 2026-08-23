#!/usr/bin/env node
// Exact-name recall probe (EXPLORE-PIN-DOC, REQ-EXPLORE-PIN-004.A2).
//
// Property under test: a specship_explore query that NAMES a target verbatim
// returns that target. This is the retrieval-quality property whose silent
// regression sent agents back to Grep (kebab-case filenames and non-callable
// kinds were dropped before ranking); this probe makes it a tracked per-run
// figure so a future ranking change cannot quietly regress it.
//
// Deterministic: targets are sampled from the repo's OWN index (no fixture
// drift) — a mix of extension-bearing paths, bare basenames (unambiguous
// only), and non-callable symbols (constants / interfaces / type aliases).
// Each is queried by name; recall = fraction whose target appears in the
// explore output. A run below RECALL_MIN (default 1.0 — every named target
// must come back) exits non-zero, which FAILS the A/B pass bar.
//
// Usage: node probe-recall.mjs <repo-with-.specship> [--verbose]
// Env:   RECALL_MIN   minimum passing recall (default "1.0")
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [, , repo, flag] = process.argv;
const verbose = flag === '--verbose';
if (!repo) {
  console.error('usage: probe-recall.mjs <repo-with-.specship> [--verbose]');
  process.exit(1);
}
const RECALL_MIN = Number(process.env.RECALL_MIN ?? '1.0');

const load = async (rel) => import(pathToFileURL(resolve(rel)).href);
const idx = await load('dist/index.js');
const tools = await load('dist/mcp/tools.js');
const SpecShip = idx.default?.default ?? idx.default ?? idx.SpecShip;
const ToolHandler = tools.ToolHandler ?? tools.default?.ToolHandler;
if (typeof SpecShip?.openSync !== 'function' || typeof ToolHandler !== 'function') {
  console.error('could not resolve SpecShip.openSync / ToolHandler from dist/');
  process.exit(2);
}

const cg = SpecShip.openSync(repo);
const h = new ToolHandler(cg);

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);
const stripExt = (s) => s.replace(/\.[^./]+$/, '');
const SRC_EXT = /\.(ts|tsx|js|jsx|py|go|rb|rs|java|kt|swift|cs|php|scala|dart|vue|svelte)$/;
const isLowValue = (p) => /(^|\/)(tests?|__tests__|specs?|fixtures?|mocks?|node_modules|dist|build|vendor)\//i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p);

// --- sample FILE targets: prefer kebab-case (the historical miss), then any.
const files = cg.getFiles().map((f) => f.path).filter((p) => SRC_EXT.test(p) && !isLowValue(p));
const baseCounts = new Map();
for (const p of files) {
  const b = stripExt(basename(p)).toLowerCase();
  baseCounts.set(b, (baseCounts.get(b) ?? 0) + 1);
}
const kebab = files.filter((p) => basename(p).includes('-'));
const pickFiles = [...kebab.slice(0, 8), ...files.filter((p) => !kebab.includes(p)).slice(0, 4)];

// One case per file, rotating query forms so all of REQ-EXPLORE-PIN-002's
// token shapes stay covered: full path, basename+ext, bare basename.
const cases = [];
pickFiles.forEach((p, i) => {
  const b = basename(p);
  const form = i % 3;
  const unambiguous = baseCounts.get(stripExt(b).toLowerCase()) === 1;
  const token = form === 0 ? p : form === 1 ? b : (unambiguous ? stripExt(b) : b);
  cases.push({ kind: 'file', token, expectPath: p });
});

// --- sample SYMBOL targets: non-callable kinds, reasonably unique names.
const WANTED_KINDS = ['constant', 'interface', 'type_alias', 'enum'];
const symCases = [];
for (const p of files) {
  if (symCases.length >= 12) break;
  for (const n of cg.getNodesInFile(p)) {
    if (symCases.length >= 12) break;
    if (!WANTED_KINDS.includes(n.kind)) continue;
    if (n.name.length < 6 || !/^[A-Za-z_$][\w$]*$/.test(n.name)) continue;
    if (cg.getNodesByName(n.name).length > 3) continue; // overload-cap territory
    symCases.push({ kind: n.kind, token: n.name, expectPath: n.filePath });
  }
}
cases.push(...symCases);

if (cases.length === 0) {
  console.error('no sampleable targets in this index — probe inconclusive');
  process.exit(2);
}

let hits = 0;
const failures = [];
for (const c of cases) {
  const res = await h.execute('specship_explore', { query: c.token });
  const text = res.content?.[0]?.text ?? '';
  const sections = text.split('\n').filter((l) => l.startsWith('#### ')).join('\n');
  const ok = c.kind === 'file'
    ? sections.includes(c.expectPath)
    : sections.includes(c.expectPath) && text.includes(c.token);
  if (ok) hits++;
  else failures.push(c);
  if (verbose) console.log(`${ok ? 'HIT ' : 'MISS'} [${c.kind}] ${c.token} -> ${c.expectPath}`);
}

const recall = hits / cases.length;
console.log('\n--- EXACT-NAME RECALL (REQ-EXPLORE-PIN-004.A2) ---');
console.log(`targets: ${cases.length} (${cases.length - symCases.length} files, ${symCases.length} symbols)`);
console.log(`recall:  ${(recall * 100).toFixed(1)}%  (min ${(RECALL_MIN * 100).toFixed(0)}%)`);
for (const f of failures) console.log(`  MISS [${f.kind}] ${f.token} -> ${f.expectPath}`);
try { cg.close?.(); } catch {}
process.exit(recall >= RECALL_MIN ? 0 : 1);
