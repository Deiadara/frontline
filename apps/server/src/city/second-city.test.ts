import {
  ALL_DISTRICTS,
  LOCATION_CATALOG,
  STARTING_RESOURCES,
  TERMINUS_CITY_ID,
  UNIT_SLOTS_PER_LOCATION,
  applyHoldBonus,
  bonusesAt,
  districtsOfCity,
  noTerritoryEffects,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  unifiedBonusFor,
  unitsUnlockedByLocation,
  type Base,
  type District,
  type HoldBonus,
  type Location,
  type TerritoryEffects,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { districtsHeldWhole } from './gates.js';
import { projectCity, projectDistrict } from './view.js';
import { standingEffectsFor } from '../crew/standing.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { garrisonedUnits } from '../units/roster.js';
import { controlsIn } from '../battle/ground.js';
import { projectActions, projectBattles } from '../battle/view.js';
import { projectCrewProfile } from '../routes/crews.js';
import { trainingBreakdownFor } from '../units/breakdown.js';
import { heldLocationLevels, unlockContextFor } from '../units/training.js';

/**
 * The second city is ground like any other ground (maintainer, 2026-09-24).
 *
 * Terminus opened as data and the server kept reading Ashfall. The failure had one root and a dozen
 * faces: `CITY_LOCATIONS` and `CITY_DISTRICTS` are one city's catalogue, and the lazy control-row
 * mint, the standings fold, the roster's garrison walk and the gate sweep all walked them. The
 * sharpest face is the first one below, because it makes every other one unreachable: with no
 * control row, a Terminus location is not ground anybody can hold, so nothing downstream of holding
 * it can be tested at all.
 *
 * Every id here is picked off the catalogue rather than typed, so the suite follows the map when
 * the map moves.
 */

const HOUR = '2026-09-01T12:00:00.000Z';

/** A Terminus district with something in it to take. */
const AWAY: District = districtsOfCity(TERMINUS_CITY_ID).find(
  (district) => district.locations.length > 1,
)!;

/** A Terminus plot, which is where a crew standing in the second city lives. */
const AWAY_HOME: District = districtsOfCity(TERMINUS_CITY_ID).find(
  (district) => district.kind === 'residential',
)!;

/**
 * A Terminus location that houses nobody of its own.
 *
 * Picked so the beds a hold is worth are exactly `UNIT_SLOTS_PER_LOCATION`, the flat 20 every held
 * block pays (§A1), with nothing from the location's own card on top. A block that also pays
 * `unit_slots` would make the expected figure a sum of two catalogue readings, and then the test
 * would be checking the catalogue rather than checking that the fold reached the second city.
 */
const PLAIN: Location = ALL_DISTRICTS.flatMap((district) => district.locations).find(
  (location) =>
    districtsOfCity(TERMINUS_CITY_ID).some((district) => district.id === location.districtId) &&
    bonusesAt(location.kind, 1).every((bonus) => bonus.kind !== 'unit_slots'),
)!;

/**
 * The one numeric channel a hold bonus moves, and by how much, read through the game's own fold.
 *
 * So the unified-bonus test below can name a district's reward without hard-coding which channel
 * this week's atlas pays it on.
 */
function channelMoved(bonus: HoldBonus): [keyof TerritoryEffects, number] {
  const probe = noTerritoryEffects();
  const blank = noTerritoryEffects();
  applyHoldBonus(probe, bonus);
  for (const key of Object.keys(probe) as (keyof TerritoryEffects)[]) {
    const after = probe[key];
    const before = blank[key];
    if (typeof after === 'number' && typeof before === 'number' && after !== before) {
      return [key, after - before];
    }
  }
  throw new Error(`${bonus.kind} moves no numeric channel`);
}

/** A Terminus block that unlocks a unit, for the roster's side of the same question. */
const AWAY_UNLOCKS: Location = districtsOfCity(TERMINUS_CITY_ID)
  .flatMap((district) => district.locations)
  .find((location) => unitsUnlockedByLocation(location.kind).length > 0)!;

/** A Terminus block that takes something off a training bill, for the breakdown's ground lines. */
const AWAY_TRAINING: Location = districtsOfCity(TERMINUS_CITY_ID)
  .flatMap((district) => district.locations)
  .find((location) => bonusesAt(location.kind, 1).some((bonus) => bonus.kind === 'training_cost'))!;

function stack(districtId = 'neon-docks'): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'holder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    districtId,
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES, caps: 9e6, scrap: 9e6, planks: 9e6, oil: 9e6 },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus', kind: 'nexus', level: 10, modifications: [] }],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(HOUR),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: HOUR,
  };
  repos.bases.insert(base);
  return { repos, base };
}

