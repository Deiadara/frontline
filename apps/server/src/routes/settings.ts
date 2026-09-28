import {
  ChangePasswordRequestSchema,
  GAME_TIMEZONE,
  TutorialSeenRequestSchema,
  UpdateProfileRequestSchema,
  UserSchema,
  type SettingsResponse,
} from '@frontline/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { SESSION_HEADER, signSession } from '../auth/session.js';
import type { UserRecord } from '../types.js';

/**
 * The player's own record: what they are called, what they look like, and what clock they read.
 *
 * Three handlers rather than one `PATCH /settings` that takes everything. A password change needs
 * the old password and a profile change does not, and folding them together would either demand a
 * password to change an icon or accept a password change without one. They are different
 * transactions with different proofs, so they are different endpoints.
 */

const BCRYPT_COST = 10;

/** The record as the client is allowed to see it. `UserSchema` is what strips the hash. */
function publicUser(record: UserRecord) {
  return UserSchema.parse(record);
}

function settingsFor(record: UserRecord): SettingsResponse {
  return {
    user: publicUser(record),
    serverNow: new Date().toISOString(),
    gameTimezone: GAME_TIMEZONE,
  };
}

export function registerSettingsRoutes(app: FastifyInstance): void {
  app.get('/settings', { preHandler: app.authenticate }, (request): SettingsResponse => {
    const record = app.repos.users.findById(request.currentUser.id);
    if (!record) throw new AppError('UNAUTHORIZED', 'Authenticated user no longer exists');
    return settingsFor(record);
  });

  /**
   * §Tutorial: remember that these cards have been shown.
   *
   * On the account, which is what stops the opening playing again on a second machine. The write
   * is a union rather than a replace (`markTutorialSeen`), so this is safe to call twice and safe
   * to call from two tabs. Skip is the same route with every step in the body, which is why there
   * is no second endpoint for it and no `skipped` flag anywhere.
   *
   * Answers with the settings sheet, like every other write here, so a client that wants to know
   * what the account now holds does not need a second read.
   */
  app.post('/settings/tutorial', { preHandler: app.authenticate }, (request): SettingsResponse => {
    const body = parseBody(TutorialSeenRequestSchema, request.body);
    const userId = request.currentUser.id;
    app.repos.users.markTutorialSeen(userId, body.steps);
    const updated = app.repos.users.findById(userId);
    if (!updated) throw new AppError('UNAUTHORIZED', 'Authenticated user no longer exists');
    return settingsFor(updated);
  });

  /**
   * Name, display name, glyph, clock.
   *
   * The username check is the same shape as registration's: look, then write, with no `await`
   * between them so Node's single loop keeps the pair atomic and two players renaming to the same
   * thing cannot both pass. Renaming to your *own* current name is not a collision: a form that
   * resends every field would otherwise refuse to change the icon.
   */
  app.patch('/settings/profile', { preHandler: app.authenticate }, (request): SettingsResponse => {
    const body = parseBody(UpdateProfileRequestSchema, request.body);
    const userId = request.currentUser.id;

    return app.db.transaction(() => {
      if (body.username !== undefined) {
        const holder = app.repos.users.findByUsername(body.username);
        if (holder && holder.id !== userId) {
          throw new AppError('USERNAME_TAKEN', 'That username is already taken');
        }
      }

      app.repos.users.updateProfile(userId, body);
      const updated = app.repos.users.findById(userId);
      if (!updated) throw new AppError('UNAUTHORIZED', 'Authenticated user no longer exists');

      app.repos.history.record({
        actorId: userId,
        baseId: null,
        kind: 'account.profile_changed',
        // The values, not just the field names: this is the trail that answers "who was this
        // account called last week". No secret passes through here.
        payload: body,
      });
      return settingsFor(updated);
    })();
  });

  /**
   * Changing a password.
   *
   * The session is the proof (maintainer, 2026-09-23): the current password is not asked for, see
   * `ChangePasswordRequestSchema`. Every other session ends with the old password (2026-09-27), and
   * this tab is handed a token at the new session version so it is the one that stays signed in.
   */
  app.post('/settings/password', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parseBody(ChangePasswordRequestSchema, request.body);
    const record = app.repos.users.findById(request.currentUser.id);
    if (!record) throw new AppError('UNAUTHORIZED', 'Authenticated user no longer exists');

    const passwordHash = await bcrypt.hash(body.newPassword, BCRYPT_COST);
    /*
     * Re-read under the write. An await sits between the read and the write, and a second change
     * landing in that gap (two tabs, one form each) would silently overwrite the first. The row is
     * the arbiter: if the hash moved while this request was hashing, this request lost, and says so.
     */
    const fresh = app.repos.users.findById(record.id);
    if (!fresh || fresh.passwordHash !== record.passwordHash) {
      throw new AppError('INVALID_CREDENTIALS', 'Your password changed while this was in flight');
    }
    /*
     * ...and the session with it (bug pass, 2026-09-28). `authenticate` checked the version before
     * the hash, so a "log out everywhere" landing inside it left this request to set a password
     * and sign itself a fresh token on a session its owner had just ended.
     */
    if (app.repos.users.sessionVersion(record.id) !== request.user.ver) {
      throw new AppError('UNAUTHORIZED', 'This session has ended. Sign in again');
    }
    app.repos.users.setPasswordHash(record.id, passwordHash);
    const version = app.repos.users.revokeSessions(record.id);
    reply.header(SESSION_HEADER, signSession(app, record.id, version));
    app.repos.history.record({
      actorId: record.id,
      baseId: null,
      kind: 'account.password_changed',
      // Deliberately empty. That it happened is the fact worth keeping; nothing about *what* it
      // changed to may ever reach a log line.
      payload: {},
    });
    return settingsFor({ ...record, passwordHash });
  });
}
