"use strict";
/**
 * Spec layer routes — list / fetch / link assert / link verify / drift queue.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSpecRoutes = registerSpecRoutes;
async function registerSpecRoutes(app) {
    app.get('/api/specs', async () => {
        const sq = app.cg.getSpecQueries();
        const docs = sq.getAllSpecs();
        return { specs: docs };
    });
    app.get('/api/spec/:id', async (req, reply) => {
        const sq = app.cg.getSpecQueries();
        const spec = sq.getSpecById(req.params.id);
        if (!spec)
            return reply.code(404).send({ error: 'spec not found' });
        const parent = spec.parentId ? sq.getSpecById(spec.parentId) : null;
        const children = sq.getSpecsByParent(spec.id);
        const siblings = parent ? sq.getSpecsByParent(parent.id).filter((s) => s.id !== spec.id) : [];
        const links = sq.getLinksBySpec(spec.id);
        return { spec, parent, siblings, children, links };
    });
    app.get('/api/drift', async (req) => {
        const sq = app.cg.getSpecQueries();
        const validStates = [
            'drafted', 'implementing', 'implemented', 'verified',
            'drifted', 'broken', 'orphaned',
        ];
        const requested = (req.query.state ?? 'drifted,broken,orphaned')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => validStates.includes(s));
        const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
        const links = sq.getLinksByState(requested).slice(0, limit);
        // Enrich with spec title for the UI.
        const out = links.map((l) => {
            const spec = sq.getSpecById(l.specId);
            return { ...l, specTitle: spec?.title ?? null };
        });
        return { links: out };
    });
    app.post('/api/spec/link-assert', async (req, reply) => {
        const body = req.body;
        if (!body?.spec_id || !body.target_file_path || !body.target_qualified_name) {
            return reply.code(400).send({ error: 'spec_id, target_file_path, target_qualified_name required' });
        }
        const sq = app.cg.getSpecQueries();
        const spec = sq.getSpecById(body.spec_id);
        if (!spec)
            return reply.code(404).send({ error: 'spec not found' });
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
        app.cg.getSpecLinkResolver().resolveLinksForFiles([body.target_file_path]);
        return { id, ok: true };
    });
    app.post('/api/spec/link-verify', async (req, reply) => {
        const body = req.body;
        if (typeof body?.link_id !== 'number' || (body.result !== 'pass' && body.result !== 'fail')) {
            return reply.code(400).send({ error: 'link_id (number) and result ("pass"|"fail") required' });
        }
        const sq = app.cg.getSpecQueries();
        const link = sq.getLinkById(body.link_id);
        if (!link)
            return reply.code(404).send({ error: 'link not found' });
        sq.updateSpecLinkState(body.link_id, body.result === 'pass' ? 'verified' : 'broken', null);
        return { ok: true, state: body.result === 'pass' ? 'verified' : 'broken' };
    });
}
//# sourceMappingURL=spec.js.map