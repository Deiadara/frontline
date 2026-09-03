import {
  BUILDING_CATALOG,
  OFFICER_ROLES,
  RESOURCE_KEYS,
  isPerkId,
  UNIT_IDS,
  findUnit,
  withoutRetiredUnits,
  findModification,
  findVehicle,
  ITEM_CATALOG,
  BaseSchema,
  defaultLoadout,
  BaseSummarySchema,
  type Base,
  type BaseSummary,
  type Building,
  type Army,
  type BuildQueue,
  type TrainingQueue,
  type Commander,
  EconomyStateSchema,
  type EconomyState,
  type ProgressionState,
  type ResearchState,
  type Resources,
  type TrainingState,
  type Inventory,
  type Fleet,
  type UnitLoadouts,
  type Addons,
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
  buildings_json: string;
  build_queue_json: string;
  army_json: string;
  training_queue_json: string;
  commanders_json: string;
  training_json: string | null;
  inventory_json: string | null;
  fitted_upgrades_json: string | null;
  unit_loadouts_json: string | null;
  fleet_json: string | null;
  addons_json: string | null;
  created_at: string;
}

type BaseSummaryRow = Pick<
  BaseRow,
  'id' | 'owner_id' | 'name' | 'district_id' | 'level' | 'is_bot'
>;

/** One row of the leaderboard's player board, straight out of the table. */
export interface BaseStanding {
  id: string;
  ownerId: string;
  name: string;
  districtId: string;
  level: number;
  isBot: boolean;
  infamy: number;
  notoriety: number;
}

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
  /**
   * Every district's standing, for the leaderboard (§J9).
   *
   * A projection of its own rather than `listSummaries` plus a lookup per row: the board is one
   * request over every account in the game, and reading a full base per player to get at two
   * numbers is how a screen that lists everybody becomes the slowest screen in the game.
   */
  listStandings(): BaseStanding[];
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
  updateUnitLoadouts(baseId: string, loadouts: UnitLoadouts): void;
  /**
   * The mean level of every base standing in the city, bots included, rounded down.
   *
   * What the Bar scales its room off (§H2): "better officers based on the overall levels of all
   * the allegiances in the districts of the city". Bots are in it on purpose, because they are the
   * allegiances holding most of the districts, and a city where the NPC crews have levelled is a city
   * where a good officer would expect better work.
   */
  averageLevel(): number;
  /** What is parked in the yard. */
  updateFleet(baseId: string, fleet: Fleet): void;
  /** §B9/§E: the blueprints researched and the add-ons the Scrapyard has built. */
  updateAddons(baseId: string, addons: Addons): void;
  /**
   * Writes a level-up as one statement (GDD §I2). Level and banked XP move together: a partial
   * write would leave progress sitting above its own level's threshold.
   */
  updateProgression(baseId: string, level: number, progression: ProgressionState): void;
  /** Where the fungible pool is standing (GDD §G). Placements only: the pool size is derived. */
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
  /** §A1: the allegiance's name. The only field on a base a player types. */
  updateName(baseId: string, name: string): void;
  /**
   * The units at home and the training queue behind them (§A5), as one statement.
   *
   * They move together for the same reason the district and its queue do: a settle that added the
   * units and failed to drop the order would train them again on the next read.
   */
  updateArmy(baseId: string, army: Army, queue: TrainingQueue): void;
}

/**
 * A stored stockpile, with any resource the row predates filled in at zero.
 *
 * `AmountSchema` has no default, so a row missing a key throws out of `BaseSchema.parse` and takes
 * the whole server down on the first read: which is what a stockpile written before `planks`
 * existed did. The backfill migration is not enough on its own, and finding out why is the reason
 * this exists rather than a wider `.default(0)` on the schema:
 *
 *   - A migration is one-shot. Anything that writes a full stockpile from an older build puts the
 *     gap straight back, and one did: `applyUnlockedSandbox` on a stale dev process rewrote the
 *     five it knew about over the six the migration had just written.
 *   - A backup restored from before the migration holds the old shape too, and §9 of this file's
 *     sibling test says a save like that must be *repairable rather than deleted*.
 *
 * Only **absence** is repaired. A key that is present and is a string, a negative or a null is
 * still a real error, because those are corruption rather than history: the schema judges them
 * exactly as it did before.
 */
