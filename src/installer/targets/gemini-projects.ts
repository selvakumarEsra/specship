/**
 * Gemini CLI's recently used projects (REQ-AGENTSWITCH-019.A1). From 0.33.0
 * Gemini keeps a registry, `~/.gemini/projects.json` =
 * `{ projects: { <root>: <short id> } }`, and writes sessions under
 * `~/.gemini/tmp/<short id>/chats/` (DOM-SPECSHIP-009). Earlier versions name
 * the folder by a hash that cannot be turned back into a path, so those
 * projects come only from SpecShip's install record.
 */

import * as fs from 'fs';
import * as path from 'path';
import { GEMINI_CLI_TRAITS } from '../../activation/hook-output';
import type { RecentProject } from './types';

export function geminiRecentProjects(home: string): RecentProject[] {
  const dir = path.join(home, GEMINI_CLI_TRAITS.configDir);
  let projects: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'projects.json'), 'utf8')) as { projects?: unknown };
    if (parsed.projects && typeof parsed.projects === 'object') projects = parsed.projects as Record<string, unknown>;
  } catch { return []; }
  const out: RecentProject[] = [];
  for (const [root, id] of Object.entries(projects)) {
    if (!path.isAbsolute(root)) continue;
    let lastTouched = 0;
    if (typeof id === 'string' && id && !id.includes('/') && !id.includes('\\')) {
      const chats = path.join(dir, 'tmp', id, 'chats');
      try {
        for (const f of fs.readdirSync(chats, { withFileTypes: true })) {
          if (!f.isFile()) continue;
          try {
            const st = fs.statSync(path.join(chats, f.name));
            if (st.mtimeMs > lastTouched) lastTouched = st.mtimeMs;
          } catch { /* ignore */ }
        }
      } catch { /* no sessions yet */ }
    }
    out.push({ root, lastTouched });
  }
  return out;
}
