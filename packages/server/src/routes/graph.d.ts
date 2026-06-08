/**
 * Graph routes — node detail + explore + search.
 *
 * These are thin wrappers around methods on the SpecShip instance. The
 * MCP layer's `specship_*` tools are markdown-formatted for agents; here
 * we return raw JSON so the UI can render visually.
 */
import type { FastifyInstance } from 'fastify';
export declare function registerGraphRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=graph.d.ts.map