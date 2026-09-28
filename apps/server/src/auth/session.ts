import type { FastifyInstance, FastifyReply } from 'fastify';
import type { JwtPayload } from '../types.js';

/**
 * Sessions that end (maintainer, 2026-09-27: thirty days, sliding).
 *
 * A token is good for thirty days from when it was signed, and it carries the account's session
 * version (`users.session_version`). While a player keeps playing, any authenticated answer more
 * than a day after their token was signed carries a fresh one in `x-session-token`, and the client
 * swaps it in (`apps/client/src/lib/api.ts`), so an active player never meets the login screen and
 * a stolen token stops working a month after it was last renewed.
 *
 * Bumping the version ends every session at once: a password change does it, and so does "log out
 * everywhere". The tab that asked is handed a token at the new version in the same header, so it
 * is the one session that survives.
 */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
export const SESSION_HEADER = 'x-session-token';

export function signSession(app: FastifyInstance, userId: string, version: number): string {
  const payload: JwtPayload = { sub: userId, ver: version };
  return app.jwt.sign(payload, { expiresIn: SESSION_TTL_SECONDS });
}

/** Whether a verified token is still one this account accepts. */
export function sessionIsCurrent(payload: JwtPayload, version: number | null): boolean {
  // A token with no expiry was signed before sessions could end, and one with no version before
  // they could be revoked. Both are refused, which costs a player one sign-in.
  if (typeof payload.exp !== 'number' || typeof payload.ver !== 'number') return false;
  return version !== null && payload.ver === version;
}

/** Hands the client a fresh token once the one it sent is more than a day old. */
export function renewIfDue(
  app: FastifyInstance,
  reply: FastifyReply,
  payload: JwtPayload,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (typeof payload.iat !== 'number') return;
  if (nowSeconds - payload.iat < SESSION_RENEW_AFTER_SECONDS) return;
  reply.header(SESSION_HEADER, signSession(app, payload.sub, payload.ver));
}
