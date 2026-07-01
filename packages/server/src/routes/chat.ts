/**
 * POST /api/chat (REQ-DASH-CHAT-001).
 *
 * The dashboard chat's server endpoint. It answers a free-form question
 * **deterministically from the project's own indexed knowledge base** — the
 * code graph, specs, and domain facts — with **no language model and no
 * network call** (A2). All the answering logic lives in the pure, Fastify-free
 * core (`chat-answer.ts`) so determinism / no-LLM is unit-testable in isolation;
 * this file is only the HTTP shell.
 *
 * Project-scoped like the spec / domain / maintainability routes: chat answers
 * come from one project's graph + spec layer, so the handler resolves the
 * active instance and 409s when no project is selectable (mirrors
 * `domain.ts`). Driven entirely through instance methods via the core, so the
 * server never runtime-imports the `@specship/specship` package (which would
 * silently serve a stale build).
 *
 * Faux-streaming (REQ-DASH-CHAT-003) and the classifier (REQ-DASH-CHAT-002)
 * are separate requirements; this endpoint returns the fully-composed answer in
 * one JSON response.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { answerFromKnowledgeBase } from './chat-answer.js';

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/chat', async (req: FastifyRequest, reply: FastifyReply) => {
    const cg = await app.activeCg(req);
    if (!cg) {
      reply.code(409).send({ error: 'no project selected', code: 'no_project' });
      return;
    }

    const body = (req.body ?? {}) as { question?: unknown };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (question.length === 0) {
      reply.code(400).send({ error: 'question is required', code: 'bad_request' });
      return;
    }

    const { found, answer, sources } = answerFromKnowledgeBase(cg, question);
    return { found, answer, sources };
  });
}
