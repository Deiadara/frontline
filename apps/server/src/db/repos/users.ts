import { TUTORIAL_STEPS, UserSchema } from '@frontline/shared';
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
  sound_volume: number | null;
  tutorial_seen_json: string | null;
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
  soundVolume?: number | undefined;
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
  /** Puts an account back in front of the character picker. The Console's Clean slate. */
  clearOverseerId(userId: string): void;
  /** Applies a Settings patch. Only the keys present are written. */
  updateProfile(userId: string, patch: ProfilePatch): void;
  setPasswordHash(userId: string, passwordHash: string): void;
  /**
   * Records tutorial cards as shown. Additive and idempotent: the set is the union of what is
   * stored and what is handed in, so two tabs marking the same card cannot lose one of them, and
   * Skip is just this call with every id.
   */
  markTutorialSeen(userId: string, steps: readonly string[]): void;
  /** Every account's username, in one read, for the boards that list everybody. */
  usernames(): Map<string, string>;
  /**
   * Every account's two names, for the display-name clash check (bug pass, 2026-09-29). All of
   * them rather than a `lower()` match in SQL, whose case folding stops at ASCII.
   */
  names(): { id: string; username: string; displayName: string | null }[];
  /** The version every live token for this account must carry, or null for no such account. */
  sessionVersion(userId: string): number | null;
  /** Ends every session the account has open, and answers the version a new token must carry. */
  revokeSessions(userId: string): number;
}

/**
 * A NULL column means "never set", which the schema's own default turns into the house value.
 *
 * Passing `undefined` rather than `null` is the point: `UserSchema` defaults these three, and a
 * default only fires for a missing key. Handing Zod an explicit `null` would fail the icon and
 * timezone fields instead of falling back to a shield and Athens.
 */
/**
 * The tutorial column, as a list of ids, or `undefined` for a row that has never had one.
 *
 * `undefined` rather than `[]` on purpose, for the same reason the three fields below it pass
 * `undefined`: `UserSchema` defaults this to an empty list and a default only fires for a missing
 * key. Anything stored that is not an array of strings is treated as "seen nothing", which is the
 * safe way to be wrong: the worst case is a player is offered the opening again, and the
 * alternative is a parse throwing on the read path for every screen in the game.
 */
function parseSeen(json: string | null): string[] | undefined {
  if (json === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((step): step is string => typeof step === 'string');
  } catch {
    return undefined;
  }
}

function rowToRecord(row: UserRow): UserRecord {
  const user = UserSchema.parse({
    id: row.id,
    username: row.username,
    overseerId: row.overseer_id,
    createdAt: row.created_at,
    displayName: row.display_name,
    icon: row.icon ?? undefined,
    timezone: row.timezone ?? undefined,
    soundVolume: row.sound_volume ?? undefined,
    // A column that predates the tutorial, or an account that has seen nothing, is an empty set.
    tutorialSeen: parseSeen(row.tutorial_seen_json),
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
  const usernamesStmt = db.prepare('SELECT id, username FROM users');
  const setOverseerStmt = db.prepare('UPDATE users SET overseer_id = ? WHERE id = ?');
  const clearOverseerStmt = db.prepare('UPDATE users SET overseer_id = NULL WHERE id = ?');
  const setPasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  /*
   * Compiled on first use, not with the rest.
   *
   * `db.prepare` compiles immediately, and the migration tests build a repo against a database
   * deliberately stopped part-way up the chain to check what an old save does. Every other
   * statement here names a column that has existed since 0001; this one names 0112's, so an eager
   * prepare throws `no such column` before those tests can assert anything.
   */
  let tutorialStmt: Statement<[string, string]> | null = null;
  // Lazy for the same reason: `session_version` is 0121's column.
  let sessionStmt: Statement<[string]> | null = null;
  let revokeStmt: Statement<[string]> | null = null;
  // And `display_name`, which is 0022's.
  let namesStmt: Statement<[]> | null = null;
  // One statement per field rather than a built-up SQL string: five prepared statements cost
  // nothing and a concatenated UPDATE is how a column name ends up coming from a request body.
  // Compiled on first use, like the ones above (bug pass, 2026-10-06): four of these name 0022's
  // and 0084's columns, and an eager prepare threw on a save stopped below them.
  const PROFILE_SQL: Readonly<Record<keyof ProfilePatch, string>> = {
    username: 'UPDATE users SET username = ? WHERE id = ?',
    displayName: 'UPDATE users SET display_name = ? WHERE id = ?',
    icon: 'UPDATE users SET icon = ? WHERE id = ?',
    timezone: 'UPDATE users SET timezone = ? WHERE id = ?',
    soundVolume: 'UPDATE users SET sound_volume = ? WHERE id = ?',
  };
  const profileStmts = new Map<keyof ProfilePatch, Statement<[string | number | null, string]>>();
  const profileStmt = (field: keyof ProfilePatch) => {
    let statement = profileStmts.get(field);
    if (statement === undefined) {
      statement = db.prepare(PROFILE_SQL[field]);
      profileStmts.set(field, statement);
    }
    return statement;
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
    clearOverseerId(userId) {
      clearOverseerStmt.run(userId);
    },
    updateProfile(userId, patch) {
      db.transaction(() => {
        for (const field of Object.keys(PROFILE_SQL) as (keyof ProfilePatch)[]) {
          const value = patch[field];
          if (value === undefined) continue;
          profileStmt(field).run(value, userId);
        }
      })();
    },
    setPasswordHash(userId, passwordHash) {
      setPasswordStmt.run(passwordHash, userId);
    },
    markTutorialSeen(userId, steps) {
      /*
       * Read, union, write, in one transaction.
       *
       * A plain overwrite loses a card: the game shell and a second tab both hold their own copy
       * of the account, and the one that writes last would erase whatever the other had just
       * marked. The union makes the call idempotent as well, which matters because the card marks
       * itself seen on the way out and a double press must not be able to do anything odd.
       */
      db.transaction(() => {
        const row = byIdStmt.get(userId) as UserRow | undefined;
        if (!row) return;
        const stored = parseSeen(row.tutorial_seen_json) ?? [];
        tutorialStmt ??= db.prepare('UPDATE users SET tutorial_seen_json = ? WHERE id = ?');
        // Only steps the game has, so the column cannot be grown by sending made-up ids: it is
        // parsed on every lookup of this account, which is every request it makes.
        const known = steps.filter((step) => (TUTORIAL_STEPS as readonly string[]).includes(step));
        const merged = [...new Set([...stored, ...known])].filter((step) =>
          (TUTORIAL_STEPS as readonly string[]).includes(step),
        );
        tutorialStmt.run(JSON.stringify(merged), userId);
      })();
    },
    usernames() {
      const rows = usernamesStmt.all() as { id: string; username: string }[];
      return new Map(rows.map((row) => [row.id, row.username]));
    },
    names() {
      namesStmt ??= db.prepare('SELECT id, username, display_name FROM users');
      const rows = namesStmt.all() as {
        id: string;
        username: string;
        display_name: string | null;
      }[];
      return rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
      }));
    },
    sessionVersion(userId) {
      sessionStmt ??= db.prepare('SELECT session_version FROM users WHERE id = ?');
      const row = sessionStmt.get(userId) as { session_version: number } | undefined;
      return row ? row.session_version : null;
    },
    revokeSessions(userId) {
      revokeStmt ??= db.prepare(
        'UPDATE users SET session_version = session_version + 1 WHERE id = ? RETURNING session_version',
      );
      const row = revokeStmt.get(userId) as { session_version: number } | undefined;
      return row?.session_version ?? 0;
    },
  };
}
