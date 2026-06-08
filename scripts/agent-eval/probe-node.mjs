#!/usr/bin/env node
// Probe specship_node (with trail) against an index using the built dist.
// Usage: node probe-node.mjs <repo-with-.specship> <symbol> [code]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [, , repo, symbol, code] = process.argv;
if (!repo || !symbol) { console.error('usage: probe-node.mjs <repo> <symbol> [code]'); process.exit(1); }

const load = async (rel) => import(pathToFileURL(resolve(rel)).href);
const idx = await load('dist/index.js');
const tools = await load('dist/mcp/tools.js');
const SpecShip = idx.default?.default ?? idx.default ?? idx.SpecShip;
const ToolHandler = tools.ToolHandler ?? tools.default?.ToolHandler;

const cg = SpecShip.openSync(repo);
const h = new ToolHandler(cg);
const res = await h.execute('specship_node', { symbol, includeCode: code === 'code' });
console.log(res.content?.[0]?.text ?? '(no text)');
try { cg.close?.(); } catch {}
