import { UserSchema } from '@frontline/shared';
import type { UserRecord } from '../../types.js';
import type { AppDatabase } from '../index.js';

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  overseer_id: string | null;
  created_at: string;
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
}

function rowToRecord(row: UserRow): UserRecord {
  const user = UserSchema.parse({
    id: row.id,
    username: row.username,
    overseerId: row.overseer_id,
    createdAt: row.created_at,
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
  };
}
