import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Set the standard SSE response headers on the raw socket AND reflect the
 * request's `Origin` as `Access-Control-Allow-Origin`.
 *
 * SSE handlers write to `reply.raw` directly and flush immediately, which
 * bypasses Fastify's response lifecycle — so `@fastify/cors` (registered with
 * `origin: true`) never gets to add the CORS header. Without this, a
 * cross-origin `EventSource` is blocked: e.g. the dashboard opened at
 * `127.0.0.1:<port>` calling the API host `localhost` (different origins to the
 * browser), or the Angular dev server on `:4200`. Echoing the request origin
 * mirrors what `origin: true` does for the non-raw routes.
 */
export function writeSseHead(req: FastifyRequest, reply: FastifyReply): void {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    reply.raw.setHeader('Access-Control-Allow-Origin', origin);
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.setHeader('Vary', 'Origin');
  }
}
