import {
  BaseSchema,
  BaseSummarySchema,
  type AssigneeState,
  type Base,
  type BaseSummary,
  type Building,
  type BuildQueue,
  type Commander,
  type EconomyState,
  type ProgressionState,
  type ResearchState,
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
  progression_json: string;
  research_json: string;
  assignees_json: string;
  buildings_json: string;
  build_queue_json: string;
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
  /**
   * Writes a level-up as one statement (GDD §I2). Level and banked XP move together — a partial
   * write would leave progress sitting above its own level's threshold.
   */
  updateProgression(baseId: string, level: number, progression: ProgressionState): void;
  /** Where the fungible pool is standing (GDD §G). Placements only — the pool size is derived. */
  updateAssignees(baseId: string, assignees: AssigneeState): void;
  /**
   * The officers on the books (GDD §H). Recruitment, the §H5 alignment drift and the §H6
   * level-ups all rewrite the whole list, since it is one JSON column rather than a table.
   */
  updateCommanders(baseId: string, commanders: Commander[]): void;
  /** The research project in flight and the facts it has produced (GDD §B9). */
  updateResearch(baseId: string, research: ResearchState): void;
  /** The structures standing in the district (GDD §A1, §D3). One JSON column, rewritten whole. */
  updateBuildings(baseId: string, buildings: Building[]): void;
  /**
   * The structures and the queue behind them, as one statement (§A1).
   *
   * They move together or not at all: a settle that stood a building up and failed to drop its
   * queue entry would build it again on the next read, and one that dropped the entry without
   * standing the building up would charge for a level nobody got.
   */
  updateDistrict(baseId: string, buildings: Building[], queue: BuildQueue): void;
  /** §A1 — the faction's name. The only field on a base a player types. */
  updateName(baseId: string, name: string): void;
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
    progression: readJson(row.progression_json),
    research: readJson(row.research_json),
    assignees: readJson(row.assignees_json),
    buildings: readJson(row.buildings_json),
    buildQueue: readJson(row.build_queue_json),
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
        resources_json, economy_json, progression_json, research_json, assignees_json,
        buildings_json, build_queue_json, commanders_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM bases WHERE id = ?');
  const byOwnerStmt = db.prepare('SELECT * FROM bases WHERE owner_id = ?');
  const botByDistrictStmt = db.prepare('SELECT * FROM bases WHERE district_id = ? AND is_bot = 1');
  const summariesStmt = db.prepare(
    'SELECT id, owner_id, name, district_id, level, is_bot FROM bases',
  );
  const updateResourcesStmt = db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?');
  const updateEconomyStmt = db.prepare('UPDATE bases SET economy_json = ? WHERE id = ?');
  const updateProgressionStmt = db.prepare(
    'UPDATE bases SET level = ?, progression_json = ? WHERE id = ?',
  );
  const updateAssigneesStmt = db.prepare('UPDATE bases SET assignees_json = ? WHERE id = ?');
  const updateCommandersStmt = db.prepare('UPDATE bases SET commanders_json = ? WHERE id = ?');
  const updateResearchStmt = db.prepare('UPDATE bases SET research_json = ? WHERE id = ?');
  const updateBuildingsStmt = db.prepare('UPDATE bases SET buildings_json = ? WHERE id = ?');
  const updateDistrictStmt = db.prepare(
    'UPDATE bases SET buildings_json = ?, build_queue_json = ? WHERE id = ?',
  );
  const updateNameStmt = db.prepare('UPDATE bases SET name = ? WHERE id = ?');

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
        JSON.stringify(base.progression),
        JSON.stringify(base.research),
        JSON.stringify(base.assignees),
        JSON.stringify(base.buildings),
        JSON.stringify(base.buildQueue),
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
    updateProgression(baseId, level, progression) {
      updateProgressionStmt.run(level, JSON.stringify(progression), baseId);
    },
    updateAssignees(baseId, assignees) {
      updateAssigneesStmt.run(JSON.stringify(assignees), baseId);
    },
    updateCommanders(baseId, commanders) {
      updateCommandersStmt.run(JSON.stringify(commanders), baseId);
    },
    updateResearch(baseId, research) {
      updateResearchStmt.run(JSON.stringify(research), baseId);
    },
    updateBuildings(baseId, buildings) {
      updateBuildingsStmt.run(JSON.stringify(buildings), baseId);
    },
    updateDistrict(baseId, buildings, queue) {
      updateDistrictStmt.run(JSON.stringify(buildings), JSON.stringify(queue), baseId);
    },
    updateName(baseId, name) {
      updateNameStmt.run(name, baseId);
    },
  };
}
