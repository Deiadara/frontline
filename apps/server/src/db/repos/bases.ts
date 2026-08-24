import {
  BaseSchema,
  BaseSummarySchema,
  type AssigneeState,
  type Base,
  type BaseSummary,
  type Building,
  type Army,
  type BuildQueue,
  type TrainingQueue,
  type Commander,
  type EconomyState,
  type ProgressionState,
  type ResearchState,
  type Resources,
  type TrainingState,
  type Inventory,
  type Fleet,
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
  army_json: string;
  training_queue_json: string;
  commanders_json: string;
  training_json: string | null;
  inventory_json: string | null;
  fitted_upgrades_json: string | null;
  fleet_json: string | null;
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
   * bases, so this answers only "is there a bot here?": the one question raid targeting
   * asks. The seed mints at most one rival per district.
   */
  findBotByDistrictId(districtId: string): Base | undefined;
  /** Public projections of every base: never exposes resources, buildings or commanders. */
  listSummaries(): BaseSummary[];
  updateResources(baseId: string, resources: Resources): void;
  updateEconomy(baseId: string, economy: EconomyState): void;
  /** §F2: the training board and the officers it pays out to, written together. */
  updateTraining(baseId: string, training: TrainingState, commanders: Commander[]): void;
  /**
   * The market and workshop writes: stockpile and satchel move together.
   *
   * One statement, because every trade, purchase and refit spends from both, and a crash between
   * two updates would take the caps without handing over the parts, or the other way round.
   */
  updateHoldings(baseId: string, resources: Resources, inventory: Inventory): void;
  /** What the workshop has fitted. */
  updateUpgrades(baseId: string, fitted: readonly string[]): void;
  /** What is parked in the yard. */
  updateFleet(baseId: string, fleet: Fleet): void;
  /**
   * Writes a level-up as one statement (GDD §I2). Level and banked XP move together: a partial
   * write would leave progress sitting above its own level's threshold.
   */
  updateProgression(baseId: string, level: number, progression: ProgressionState): void;
  /** Where the fungible pool is standing (GDD §G). Placements only: the pool size is derived. */
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
  /** §A1: the faction's name. The only field on a base a player types. */
  updateName(baseId: string, name: string): void;
  /**
   * The units at home and the training queue behind them (§A5), as one statement.
   *
   * They move together for the same reason the district and its queue do: a settle that added the
   * units and failed to drop the order would train them again on the next read.
   */
  updateArmy(baseId: string, army: Army, queue: TrainingQueue): void;
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
    army: readJson(row.army_json),
    trainingQueue: readJson(row.training_queue_json),
    commanders: readJson(row.commanders_json),
    // Left to the schema's own default when the column is empty, rather than defaulted here: a
    // district written before the Training tab existed still opens, with today's allowance.
    training: row.training_json === null ? undefined : readJson(row.training_json),
    // Same rule as `training`: an empty column is a district that predates the feature, and the
    // schema's own default is the right answer for it.
    inventory: row.inventory_json === null ? undefined : readJson(row.inventory_json),
    fittedUpgrades:
      row.fitted_upgrades_json === null ? undefined : readJson(row.fitted_upgrades_json),
    fleet: row.fleet_json === null ? undefined : readJson(row.fleet_json),
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

/**
 * A stockpile on its way to storage, checked for numbers that are not numbers.
 *
 * `JSON.stringify` turns `NaN` and `Infinity` into `null` without a word, and `ResourcesSchema`
 * refuses `null`, so a single arithmetic hole anywhere upstream writes a row that the *next boot*
 * cannot read, and the server does not start. That is exactly what happened: one `Building` that
 * had skipped the parser had no `damage`, the storage ceiling came out `NaN`, the sandbox stored a
 * stockpile of five nulls, and the process died on the following read with a Zod error pointing at
 * a column nothing had knowingly touched.
 *
 * Both halves of that are now fixed. This is the half that matters more: the arithmetic bug was one
 * missing field and there will be others, but a save can only be corrupted through a write. Failing
 * here turns a silent, delayed, unrecoverable corruption into a loud error at the line that caused
 * it, with the base id attached.
 */
function countable(resources: Resources, baseId: string): Resources {
  for (const [key, amount] of Object.entries(resources)) {
    if (!Number.isFinite(amount)) {
      throw new Error(
        `refusing to store a ${String(amount)} ${key} for base ${baseId}: ` +
          'a non-finite resource would be written as null and break the next read',
      );
    }
    // And the same argument one step weaker: `ResourcesSchema` is whole numbers, so a fraction
    // written here is a row that parses today and refuses to parse on the next boot. Failing at the
    // write puts the error on the line that computed it instead of on a read that is innocent.
    if (!Number.isInteger(amount)) {
      throw new Error(
        `refusing to store a fractional ${key} (${String(amount)}) for base ${baseId}: ` +
          'stockpiles are whole units: bank the whole part and carry the rest',
      );
    }
  }
  return resources;
}

export function createBasesRepo(db: AppDatabase): BasesRepo {
  const insertStmt = db.prepare(
    `INSERT INTO bases
       (id, owner_id, name, district_id, level, is_bot,
        resources_json, economy_json, progression_json, research_json, assignees_json,
        buildings_json, build_queue_json, army_json, training_queue_json,
        commanders_json, training_json, inventory_json, fitted_upgrades_json, fleet_json,
        created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  // Officers and the training board move together whenever a session finishes on an officer, so
  // they are written in one statement: two updates would let a crash land the gain without the
  // session leaving the board, and the hour would pay out again on the next read.
  const updateHoldingsStmt = db.prepare(
    'UPDATE bases SET resources_json = ?, inventory_json = ? WHERE id = ?',
  );
  const updateUpgradesStmt = db.prepare('UPDATE bases SET fitted_upgrades_json = ? WHERE id = ?');
  const updateFleetStmt = db.prepare('UPDATE bases SET fleet_json = ? WHERE id = ?');
  const updateTrainingStmt = db.prepare(
    'UPDATE bases SET training_json = ?, commanders_json = ? WHERE id = ?',
  );
  const updateResearchStmt = db.prepare('UPDATE bases SET research_json = ? WHERE id = ?');
  const updateBuildingsStmt = db.prepare('UPDATE bases SET buildings_json = ? WHERE id = ?');
  const updateDistrictStmt = db.prepare(
    'UPDATE bases SET buildings_json = ?, build_queue_json = ? WHERE id = ?',
  );
  const updateNameStmt = db.prepare('UPDATE bases SET name = ? WHERE id = ?');
  const updateArmyStmt = db.prepare(
    'UPDATE bases SET army_json = ?, training_queue_json = ? WHERE id = ?',
  );

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
        JSON.stringify(base.army),
        JSON.stringify(base.trainingQueue),
        JSON.stringify(base.commanders),
        JSON.stringify(base.training),
        JSON.stringify(base.inventory),
        JSON.stringify(base.fittedUpgrades),
        JSON.stringify(base.fleet),
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
      updateResourcesStmt.run(JSON.stringify(countable(resources, baseId)), baseId);
    },
    updateHoldings(baseId, resources, inventory) {
      updateHoldingsStmt.run(
        JSON.stringify(countable(resources, baseId)),
        JSON.stringify(inventory),
        baseId,
      );
    },
    updateUpgrades(baseId, fitted) {
      updateUpgradesStmt.run(JSON.stringify(fitted), baseId);
    },
    updateFleet(baseId, fleet) {
      updateFleetStmt.run(JSON.stringify(fleet), baseId);
    },
    updateTraining(baseId, training, commanders) {
      updateTrainingStmt.run(JSON.stringify(training), JSON.stringify(commanders), baseId);
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
    updateArmy(baseId, army, queue) {
      updateArmyStmt.run(JSON.stringify(army), JSON.stringify(queue), baseId);
    },
  };
}
