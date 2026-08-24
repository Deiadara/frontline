import { UserSchema } from '@frontline/shared';
import type { Statement } from 'better-sqlite3';
import type { UserRecord } from '../../types.js';
import type { AppDatabase } from '../index.js';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  overseer_id: string | null;
  created_at: string;
  display_name: string | null;
  icon: string | null;
  timezone: string | null;
}

/**
 * What Settings may change, as a sparse patch.
 *
 * Sparse because the form sends only what moved: a player changing their icon should not be able to
 * rewrite their username as a side effect of the round trip. `undefined` means "leave it", which is
 * a different instruction from `null`, and `displayName` is the one field where `null` is a real
 * value, meaning "go back to being called by my username".
 */
export interface ProfilePatch {
  username?: string | undefined;
  displayName?: string | null | undefined;
  icon?: string | undefined;
  timezone?: string | undefined;
}

/** Columns needed to persist a freshly registered user (before an overseer is chosen). */
export interface NewUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export interface UsersRepo {
  insert(user: NewUser): void;
  findById(id: string): UserRecord | undefined;
  findByUsername(username: string): UserRecord | undefined;
  setOverseerId(userId: string, overseerId: string): void;
  /** Applies a Settings patch. Only the keys present are written. */
  updateProfile(userId: string, patch: ProfilePatch): void;
  setPasswordHash(userId: string, passwordHash: string): void;
}

/**
 * A NULL column means "never set", which the schema's own default turns into the house value.
 *
 * Passing `undefined` rather than `null` is the point: `UserSchema` defaults these three, and a
 * default only fires for a missing key. Handing Zod an explicit `null` would fail the icon and
 * timezone fields instead of falling back to a shield and Athens.
 */
function rowToRecord(row: UserRow): UserRecord {
  const user = UserSchema.parse({
    id: row.id,
    username: row.username,
    overseerId: row.overseer_id,
    createdAt: row.created_at,
    displayName: row.display_name,
    icon: row.icon ?? undefined,
    timezone: row.timezone ?? undefined,
  });
  return { ...user, passwordHash: row.password_hash };
}

export function createUsersRepo(db: AppDatabase): UsersRepo {
  const insertStmt = db.prepare(
    `INSERT INTO users (id, username, password_hash, overseer_id, created_at)
     VALUES (?, ?, ?, NULL, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const byUsernameStmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const setOverseerStmt = db.prepare('UPDATE users SET overseer_id = ? WHERE id = ?');
  const setPasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  // One statement per field rather than a built-up SQL string: four prepared statements cost
  // nothing and a concatenated UPDATE is how a column name ends up coming from a request body.
  const profileStmts: Readonly<Record<keyof ProfilePatch, Statement<[string | null, string]>>> = {
    username: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
    displayName: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
    icon: db.prepare('UPDATE users SET icon = ? WHERE id = ?'),
    timezone: db.prepare('UPDATE users SET timezone = ? WHERE id = ?'),
  };

  return {
    insert(user) {
      insertStmt.run(user.id, user.username, user.passwordHash, user.createdAt);
    },
    findById(id) {
      const row = byIdStmt.get(id) as UserRow | undefined;
      return row ? rowToRecord(row) : undefined;
    },
    findByUsername(username) {
      const row = byUsernameStmt.get(username) as UserRow | undefined;
      return row ? rowToRecord(row) : undefined;
    },
    setOverseerId(userId, overseerId) {
      setOverseerStmt.run(overseerId, userId);
    },
    updateProfile(userId, patch) {
      db.transaction(() => {
        for (const [field, statement] of Object.entries(profileStmts)) {
          const value = patch[field as keyof ProfilePatch];
          if (value === undefined) continue;
          statement.run(value, userId);
        }
      })();
    },
    setPasswordHash(userId, passwordHash) {
      setPasswordStmt.run(passwordHash, userId);
    },
  };
}
