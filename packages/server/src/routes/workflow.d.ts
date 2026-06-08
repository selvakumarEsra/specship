/**
 * Workflow routes — discover / run / resume / cancel / approve / reject /
 * runs list / run detail + SSE event stream.
 *
 * The SSE endpoint streams workflow_events as they're appended to the DB.
 * Implementation: poll the events table every 500ms, send only rows newer
 * than the last sent id. This is intentionally simple — for v1, polling the
 * same SQLite the executor writes to is faster + more reliable than wiring
 * an in-process event bus across packages.
 */
import type { FastifyInstance } from 'fastify';
export declare function registerWorkflowRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=workflow.d.ts.map