/** Hands this crew one block, leaving the rest of the map alone. */
function take(repos: Repositories, baseId: string, location: Location, garrison = {}): void {
  const control = repos.city.control(location.id);
  expect(control, `no control row for ${location.id}`).toBeDefined();
  repos.city.put({ ...control!, holder: { kind: 'crew', baseId }, garrison });
}

/** Hands this crew every location in `district`, leaving the rest of the map alone. */
function takeWhole(repos: Repositories, baseId: string, district: District): void {
  for (const location of district.locations) {
    const control = repos.city.control(location.id);
    expect(control, `no control row for ${location.id}`).toBeDefined();
    repos.city.put({ ...control!, holder: { kind: 'crew', baseId }, garrison: {} });
  }
}

describe('a Terminus location is ground the world knows about', () => {
  /**
   * The root defect. `controls()` minted missing rows off Ashfall's sixty locations and `control`
   * resolved an id against the same array, so a Terminus id answered `undefined` for ever: not
   * "held by the Combine", not "empty", but no such place. Nothing could be taken, garrisoned,
   * fortified or fought over, which made the whole city unreachable.
   */
  it('mints a control row for a location the second city owns', () => {
    const { repos } = stack();
    const [first] = AWAY.locations;

    const control = repos.city.control(first!.id);
    expect(control).toBeDefined();
    expect(control!.locationId).toBe(first!.id);
    expect(repos.city.controls().get(first!.id)).toBeDefined();
  });

  it('keeps what is written to that row', () => {
    const { repos, base } = stack();
    const [first] = AWAY.locations;
    const control = repos.city.control(first!.id)!;

    repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: base.id },
      level: 3,
      garrison: { scavengers: 4 },
    });

    const read = repos.city.control(first!.id)!;
    expect(read.holder).toEqual({ kind: 'crew', baseId: base.id });
    expect(read.level).toBe(3);
    expect(read.garrison).toEqual({ scavengers: 4 });
  });

  /** Every location in the world gets a row, so the count is the whole atlas rather than one city. */
  it('mints one for every location on the map', () => {
    const { repos } = stack();
    const everywhere = ALL_DISTRICTS.flatMap((district) => district.locations);

    expect(repos.city.controls().size).toBe(everywhere.length);
  });

  /** The fight over a Terminus location has to find the district's other rows to resolve at all. */
  it('reports the district`s control rows to the battle engine', () => {
    const { repos } = stack();

    expect(controlsIn(repos, AWAY.id).map((row) => row.locationId)).toEqual(
      AWAY.locations.map((location) => location.id),
    );
  });
});

