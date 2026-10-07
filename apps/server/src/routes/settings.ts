import {
  ChangePasswordRequestSchema,
  DISPLAY_NAME_TAKEN_MESSAGE,
  GAME_TIMEZONE,
  RESERVED_NAME_MESSAGE,
  TutorialSeenRequestSchema,
  UpdateProfileRequestSchema,
  UserSchema,
  isReservedName,
  sameDisplayName,
  type SettingsResponse,
} from '@frontline/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import { issueSession } from '../auth/session.js';
import type { UserRecord } from '../types.js';

/**
 * The player's own record: what they are called, what they look like, and what clock they read.
 *
 * Three handlers rather than one `PATCH /settings` that takes everything. A password change ends
 * every other session and a profile change does not, so they are different transactions and
 * different endpoints.
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

/**
 * A display name somebody else already answers to, as their username or their display name (bug
 * pass, 2026-09-29): `bobby` set his to `Alice`, another player's username, and his trade offers
 * and letters arrived under her name. Ignoring case, because the screens print both as typed.
 * The caller's own username is not a clash: `alice` may call herself `Alice`.
 */
function refuseTakenDisplayName(app: FastifyInstance, userId: string, displayName: string): void {
  const clash = app.repos.users
    .names()
    .some(
      (other) =>
        other.id !== userId &&
        (sameDisplayName(other.username, displayName) ||
          (other.displayName !== null && sameDisplayName(other.displayName, displayName))),
    );
  if (clash) throw new AppError('DISPLAY_NAME_TAKEN', DISPLAY_NAME_TAKEN_MESSAGE);
}

/**
 * A username another player already shows as their display name (bug pass, 2026-10-02), the other
 * direction of {@link refuseTakenDisplayName}: Alice called herself `Kestrel`, Bob renamed his
 * login to `Kestrel`, and every letter he signed and every pick of "Kestrel" in the composer reached
 * him rather than her. `userId` is the caller, null at registration; their own display name is fine.
 */
export function refuseUsernameWornByAnother(
  app: FastifyInstance,
  userId: string | null,
  username: string,
): void {
  const clash = app.repos.users
    .names()
    .some(
      (other) =>
        other.id !== userId &&
        other.displayName !== null &&
        sameDisplayName(other.displayName, username),
    );
  if (clash) throw new AppError('USERNAME_TAKEN', 'Another player already goes by that name');
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
      /*
       * Only a change is refused here: the form resends both names with every save, and an
       * account that took a username before the reserved list existed, or whose display name
       * somebody registered as a username afterwards, must still be able to save the other field.
       * A reserved display name is the schema's refusal (`DisplayNameSchema`), changed or not.
       */
      const current = app.repos.users.findById(userId);
      if (body.username !== undefined) {
        const holder = app.repos.users.findByUsername(body.username);
        if (holder && holder.id !== userId) {
          throw new AppError('USERNAME_TAKEN', 'That username is already taken');
        }
        if (current?.username !== body.username && isReservedName(body.username)) {
          throw new AppError('USERNAME_RESERVED', RESERVED_NAME_MESSAGE);
        }
        if (current?.username !== body.username) {
          refuseUsernameWornByAnother(app, userId, body.username);
        }
      }
      if (typeof body.displayName === 'string' && current?.displayName !== body.displayName) {
        refuseTakenDisplayName(app, userId, body.displayName);
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
    // One transaction for the checks and the three writes (bug pass, 2026-10-06): a new hash with
    // the old sessions still open, or no line in the history, is not a state to stop in. The
    // cookie goes out only once it has committed.
    const { fresh, version } = app.db.transaction(() => {
      const fresh = app.repos.users.findById(record.id);
      if (!fresh || fresh.passwordHash !== record.passwordHash) {
        throw new AppError('INVALID_CREDENTIALS', 'Your password changed while this was in flight');
      }
      /*
       * ...and the session with it (bug pass, 2026-09-28). `authenticate` checked the version
       * before the hash, so a "log out everywhere" landing inside it left this request to set a
       * password and sign itself a fresh token on a session its owner had just ended.
       */
      if (app.repos.users.sessionVersion(record.id) !== request.user.ver) {
        throw new AppError('UNAUTHORIZED', 'This session has ended. Sign in again');
      }
      app.repos.users.setPasswordHash(record.id, passwordHash);
      const version = app.repos.users.revokeSessions(record.id);
      app.repos.history.record({
        actorId: record.id,
        baseId: null,
        kind: 'account.password_changed',
        // Deliberately empty. That it happened is the fact worth keeping; nothing about *what* it
        // changed to may ever reach a log line.
        payload: {},
      });
      return { fresh, version };
    })();
    issueSession(app, reply, record.id, version, request.sessionVia);
    // Off the row read after the hash, so a profile edit made while it ran is in the answer.
    return settingsFor({ ...fresh, passwordHash });
  });
}
