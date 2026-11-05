/**
 * Build step: assemble the Gemini CLI extension (REQ-AGENTSWITCH-016) into
 * `gemini-extension/`. It is built FROM a real `specship install --target
 * gemini` into a scratch project, so the extension carries exactly what the
 * CLI install writes — same MCP entry, GEMINI.md blocks, hooks, /specship:*
 * commands, skills and explorer subagent — and cannot drift from it.
 *
 * Users: `gemini extensions install <package>/gemini-extension` (or `link`).
 * Run after `tsc` (it loads the compiled installer from dist/).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'gemini-extension');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'specship-gemini-ext-'));
const project = path.join(scratch, 'project');
fs.mkdirSync(project, { recursive: true });
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, SPECSHIP_INSTALL_DIR: process.env.SPECSHIP_INSTALL_DIR, SPECSHIP_GEMINI_VERSION: process.env.SPECSHIP_GEMINI_VERSION };
const cwd = process.cwd();
try {
  // Isolated: the scratch install never touches the builder's real config.
  process.env.HOME = process.env.USERPROFILE = path.join(scratch, 'home');
  process.env.SPECSHIP_INSTALL_DIR = path.join(scratch, 'home', '.specship');
  process.env.SPECSHIP_GEMINI_VERSION = '0.28.0'; // the verified baseline: skills + subagent included
  process.chdir(project);
  const { geminiTarget } = require(path.join(root, 'dist/installer/targets/gemini.js'));
  geminiTarget.install('local', { sdd: true, autoAllow: false, installStatusLine: false });

  const gem = path.join(project, '.gemini');
  const settings = JSON.parse(fs.readFileSync(path.join(gem, 'settings.json'), 'utf-8'));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'hooks'), { recursive: true });
  for (const dir of ['commands', 'skills', 'agents']) {
    if (fs.existsSync(path.join(gem, dir))) fs.cpSync(path.join(gem, dir), path.join(out, dir), { recursive: true });
  }
  // A skill dir's install-ownership marker means nothing inside an extension.
  for (const marker of fs.readdirSync(path.join(out, 'skills'), { recursive: true }).filter((f) => String(f).endsWith('.specship-installed'))) {
    fs.rmSync(path.join(out, 'skills', String(marker)));
  }
  fs.copyFileSync(path.join(project, 'GEMINI.md'), path.join(out, 'GEMINI.md'));
  fs.writeFileSync(path.join(out, 'hooks', 'hooks.json'), JSON.stringify({ hooks: settings.hooks ?? {} }, null, 2) + '\n');
  const manifest = {
    name: 'specship',
    version: pkg.version,
    description: 'SpecShip code intelligence and spec-driven flow for Gemini CLI. Requires the specship CLI on PATH (npm i -g @specship/specship).',
    mcpServers: { specship: settings.mcpServers.specship },
    contextFileName: 'GEMINI.md',
  };
  fs.writeFileSync(path.join(out, 'gemini-extension.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`gemini-extension/ built (v${pkg.version})`);
} finally {
  process.chdir(cwd);
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  fs.rmSync(scratch, { recursive: true, force: true });
}
