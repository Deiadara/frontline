import {
  ChangePasswordRequestSchema,
  GAME_TIMEZONE,
  PLAYER_ICONS,
  UpdateProfileRequestSchema,
  UserSchema,
  type SettingsResponse,
} from '@frontline/shared';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { AppError, parseBody } from '../errors.js';
import type { UserRecord } from '../types.js';

/**
 * The player's own record: what they are called, what they look like, and what clock they read.
 *
 * Three handlers rather than one `PATCH /settings` that takes everything. A passphrase change needs
 * the old passphrase and a profile change does not, and folding them together would either demand a
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
    icons: [...PLAYER_ICONS],
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
   * Name, display name, glyph, clock.
   *
   * The username check is the same shape as registration's: look, then write, with no `await`
   * between them so Node's single loop keeps the pair atomic and two players renaming to the same
   * thing cannot both pass. Renaming to your *own* current name is not a collision — a form that
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
   * Changing a passphrase.
   *
   * The current one is required even though the request already carries a valid token — see
   * `ChangePasswordRequestSchema`. The answer deliberately carries no new token: the JWT holds only
   * `{sub}`, so it survives a password change, and minting a fresh one would imply a revocation
   * this system does not do.
   */
  app.post('/settings/password', { preHandler: app.authenticate }, async (request) => {
    const body = parseBody(ChangePasswordRequestSchema, request.body);
    const record = app.repos.users.findById(request.currentUser.id);
    if (!record) throw new AppError('UNAUTHORIZED', 'Authenticated user no longer exists');

    const matches = await bcrypt.compare(body.currentPassword, record.passwordHash);
    if (!matches) throw new AppError('INVALID_CREDENTIALS', 'That is not your current passphrase');

    const passwordHash = await bcrypt.hash(body.newPassword, BCRYPT_COST);
    app.repos.users.setPasswordHash(record.id, passwordHash);
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
