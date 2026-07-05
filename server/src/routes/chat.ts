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
 * The question is routed by the deterministic, I/O-free classifier
 * (`../chat/classify.ts`, REQ-DASH-CHAT-002) to the matching knowledge-base
 * query via `answerForIntent`. Two shapes are served:
 *
 *   - `POST /api/chat` — returns the fully-composed answer in one JSON response.
 *   - `GET  /api/chat/stream` — faux-streams the SAME answer as a paced SSE
 *     event sequence (REQ-DASH-CHAT-003): the full answer is computed first,
 *     then emitted as `thinking` → `tool` → `result_summary` → `chunk`… →
 *     `done`. The chunking is presentation pacing only; a client disconnect ends
 *     the stream cleanly without throwing (A4).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { writeSseHead } from './sse.js';
import { answerForIntent, chunkAnswer } from './chat-answer.js';
import { classifyIntent, type ClassifiedIntent } from '../chat/classify.js';

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

    const classified = classifyIntent(question);
    const { found, answer, sources } = answerForIntent(cg, classified);
    return { found, answer, sources };
  });

  // ---------------------------------------------------------------------------
  // GET /api/chat/stream (REQ-DASH-CHAT-003) — the faux-streaming variant.
  //
  // GET + SSE so the browser's native `EventSource` (via ApiService) drives it.
  // The answer is composed in full BEFORE the first chunk is written (A3), then
  // paced out as named events. Writes go straight to `reply.raw` and the handler
  // returns without awaiting the pacing — mirrors `events.ts`; the setTimeout
  // chain keeps writing after the handler resolves and `reply.raw.end()` closes
  // the stream after the `done` sentinel. Every write is guarded so a client
  // disconnect (which flips `closed` and clears the timer) ends cleanly (A4).
  // ---------------------------------------------------------------------------
  app.get('/api/chat/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const cg = await app.activeCg(req);
    if (!cg) {
      reply.code(409).send({ error: 'no project selected', code: 'no_project' });
      return;
    }

    const q = (req.query as { question?: unknown } | undefined)?.question;
    const question = typeof q === 'string' ? q.trim() : '';
    if (question.length === 0) {
      reply.code(400).send({ error: 'question is required', code: 'bad_request' });
      return;
    }

    // Compose the whole answer up front — chunk boundaries/pacing below affect
    // presentation only, never content (A3).
    const classified = classifyIntent(question);
    const { found, answer, sources } = answerForIntent(cg, classified);
    const chunks = chunkAnswer(answer);
    const tool = toolForIntent(classified);

    writeSseHead(req, reply);

    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const write = (event: string, data: unknown): void => {
      if (closed) return;
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* peer gone — stop writing */
      }
    };

    // A client disconnect ends the stream cleanly: stop the pacing, write no more.
    req.raw.on('close', () => {
      closed = true;
      if (timer) clearTimeout(timer);
    });

    // Pre-chunk events, in the order the spec fixes (A1).
    write('thinking', { started: true });
    write('tool', { name: tool.name, input: tool.input });
    write('result_summary', { found, sourceCount: sources.length });

    // Pace the answer chunks, then the terminal `done` sentinel.
    let idx = 0;
    const step = (): void => {
      if (closed) return;
      if (idx >= chunks.length) {
        write('done', { found, sources });
        if (!closed) {
          try { reply.raw.end(); } catch { /* already closed */ }
        }
        return;
      }
      write('chunk', { text: chunks[idx] });
      idx += 1;
      timer = setTimeout(step, CHUNK_PACING_MS);
    };
    step();
  });
}

/** Inter-chunk delay for the faux-stream — small, presentation-only pacing. */
const CHUNK_PACING_MS = 24;

/**
 * The truthful tool-call the answer came from (REQ-DASH-CHAT-004.A2) — the
 * capability name the UI renders in its tool card, plus the real query input.
 * Maps each classified intent to the specship capability that answered it; the
 * input is the classifier's own query so the card reflects what actually ran.
 */
function toolForIntent(classified: ClassifiedIntent): { name: string; input: string } {
  const input = classified.query.trim();
  switch (classified.intent) {
    case 'callers': return { name: 'specship_callers', input };
    case 'callees': return { name: 'specship_callees', input };
    case 'impact':  return { name: 'specship_impact', input };
    case 'spec':    return { name: 'specship_spec', input };
    case 'domain':  return { name: 'specship_spec', input };
    case 'drift':   return { name: 'specship_drifted', input };
    case 'explore': return { name: 'specship_explore', input };
    case 'search':
    default:        return { name: 'specship_search', input };
  }
}
