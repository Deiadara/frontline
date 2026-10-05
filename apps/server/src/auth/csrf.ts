import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@frontline/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { presentedSession } from './session.js';

/** The methods that only read. Everything else is a write and is guarded. */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Signing out writes a cookie even for a browser that sent none, so it is guarded either way. */
const ALWAYS_GUARDED: readonly string[] = ['/api/auth/logout'];

/**
 * Signing in and signing up never act on the cookie a request carries: they check a password or
 * make an account, and answer with a cookie of their own. So a stale cookie riding along is no
 * reason to refuse one, and a scripted caller with a cookie jar can sign in twice. Neither can be
 * forged from another site: see the JSON note below.
 */
const IGNORE_COOKIE: readonly string[] = ['/api/auth/login', '/api/auth/register'];

/**
 * Whether a request is one another site could have made the browser send (security pass,
 * 2026-09-30).
 *
 * A write that rides the session cookie is the case: the cookie is attached by the browser, not
 * chosen by the page. A Bearer request is not, because no other site can make a browser attach a
 * header it chose. A write with no session at all is not either: the only ones that do anything
 * are signing in and signing up, whose bodies are JSON and which a cross-site form cannot send
 * (Fastify refuses a form body with 415, and a plain-text one fails the schema).
 */
function needsCsrfHeader(request: FastifyRequest, path: string): boolean {
  if (SAFE_METHODS.has(request.method) || IGNORE_COOKIE.includes(path)) return false;
  const via = presentedSession(request)?.via;
  if (via === 'bearer') return false;
  return via === 'cookie' || ALWAYS_GUARDED.includes(path);
}

/**
 * Refuses a cookie-borne write that lacks `CSRF_HEADER` (see its note in `@frontline/shared`).
 *
 * An `onRequest` hook, after the rate limiter's, so a refused request is still counted and never
 * reaches body parsing or a handler.
 */
export function registerCsrfGuard(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    const path = request.routeOptions.url ?? request.url.split('?')[0] ?? request.url;
    const allowed =
      !needsCsrfHeader(request, path) ||
      request.headers[CSRF_HEADER.toLowerCase()] === CSRF_HEADER_VALUE;
    done(
      allowed
        ? undefined
        : new AppError('FORBIDDEN', 'That request did not come from the game’s own page.'),
    );
  });
}
