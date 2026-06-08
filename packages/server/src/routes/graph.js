"use strict";
/**
 * Graph routes — node detail + explore + search.
 *
 * These are thin wrappers around methods on the SpecShip instance. The
 * MCP layer's `specship_*` tools are markdown-formatted for agents; here
 * we return raw JSON so the UI can render visually.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGraphRoutes = registerGraphRoutes;
async function registerGraphRoutes(app) {
    app.get('/api/graph/stats', async () => {
        const cg = app.cg;
        const stats = cg.getStats();
        return stats;
    });
    /**
     * List nodes with optional kind / file / limit filtering. For node-explorer
     * UI surfaces that want a flat paginated list.
     */
    app.get('/api/graph/nodes', async (req) => {
        const cg = app.cg;
        const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 1000);
        const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);
        // Use the underlying QueryBuilder via the queries helper. SpecShip
        // doesn't expose a flat-list method directly, so use searchNodes with
        // an empty query as a fallback. For real volume queries the UI should
        // use the file tree + per-file getNodesByFile pattern.
        // searchNodes returns SearchResult[] — extract the node and pass through.
        const results = cg.searchNodes(req.query.kind ?? '', { limit: limit + offset });
        return {
            total: results.length,
            offset,
            limit,
            nodes: results.slice(offset, offset + limit).map((r) => r.node),
        };
    });
    /**
     * GET /api/graph/node — by symbol name (with optional file/line disambiguation)
     * or by exact id. Returns the node + callers + callees + linked specs.
     */
    app.get('/api/graph/node', async (req, reply) => {
        const cg = app.cg;
        const { symbol, id, file, line } = req.query;
        if (!symbol && !id) {
            return reply.code(400).send({ error: 'symbol or id is required' });
        }
        let matches = [];
        if (id) {
            const node = cg.getNode(id);
            if (node)
                matches = [node];
        }
        else if (symbol) {
            matches = cg.searchNodes(symbol, { limit: 50 }).map((r) => r.node);
            if (file) {
                const f = file.toLowerCase();
                const narrowed = matches.filter((n) => n.filePath.toLowerCase().includes(f));
                if (narrowed.length > 0)
                    matches = narrowed;
            }
            if (line) {
                const ln = parseInt(line, 10);
                if (Number.isFinite(ln)) {
                    const containing = matches.filter((n) => n.startLine <= ln && (n.endLine ?? n.startLine) >= ln);
                    matches = containing.length > 0 ? containing : matches.slice(0, 1);
                }
            }
        }
        if (matches.length === 0)
            return reply.code(404).send({ error: 'not found' });
        const enriched = matches.map((n) => {
            const callers = cg.getCallers(n.id).map((e) => e.node);
            const callees = cg.getCallees(n.id).map((e) => e.node);
            const links = cg.getSpecQueries().getLinksByNode(n.id);
            return { ...n, callers, callees, linkedSpecs: links };
        });
        return { matches: enriched };
    });
    app.post('/api/graph/explore', async (req, reply) => {
        const cg = app.cg;
        const { query, maxFiles } = req.body ?? { query: '' };
        if (!query)
            return reply.code(400).send({ error: 'query is required' });
        // Use the public buildContext as a stand-in for explore's text response.
        // The UI consumes this as markdown for now.
        void maxFiles;
        const ctx = await cg.buildContext(query, {
            maxNodes: 80,
            includeCode: true,
            format: 'markdown',
        });
        return ctx;
    });
    app.get('/api/graph/search', async (req) => {
        const cg = app.cg;
        const q = req.query.q ?? '';
        const limit = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 200);
        if (!q)
            return { results: [] };
        const kinds = req.query.kind ? [req.query.kind] : undefined;
        const results = cg.searchNodes(q, { kinds, limit });
        return { results };
    });
    app.get('/api/graph/callers/:id', async (req, reply) => {
        const cg = app.cg;
        const node = cg.getNode(req.params.id);
        if (!node)
            return reply.code(404).send({ error: 'node not found' });
        return { callers: cg.getCallers(req.params.id).map((e) => e.node) };
    });
    app.get('/api/graph/callees/:id', async (req, reply) => {
        const cg = app.cg;
        const node = cg.getNode(req.params.id);
        if (!node)
            return reply.code(404).send({ error: 'node not found' });
        return { callees: cg.getCallees(req.params.id).map((e) => e.node) };
    });
    app.get('/api/graph/impact/:id', async (req) => {
        const cg = app.cg;
        const depth = Math.min(parseInt(req.query.depth ?? '2', 10) || 2, 5);
        return { impact: cg.getImpactRadius(req.params.id, depth) };
    });
    app.get('/api/graph/files', async () => {
        return { files: app.cg.getFiles() };
    });
}
//# sourceMappingURL=graph.js.map