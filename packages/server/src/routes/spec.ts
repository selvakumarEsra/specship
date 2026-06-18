/**
 * Spec layer routes — list / fetch / link assert / link verify / drift queue.
 * Plus the v0.2 write endpoints: PUT /api/spec/:id and POST /api/specs,
 * which let the dashboard's Monaco editor save spec edits back to disk.
 *
 * Every route is project-scoped via `?project=<slug>` (falls back to the
 * boot-time primary). Returns 409 / `no_project` when neither is selectable.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SpecLinkKind, NodeKind, SpecLinkState } from '@selvakumaresra/specship';
import type { SpecShipInstance } from '../project-registry.js';

interface ProjectQuery { project?: string }

interface LinkAssertBody {
  spec_id: string;
  target_file_path: string;
  target_qualified_name: string;
  target_node_kind?: NodeKind;
  kind?: SpecLinkKind;
}

interface LinkVerifyBody {
  link_id: number;
  result: 'pass' | 'fail';
  reason?: string;
}

interface SpecPutBody {
  content: string;
}

interface SpecPostBody {
  filePath: string;
  content: string;
}

/**
 * Resolve a project-relative path to an absolute path under the project
 * root, refusing anything that escapes the root (path-traversal guard).
 * Returns null when the resolved path is outside the project — caller
 * surfaces 400 in that case.
 */
