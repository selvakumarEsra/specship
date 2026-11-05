/**
 * REQ-REFLECT-005 (specs/reflection-engine.md) — a reflection pass and a
 * sweep, with no per-proposal confirmation, modify no file on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import SpecShip from '../src';

let project: string;
let home: string;
let cg: SpecShip | undefined;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

/** Hash of every file under `dir` except SpecShip's own state folder. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '.specship') walk(abs); }
      else out[path.relative(dir, abs)] = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-nowrite-')));
  project = path.join(root, 'p');
  home = path.join(root, 'home');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# Notes\n');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  cg = await SpecShip.init(project);
  // Sessions that DO produce proposals: the same command run by hand across sessions.
  const db = cg.getSpecQueries().getRawDb();
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const s of ['s1', 's2']) {
    db.prepare('INSERT INTO claude_sessions (id, project_path, source_file) VALUES (?, ?, ?)').run(s, project, `${s}.jsonl`);
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO claude_tool_calls (prompt_id, session_id, assistant_uuid, tool_name, input_summary, result_length, ts)
                  VALUES (?, ?, ?, 'Bash', 'npm run build', 10, ?)`).run(`${s}-p`, s, `${s}-a${i}`, i);
    }
  }
});
afterEach(() => {
  cg?.close();
  cg = undefined;
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  fs.rmSync(path.dirname(project), { recursive: true, force: true });
});

describe('REQ-REFLECT-005 — reflection writes nothing without confirmation', () => {
  it('REQ-REFLECT-005.A1: a reflection pass and a sweep with no confirmation change no file', reqReflect005A1);
  function reqReflect005A1(): void {
    const projectBefore = snapshot(project);
    const homeBefore = snapshot(home);
    const analyzed = cg!.reflectAnalyze();
    expect(JSON.stringify(analyzed)).toMatch(/npm run build/); // proposals were produced…
    cg!.reflectSweep();
    expect(snapshot(project)).toEqual(projectBefore); // …and nothing on disk changed
    expect(snapshot(home)).toEqual(homeBefore);
  }
});
