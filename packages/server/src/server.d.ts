/**
 * Fastify HTTP server for specship + SpecShip Desktop UI.
 *
 * Routes follow the design spec — `/api/graph/*`, `/api/spec/*`,
 * `/api/drift`, `/api/workflows/*`, `/api/claude/*`. Each route group lives
 * in its own file under `./routes/` and registers itself on a passed
 * Fastify instance.
 *
 * Why Fastify: lighter than Express, faster, first-class TypeScript types,
 * built-in JSON schema validation, plugins for CORS + SSE. The 30K LoC
 * Archon UI port pulls ~20+ API routes — Fastify's plugin model keeps the
 * registration code tidy.
 */
import { FastifyInstance } from 'fastify';
import type { WatcherHandle } from '@specship/specship-ingest';
export interface ServerOptions {
    /** Path to the project root (passed to SpecShip.open). */
    projectRoot: string;
    /** Host to bind. Default '127.0.0.1' — loopback only. */
    host?: string;
    /** Port to bind. Default 4242. */
    port?: number;
    /** Allow CORS for the Vite dev server (http://localhost:5173). Default true. */
    cors?: boolean;
    /** Watcher handle, if Claude transcript ingest is running. */
    watcher?: WatcherHandle | null;
    /** Verbose logging. */
    verbose?: boolean;
}
export interface ServerHandle {
    app: FastifyInstance;
    url: string;
    port: number;
    host: string;
    stop: () => Promise<void>;
}
export declare function createServer(options: ServerOptions): Promise<ServerHandle>;
declare module 'fastify' {
    interface FastifyInstance {
        cg: Awaited<ReturnType<typeof import('@specship/specship').SpecShip.open>>;
        watcher: WatcherHandle | null;
    }
}
//# sourceMappingURL=server.d.ts.map