import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CHAT-REMOVE-DOC (specs/chat-removal.md) — the dashboard chat surface is
 * gone and stays gone. Source-scan guards (the repo's pattern for structural
 * invariants, cf. the /api/domain bare-import scan):
 *
 *   001.A1 — no Chat page, nav entry, or route in the UI shell.
 *   002.A1 — no /api/chat route registration anywhere in the server.
 *   003.A1 — the run page keeps the reviewer loop chat was cut in favor of.
 */

const ROOT = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

describe('chat surface removal (CHAT-REMOVE-DOC)', () => {
  it('001.A1: the UI ships no chat page, palette entry, or route', () => {
    expect(fs.existsSync(path.join(ROOT, 'ui', 'src', 'pages', 'chat.tsx'))).toBe(false);
    const app = read('ui/src/App.tsx');
    expect(app).not.toContain("from './pages/chat'");
    expect(app).not.toMatch(/id:\s*'chat'/);
    expect(app).not.toMatch(/\bchat:\s*ChatPage/);
  });

  it('002.A1: the server registers no /api/chat route and ships no chat engine', () => {
    expect(fs.existsSync(path.join(ROOT, 'server', 'src', 'routes', 'chat.ts'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'server', 'src', 'routes', 'chat-answer.ts'))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'server', 'src', 'chat'))).toBe(false);
    // No route registration for /api/chat anywhere in server source.
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
      );
    const offenders = walk(path.join(ROOT, 'server', 'src'))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /['"`]\/api\/chat/.test(fs.readFileSync(f, 'utf-8')));
    expect(offenders).toEqual([]);
    // Client bindings gone too.
    const api = read('ui/src/api.ts');
    expect(api).not.toContain('/api/chat');
    expect(api).not.toContain('chatStreamUrl');
  });

  it('003.A1: the run page keeps approve-with-comment and reject-with-comment (the loop chat was cut for)', () => {
    const runDetail = read('ui/src/components/run-detail.tsx');
    expect(runDetail).toContain("runAction(id, 'approve'");
    expect(runDetail).toContain("runAction(id, 'reject'");
    expect(runDetail).toContain('rejectReason'); // reject carries a comment
    expect(runDetail).toContain("runAction(id, 'resume'"); // revise loop re-entry
  });
});
