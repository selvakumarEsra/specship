/**
 * @selvakumaresra/specship-server — public API.
 *
 * Fastify-based HTTP layer that mirrors specship's MCP tools as REST so the
 * SpecShip Desktop UI (and any other client) can drive the graph + spec
 * layer + workflow engine + Claude Code analytics.
 *
 * Boots on 127.0.0.1 by default. Override via host / port options on
 * `createServer()`. No auth by default — host bound to loopback. For
 * remote access, generate + require a bearer token (TODO).
 */
export { createServer } from './server.js';
export type { ServerOptions, ServerHandle } from './server.js';
//# sourceMappingURL=index.d.ts.map