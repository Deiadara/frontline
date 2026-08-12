import {
  BaseSchema,
  BaseSummarySchema,
  type Base,
  type BaseSummary,
  type Resources,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { AppDatabase } from '../index.js';

interface BaseRow {
  id: string;
  owner_id: string;
  name: string;
  district_id: string;
  level: number;
  resources_json: string;
  buildings_json: string;
  created_at: string;
}

interface BaseSummaryRow {
  id: string;
  owner_id: string;
  name: string;
  district_id: string;
  level: number;
}

export interface BasesRepo {
  insert(base: Base): void;
  findById(id: string): Base | undefined;
  findByOwnerId(ownerId: string): Base | undefined;
  /** Public projections of every base — never exposes resources or buildings. */
  listSummaries(): BaseSummary[];
  updateResources(baseId: string, resources: Resources): void;
}

function rowToBase(row: BaseRow): Base {
  return BaseSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    districtId: row.district_id,
    level: row.level,
    resources: readJson(row.resources_json),
    buildings: readJson(row.buildings_json),
    createdAt: row.created_at,
  });
}

function rowToSummary(row: BaseSummaryRow): BaseSummary {
  return BaseSummarySchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    districtId: row.district_id,
    level: row.level,
  });
}

export function createBasesRepo(db: AppDatabase): BasesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO bases
       (id, owner_id, name, district_id, level, resources_json, buildings_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM bases WHERE id = ?');
  const byOwnerStmt = db.prepare('SELECT * FROM bases WHERE owner_id = ?');
  const summariesStmt = db.prepare('SELECT id, owner_id, name, district_id, level FROM bases');
  const updateResourcesStmt = db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?');

  return {
    insert(base) {
      insertStmt.run(
        base.id,
        base.ownerId,
        base.name,
        base.districtId,
        base.level,
        JSON.stringify(base.resources),
        JSON.stringify(base.buildings),
        base.createdAt,
      );
    },
    findById(id) {
      const row = byIdStmt.get(id) as BaseRow | undefined;
      return row ? rowToBase(row) : undefined;
    },
    findByOwnerId(ownerId) {
      const row = byOwnerStmt.get(ownerId) as BaseRow | undefined;
      return row ? rowToBase(row) : undefined;
    },
    listSummaries() {
      const rows = summariesStmt.all() as BaseSummaryRow[];
      return rows.map(rowToSummary);
    },
    updateResources(baseId, resources) {
      updateResourcesStmt.run(JSON.stringify(resources), baseId);
    },
  };
}
