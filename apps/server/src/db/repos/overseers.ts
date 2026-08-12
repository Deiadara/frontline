import { OverseerSchema, type Overseer } from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

interface OverseerRow {
  id: string;
  name: string;
  archetype: string;
  portrait_id: string;
  bio: string;
  skills_json: string;
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
}

function rowToOverseer(row: OverseerRow): Overseer {
  return OverseerSchema.parse({
    id: row.id,
    name: row.name,
    archetype: row.archetype,
    portraitId: row.portrait_id,
    bio: row.bio,
    skills: readJson(row.skills_json),
  });
}

export function createOverseersRepo(db: AppDatabase): OverseersRepo {
  const insertStmt = db.prepare(
    `INSERT INTO overseers
       (id, user_id, preset_id, name, archetype, portrait_id, bio, skills_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM overseers WHERE id = ?');

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
        JSON.stringify(overseer.skills),
        createdAt,
      );
    },
    findById(id) {
      const row = byIdStmt.get(id) as OverseerRow | undefined;
      return row ? rowToOverseer(row) : undefined;
    },
  };
}
