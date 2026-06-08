"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const graph_js_1 = require("./routes/graph.js");
const spec_js_1 = require("./routes/spec.js");
const workflow_js_1 = require("./routes/workflow.js");
const claude_js_1 = require("./routes/claude.js");
const status_js_1 = require("./routes/status.js");
/**
 * Lazy-import the specship core. We can't statically import it because the
 * server package's `file:../..` dependency hasn't been built into a `dist/`
 * yet at server-package install time on a fresh clone. Instead we resolve
 * the parent root at runtime — same module the CLI uses.
 */
async function loadSpecShip() {
    return Promise.resolve().then(() => __importStar(require('@selvakumaresra/specship')));
}
async function createServer(options) {
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 4242;
    const verbose = options.verbose ?? false;
    const app = (0, fastify_1.default)({
        logger: verbose
            ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
            : false,
    });
    if (options.cors !== false) {
        // Permissive CORS for local dev. The server is bound to loopback by
        // default, so the broad allowlist is fine — Browsers won't get to it
        // from a non-localhost origin without explicit user override.
        await app.register(cors_1.default, {
            origin: true,
            credentials: false,
        });
    }
    // Lazy-load specship and open the project once. All routes share this instance.
    const cgMod = await loadSpecShip();
    const cg = await cgMod.SpecShip.open(options.projectRoot);
    // Decorate the Fastify instance so route handlers can access shared state
    // without globals or DI containers.
    app.decorate('cg', cg);
    app.decorate('watcher', options.watcher ?? null);
    // Register route groups.
    await (0, status_js_1.registerStatusRoutes)(app);
    await (0, graph_js_1.registerGraphRoutes)(app);
    await (0, spec_js_1.registerSpecRoutes)(app);
    await (0, workflow_js_1.registerWorkflowRoutes)(app);
    await (0, claude_js_1.registerClaudeRoutes)(app);
    await app.listen({ host, port });
    const url = `http://${host}:${port}`;
    return {
        app,
        url,
        host,
        port,
        stop: async () => {
            try {
                cg.close();
            }
            catch { /* ignore */ }
            await app.close();
        },
    };
}
//# sourceMappingURL=server.js.map