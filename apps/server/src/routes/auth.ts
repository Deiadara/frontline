import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PLAYER_ICON,
  DEFAULT_SOUND_VOLUME,
  GAME_TIMEZONE,
  LoginRequestSchema,
  RegisterRequestSchema,
  UserSchema,
  type AuthResponse,
} from '@frontline/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import type { UserRecord } from '../types.js';
import { clearSession, issueSession, sessionCookie, signSession } from '../auth/session.js';
import { worldHasRoom } from '../city/homes.js';
import { addressBucket } from '../limits/plugin.js';
import { admitSignIn, clearFailedSignIns } from '../limits/sign-in.js';
import { refuseUsernameWornByAnother } from './settings.js';

const BCRYPT_COST = 10;

/** A real bcrypt hash of a random string, compared against when the username is unknown. */
const UNKNOWN_USER_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_COST);

/**
 * Signs the account in: the session as an httpOnly cookie for the browser, and the same token in
 * the body for a scripted caller (see `AuthResponseSchema`).
 */
function signIn(app: FastifyInstance, reply: FastifyReply, record: UserRecord): AuthResponse {
  const user = UserSchema.parse(record); // strips passwordHash
  const token = signSession(app, user.id, app.repos.users.sessionVersion(user.id) ?? 0);
  reply.header('Set-Cookie', sessionCookie(token, app.config.secureCookies));
  return { token, user };
}

/**
 * The two refusals a sign-up can meet after its body has parsed. Run before the hash, so a refused
 * sign-up costs no bcrypt, and again after it with no `await` between the check and the insert: on
 * Node's single-threaded loop that keeps them atomic, so two concurrent registrations of the same
 * username can't both pass the check and collide on the DB constraint (which would 500).
 *
 * The world first (bug pass, 2026-09-29): with no free plot anywhere the account could never play,
 * and the player should hear that before being told their name is taken.
 */
function refuseSignUp(app: FastifyInstance, username: string): void {
  if (!worldHasRoom(app.repos)) {
    throw new AppError(
      'WORLD_FULL',
      'The world is full. Every plot in every open city has a crew on it, so there is nowhere to move in yet. Try again when one frees up.',
    );
  }
  if (app.repos.users.findByUsername(username)) {
    throw new AppError('USERNAME_TAKEN', 'That username is already taken');
  }
  refuseUsernameWornByAnother(app, null, username);
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/auth/register', async (request, reply) => {
    const body = parseBody(RegisterRequestSchema, request.body);

    refuseSignUp(app, body.username);
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);
    refuseSignUp(app, body.username);

    const record: UserRecord = {
      id: randomUUID(),
      username: body.username,
      overseerId: null,
      createdAt: new Date().toISOString(),
      // The house defaults. A new account is called by its username, wears a shield, reads the
      // game on Athens time and hears it at 60 until Settings says otherwise.
      displayName: null,
      icon: DEFAULT_PLAYER_ICON,
      timezone: GAME_TIMEZONE,
      soundVolume: DEFAULT_SOUND_VOLUME,
      // Nothing seen yet, which is what makes the opening tutorial play exactly once.
      tutorialSeen: [],
      passwordHash,
    };
    app.repos.users.insert(record);
    app.repos.history.record({
      actorId: record.id,
      baseId: null,
      kind: 'account.registered',
      payload: { username: record.username },
    });

    reply.code(201);
    return signIn(app, reply, record);
  });

  app.post('/auth/login', async (request, reply) => {
    const body = parseBody(LoginRequestSchema, request.body);
    const attempt = { username: body.username, address: addressBucket(request.ip) };
    // Before the compare: the point of the lock is that a knock on a shut door costs no hash.
    admitSignIn(app.rateLimiter, attempt, (seconds) => {
      reply.header('Retry-After', String(seconds));
    });

    const record = app.repos.users.findByUsername(body.username);
    // An unknown name still pays for a compare, against a hash nobody holds, so the answer takes
    // as long either way and the timing does not say which usernames exist.
    const passwordMatches = await bcrypt.compare(
      body.password,
      record?.passwordHash ?? UNKNOWN_USER_HASH,
    );
    if (!record || !passwordMatches) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password');
    }
    /*
     * Re-read after the compare, as a password change does (bug pass, 2026-10-06). A change landing
     * during this request's hash committed a new hash and bumped the session version, and the old
     * password, compared against the row read before the await, still minted a token at the new
     * version: the lock-out a password change is for did not hold.
     */
    if (app.repos.users.findById(record.id)?.passwordHash !== record.passwordHash) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password');
    }

    clearFailedSignIns(app.rateLimiter, attempt);
    // Successes only. A trail of failed attempts against a username is a list of guesses at a
    // password, and it belongs in a rate limiter rather than in a table anybody can read.
    app.repos.history.record({
      actorId: record.id,
      baseId: null,
      kind: 'account.login',
      payload: {},
    });
    return signIn(app, reply, record);
  });

  /**
   * Signs this browser out. The cookie is httpOnly, so the page cannot drop it itself; this answers
   * with an expired one in its place. Not behind `authenticate`: a session that has already ended
   * still leaves a cookie to clear. Every other session this account holds carries on, which is
   * what "Log out everywhere" below is for.
   */
  app.post('/auth/logout', (_request, reply) => {
    clearSession(app, reply);
    return { ok: true as const };
  });

  /**
   * Log out everywhere: every token this account has handed out stops working at once, and the
   * tab that asked is given a new one so it stays signed in (`auth/session.ts`), as a cookie or in
   * the header, the way it sent the old one.
   */
  app.post('/auth/logout-all', { preHandler: app.authenticate }, (request, reply) => {
    const version = app.repos.users.revokeSessions(request.currentUser.id);
    app.repos.history.record({
      actorId: request.currentUser.id,
      baseId: null,
      kind: 'account.sessions_revoked',
      payload: {},
    });
    issueSession(app, reply, request.currentUser.id, version, request.sessionVia);
    return { ok: true as const };
  });
}
