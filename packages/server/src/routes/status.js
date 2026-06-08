"use strict";
/**
 * GET /api/status — backend, journal mode, node/edge counts, drift count,
 * last index time. Drives the UI's persistent status strip.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerStatusRoutes = registerStatusRoutes;
async function registerStatusRoutes(app) {
    app.get('/api/status', async () => {
        const cg = app.cg;
        const stats = cg.getStats();
        const lastIndexed = cg.getLastIndexedAt();
        const drift = cg
            .getSpecQueries()
            .getLinksByState(['drifted', 'broken', 'orphaned']).length;
        return {
            projectPath: cg.getProjectRoot ? cg.getProjectRoot() : '',
            backend: cg.getBackend(),
            journalMode: cg.getJournalMode(),
            nodeCount: stats.nodeCount,
            edgeCount: stats.edgeCount,
            fileCount: stats.fileCount,
            drift,
            lastIndexed: lastIndexed != null ? new Date(lastIndexed).toISOString() : null,
            nodesByKind: stats.nodesByKind,
            filesByLanguage: stats.filesByLanguage,
            dbSizeBytes: stats.dbSizeBytes,
        };
    });
}
//# sourceMappingURL=status.js.map