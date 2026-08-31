import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LIMIT_SWEEP_MS, RateLimiter } from './bucket.js';
import { ruleFor } from './rules.js';

/**
 * Wires the limiter into the request lifecycle.
 *
 * `onRequest`, the earliest hook there is, so a refused call costs a map lookup and never reaches
 * body parsing, authentication or the database. That ordering is the point of a rate limit: the
 * work it saves is the work it refuses to start.
 *
 * ## Counted against the account when there is one, the address when there is not
 *
 * The token is read here rather than waiting for `authenticate`, because `onRequest` runs first and
 * an address is the wrong key for a logged-in player: everyone behind one office NAT would share a
 * bucket. It is only *decoded*, never trusted for anything but bucketing, so an expired or forged
 * token simply falls back to the address. The route's own `preHandler` still decides who may act.
 */
export function registerRateLimits(app: FastifyInstance, limiter = new RateLimiter()): RateLimiter {
  const sweep = setInterval(() => limiter.sweep(), LIMIT_SWEEP_MS);
  sweep.unref?.();
  app.addHook('onClose', () => clearInterval(sweep));

  app.addHook('onRequest', async (request, reply) => {
    const { rule, scope } = ruleFor(request.method, request.url.split('?')[0] ?? request.url);
    const decision = limiter.take(`${scope}:${callerOf(app, request)}`, rule);

    reply.header('X-RateLimit-Limit', String(rule.quota));
    reply.header('X-RateLimit-Remaining', String(decision.remaining));
    if (decision.allowed) return;

    reply.header('Retry-After', String(decision.retryAfterSeconds));
    // 429 with a body in the shape every other refusal uses, so the client's existing error
    // handling reads it without a special case.
    await reply.status(429).send({
      error: {
        code: 'RATE_LIMITED',
        message: 'That is more requests than this server will take. Give it a moment.',
      },
    });
  });

  return limiter;
}

/** The account this request belongs to, or the address it came from. */
function callerOf(app: FastifyInstance, request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const payload = app.jwt.verify<{ sub?: string }>(header.slice(7));
      if (payload.sub) return `user:${payload.sub}`;
    } catch {
      // Not a token this server issued, or an expired one. The address will do.
    }
  }
  return `ip:${request.ip}`;
}