describe('ground held in the second city pays the crew that holds it', () => {
  /**
   * `territoryEffectsFor` was handed Ashfall's sixty, so a crew that marched across and took a
   * platform was paid nothing for it. `UNIT_SLOTS_PER_LOCATION` is the flat 20 beds every held
   * block is worth (§A1) and it is the cleanest of the channels to pin: it does not depend on
   * which location was taken.
   */
  it('pays unit slots for a location held abroad', () => {
    const { repos, base } = stack();
    const before = standingEffectsFor(repos, base, new Date(HOUR)).unitSlotBonus;

    const control = repos.city.control(PLAIN.id)!;
    repos.city.put({ ...control, holder: { kind: 'crew', baseId: base.id }, garrison: {} });

    const after = standingEffectsFor(repos, base, new Date(HOUR)).unitSlotBonus;
    expect(after - before).toBe(UNIT_SLOTS_PER_LOCATION);
  });

  it('carries those beds through to the district`s capacity', () => {
    const { repos, base } = stack();
    const before = districtUnitSlots(repos, base).capacity;

    const control = repos.city.control(PLAIN.id)!;
    repos.city.put({ ...control, holder: { kind: 'crew', baseId: base.id }, garrison: {} });

    expect(districtUnitSlots(repos, base).capacity - before).toBe(UNIT_SLOTS_PER_LOCATION);
  });

  /**
   * Garrisons abroad used to be free. `postedUnits` walks a table and so always counted a posting
   * wherever it stood, while `garrisonedUnits` walked one city's catalogue: units standing on a
   * crew's own Terminus ground drew no beds and cost no payroll.
   */
  it('counts units garrisoned abroad as units this crew feeds', () => {
    const { repos, base } = stack();
    const empty = districtUnitSlots(repos, base).army;
    const control = repos.city.control(PLAIN.id)!;
    repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: base.id },
      garrison: { scavengers: 6 },
    });

    expect(garrisonedUnits(repos, base)).toEqual({ scavengers: 6 });
    // `army` is the roster and every garrison on it, which is the figure a training order is
    // refused against: six carriers standing on a Terminus platform used to be housed by nobody.
    expect(districtUnitSlots(repos, base).army).toBeGreaterThan(empty);
  });

  /** A district taken end to end is a gate, in whichever city it happens to be. */
  it('counts a district held whole abroad', () => {
    const { repos, base } = stack();
    takeWhole(repos, base.id, AWAY);

    expect(districtsHeldWhole(repos, base.id)).toContain(AWAY.id);
  });

  /**
   * And the unified bonus that finishing it pays, which is the district-level half of the fold
   * rather than the per-location half.
   *
   * Measured by taking the district whole and then handing one block back, because that is the
   * only difference between "holder of all of it" and "holder of most of it". The channel is safe
   * to read on its own: `atlas.test.ts` refuses a unified bonus of a kind that any location inside
   * the same district already pays, so giving a block back cannot move this number by itself.
   */
  it('pays the whole-district bonus abroad', () => {
    const { repos, base } = stack();
    const [channel, amount] = channelMoved(unifiedBonusFor(AWAY.id)!.bonus);

    takeWhole(repos, base.id, AWAY);
    const whole = standingEffectsFor(repos, base, new Date(HOUR))[channel] as number;

    const [first] = AWAY.locations;
    const control = repos.city.control(first!.id)!;
    repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: {} });
    const short = standingEffectsFor(repos, base, new Date(HOUR))[channel] as number;

    expect(amount).toBeGreaterThan(0);
    expect(whole - short).toBe(amount);
  });
});

describe('a crew standing in the second city is shown the second city', () => {
  /**
   * `projectCity` mapped Ashfall's twelve districts and `summarise` looked its home up in the same
   * array. A Terminus resident was therefore served somebody else's map with `isHome` false on
   * every row of it, and, because the travel fallback answers 0 for a home the array does not
   * hold, every district on it was quoted as no distance at all.
   */
  it('draws its own city`s districts, with its home among them', () => {
    const { repos, base } = stack(AWAY_HOME.id);
    const city = projectCity(repos, base, new Date(HOUR));

    expect(city.districts.map((row) => row.district.id)).toEqual(
      districtsOfCity(TERMINUS_CITY_ID).map((district) => district.id),
    );
    expect(city.homeDistrictId).toBe(AWAY_HOME.id);
    expect(city.districts.filter((row) => row.isHome)).toHaveLength(1);
  });

  it('quotes a real road to everywhere but its own door', () => {
    const { repos, base } = stack(AWAY_HOME.id);
    const city = projectCity(repos, base, new Date(HOUR));

    for (const row of city.districts) {
      if (row.district.id === AWAY_HOME.id) continue;
      expect(row.travelMinutes, `${row.district.id} quoted as no distance`).toBeGreaterThan(0);
    }
  });

  /** An Ashfall crew is still shown Ashfall: the fix is about which city, not about all of them. */
  it('leaves a crew at home looking at home', () => {
    const { repos, base } = stack('kettle-row');
    const city = projectCity(repos, base, new Date(HOUR));

    expect(city.districts.every((row) => row.district.cityId === 'ashfall')).toBe(true);
  });
});

