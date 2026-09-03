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
  findById(id: string): Overseer | undefined;
  /** GDD §F2: the Overseer develops an attribute, which is the only thing that moves this sheet. */
  updateAttributes(id: string, attributes: Attributes): void;
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
  const insertStmt = db.prepare(
    `INSERT INTO overseers
       (id, user_id, preset_id, name, archetype, portrait_id, bio, attributes_json, perks_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM overseers WHERE id = ?');
  const updateAttributesStmt = db.prepare('UPDATE overseers SET attributes_json = ? WHERE id = ?');

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
    findById(id) {
      const row = byIdStmt.get(id) as OverseerRow | undefined;
      return row ? rowToOverseer(row) : undefined;
    },
    updateAttributes(id, attributes) {
      updateAttributesStmt.run(JSON.stringify(attributes), id);
    },
  };
}
