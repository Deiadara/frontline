import { OverseerSchema, isPerkId, type Attributes, type Overseer } from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

interface OverseerRow {
  id: string;
  name: string;
  archetype: string;
  portrait_id: string;
  bio: string;
  attributes_json: string;
  perks_json: string;
}

/** An overseer minted from a preset, together with the ownership/audit columns the table needs. */
export interface NewOverseer {
  overseer: Overseer;
  userId: string;
  presetId: string;
  createdAt: string;
}

export interface OverseersRepo {
  insert(input: NewOverseer): void;
  /**
   * Drops the character an account is carrying, so it can pick another.
   *
   * `idx_overseers_user` is unique (migration 0074), so leaving the old row behind makes the next
   * `POST /overseer` fail on the index rather than on a guard: the Console's Clean slate has to
   * take the row with it, not only the pointer on `users`.
   */
  removeForUser(userId: string): void;
  /**
   * Every character somebody already holds (§F6): the pool, less what is left of it.
   *
   * Read off the `overseers` table rather than kept in a table of its own, because the table *is*
   * the record: a character is claimed exactly when an account is carrying it, and a second store
   * could only ever disagree with that. The Console's Clean slate drops the row, so it puts the
   * character back in the pool by construction rather than by remembering to.
   */
  claimedPresetIds(): Set<string>;
  /**
   * §F6: the characters currently being held for somebody who is deciding.
   *
   * Separate from {@link claimedPresetIds} because the two answer different questions and only one
   * of them is permanent. A claim is an account carrying a character for ever; a hold is a batch on
   * the table in front of somebody for ten minutes. Both block a draw, and only the claim blocks a
   * take.
   */
  heldPresetIds(now: Date): Set<string>;
  /** The batch this account is holding, and when it lapses. Empty when there is none. */
  holdsFor(userId: string, now: Date): { presetIds: string[]; expiresAt: string | null };
  /** Puts a fresh batch in front of one account, replacing whatever it was holding. */
  hold(userId: string, presetIds: readonly string[], expiresAt: Date): void;
  /** Lets go of everything this account was holding: it has chosen, or it is being wiped. */
  releaseHolds(userId: string): void;
  /** Drops every lapsed hold. Called on the read, so the sweep needs no scheduler. */
  sweepHolds(now: Date): number;
  findById(id: string): Overseer | undefined;
  /** GDD §F2: the Overseer develops an attribute, which is the only thing that moves this sheet. */
  updateAttributes(id: string, attributes: Attributes): void;
}

/**
 * Compiled on first use rather than when the repo is built.
 *
 * `overseer_holds` arrives in 0100 and this repo is constructed against older schemas by
 * `stockpile-integrity.test.ts`, which seeds rows before the migration it measures runs.
 */
function lazy<T>(compile: () => T): () => T {
  let compiled: T | null = null;
  return () => (compiled ??= compile());
}

/**
 * Drops a perk the catalogue no longer carries.
 *
 * The same repair `knownCommanders` does for an officer's sheet in `bases.ts`, and for the same
 * reason: the perk book is content, `PerkIdSchema` validates against the live catalogue, and the
 * ids are persisted verbatim. Retire or rename one and every Overseer holding it fails
 * `OverseerSchema.parse`, so `findById` *throws* rather than returning undefined. That call sits
 * inside `crewSheetsFor`, which sits inside every settle, every projection and the battle engine's
 * inputs, so the account loses every screen rather than one bonus. An officer already survives
 * this; the Overseer did not.
 */
function knownPerks(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return (raw as unknown[]).filter((id) => typeof id !== 'string' || isPerkId(id));
}

function rowToOverseer(row: OverseerRow): Overseer {
  return OverseerSchema.parse({
    id: row.id,
    name: row.name,
    archetype: row.archetype,
    portraitId: row.portrait_id,
    bio: row.bio,
    attributes: readJson(row.attributes_json),
    perks: knownPerks(readJson(row.perks_json)),
  });
}

export function createOverseersRepo(db: AppDatabase): OverseersRepo {
  const removeStmt = db.prepare('DELETE FROM overseers WHERE user_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO overseers
       (id, user_id, preset_id, name, archetype, portrait_id, bio, attributes_json, perks_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM overseers WHERE id = ?');
  const updateAttributesStmt = db.prepare('UPDATE overseers SET attributes_json = ? WHERE id = ?');
  const claimedStmt = db.prepare('SELECT DISTINCT preset_id FROM overseers');
  /*
   * Lazy, the way `blackmarket.ts`'s statements are and for the same reason: `overseer_holds`
   * arrives in 0100, and `stockpile-integrity.test.ts` builds a repo against a part-migrated
   * database on purpose, where a statement naming this table cannot be compiled.
   */
  const heldStmt = lazy(() =>
    db.prepare('SELECT preset_id FROM overseer_holds WHERE expires_at > ?'),
  );
  const holdsForStmt = lazy(() =>
    db.prepare(
      'SELECT preset_id, expires_at FROM overseer_holds WHERE user_id = ? AND expires_at > ?',
    ),
  );
  const holdStmt = lazy(() =>
    db.prepare(
      `INSERT INTO overseer_holds (preset_id, user_id, expires_at) VALUES (?, ?, ?)
         ON CONFLICT (preset_id) DO UPDATE SET user_id = excluded.user_id,
                                               expires_at = excluded.expires_at`,
    ),
  );
  const releaseStmt = lazy(() => db.prepare('DELETE FROM overseer_holds WHERE user_id = ?'));
  const sweepStmt = lazy(() => db.prepare('DELETE FROM overseer_holds WHERE expires_at <= ?'));

  return {
    insert({ overseer, userId, presetId, createdAt }) {
      insertStmt.run(
        overseer.id,
        userId,
        presetId,
        overseer.name,
        overseer.archetype,
        overseer.portraitId,
        overseer.bio,
        JSON.stringify(overseer.attributes),
        JSON.stringify(overseer.perks),
        createdAt,
      );
    },
    removeForUser(userId) {
      removeStmt.run(userId);
    },
    claimedPresetIds() {
      return new Set((claimedStmt.all() as { preset_id: string }[]).map((row) => row.preset_id));
    },
    heldPresetIds(now) {
      const rows = heldStmt().all(now.toISOString()) as { preset_id: string }[];
      return new Set(rows.map((row) => row.preset_id));
    },
    holdsFor(userId, now) {
      const rows = holdsForStmt().all(userId, now.toISOString()) as {
        preset_id: string;
        expires_at: string;
      }[];
      return {
        presetIds: rows.map((row) => row.preset_id),
        // One batch shares one expiry, so the first row's is the batch's.
        expiresAt: rows[0]?.expires_at ?? null,
      };
    },
    hold(userId, presetIds, expiresAt) {
      releaseStmt().run(userId);
      const at = expiresAt.toISOString();
      for (const presetId of presetIds) holdStmt().run(presetId, userId, at);
    },
    releaseHolds(userId) {
      releaseStmt().run(userId);
    },
    sweepHolds(now) {
      return sweepStmt().run(now.toISOString()).changes;
    },
    findById(id) {
      const row = byIdStmt.get(id) as OverseerRow | undefined;
      return row ? rowToOverseer(row) : undefined;
    },
    updateAttributes(id, attributes) {
      updateAttributesStmt.run(JSON.stringify(attributes), id);
    },
  };
}