describe('the roster and the file read the second city too', () => {
  /**
   * §A5: a location unlocks units for whoever holds it. `unlockContextFor` walked Ashfall's sixty,
   * so the Kennels on Bonded Row unlocked nothing for the crew standing on them and the roster card
   * still read "you need a doghouse" beside a doghouse they held.
   */
  it('unlocks what a block held abroad unlocks', () => {
    const { repos, base } = stack();
    expect(unlockContextFor(repos, base).heldPlaceKinds.has(AWAY_UNLOCKS.kind)).toBe(false);

    take(repos, base.id, AWAY_UNLOCKS);

    expect(unlockContextFor(repos, base).heldPlaceKinds.has(AWAY_UNLOCKS.kind)).toBe(true);
  });

  /** And the level it has been worked up to, which is what `homeTrainingBonus` prices. */
  it('reads the level of a block held abroad', () => {
    const { repos, base } = stack();
    const control = repos.city.control(AWAY_UNLOCKS.id)!;
    repos.city.put({ ...control, holder: { kind: 'crew', baseId: base.id }, level: 4 });

    expect(heldLocationLevels(repos, base).get(AWAY_UNLOCKS.kind)).toBe(4);
  });

  /**
   * The hover card that says where a training discount came from. It walked one city, so a crew
   * paying less because of an armoury it holds in Terminus was shown a total with no line under it.
   */
  it('names a block held abroad in the training breakdown', () => {
    const { repos, base } = stack();
    take(repos, base.id, AWAY_TRAINING);

    const lines = trainingBreakdownFor(repos, base, new Date(HOUR)).cost;
    expect(lines.map((line) => line.source)).toContain(AWAY_TRAINING.name);
  });

  /** "Where is everybody right now" has to answer for people standing in a second city. */
  it('lists a garrison abroad on the actions screen', () => {
    const { repos, base } = stack();
    take(repos, base.id, AWAY_UNLOCKS, { scavengers: 3 });

    const stationed = projectActions(repos, base, new Date(HOUR)).stationed;
    expect(stationed.map((row) => row.locationId)).toContain(AWAY_UNLOCKS.id);
  });

  /** A crew's file lists what it holds, and ground abroad is ground it holds. */
  it('lists a holding abroad on the crew`s own file', () => {
    const { repos, base } = stack();
    take(repos, base.id, AWAY_UNLOCKS);
    const user = repos.users.findById('u')!;

    const profile = projectCrewProfile(repos, {
      crew: base,
      user,
      viewer: base,
      now: new Date(HOUR),
    });

    expect(profile.holdings.map((holding) => holding.locationId)).toContain(AWAY_UNLOCKS.id);
    expect(profile.holdings.find((holding) => holding.locationId === AWAY_UNLOCKS.id)?.kind).toBe(
      LOCATION_CATALOG[AWAY_UNLOCKS.kind].label,
    );
  });
});

describe('the board prices the ground a crew took abroad', () => {
  /** The front door of a district abroad. Absent, the screen offers no gate at all. */
  it('draws the front door of a district abroad', () => {
    const { repos, base } = stack();
    take(repos, base.id, PLAIN);

    const board = projectBattles(repos, base, new Date(HOUR));
    expect(board.gates.map((gate) => gate.districtId)).toContain(PLAIN.districtId);
  });

  /**
   * §D7: an absent price reads as free, and only ground a *player* holds is charged for at all.
   * The sweep walked one city, so calling on another player's Terminus block was quoted at nothing
   * in the dialog and billed for at the route.
   */
  it('quotes a call on another player`s ground abroad', () => {
    const { repos, base } = stack();
    const [mine, theirs] = AWAY.locations;
    take(repos, base.id, mine!);

    repos.users.insert({ id: 'u2', username: 'rival', passwordHash: 'x', createdAt: HOUR });
    const rival: Base = { ...base, id: 'b2', ownerId: 'u2', name: 'Someone Else' };
    repos.bases.insert(rival);
    take(repos, rival.id, theirs!);

    const board = projectBattles(repos, base, new Date(HOUR));
    expect(board.callPrices.locations[theirs!.id]).toBeGreaterThan(0);
  });

  /** The district page's own road, which fell back to "0 min" for a home the array did not hold. */
  it('quotes a real road from a home abroad', () => {
    const { repos, base } = stack(AWAY_HOME.id);
    const view = projectDistrict(repos, base, AWAY, new Date(HOUR));

    expect(view.travelMinutes).toBeGreaterThan(0);
  });
});
