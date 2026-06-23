/**
 * Designer MCP tools — claude.ai/design driving, vendored from @pro-vi/designer.
 *
 * These six tools merge the standalone `designer` MCP into SpecShip's surface
 * so one `specship serve --mcp` exposes both the code-graph tools and the
 * design loop:
 *   - designer_session   — enter / inspect / transition a claude.ai/design session
 *   - designer_prompt    — modify the design (returns a live URL to taste)
 *   - designer_ask       — Q&A with the design assistant (no file change)
 *   - designer_list      — list projects or files
 *   - designer_snapshot  — capture the current file (paths + hash; optional HTML)
 *   - designer_handoff   — fetch the export bundle → ./artifacts/<key>/handoff-<ts>/
 *
 * The heavy lifting lives in the vendored subtree under src/designer/ (compiled
 * separately to dist/designer/ as CommonJS — see src/designer/tsconfig.json).
 * We load it through a RUNTIME require so SpecShip's strict root tsc never has
 * to type-check the foreign code. `DesignerController` holds a CDP connection to
 * a debug Chrome; it is a per-process singleton (keyed by `key`) held here so
 * the daemon shares one browser across MCP clients.
 *
 * Runtime requirements (inherited from designer, NOT vendored): the external
 * `agent-browser` binary on PATH, and a one-time Chrome debug-profile + login
 * (`designer setup`). Tools surface a clear error if the session isn't ready.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ToolDefinition, ToolResult } from './tools';

// --- Runtime bridge into the vendored (CJS) designer subtree -----------------

/** The subset of DesignerController we call. Kept local so the strict root
 *  build needs no types from the foreign subtree. */
interface DesignerControllerLike {
  key: string;
  session(opts: { action?: string; name?: string; fidelity?: string }): Promise<unknown>;
  iterate(
    prompt: string,
    opts: { file?: string; timeoutMs?: number; stabilityMs?: number; decisive?: boolean }
  ): Promise<unknown>;
  ask(prompt: string, opts: { file?: string; timeoutMs?: number; stabilityMs?: number }): Promise<unknown>;
  listProjects(): Promise<unknown>;
  listFilesDetailed(): Promise<{ files: unknown; folders: string[]; authoritative: boolean }>;
  openFile(filename: string): Promise<{ ok: boolean; error?: string }>;
  snapshotDesign(opts: Record<string, unknown>): Promise<{
    url: string;
    iframeSrc?: string | null;
    html?: string | null;
    screenshotPath?: string | null;
  }>;
  handoff(opts: { openFile?: string }): Promise<unknown>;
}

interface DesignerModule {
  DesignerController: new (opts: { key: string; headed?: boolean }) => DesignerControllerLike;
}
interface ArtifactStoreModule {
  sessionDir: (key: string) => string;
}

// Lazy module handles + per-key controller cache (process singleton).
let designerMod: DesignerModule | null = null;
let artifactStoreMod: ArtifactStoreModule | null = null;
const controllers = new Map<string, DesignerControllerLike>();

function loadDesignerModules(): { designer: DesignerModule; artifacts: ArtifactStoreModule } {
  if (!designerMod || !artifactStoreMod) {
    // Relative to the COMPILED location (dist/mcp/designer-tools.js → dist/designer/*).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    designerMod = require('../designer/designer-controller') as DesignerModule;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    artifactStoreMod = require('../designer/artifact-store') as ArtifactStoreModule;
  }
  return { designer: designerMod, artifacts: artifactStoreMod };
}

function getController(key: string | undefined): DesignerControllerLike {
  const k = key || 'default';
  let c = controllers.get(k);
  if (!c) {
    const { designer } = loadDesignerModules();
    c = new designer.DesignerController({ key: k, headed: true });
    controllers.set(k, c);
  }
  return c;
}

function ok(obj: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
  };
}
function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a controller call so a not-ready session / missing agent-browser
 *  surfaces as a clean tool error rather than an unhandled rejection. */
