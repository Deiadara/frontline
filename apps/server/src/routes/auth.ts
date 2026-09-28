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
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import type { UserRecord } from '../types.js';
import { SESSION_HEADER, signSession } from '../auth/session.js';

const BCRYPT_COST = 10;

/** A real bcrypt hash of a random string, compared against when the username is unknown. */
const UNKNOWN_USER_HASH = bcrypt.hashSync(randomUUID(), BCRYPT_COST);

function authResponse(app: FastifyInstance, record: UserRecord): AuthResponse {
  const user = UserSchema.parse(record); // strips passwordHash
  return { token: signSession(app, user.id, app.repos.users.sessionVersion(user.id) ?? 0), user };
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/auth/register', async (request, reply) => {
    const body = parseBody(RegisterRequestSchema, request.body);

    // Refused before the hash when the name is plainly taken, so a taken name costs no bcrypt.
    if (app.repos.users.findByUsername(body.username)) {
      throw new AppError('USERNAME_TAKEN', 'That username is already taken');
    }
    // Then checked again after it, with no `await` between the check and the insert: on Node's
    // single-threaded loop that keeps them atomic, so two concurrent registrations of the same
    // username can't both pass the check and collide on the DB constraint (which would 500).
    const passwordHash = await bcrypt.hash(body.password, BCRYPT_COST);

    if (app.repos.users.findByUsername(body.username)) {
      throw new AppError('USERNAME_TAKEN', 'That username is already taken');
    }

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
    return authResponse(app, record);
  });

  app.post('/auth/login', async (request) => {
    const body = parseBody(LoginRequestSchema, request.body);

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

    // Successes only. A trail of failed attempts against a username is a list of guesses at a
    // password, and it belongs in a rate limiter rather than in a table anybody can read.
    app.repos.history.record({
      actorId: record.id,
      baseId: null,
      kind: 'account.login',
      payload: {},
    });
    return authResponse(app, record);
  });

  /**
   * Log out everywhere: every token this account has handed out stops working at once, and the
   * tab that asked is given a new one so it stays signed in (`auth/session.ts`).
   */
  app.post('/auth/logout-all', { preHandler: app.authenticate }, (request, reply) => {
    const version = app.repos.users.revokeSessions(request.currentUser.id);
    app.repos.history.record({
      actorId: request.currentUser.id,
      baseId: null,
      kind: 'account.sessions_revoked',
      payload: {},
    });
    reply.header(SESSION_HEADER, signSession(app, request.currentUser.id, version));
    return { ok: true as const };
  });
}
