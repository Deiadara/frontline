import {
  ATTRIBUTES_BY_GROUP,
  EVERY_LOCATION,
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  MAX_OFFICER_LIFT,
  RESEARCH_ITEMS,
  STARTING_RESOURCES,
  TRAININGS_PER_DAY,
  bareBattlefield,
  bonusesAt,
  cityIsOpen,
  createCommander,
  discounted,
  discountedCaps,
  discountedInfamy,
  earnedInfamy,
  effectiveMarketDiscount,
  effectiveStats,
  findDistrict,
  findLocation,
  findUnit,
  gainInfamy,
  hastenedMinutes,
  heldDefense,
  lootCapacityOf,
  makeAttributes,
  missionSpeedPercentIn,
  musterCost,
  musterSecondsFor,
  roadMinutes,
  rawMinutesBetween,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  stimmed,
  type Base,
  type CrewEffects,
  type District,
  type Location,
  type LocationKind,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { refundFor } from '../battle/resolve.js';
import {
  liftedOfficerSheet,
  officerFitReader,
  officerLiftRoom,
  standingEffectsFor,
} from '../crew/standing.js';
import { projectTraining } from '../crew/training.js';
import { buildClocksFor } from '../district/build.js';
import { productionRatesFor } from '../district/settle.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { minutesFor } from '../research/tracks.js';
import { spyStrengthFor } from '../spying/spying.js';
import { musterRatesFor } from '../units/muster.js';
import { stationsHeldBy } from './railway.js';
import { projectCity } from './view.js';

/**
 * §A4: every kind of hold bonus, held on its own, moves the number its consumer reads (bug pass,
 * 2026-10-05).
 *
 * `channels.test.ts` proves every channel is fed and `hold-effects.test.ts` follows four of them to
 * the till. This walks the rest: one crew, one location, nothing else on the map, and the figure
 * the game spends measured with and without it. A bonus that folds into a channel nobody reads
 * fails here as a zero, and one read off the wrong fold fails as the bare number.
 *
 * Where the consumer is a route, the figure is measured on the function the route calls with the
 * standing it reads, since that pair is where every wiring bug in this area has lived.
 */

const HOUR = '2026-09-01T12:00:00.000Z';
const NOW = new Date(HOUR);

function stack(): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'holder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    // An Ashfall plot, so every Ashfall road below has a length.
    districtId: 'south-quay',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus', kind: 'nexus', level: 10, modifications: [] }],
    buildQueue: [],
    army: {},
    musterQueue: [],
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

/** The first location of `kind` in an open city. */
function somewhere(kind: LocationKind): Location {
  const found = EVERY_LOCATION.find(
    (location) => location.kind === kind && cityIsOpen(findDistrict(location.districtId)!.cityId),
  );
  if (!found) throw new Error(`no ${kind} in an open city`);
  return found;
}

function take(repos: Repositories, baseId: string, location: Location, level = 1): void {
  const control = repos.city.control(location.id)!;
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

/** A fresh crew holding one location of `kind`, and the same crew's standing before it took it. */
function holding(
  kind: LocationKind,
  level = 1,
): { repos: Repositories; base: Base; before: CrewEffects; after: CrewEffects } {
  const { repos, base } = stack();
  const before = standingEffectsFor(repos, base, NOW);
  take(repos, base.id, somewhere(kind), level);
  return { repos, base, before, after: standingEffectsFor(repos, base, NOW) };
}

/** The one bonus of `bonusKind` a kind pays at level 1, as a number. */
function face(kind: LocationKind, bonusKind: string): number {
  const bonus = bonusesAt(kind, 1).find((one) => one.kind === bonusKind) as
    { percent?: number; flat?: number } | undefined;
  const value = bonus?.percent ?? bonus?.flat;
  if (value === undefined) throw new Error(`${kind} has no ${bonusKind}`);
  return value;
}

const ANODICS = findUnit('anodics')!;
const FIELD = bareBattlefield();

/** Muster prices with no cut at all: what the catalogue charges. */
const PLAIN_RATES = {
  costPercent: 0,
  suppliesPercent: 0,
  veteranPercent: 0,
  speedPercent: 0,
  locationLevels: new Map(),
  costPercentByTier: {},
};

describe('what the ground makes', () => {
  it('pays a Gas Station`s oil and scrap into the hourly rate, scaled by its level', () => {
    const { repos, base } = holding('gas_station', 3);
    // 18 and 8 at level 1, three times that at level 3: a level pays its number (`LEVEL_SCALE`).
    expect(productionRatesFor(repos, base, NOW)).toMatchObject({ oil: 54, scrap: 24 });
  });

  it('makes the oil the ground pumps go further with a Nuclear Plant beside it', () => {
    const { repos, base } = stack();
    take(repos, base.id, somewhere('gas_station'));
    expect(productionRatesFor(repos, base, NOW).oil).toBeCloseTo(18, 6);
    take(repos, base.id, somewhere('nuclear_plant'));
    const rates = productionRatesFor(repos, base, NOW);
    expect(rates.oil).toBeCloseTo(18 * 1.12, 6);
    expect(rates.highQualityMetal).toBe(5);
  });
});

describe('what the ground does in a fight', () => {
  const stats = (effects: CrewEffects, defending: boolean) =>
    effectiveStats(ANODICS, FIELD, { defending, outnumbered: 0 }, effects);

  it('High Ground: defenders only, through the held-ground curve', () => {
    const { before, after } = holding('high_ground');
    expect(stats(after, true).vitality / stats(before, true).vitality).toBeCloseTo(
      1 + heldDefense(12) / 100,
      9,
    );
    expect(stats(after, false).vitality).toBe(stats(before, false).vitality);
  });

  it.each([
    ['mad_scientist_lair', 'unit_offense', 'offense'],
    ['hospital', 'unit_vitality', 'vitality'],
  ] as const)('%s: %s lands on every unit, attacking or not', (kind, bonusKind, stat) => {
    const { before, after } = holding(kind);
    expect(stats(after, false)[stat] / stats(before, false)[stat]).toBeCloseTo(
      1 + face(kind, bonusKind) / 100,
      9,
    );
  });

  it('Cinema morale and Broadcast Tower menace are flat points on the sheet', () => {
    const cinema = holding('cinema');
    expect(stats(cinema.after, false).morale - stats(cinema.before, false).morale).toBe(12);
    const tower = holding('broadcast_tower');
    expect(stats(tower.after, false).intimidation - stats(tower.before, false).intimidation).toBe(
      10,
    );
  });

  it('Skate Ground speed and Sewer Junction stealth multiply the sheet', () => {
    const skate = holding('skate_ground');
    expect(stats(skate.after, false).speed).toBeCloseTo(
      Math.min(100, stats(skate.before, false).speed * 1.12),
      9,
    );
    const sewer = holding('sewer_junction');
    expect(stats(sewer.after, false).stealth).toBe(Math.round(ANODICS.stats.stealth * 1.15));
  });

  it('Black Clinic: two syringes, three points of offense and a point of morale each', () => {
    const { before, after } = holding('black_clinic');
    expect(after.battleStims).toBe(2);
    expect(stimmed(after).unitOffensePercent - before.unitOffensePercent).toBe(6);
    expect(stimmed(after).unitMoraleFlat - before.unitMoraleFlat).toBe(2);
  });

  it('the three rules and the Fight Pit`s cut reach the fold the engine reads', () => {
    // The pit pays double infamy for the intimidated and no longer puts the porters in the line
    // (maintainer, 2026-10-06); `carriers_fight` is Field Commander's and the Lab's now.
    expect(holding('fight_pit').after.intimidatedInfamyPercent).toBe(100);
    expect(holding('fight_pit').after.carriersFight).toBe(false);
    expect(holding('war_machine_graveyard').after.anyRide).toBe(true);
    expect(holding('chapel').after.steadyNerve).toBe(true);
    expect(holding('barricade').after.unitMarks).toMatchObject({ ironsides: ['stalwart'] });
  });

  it('Bone Market: a share of the dead`s caps comes back', () => {
    const { after } = holding('bone_market');
    const paid = musterCost(ANODICS, 10).caps!;
    // 10 Anodics at 90 caps, 12% back.
    expect(paid).toBe(900);
    expect(refundFor({ anodics: 10 }, after.salvageRefundPercent, PLAIN_RATES)).toEqual({
      caps: 108,
    });
  });

  it('Graveyard: more infamy off what a fight earns', () => {
    const { after } = holding('graveyard');
    // Banked through `gainInfamy`, which rounds the float residue of 100 x 1.15.
    expect(gainInfamy(0, earnedInfamy(100, after.infamyGainPercent))).toBe(115);
  });

  it('Pawn Shop: a bigger truck', () => {
    const { before, after } = holding('pawn_shop');
    // Per unit and in whole slots (`raid.ts`, maintainer 2026-10-07), so the bonus lands on one
    // Anodic's bag, rounded up, and ten of them carry ten of that.
    const one = lootCapacityOf({ anodics: 1 }, before.lootCapacityPercent);
    expect(lootCapacityOf({ anodics: 1 }, after.lootCapacityPercent)).toBe(Math.ceil(one * 1.15));
    expect(lootCapacityOf({ anodics: 10 }, after.lootCapacityPercent)).toBe(
      Math.ceil(one * 1.15) * 10,
    );
  });
});

describe('what the ground does to the clocks', () => {
  it('University: points off the research clock', () => {
    const { repos, base } = stack();
    const rung = RESEARCH_ITEMS.find((item) => item.minutes >= 100)!;
    const bare = minutesFor(repos, base, rung, officerFitReader(repos, base, NOW));
    take(repos, base.id, somewhere('university'));
    const sped = minutesFor(repos, base, rung, officerFitReader(repos, base, NOW));
    expect(bare).toBe(rung.minutes);
    expect(sped).toBe(Math.round(rung.minutes * 0.88));
  });

  it('Construction Site: points off every build clock', () => {
    const { repos, base } = stack();
    const bare = buildClocksFor(repos, base, NOW, false);
    take(repos, base.id, somewhere('construction_site'));
    const sped = buildClocksFor(repos, base, NOW, false);
    const kinds = Object.keys(bare) as (keyof typeof bare)[];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(sped[kind], kind).toBe(Math.max(1, Math.round(bare[kind]! * 0.9)));
    }
  });

  it('Arcade and Armory: the muster bench`s speed and price', () => {
    const arcade = holding('arcade');
    expect(musterRatesFor(arcade.repos, arcade.base, NOW).speedPercent).toBe(12);
    expect(musterSecondsFor(ANODICS, 1, 12)).toBe(Math.round(ANODICS.musterSeconds / 1.12));
    const armory = holding('armory');
    expect(musterRatesFor(armory.repos, armory.base, NOW).costPercent).toBe(1);
  });

  it('Smuggler`s Tunnel: every job is home sooner, in any city', () => {
    const { after } = holding('smugglers_tunnel');
    expect(hastenedMinutes(112, missionSpeedPercentIn(after, 'neon-docks'))).toBe(100);
    expect(hastenedMinutes(112, missionSpeedPercentIn(after, 'coldwater-halt'))).toBe(100);
    expect(hastenedMinutes(112, missionSpeedPercentIn(after, 'misc'))).toBe(100);
  });
});

describe('what the ground does to the roads', () => {
  const far: District = findDistrict('ccs')!;
  const home: District = findDistrict('south-quay')!;
  const quoted = (repos: Repositories, base: Base) =>
    projectCity(repos, base, NOW).districts.find((one) => one.district.id === far.id)!
      .travelMinutes;

  it('Rail Yard: a percentage off what the road came to', () => {
    const { repos, base } = holding('rail_yard');
    expect(quoted(repos, base)).toBe(roadMinutes(rawMinutesBetween(home, far), 0, 10));
  });

  // One channel since 2026-10-07: the depot's four flat minutes became four more travel points,
  // so it pays 22 and the road is a percentage all the way down.
  it('Tram Depot: twenty-two points off the road and nothing flat', () => {
    const { repos, base } = holding('tram_depot');
    const raw = rawMinutesBetween(home, far);
    expect(quoted(repos, base)).toBe(roadMinutes(raw, 0, 22));
  });

  it('Station: the district goes on the line', () => {
    const { repos, base } = stack();
    const station = somewhere('rail_station');
    expect(stationsHeldBy(repos, base).size).toBe(0);
    take(repos, base.id, station);
    expect([...stationsHeldBy(repos, base)]).toEqual([station.districtId]);
  });
});

describe('what the ground does to prices', () => {
  it('Downtown Market: off every caps price, through the curve', () => {
    const { after } = holding('downtown_market');
    expect(discountedCaps(1000, after.marketDiscountPercent)).toBe(
      Math.round(1000 * (1 - effectiveMarketDiscount(10) / 100)),
    );
  });

  it('Statue of the Revolutionist: off the black market`s infamy', () => {
    const { after } = holding('revolutionist_statue');
    expect(discountedInfamy(100, after.blackMarketDiscountPercent)).toBe(85);
  });

  it('Armory refits and Rail Yard machines: off the bill', () => {
    expect(discounted({ caps: 100 }, holding('armory').after.refitDiscountPercent)).toEqual({
      caps: 80,
    });
    expect(discounted({ caps: 100 }, holding('rail_yard').after.vehiclePartsPercent)).toEqual({
      caps: 80,
    });
  });
});

describe('what the ground does for the crew', () => {
  it('Gym: one more session on the day`s allowance', () => {
    const { base, after } = holding('gym');
    const training = projectTraining(base, undefined, HOUR, after.extraTrainingSessions);
    expect(training.perDay).toBe(TRAININGS_PER_DAY + 1);
  });

  it('Watchtower: points on every spy job', () => {
    const { repos, base } = holding('watchtower');
    expect(spyStrengthFor(repos, base, 'loose_ears', NOW).intelPercent).toBe(38);
  });

  it('Fence Camp: twenty beds for the block and fifty more for the camp', () => {
    const { repos, base } = stack();
    const bare = districtUnitSlots(repos, base, {}).capacity;
    take(repos, base.id, somewhere('refugee_camp'));
    expect(districtUnitSlots(repos, base, {}).capacity - bare).toBe(70);
  });

  it('Broadcast Station: two points on every social attribute of every officer', () => {
    const { repos, base } = stack();
    const officer = createCommander('o1', 'Vell', 'engineer', makeAttributes(30));
    const crew: Base = { ...base, commanders: [officer] };
    const bare = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    take(repos, base.id, somewhere('broadcast_station'));
    const lifted = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    const moved = Object.fromEntries(
      Object.entries(lifted)
        .map(([name, value]) => [name, value - bare[name as keyof typeof bare]] as const)
        .filter(([, gained]) => gained !== 0),
    );
    // Halved since 2026-10-05: two at level 1.
    expect(moved).toEqual(Object.fromEntries(ATTRIBUTES_BY_GROUP.social.map((name) => [name, 2])));
  });

  /** Maintainer, 2026-10-05: the ground's group lift sits outside the officers' ten-point cap. */
  it('Broadcast Station at level 5: six points, paid in full outside the lift cap', () => {
    const { repos, base } = stack();
    const officer = createCommander('o1', 'Vell', 'engineer', makeAttributes(30));
    const crew: Base = { ...base, commanders: [officer] };
    const bare = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    // Five on the card: half of that floored, then one a level (`officer_group` in `scaledBonus`).
    take(repos, base.id, somewhere('broadcast_station'), MAX_LOCATION_LEVEL);
    const lifted = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    for (const name of ATTRIBUTES_BY_GROUP.social) {
      expect(lifted[name] - bare[name], name).toBe(6);
    }
  });
});

/**
 * Arca's ground (maintainer, 2026-10-06). These take the authored plots by id, which is the point:
 * a Market here pays what the atlas says and not what a Market pays.
 */
describe('what Arca`s ground does', () => {
  const DEATH_CLOAKS = findUnit('death_cloaks')!;
  const at = (id: string): Location => {
    const found = findLocation(id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  const stats = (unitId: string, effects: CrewEffects) =>
    effectiveStats(findUnit(unitId)!, FIELD, { defending: false, outnumbered: 0 }, effects);

  it('Mausoleum: thirty damage and vitality on a Death Cloak for every tomb held, and the beds', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    take(repos, base.id, at('gravefields-mausoleums'));
    const one = standingEffectsFor(repos, base, NOW);
    take(repos, base.id, at('candlemarket-tomb'));
    const two = standingEffectsFor(repos, base, NOW);
    expect([bare.mausoleums, one.mausoleums, two.mausoleums]).toEqual([0, 1, 2]);
    expect(stats('death_cloaks', two).offense - stats('death_cloaks', bare).offense).toBe(60);
    expect(stats('death_cloaks', two).vitality - stats('death_cloaks', bare).vitality).toBe(60);
    // Faith is theirs alone: a Razor beside them gains nothing from the tombs.
    expect(stats('razors', two).offense).toBe(stats('razors', bare).offense);
    expect(DEATH_CLOAKS.faith).toBe(true);
    expect(two.unitSlotBonus - bare.unitSlotBonus).toBe(2 * (6 + 20));
  });

  it('pays what the atlas wrote on the plot, not what the kind pays', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    take(repos, base.id, at('candlemarket-waxstalls'));
    take(repos, base.id, at('candlemarket-chandlery'));
    take(repos, base.id, at('candlemarket-hostels'));
    take(repos, base.id, at('gravefields-mourners'));
    take(repos, base.id, at('gravefields-cemetery'));
    const after = standingEffectsFor(repos, base, NOW);
    expect((after.perHour.caps ?? 0) - (bare.perHour.caps ?? 0), 'the Wax Stalls').toBe(40);
    expect((after.perHour.oil ?? 0) - (bare.perHour.oil ?? 0), 'the Chandlery').toBe(20);
    expect(
      (after.perHour.highQualityMetal ?? 0) - (bare.perHour.highQualityMetal ?? 0),
      'Mourners Row',
    ).toBe(2);
    // Five plots: twenty beds each, and the Hostels' fifty on top. No caps from the camp.
    expect(after.unitSlotBonus - bare.unitSlotBonus).toBe(5 * 20 + 50);
    expect(after.infamyGainPercent - bare.infamyGainPercent, 'the Cemetery').toBe(5);
    // Nothing the kinds would have paid leaks through: a Pawn Shop's bigger truck, for one.
    expect(after.lootCapacityPercent).toBe(bare.lootCapacityPercent);
  });

  it('Martyr`s Plinth: ten morale on the rabble and none on anybody else', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    take(repos, base.id, at('candlemarket-plinth'));
    const after = standingEffectsFor(repos, base, NOW);
    expect(after.unitMoraleFlat).toBe(bare.unitMoraleFlat);
    expect(stats('razors', after).morale - stats('razors', bare).morale).toBe(10);
    expect(stats('sluggers', after).morale).toBe(stats('sluggers', bare).morale);
  });

  it('Bulb-String Loft and the Wake House: five points on four named skills, past the lift cap', () => {
    const { repos, base } = stack();
    const officer = createCommander('o1', 'Vell', 'engineer', makeAttributes(30));
    const crew: Base = { ...base, commanders: [officer] };
    const bare = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    take(repos, base.id, at('candlemarket-loft'));
    take(repos, base.id, at('gravefields-wakehouse'));
    const lifted = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    const moved = Object.fromEntries(
      Object.entries(lifted)
        .map(([name, value]) => [name, value - bare[name as keyof typeof bare]] as const)
        .filter(([, gained]) => gained !== 0),
    );
    expect(moved).toEqual({ communication: 5, signals: 5, empathy: 5, resolve: 5 });
    // Outside the cap, like the group lift: level 5 pays the level's whole figure, twice the card
    // (`OFFICER_LEVEL_SCALE`), even though the cap on lifts is ten.
    take(repos, base.id, at('candlemarket-loft'), MAX_LOCATION_LEVEL);
    const high = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    expect(high.communication - bare.communication).toBe(10);
    expect(high.communication - bare.communication).toBeGreaterThanOrEqual(MAX_OFFICER_LIFT);
  });
});

describe('the sweep covers the catalogue', () => {
  it('names every bonus kind a location pays', () => {
    const paid = new Set(
      Object.values(LOCATION_CATALOG).flatMap((spec) => spec.bonuses.map((one) => one.kind)),
    );
    // Everything a location can pay, and nothing above was written for a kind no location pays.
    expect([...paid].sort()).toEqual(
      [
        'any_ride',
        'battle_stims',
        'black_market_discount',
        'build_speed',
        'carrier_loot_flat',
        'defense_percent',
        'faith',
        'golden_jobs',
        'infamy_gain',
        'intel',
        'intimidated_infamy',
        'intimidation',
        'loot_capacity',
        'market_discount',
        'mission_speed',
        'muster_cost',
        'muster_speed',
        'officer_group',
        'rail_link',
        'refit_discount',
        'research_speed',
        'resource',
        'resource_yield',
        'salvage_refund',
        'steady_nerve',
        'storage',
        'training_sessions',
        'travel_speed',
        'trophies',
        'unit_door',
        'unit_mark',
        'unit_morale',
        'unit_offense',
        'unit_slots',
        'unit_speed',
        'unit_stealth',
        'unit_vitality',
        'vehicle_parts',
      ].sort(),
    );
  });
});
