/**
 * Keep the Claude Code plugin (hooks/hooks.json, .claude-plugin/plugin.json)
 * identical to what `specship install --target claude` wires
 * (REQ-AGENTSWITCH-016): built from a real Claude install into a scratch
 * project, so the plugin's hooks cannot drift from the installer's. The
 * plugin's MCP server enables no integration (they stay opt-in), and the
 * manifest carries the package version.
 *
 *   node scripts/sync-claude-plugin.mjs           # write the files
 *   node scripts/sync-claude-plugin.mjs --check   # exit 1 if they are stale
 * Run after `tsc` (it loads the compiled installer from dist/).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const check = process.argv.includes('--check');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

export function renderClaudePlugin() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-claude-plugin-'));
  const project = path.join(scratch, 'project');
  fs.mkdirSync(project, { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SPECSHIP_INSTALL_DIR: process.env.SPECSHIP_INSTALL_DIR };
  const cwd = process.cwd();
  try {
    process.env.HOME = process.env.USERPROFILE = path.join(scratch, 'home');
    process.env.SPECSHIP_INSTALL_DIR = path.join(scratch, 'home', '.specship');
    process.chdir(project);
    const { claudeTarget } = require(path.join(root, 'dist/installer/targets/claude.js'));
    const { getMcpServerConfig } = require(path.join(root, 'dist/installer/targets/shared.js'));
    // autoAllow on: the installer gates its sync hooks on it, and a plugin's
    // hooks are accepted when the plugin is installed. Only the hooks are
    // taken — the permissions list stays out of the plugin.
    claudeTarget.install('local', { sdd: true, autoAllow: true, installStatusLine: false });
    const settings = JSON.parse(fs.readFileSync(path.join(project, '.claude', 'settings.json'), 'utf-8'));
    const hooks = JSON.stringify({ hooks: settings.hooks ?? {} }, null, 2) + '\n';
    const plugin = JSON.stringify({
      name: 'specship',
      version: pkg.version,
      description: 'SpecShip for Claude Code — local code intelligence (search, flow tracing, impact) over a SQLite knowledge graph, spec-driven development, and the same hooks `specship install` wires. Requires the specship CLI on PATH.',
      author: { name: 'selvakumarEsra' },
      // No integrations: JIRA and the designer stay opt-in (INTEG-TIER-DOC).
      mcpServers: { specship: getMcpServerConfig([]) },
    }, null, 2) + '\n';
    return { hooks, plugin };
  } finally {
    process.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const { hooks, plugin } = renderClaudePlugin();
  const targets = [[path.join(root, 'hooks', 'hooks.json'), hooks], [path.join(root, '.claude-plugin', 'plugin.json'), plugin]];
  const stale = targets.filter(([f, want]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf-8') !== want).map(([f]) => path.relative(root, f));
  if (check) {
    if (stale.length) { console.error(`stale Claude plugin files: ${stale.join(', ')} — run node scripts/sync-claude-plugin.mjs`); process.exit(1); }
    console.log('Claude plugin files are in sync');
  } else {
    for (const [f, want] of targets) fs.writeFileSync(f, want);
    console.log(stale.length ? `updated ${stale.join(', ')}` : 'Claude plugin files already in sync');
  }
}