function storedResources(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const stored = raw as Record<string, unknown>;
  const filled: Record<string, unknown> = { ...stored };
  for (const key of RESOURCE_KEYS) {
    if (!(key in stored)) filled[key] = 0;
  }
  return filled;
}

/**
 * Content that no longer exists, dropped rather than allowed to brick the account.
 *
 * ## Why this is here rather than in a migration
 *
 * The same three reasons `storedResources` gives, one content change along. Twice now a unit has
 * left the roster and the server has refused to *boot*: `UnitIdSchema` is a key schema over the
 * live catalogue, so an army holding a retired id fails `BaseSchema.parse` on the way **out of the
 * database**, before any request is served. Both times the fix was a migration, and a migration is
 * one-shot: a backup restored from before it, a stale process writing an older shape, or simply the
 * next removal somebody forgets to write one for, and the account is dead again.
 *
 * Measured rather than assumed: of the ten columns that store a content id, **six** refused the row
 * outright (army, training queue, building kind, building modification, officer role, officer
 * trait) and only three degraded. That asymmetry was an accident of which schemas happened to use a
 * key schema, not a decision.
 *
 * ## What it will and will not do
 *
 * Only **unknown ids** are dropped, and nothing else is touched: a negative count, a null, a string
 * where a number belongs are all still real errors, and the schema judges them exactly as before.
 * Losing a retired unit is the correct outcome, because the unit does not exist; losing the account
 * is not. The migrations stay: they are the tidy path, and they keep the database honest. This is
 * the floor under them.
 */
const KNOWN_ROLES = new Set<string>(OFFICER_ROLES);

/** Training orders for units that still exist. A part-trained batch of a retired unit is gone. */
function knownTrainingQueue(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return (raw as unknown[]).filter((order) => {
    if (!isRow(order)) return true;
    const unitId = order.unitId;
    return typeof unitId !== 'string' || findUnit(unitId) !== undefined;
  });
}

/**
 * One stored row, before the schema has judged it: an object with fields of unknown type.
 *
 * Typed rather than `any` so the salvage below reads a field, decides on it and puts the row back
 * without the compiler losing track of what it is holding. Everything it does not name is carried
 * through untouched, which is the point: this drops ids, it does not reshape rows.
 */
type StoredRow = Readonly<Record<string, unknown>>;

/** Whether this is an object the salvage can look inside. Anything else is left for the schema. */
function isRow(value: unknown): value is StoredRow {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A shelf holding only add-ons the catalogue still knows.
 *
 * The same repair `knownBuildings` does one level down, and it is needed for the same reason and
 * by the same events: migration 0056 backfills the shelf from whatever is bolted on today, which
 * on a district built before §A1 and §A2 includes the Cistern's five modifications and the four
 * that pushed a power grid. None of them has a catalogue entry any more, so none of them can be
 * priced, described or fitted, and carrying them would put a row on the Scrapyard's page that
 * renders as blank.
 */
function knownAddons(raw: unknown): unknown {
  if (!isRow(raw)) return raw;
  const clean = (value: unknown): unknown =>
    Array.isArray(value)
      ? (value as unknown[]).filter((id) => typeof id !== 'string' || findModification(id))
      : value;
  return { ...raw, researched: clean(raw.researched), built: clean(raw.built) };
}

/**
 * Build orders for a structure that still exists.
 *
 * `BuildQueueEntrySchema.kind` is an enum over the live catalogue, so an order for a retired
 * structure does not fail validation with a bad field: it fails `BaseSchema.parse` on the way
 * *out of the database*, which is the account refusing to open. `knownBuildings` beside this has
 * covered the standing structures since the last removal; the queue was the half nobody had had a
 * reason to look at until §A2 retired the Cistern with orders possibly in flight for it.
 */
function knownBuildQueue(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return (raw as unknown[]).filter((entry) => {
    if (!isRow(entry)) return true;
    const kind = entry.kind;
    return typeof kind !== 'string' || kind in BUILDING_CATALOG;
  });
}

/** Structures of a kind that still exists, each carrying only modifications that still exist. */
function knownBuildings(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return (raw as unknown[])
    .filter((building) => {
      if (!isRow(building)) return true;
      const kind = building.kind;
      return typeof kind !== 'string' || kind in BUILDING_CATALOG;
    })
    .map((building): unknown => {
      if (!isRow(building)) return building;
      const mods = building.modifications;
      if (!Array.isArray(mods)) return building;
      return {
        ...building,
        modifications: (mods as unknown[]).filter(
          (id) => typeof id !== 'string' || findModification(id) !== undefined,
        ),
      };
    });
}

/**
 * Keys of a stored map that still name something the catalogue carries.
 *
 * `FleetSchema` and `InventorySchema` are `z.partialRecord` over an id enum, so an id the game no
 * longer has is not a missing bonus: it is `BaseSchema.parse` throwing on the way *out of the
 * database*, i.e. the account refusing to open and the world tick throwing when it touches that
 * base. Eight other columns already get this repair; these two did not, and they are also the two
 * no migration has ever swept, so there was no backstop either.
 */
function knownKeys(raw: unknown, known: (id: string) => boolean): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([id]) => known(id)),
  );
}

