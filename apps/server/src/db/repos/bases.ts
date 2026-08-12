import {
  BaseSchema,
  BaseSummarySchema,
  type Base,
  type BaseSummary,
  type EconomyState,
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
  is_bot: number;
  resources_json: string;
  economy_json: string;
  buildings_json: string;
  commanders_json: string;
  created_at: string;
}

type BaseSummaryRow = Pick<
  BaseRow,
  'id' | 'owner_id' | 'name' | 'district_id' | 'level' | 'is_bot'
>;

export interface BasesRepo {
  insert(base: Base): void;
  findById(id: string): Base | undefined;
  findByOwnerId(ownerId: string): Base | undefined;
  /**
   * The AI rival garrisoning a district, if one is there. A district can hold several
   * bases, so this answers only "is there a bot here?" — the one question raid targeting
   * asks. The seed mints at most one rival per district.
   */
  findBotByDistrictId(districtId: string): Base | undefined;
  /** Public projections of every base — never exposes resources, buildings or commanders. */
  listSummaries(): BaseSummary[];
  updateResources(baseId: string, resources: Resources): void;
  updateEconomy(baseId: string, economy: EconomyState): void;
}

function rowToBase(row: BaseRow): Base {
  return BaseSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    districtId: row.district_id,
    level: row.level,
    isBot: row.is_bot === 1,
    resources: readJson(row.resources_json),
    economy: readJson(row.economy_json),
    buildings: readJson(row.buildings_json),
    commanders: readJson(row.commanders_json),
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
    isBot: row.is_bot === 1,
  });
}

export function createBasesRepo(db: AppDatabase): BasesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO bases
       (id, owner_id, name, district_id, level, is_bot,
        resources_json, economy_json, buildings_json, commanders_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM bases WHERE id = ?');
  const byOwnerStmt = db.prepare('SELECT * FROM bases WHERE owner_id = ?');
  const botByDistrictStmt = db.prepare('SELECT * FROM bases WHERE district_id = ? AND is_bot = 1');
  const summariesStmt = db.prepare(
    'SELECT id, owner_id, name, district_id, level, is_bot FROM bases',
  );
  const updateResourcesStmt = db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?');
  const updateEconomyStmt = db.prepare('UPDATE bases SET economy_json = ? WHERE id = ?');

  return {
    insert(base) {
      insertStmt.run(
        base.id,
        base.ownerId,
        base.name,
        base.districtId,
        base.level,
        base.isBot ? 1 : 0,
        JSON.stringify(base.resources),
        JSON.stringify(base.economy),
        JSON.stringify(base.buildings),
        JSON.stringify(base.commanders),
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
    findBotByDistrictId(districtId) {
      const row = botByDistrictStmt.get(districtId) as BaseRow | undefined;
      return row ? rowToBase(row) : undefined;
    },
    listSummaries() {
      const rows = summariesStmt.all() as BaseSummaryRow[];
      return rows.map(rowToSummary);
    },
    updateResources(baseId, resources) {
      updateResourcesStmt.run(JSON.stringify(resources), baseId);
    },
    updateEconomy(baseId, economy) {
      updateEconomyStmt.run(JSON.stringify(economy), baseId);
    },
  };
}
