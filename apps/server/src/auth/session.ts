import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../types.js';

/**
 * Sessions that end (maintainer, 2026-09-27: thirty days, sliding).
 *
 * A token is good for thirty days from when it was signed, and it carries the account's session
 * version (`users.session_version`). While a player keeps playing, any authenticated answer more
 * than a day after their token was signed carries a fresh one, so an active player never meets the
 * login screen and a stolen token stops working a month after it was last renewed.
 *
 * Bumping the version ends every session at once: a password change does it, and so does "log out
 * everywhere". The tab that asked is handed a token at the new version, so it is the one session
 * that survives.
 *
 * ## Two ways to carry it (security pass, 2026-09-30)
 *
 * The browser carries its session in an httpOnly cookie. It used to hold the token in
 * `localStorage`, where any script that ever ran on the page could read it and take the account
 * away for a month; a script cannot read an httpOnly cookie at all. Renewal and rotation arrive as a
 * fresh cookie, and the page never sees the token.
 *
 * `Authorization: Bearer` still works, for scripted callers: the playthrough, the load script and
 * the server's own tests, a few hundred of which sign in that way. A browser never sends it, since
 * the client has no token to send. A Bearer caller gets its renewals the way it always did, in the
 * `x-session-token` header, because a caller with no cookie jar would otherwise lose them.
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
export const SESSION_HEADER = 'x-session-token';
export const SESSION_COOKIE = 'frontline_session';

/** How a request presented its session. Decides how a renewed one is handed back. */
export type SessionTransport = 'cookie' | 'bearer';

export interface PresentedSession {
  token: string;
  via: SessionTransport;
}

export function signSession(app: FastifyInstance, userId: string, version: number): string {
  const payload: JwtPayload = { sub: userId, ver: version };
  return app.jwt.sign(payload, { expiresIn: SESSION_TTL_SECONDS });
}

/**
 * The token a request carries, and how. A Bearer header wins over the cookie: a caller that went to
 * the trouble of naming a token means that one.
 */
export function presentedSession(request: FastifyRequest): PresentedSession | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return { token: header.slice(7), via: 'bearer' };
  const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
  return token ? { token, via: 'cookie' } : null;
}

/**
 * One cookie's value out of a `Cookie` header, or null. Written here rather than installed for the
 * reason the rate limiter is: the server reads exactly one cookie and sets exactly one.
 */
function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at === -1 || pair.slice(0, at).trim() !== name) continue;
    const value = pair.slice(at + 1).trim();
    return value === '' ? null : value;
  }
  return null;
}

/**
 * The `Set-Cookie` line for a session, or for clearing one when `token` is null.
 *
 * - `HttpOnly`: no script on the page can read it, which is the whole reason it moved here.
 * - `SameSite=Strict`: no request another site starts carries it, not even a form posted from
 *   there. Following a link into the game still works: the page itself needs no cookie, and its
 *   own requests to `/api` are same-site.
 * - `Secure` in production, where everything is HTTPS behind Caddy. Not in development, where the
 *   stack is plain HTTP on localhost and a Secure cookie would never be sent back.
 * - `Path=/api`: the static client never needs it, so it never travels with an image request.
 */
export function sessionCookie(token: string | null, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token ?? ''}`,
    'Path=/api',
    `Max-Age=${token === null ? 0 : SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** Hands a caller its session the way it presented the last one: a cookie or the header. */
export function issueSession(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  version: number,
  via: SessionTransport,
): void {
  const token = signSession(app, userId, version);
  if (via === 'bearer') reply.header(SESSION_HEADER, token);
  else reply.header('Set-Cookie', sessionCookie(token, app.config.secureCookies));
}

/** Ends this browser's session: the cookie is overwritten with an empty one that has expired. */
export function clearSession(app: FastifyInstance, reply: FastifyReply): void {
  reply.header('Set-Cookie', sessionCookie(null, app.config.secureCookies));
}

/** Whether a verified token is still one this account accepts. */
export function sessionIsCurrent(payload: JwtPayload, version: number | null): boolean {
  // A token with no expiry was signed before sessions could end, and one with no version before
  // they could be revoked. Both are refused, which costs a player one sign-in.
  if (typeof payload.exp !== 'number' || typeof payload.ver !== 'number') return false;
  return version !== null && payload.ver === version;
}

/** Hands the caller a fresh session once the one it sent is more than a day old. */
export function renewIfDue(
  app: FastifyInstance,
  reply: FastifyReply,
  payload: JwtPayload,
  via: SessionTransport,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (typeof payload.iat !== 'number') return;
  if (nowSeconds - payload.iat < SESSION_RENEW_AFTER_SECONDS) return;
  issueSession(app, reply, payload.sub, payload.ver, via);
}