/**
 * Officers whose chair still exists, each carrying only traits that still exist.
 *
 * Dropping a whole officer is the harshest repair here and it is still the right one: a role that
 * no longer exists is a seat nobody can sit in, and the alternative is an account that cannot be
 * opened. A retired *perk* costs the officer nothing but the perk.
 */
function knownCommanders(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return (raw as unknown[])
    .filter((officer) => {
      if (!isRow(officer)) return true;
      const role = officer.role;
      return typeof role !== 'string' || KNOWN_ROLES.has(role);
    })
    .map((officer): unknown => {
      if (!isRow(officer)) return officer;
      const perks = officer.perks;
      if (!Array.isArray(perks)) return officer;
      return {
        ...officer,
        perks: (perks as unknown[]).filter((id) => typeof id !== 'string' || isPerkId(id)),
      };
    });
}

function rowToBase(row: BaseRow): Base {
  return BaseSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    districtId: row.district_id,
    level: row.level,
    isBot: row.is_bot === 1,
    resources: storedResources(readJson(row.resources_json)),
    economy: readJson(row.economy_json),
    progression: readJson(row.progression_json),
    research: readJson(row.research_json),
    buildings: knownBuildings(readJson(row.buildings_json)),
    buildQueue: knownBuildQueue(readJson(row.build_queue_json)),
    army: withoutRetiredUnits(readJson(row.army_json)),
    trainingQueue: knownTrainingQueue(readJson(row.training_queue_json)),
    commanders: knownCommanders(readJson(row.commanders_json)),
    // Left to the schema's own default when the column is empty, rather than defaulted here: a
    // district written before the Training tab existed still opens, with today's allowance.
    training: row.training_json === null ? undefined : readJson(row.training_json),
    // Same rule as `training`: an empty column is a district that predates the feature, and the
    // schema's own default is the right answer for it.
    inventory:
      row.inventory_json === null
        ? undefined
        : knownKeys(readJson(row.inventory_json), (id) => id in ITEM_CATALOG),
    fittedUpgrades:
      row.fitted_upgrades_json === null ? undefined : readJson(row.fitted_upgrades_json),
    // A district written before slots existed has no column, and the answer for it is not "three
    // empty brackets": until today every upgrade it had built applied to every unit it owned, and
    // an empty map would quietly strip stats off a mid-game crew. It gets the arrangement that
    // costs it nothing (`defaultLoadout`) until it opens the screen and says otherwise.
    unitLoadouts:
      row.unit_loadouts_json === null
        ? loadoutsForPreSlotSave(row.fitted_upgrades_json)
        : readJson(row.unit_loadouts_json),
    fleet:
      row.fleet_json === null
        ? undefined
        : knownKeys(readJson(row.fleet_json), (id) => findVehicle(id) !== undefined),
    addons: row.addons_json === null ? undefined : knownAddons(readJson(row.addons_json)),
    createdAt: row.created_at,
  });
}