async function guard(run: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await run());
  } catch (err) {
    return fail(`designer: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

// --- Handlers ----------------------------------------------------------------

export async function handleDesignerSession(args: Record<string, unknown>): Promise<ToolResult> {
  const key = str(args.key);
  const action = str(args.action) ?? 'status';
  const name = str(args.name);
  const fidelity = str(args.fidelity);
  return guard(() => getController(key).session({ action, name, fidelity }));
}

export async function handleDesignerPrompt(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = str(args.prompt);
  if (prompt === undefined) return fail('designer_prompt: "prompt" (string) is required');
  const key = str(args.key);
  return guard(() =>
    getController(key).iterate(prompt, {
      file: str(args.file),
      timeoutMs: num(args.timeoutMs),
      stabilityMs: num(args.stabilityMs),
      decisive: bool(args.decisive),
    })
  );
}

export async function handleDesignerAsk(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = str(args.prompt);
  if (prompt === undefined) return fail('designer_ask: "prompt" (string) is required');
  const key = str(args.key);
  return guard(() =>
    getController(key).ask(prompt, {
      file: str(args.file),
      timeoutMs: num(args.timeoutMs),
      stabilityMs: num(args.stabilityMs),
    })
  );
}

export async function handleDesignerList(args: Record<string, unknown>): Promise<ToolResult> {
  const scope = str(args.scope);
  if (scope !== 'projects' && scope !== 'files') {
    return fail('designer_list: "scope" must be "projects" or "files"');
  }
  const key = str(args.key);
  return guard(async () => {
    const c = getController(key);
    if (scope === 'projects') return c.listProjects();
    const detail = await c.listFilesDetailed();
    if (!detail.authoritative) {
      return {
        files: detail.files,
        folders: detail.folders,
        authoritative: false,
        warning:
          'This project has folders (' +
          detail.folders.join(', ') +
          '). Files under folders are not visible to the live file-list scrape. Call designer_handoff for an authoritative list.',
      };
    }
    return { files: detail.files, authoritative: true };
  });
}

export async function handleDesignerSnapshot(args: Record<string, unknown>): Promise<ToolResult> {
  const key = str(args.key);
  const filename = str(args.filename);
  const includeHtml = bool(args.includeHtml) ?? false;
  const screenshot = bool(args.screenshot) ?? true;
  return guard(async () => {
    const { artifacts } = loadDesignerModules();
    const c = getController(key);
    if (filename) {
      const swap = await c.openFile(filename);
      if (!swap.ok) return { ok: false, error: swap.error, file: filename };
    }
    const snap = await c.snapshotDesign({});
    let htmlPath: string | null = null;
    if (snap.html) {
      htmlPath = path.join(artifacts.sessionDir(c.key), `snap-${Date.now()}.html`);
      fs.writeFileSync(htmlPath, snap.html);
    }
    return {
      ok: true,
      file: filename || extractFileParamFromUrl(snap.url),
      url: snap.url,
      iframeSrc: snap.iframeSrc,
      htmlPath,
      screenshotPath: screenshot ? snap.screenshotPath : null,
      htmlBytes: snap.html ? snap.html.length : 0,
      html: includeHtml ? snap.html : undefined,
    };
  });
}

export async function handleDesignerHandoff(args: Record<string, unknown>): Promise<ToolResult> {
  const key = str(args.key);
  const openFile = str(args.openFile);
  return guard(() => getController(key).handoff({ openFile }));
}

function extractFileParamFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('file');
  } catch {
    return null;
  }
}

// --- Definitions -------------------------------------------------------------

export const designerToolDefinitions: ToolDefinition[] = [
  {
    name: 'designer_session',
    description:
      "Enter, inspect, or transition a claude.ai/design session (drives a debug Chrome via CDP). action='status' (default) is a read-only orient — returns stored state + currentUrl + inSession + availableFiles. Other actions: ensure_ready (navigate to /design), resume (open the stored design URL), create (new project — requires name), adopt (bind an already-open /design/p/<uuid> tab), clear (dismiss interstitial overlays). Requires the agent-browser tool on PATH and a signed-in debug Chrome (one-time `designer setup`).",
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Stable key for this loop (e.g. feature name). Defaults to "default".' },
        action: {
          type: 'string',
          description: 'Default: status',
          enum: ['status', 'ensure_ready', 'resume', 'create', 'adopt', 'clear'],
        },
        name: { type: 'string', description: 'Required when action=create; optional label when action=adopt.' },
        fidelity: {
          type: 'string',
          description: 'wireframe (default) or highfi — folded into the creation seed prompt.',
          enum: ['wireframe', 'highfi'],
        },
      },
    },
  },
  {
    name: 'designer_prompt',
    description:
      "Modify the design. Sends a prompt expected to change the served HTML (e.g. 'create a login screen'). Waits for Claude Design's turn to complete, then returns slim metadata (NOT inline HTML). DEFAULT TASTE PATH: hand the human the returned `url` — it's the live, interactive claude.ai/design surface. Auto-appends a 'keep all files at project root, no subfolders' instruction.",
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Stable key for this loop. Defaults to "default".' },
        prompt: { type: 'string', description: 'The instruction to send to Claude Design.' },
        file: { type: 'string', description: 'Switch to this file before sending (targets the prompt at it).' },
        timeoutMs: { type: 'number', description: 'Default 20m. Hi-fi generations can take 15+ min.' },
        stabilityMs: { type: 'number', description: 'Default 4s.' },
        decisive: {
          type: 'boolean',
          description: "Append a 'do not stop to ask clarifying questions' instruction.",
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'designer_ask',
    description:
      "Q&A with the design assistant — text-only, changes no file. Use for 'why did you choose X?', 'compare A vs B', 'suggest 3 alternatives before I commit'. Returns the assistant's reply.",
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Stable key for this loop. Defaults to "default".' },
        prompt: { type: 'string', description: 'The question to ask Claude Design.' },
        file: { type: 'string', description: 'Switch to this file before asking (gives Claude context).' },
        timeoutMs: { type: 'number', description: 'Default 5m.' },
        stabilityMs: { type: 'number', description: 'Default 2.5s.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'designer_list',
    description:
      "Inventory. scope='projects' lists all your Claude design projects; scope='files' lists files in the currently-open project (flat-only — folder contents need designer_handoff). Usually unnecessary — designer_session already returns availableFiles.",
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Stable key for this loop. Defaults to "default".' },
        scope: { type: 'string', description: 'projects or files', enum: ['projects', 'files'] },
      },
      required: ['scope'],
    },
  },
  {
    name: 'designer_snapshot',
    description:
      "Inspect a file's current state. Switches to `filename` first if given. Default returns paths + hash only (HTML written to disk at htmlPath); set includeHtml=true to inline the HTML. Reads the real rendered HTML over CDP from inside the cross-origin preview iframe.",
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Stable key for this loop. Defaults to "default".' },
        filename: { type: 'string', description: 'Switch to this file first. Omit to snapshot whatever is active.' },
        includeHtml: { type: 'boolean', description: 'Default false.' },
        screenshot: { type: 'boolean', description: 'Default true.' },
      },
    },
  },
  {
    name: 'designer_handoff',
    description:
      "Promote: fetch the project's export zip and extract it under ./artifacts/<key>/handoff-<ts>/project/, plus decision-record.md (the live chat transcript, verbatim). Call when the human says 'yes, that's it'. The bundle is what /ss-design-loop feeds to the claude-design-implement workflow.",
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Stable key for this loop. Defaults to "default".' },
        openFile: { type: 'string', description: 'Set the open file before handoff.' },
      },
    },
  },
];
