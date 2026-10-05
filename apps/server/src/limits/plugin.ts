import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LIMIT_SWEEP_MS, RateLimiter } from './bucket.js';
import { presentedSession } from '../auth/session.js';
import { countsByAddress, ruleFor } from './rules.js';

/**
 * Wires the limiter into the request lifecycle.
 *
 * `onRequest`, the earliest hook there is, so a refused call costs a map lookup and never reaches
 * unit parsing, authentication or the database. That ordering is the point of a rate limit: the
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
    /*
     * Classified by the route the router matched, not by the raw URL (bug pass, 2026-09-28). The
     * router decodes a path before matching it, so `/api/%61uth/login` signs in, and a prefix test
     * on the raw text sent it to the 120-a-minute write bucket instead of the sign-in one. The raw
     * path is left for a request that matched nothing, which is a 404 whatever it is counted as.
     */
    const path = request.routeOptions.url ?? request.url.split('?')[0] ?? request.url;
    const { rule, scope } = ruleFor(request.method, path);
    const caller = countsByAddress(path)
      ? `ip:${addressBucket(request.ip)}`
      : callerOf(app, request);
    const decision = limiter.take(`${scope}:${caller}`, rule);

    reply.header('X-RateLimit-Limit', String(rule.quota));
    reply.header('X-RateLimit-Remaining', String(decision.remaining));
    if (decision.allowed) return;

    reply.header('Retry-After', String(decision.retryAfterSeconds));
    // 429 with a unit in the shape every other refusal uses, so the client's existing error
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

/**
 * The account this request belongs to, or the address it came from.
 *
 * Only a token at the account's current session version counts as the account (security pass,
 * 2026-09-28). A token revoked by "log out everywhere" or a password change still verifies here,
 * and counted against the account, whoever held it could spend the owner's whole budget and the
 * owner's fresh session met a 429 for as long as the old token had left to run, which is up to
 * thirty days. A revoked token is counted against its address instead.
 *
 * The bucket itself is the account's and never the version's (bug pass, 2026-09-29). It used to be
 * keyed `user:<id>:<version>`, and a password change bumps the version and hands the caller a token
 * at the new one, so every change opened a fresh bucket: following the returned token, forty-five
 * changes in a row all went through, each one a bcrypt hash on the loop every player shares, which
 * is the cost `PASSWORD_PATHS` puts them on the sign-in budget to stop.
 */
function callerOf(app: FastifyInstance, request: FastifyRequest): string {
  // The cookie or the Bearer header, whichever the request carries: the account is the same.
  const presented = presentedSession(request);
  if (presented) {
    try {
      const payload = app.jwt.verify<{ sub?: string; ver?: number }>(presented.token);
      if (payload.sub && payload.ver === app.repos.users.sessionVersion(payload.sub)) {
        return `user:${payload.sub}`;
      }
    } catch {
      // Not a token this server issued, or an expired one. The address will do.
    }
  }
  return `ip:${addressBucket(request.ip)}`;
}

/**
 * The part of an address that names one caller.
 *
 * IPv4 as it is. IPv6 by its /64, because a single home or server is handed a whole /64 and can
 * answer from any of its 2^64 addresses: keyed whole, every request would be a fresh bucket. An
 * IPv4 address written in IPv6 form (`::ffff:1.2.3.4`) is the IPv4 address.
 */
export function addressBucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1]!;
  if (!ip.includes(':')) return ip;
  const [head = '', tail = ''] = ip.toLowerCase().split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === '' ? [] : tail.split(':');
  const groups = ip.includes('::')
    ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