/** Every unit gets the crew's three strongest, which is what it already had before slots. */
function loadoutsForPreSlotSave(fittedJson: string | null): UnitLoadouts {
  const built = fittedJson === null ? [] : (readJson(fittedJson) as string[]);
  const slots = defaultLoadout(built);
  if (slots.length === 0) return {};
  return Object.fromEntries(UNIT_IDS.map((id) => [id, slots]));
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
        resources_json, economy_json, progression_json, research_json,
        buildings_json, build_queue_json, army_json, training_queue_json,
        commanders_json, training_json, inventory_json, fitted_upgrades_json,
        unit_loadouts_json, fleet_json, addons_json,
        created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM bases WHERE id = ?');
  const byOwnerStmt = db.prepare('SELECT * FROM bases WHERE owner_id = ?');
  const botByDistrictStmt = db.prepare('SELECT * FROM bases WHERE district_id = ? AND is_bot = 1');
  // Ordered, because callers ask this for "the crew that lives in district X" and a district holds
  // more than one. An unordered scan makes that answer depend on the storage engine's mood, so the
  // map, the battle board and the settler could each name a different crew for the same ground.
  const summariesStmt = db.prepare(
    'SELECT id, owner_id, name, district_id, level, is_bot FROM bases ORDER BY created_at, id',
  );
  const standingsStmt = db.prepare(
    'SELECT id, owner_id, name, district_id, level, is_bot, economy_json FROM bases',
  );
  const updateResourcesStmt = db.prepare('UPDATE bases SET resources_json = ? WHERE id = ?');
  const updateEconomyStmt = db.prepare('UPDATE bases SET economy_json = ? WHERE id = ?');
  const updateProgressionStmt = db.prepare(
    'UPDATE bases SET level = ?, progression_json = ? WHERE id = ?',
  );
  const updateCommandersStmt = db.prepare('UPDATE bases SET commanders_json = ? WHERE id = ?');
  // Officers and the training board move together whenever a session finishes on an officer, so
  // they are written in one statement: two updates would let a crash land the gain without the
  // session leaving the board, and the hour would pay out again on the next read.
  const updateHoldingsStmt = db.prepare(
    'UPDATE bases SET resources_json = ?, inventory_json = ? WHERE id = ?',
  );
  const updateUpgradesStmt = db.prepare('UPDATE bases SET fitted_upgrades_json = ? WHERE id = ?');
  const updateLoadoutsStmt = db.prepare('UPDATE bases SET unit_loadouts_json = ? WHERE id = ?');
  const averageLevelStmt = db.prepare('SELECT avg(level) AS mean FROM bases');
  const updateFleetStmt = db.prepare('UPDATE bases SET fleet_json = ? WHERE id = ?');
  const updateAddonsStmt = db.prepare('UPDATE bases SET addons_json = ? WHERE id = ?');
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
        JSON.stringify(base.buildings),
        JSON.stringify(base.buildQueue),
        JSON.stringify(base.army),
        JSON.stringify(base.trainingQueue),
        JSON.stringify(base.commanders),
        JSON.stringify(base.training),
        JSON.stringify(base.inventory),
        JSON.stringify(base.fittedUpgrades),
        JSON.stringify(base.unitLoadouts),
        JSON.stringify(base.fleet),
        JSON.stringify(base.addons ?? { researched: [], built: [] }),
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
    listStandings() {
      const rows = standingsStmt.all() as (BaseSummaryRow & { economy_json: string })[];
      return rows.map((row) => {
        // Parsed through the shared schema rather than cast: this is the one place the leaderboard
        // touches stored JSON, and a row written by an older build should fail here by name.
        const economy = EconomyStateSchema.parse(readJson(row.economy_json));
        return {
          id: row.id,
          ownerId: row.owner_id,
          name: row.name,
          districtId: row.district_id,
          level: row.level,
          isBot: row.is_bot === 1,
          infamy: economy.infamy,
          notoriety: economy.notoriety,
        };
      });
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
    averageLevel() {
      const row = averageLevelStmt.get() as { mean: number | null } | undefined;
      return Math.max(0, Math.floor(row?.mean ?? 0));
    },
    updateUnitLoadouts(baseId, loadouts) {
      updateLoadoutsStmt.run(JSON.stringify(loadouts), baseId);
    },
    updateFleet(baseId, fleet) {
      updateFleetStmt.run(JSON.stringify(fleet), baseId);
    },
    updateAddons(baseId, addons) {
      updateAddonsStmt.run(JSON.stringify(addons), baseId);
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