function safeProjectPath(projectRoot: string, relPath: string): string | null {
  // Strip leading slashes so absolute paths in user input don't blow past
  // path.resolve's "drop earlier components" behavior.
  const cleaned = relPath.replace(/^[/\\]+/, '');
  const abs = path.resolve(projectRoot, cleaned);
  const rootResolved = path.resolve(projectRoot);
  const rel = path.relative(rootResolved, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

/**
 * Atomic file write: tmp + rename. Mirrors `atomicWriteFileSync` in
 * `src/installer/targets/shared.ts` — kept local here to avoid the
 * @selvakumaresra/specship deep-import dance for a 10-line helper.
 */
function atomicWriteFile(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, targetPath);
}

async function resolveCg(app: FastifyInstance, req: FastifyRequest, reply: FastifyReply): Promise<SpecShipInstance | null> {
  const cg = await app.activeCg(req);
  if (!cg) { reply.code(409).send({ error: 'no project selected', code: 'no_project' }); return null; }
  return cg;
}

export async function registerSpecRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/specs', async (req: FastifyRequest<{ Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const docs = cg.getSpecQueries().getAllSpecs();
    return { specs: docs };
  });

  app.get('/api/spec/:id', async (req: FastifyRequest<{ Params: { id: string }; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const sq = cg.getSpecQueries();
    const spec = sq.getSpecById(req.params.id);
    if (!spec) return reply.code(404).send({ error: 'spec not found' });

    const parent = spec.parentId ? sq.getSpecById(spec.parentId) : null;
    const children = sq.getSpecsByParent(spec.id);
    const siblings = parent ? sq.getSpecsByParent(parent.id).filter((s) => s.id !== spec.id) : [];
    const links = sq.getLinksBySpec(spec.id);

    // Read the raw source file so the dashboard's Monaco editor can edit
    // the whole document, not just the DB-parsed body fragment for this
    // requirement. The `spec.body` field stores per-section content; the
    // editor needs the file.
    let source: string | null = null;
    try {
      const projectRoot = cg.getProjectRoot();
      const absPath = safeProjectPath(projectRoot, spec.sourcePath);
      if (absPath && fs.existsSync(absPath)) {
        source = fs.readFileSync(absPath, 'utf-8');
      }
    } catch {
      // File missing or unreadable — return null so the UI can show a
      // "source not available" hint without failing the whole fetch.
    }

    return { spec, parent, siblings, children, links, source };
  });

  app.get('/api/drift', async (req: FastifyRequest<{ Querystring: ProjectQuery & { state?: string; limit?: string } }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const sq = cg.getSpecQueries();
    const validStates: SpecLinkState[] = [
      'drafted', 'implementing', 'implemented', 'verified',
      'drifted', 'broken', 'orphaned',
    ];
    const requested = (req.query.state ?? 'drifted,broken,orphaned')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is SpecLinkState => validStates.includes(s as SpecLinkState));
    const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
    const links = sq.getLinksByState(requested).slice(0, limit);
    const out = links.map((l) => {
      const spec = sq.getSpecById(l.specId);
      return { ...l, specTitle: spec?.title ?? null };
    });
    return { links: out };
  });

  app.post('/api/spec/link-assert', async (req: FastifyRequest<{ Body: LinkAssertBody; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const body = req.body;
    if (!body?.spec_id || !body.target_file_path || !body.target_qualified_name) {
      return reply.code(400).send({ error: 'spec_id, target_file_path, target_qualified_name required' });
    }
    const sq = cg.getSpecQueries();
    const spec = sq.getSpecById(body.spec_id);
    if (!spec) return reply.code(404).send({ error: 'spec not found' });

    const now = Date.now();
    const id = sq.upsertSpecLink({
      specId: body.spec_id,
      targetFilePath: body.target_file_path,
      targetQualifiedName: body.target_qualified_name,
      targetNodeKind: body.target_node_kind ?? 'function',
      resolvedNodeId: undefined,
      kind: body.kind ?? 'implements',
      state: 'implemented',
      driftAxis: null,
      specHashAtLink: spec.contentHash,
      nodeSigAtLink: undefined,
      provenance: 'agent-asserted',
      confidence: 1.0,
      createdAt: now,
      updatedAt: now,
    });
    cg.getSpecLinkResolver().resolveLinksForFiles([body.target_file_path]);
    return { id, ok: true };
  });

  app.post('/api/spec/link-verify', async (req: FastifyRequest<{ Body: LinkVerifyBody; Querystring: ProjectQuery }>, reply) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const body = req.body;
    if (typeof body?.link_id !== 'number' || (body.result !== 'pass' && body.result !== 'fail')) {
      return reply.code(400).send({ error: 'link_id (number) and result ("pass"|"fail") required' });
    }
    const sq = cg.getSpecQueries();
    const link = sq.getLinkById(body.link_id);
    if (!link) return reply.code(404).send({ error: 'link not found' });
    sq.updateSpecLinkState(body.link_id, body.result === 'pass' ? 'verified' : 'broken', null);
    return { ok: true, state: body.result === 'pass' ? 'verified' : 'broken' };
  });

  /**
   * PUT /api/spec/:id — overwrite the spec file backing this spec.
   *
   * Resolves the source file path from the existing spec row, validates it's
   * under the project root (path-traversal guard), atomically writes the new
   * content, then re-syncs the project so the indexer picks up the change.
   * Returns the freshly re-parsed spec node. Used by the dashboard's Monaco
   * editor.
   */
  app.put('/api/spec/:id', async (
    req: FastifyRequest<{ Params: { id: string }; Body: SpecPutBody; Querystring: ProjectQuery }>,
    reply,
  ) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const sq = cg.getSpecQueries();
    const spec = sq.getSpecById(req.params.id);
    if (!spec) return reply.code(404).send({ error: 'spec not found' });

    const body = req.body;
    if (typeof body?.content !== 'string') {
      return reply.code(400).send({ error: 'content (string) required' });
    }

    const projectRoot = cg.getProjectRoot();
    const absPath = safeProjectPath(projectRoot, spec.sourcePath);
    if (!absPath) {
      return reply.code(400).send({
        error: 'spec.sourcePath resolves outside project root',
        code: 'path_traversal',
      });
    }

    try {
      atomicWriteFile(absPath, body.content);
    } catch (e) {
      return reply.code(500).send({
        error: 'failed to write spec file',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    // Re-index so the freshly-edited spec replaces the old graph nodes.
    // The Markdown extractor will rebuild the doc + REQs + acceptance
    // children, and the link resolver re-runs against the new content
    // hash so drift states transition correctly.
    try {
      await cg.sync();
    } catch (e) {
      // Sync errors don't roll back the write — the file is on disk and
      // the next sync will pick it up. Surface so the UI can show a
      // "saved but not yet indexed" hint.
      const updated = sq.getSpecById(req.params.id);
      return {
        ok: true,
        spec: updated ?? spec,
        syncError: e instanceof Error ? e.message : String(e),
      };
    }

    const updated = sq.getSpecById(req.params.id);
    return { ok: true, spec: updated ?? spec };
  });

  /**
   * POST /api/specs — create a new spec file under the project's specs/
   * directory.
   *
   * `filePath` is project-relative (e.g. `specs/billing.md`). 409 if the
   * file already exists. Used by the dashboard's Draft-with-Claude flow
   * for the optional "finalize via dashboard" path.
   */
  app.post('/api/specs', async (
    req: FastifyRequest<{ Body: SpecPostBody; Querystring: ProjectQuery }>,
    reply,
  ) => {
    const cg = await resolveCg(app, req, reply); if (!cg) return;
    const body = req.body;
    if (typeof body?.filePath !== 'string' || typeof body?.content !== 'string') {
      return reply.code(400).send({ error: 'filePath and content (strings) required' });
    }

    const projectRoot = cg.getProjectRoot();
    const absPath = safeProjectPath(projectRoot, body.filePath);
    if (!absPath) {
      return reply.code(400).send({
        error: 'filePath resolves outside project root',
        code: 'path_traversal',
      });
    }

    if (fs.existsSync(absPath)) {
      return reply.code(409).send({
        error: 'file already exists',
        code: 'file_exists',
        filePath: body.filePath,
      });
    }

    try {
      atomicWriteFile(absPath, body.content);
    } catch (e) {
      return reply.code(500).send({
        error: 'failed to write spec file',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    try {
      await cg.sync();
    } catch (e) {
      return {
        ok: true,
        filePath: body.filePath,
        syncError: e instanceof Error ? e.message : String(e),
      };
    }

    return { ok: true, filePath: body.filePath };
  });
}
