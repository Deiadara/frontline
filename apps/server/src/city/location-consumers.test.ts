import {
  ATTRIBUTES_BY_GROUP,
  EVERY_LOCATION,
  MAX_LOCATION_LEVEL,
  MAX_OFFICER_LIFT,
  RESEARCH_ITEMS,
  STARTING_RESOURCES,
  TRAININGS_PER_DAY,
  UNIT_SLOTS_PER_LOCATION,
  UNIT_SLOTS_PER_LOCATION_LEVEL,
  levelSteps,
  bareBattlefield,
  barterQuote,
  bonusesAt,
  brokerRate,
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
  applyHoldBonus,
  noTerritoryEffects,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { refundFor } from '../battle/resolve.js';
import { barter } from '../market/board.js';
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

/** One location, by id, in an open city. */
function somewhere(id: string): Location {
  const found = EVERY_LOCATION.find(
    (location) => location.id === id && cityIsOpen(findDistrict(location.districtId)!.cityId),
  );
  if (!found) throw new Error(`no ${id} in an open city`);
  return found;
}

function take(repos: Repositories, baseId: string, location: Location, level = 1): void {
  const control = repos.city.control(location.id)!;
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

/** A fresh crew holding one location, and the same crew's standing before it took it. */
function holding(
  id: string,
  level = 1,
): { repos: Repositories; base: Base; before: CrewEffects; after: CrewEffects } {
  const { repos, base } = stack();
  const before = standingEffectsFor(repos, base, NOW);
  take(repos, base.id, somewhere(id), level);
  return { repos, base, before, after: standingEffectsFor(repos, base, NOW) };
}

/** The one bonus of `bonusKind` a location pays at level 1, as a number. */
function face(id: string, bonusKind: string): number {
  const bonus = bonusesAt(somewhere(id), 1).find((one) => one.kind === bonusKind) as
    { percent?: number; flat?: number } | undefined;
  const value = bonus?.percent ?? bonus?.flat;
  if (value === undefined) throw new Error(`${id} has no ${bonusKind}`);
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
  speedPercentByTier: {},
};

describe('what the ground makes', () => {
  it('pays a Gas Station`s oil and scrap into the hourly rate, scaled by its level', () => {
    const { repos, base } = holding('steelbelt-pumps', 3);
    // 18 and 8 at level 1, three times that at level 3: a level pays its number (`LEVEL_SCALE`).
    expect(productionRatesFor(repos, base, NOW)).toMatchObject({ oil: 54, scrap: 24 });
  });

  it('makes the oil the ground pumps go further with a Nuclear Plant beside it', () => {
    const { repos, base } = stack();
    take(repos, base.id, somewhere('steelbelt-pumps'));
    expect(productionRatesFor(repos, base, NOW).oil).toBeCloseTo(18, 6);
    take(repos, base.id, somewhere('blacksite-pile'));
    const rates = productionRatesFor(repos, base, NOW);
    expect(rates.oil).toBeCloseTo(18 * 1.12, 6);
    expect(rates.highQualityMetal).toBe(5);
  });
});

describe('what the ground does in a fight', () => {
  const stats = (effects: CrewEffects, defending: boolean) =>
    effectiveStats(ANODICS, FIELD, { defending, outnumbered: 0 }, effects);

  it('High Ground: defenders only, through the held-ground curve', () => {
    const { before, after } = holding('chrome-row-overlook');
    expect(stats(after, true).vitality / stats(before, true).vitality).toBeCloseTo(
      1 + heldDefense(12) / 100,
      9,
    );
    expect(stats(after, false).vitality).toBe(stats(before, false).vitality);
  });

  it.each([
    ['undergrid-lair', 'unit_offense', 'offense'],
    ['chrome-row-ferrous', 'unit_vitality', 'vitality'],
  ] as const)('%s: %s lands on every unit, attacking or not', (id, bonusKind, stat) => {
    const { before, after } = holding(id);
    expect(stats(after, false)[stat] / stats(before, false)[stat]).toBeCloseTo(
      1 + face(id, bonusKind) / 100,
      9,
    );
  });

  it('Cinema morale and Broadcast Tower menace are flat points on the sheet', () => {
    const cinema = holding('chrome-row-regal');
    expect(stats(cinema.after, false).morale - stats(cinema.before, false).morale).toBe(12);
    const tower = holding('chrome-row-cathode');
    expect(stats(tower.after, false).intimidation - stats(tower.before, false).intimidation).toBe(
      10,
    );
  });

  it('Skate Ground speed and Sewer Junction stealth multiply the sheet', () => {
    const skate = holding('steelbelt-ramp');
    expect(stats(skate.after, false).speed).toBeCloseTo(
      Math.min(100, stats(skate.before, false).speed * 1.12),
      9,
    );
    const sewer = holding('undergrid-junction');
    expect(stats(sewer.after, false).stealth).toBe(Math.round(ANODICS.stats.stealth * 1.15));
  });

  it('Black Clinic: two syringes, three points of offense and a point of morale each', () => {
    const { before, after } = holding('blacksite-blackward');
    expect(after.battleStims).toBe(2);
    expect(stimmed(after).unitOffensePercent - before.unitOffensePercent).toBe(6);
    expect(stimmed(after).unitMoraleFlat - before.unitMoraleFlat).toBe(2);
  });

  it('the rules and the Fight Pit`s cut reach the fold the engine reads', () => {
    // The pit pays double infamy for the intimidated and no longer puts the porters in the line
    // (maintainer, 2026-10-06); `carriers_fight` is Field Commander's and the Lab's now.
    expect(holding('blacksite-pit17').after.intimidatedInfamyPercent).toBe(100);
    expect(holding('blacksite-pit17').after.carriersFight).toBe(false);
    expect(holding('glasshouse-fields-fieldchapel').after.steadyNerve).toBe(true);
    expect(holding('blacksite-outer').after.unitMarks).toMatchObject({ ironsides: ['stalwart'] });
  });

  it('Bone Market: a share of the dead`s caps comes back', () => {
    const { after } = holding('bonded-row-rendering');
    const paid = musterCost(ANODICS, 10).caps!;
    // 10 Anodics at 90 caps, 12% back.
    expect(paid).toBe(900);
    expect(refundFor({ anodics: 10 }, after.salvageRefundPercent, PLAIN_RATES)).toEqual({
      caps: 108,
    });
  });

  it('Graveyard: more infamy off what a fight earns', () => {
    const { after } = holding('ccs-martyrs');
    // Banked through `gainInfamy`, which rounds the float residue of 100 x 1.15.
    expect(gainInfamy(0, earnedInfamy(100, after.infamyGainPercent))).toBe(115);
  });

  it('Pawn Shop: a bigger truck', () => {
    const { before, after } = holding('neon-docks-chandler');
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
    take(repos, base.id, somewhere('annexes-faculty'));
    const sped = minutesFor(repos, base, rung, officerFitReader(repos, base, NOW));
    expect(bare).toBe(rung.minutes);
    expect(sped).toBe(Math.round(rung.minutes * 0.88));
  });

  it('Construction Site: points off every build clock', () => {
    const { repos, base } = stack();
    const bare = buildClocksFor(repos, base, NOW, false);
    take(repos, base.id, somewhere('annexes-scaffold'));
    const sped = buildClocksFor(repos, base, NOW, false);
    const kinds = Object.keys(bare) as (keyof typeof bare)[];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(sped[kind], kind).toBe(Math.max(1, Math.round(bare[kind]! * 0.9)));
    }
  });

  it('Arcade and Armory: the muster bench`s speed and price', () => {
    const arcade = holding('chrome-row-coinop');
    expect(musterRatesFor(arcade.repos, arcade.base, NOW).speedPercent).toBe(12);
    expect(musterSecondsFor(ANODICS, 1, 12)).toBe(Math.round(ANODICS.musterSeconds / 1.12));
    const armory = holding('blacksite-armory');
    expect(musterRatesFor(armory.repos, armory.base, NOW).costPercent).toBe(1);
  });

  it('Smuggler`s Tunnel: every job is home sooner, in any city', () => {
    const { after } = holding('neon-docks-runners');
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
    const { repos, base } = holding('glasshouse-fields-haulers');
    expect(quoted(repos, base)).toBe(roadMinutes(rawMinutesBetween(home, far), 0, 10));
  });

  // One channel since 2026-10-07: the depot's four flat minutes became four more travel points,
  // so it pays 22 and the road is a percentage all the way down.
  it('Tram Depot: twenty-two points off the road and nothing flat', () => {
    const { repos, base } = holding('undergrid-depot');
    const raw = rawMinutesBetween(home, far);
    expect(quoted(repos, base)).toBe(roadMinutes(raw, 0, 22));
  });

  it('Station: the district goes on the line', () => {
    const { repos, base } = stack();
    const station = somewhere('coldwater-halt-platform');
    expect(stationsHeldBy(repos, base).size).toBe(0);
    take(repos, base.id, station);
    expect([...stationsHeldBy(repos, base)]).toEqual([[station.districtId, 1]]);
  });
});

describe('what the ground does to prices', () => {
  it('Downtown Market: off every caps price, through the curve', () => {
    const { after } = holding('chrome-row-exchange');
    expect(discountedCaps(1000, after.marketDiscountPercent)).toBe(
      Math.round(1000 * (1 - effectiveMarketDiscount(10) / 100)),
    );
  });

  /*
   * The old Statue's figure, folded by hand: since 2026-10-13 the one Statue on the map, the
   * Stationmaster's Office, pays officer skills instead, so no held location reaches this channel.
   */
  it('Statue of the Revolutionist: off the black market`s infamy', () => {
    const statue = bonusesAt(
      { bonuses: [{ kind: 'black_market_discount', percent: 15 }] },
      1,
    ).reduce((into, bonus) => applyHoldBonus(into, bonus), noTerritoryEffects());
    expect(discountedInfamy(100, statue.blackMarketDiscountPercent)).toBe(85);
  });

  it('Armory refits and Rail Yard machines: off the bill', () => {
    expect(
      discounted({ caps: 100 }, holding('blacksite-armory').after.refitDiscountPercent),
    ).toEqual({
      caps: 80,
    });
    expect(
      discounted({ caps: 100 }, holding('glasshouse-fields-haulers').after.vehiclePartsPercent),
    ).toEqual({
      caps: 80,
    });
  });
});

describe('what the ground does for the crew', () => {
  it('Gym: one more session on the day`s allowance', () => {
    const { base, after } = holding('blacksite-drill');
    const training = projectTraining(base, undefined, HOUR, after.extraTrainingSessions);
    expect(training.perDay).toBe(TRAININGS_PER_DAY + 1);
  });

  it('Watchtower: points on every spy job', () => {
    const { repos, base } = holding('neon-docks-cranegate');
    expect(spyStrengthFor(repos, base, 'loose_ears', NOW).intelPercent).toBe(38);
  });

  it('Fence Camp: twenty beds for the block and fifty more for the camp', () => {
    const { repos, base } = stack();
    const bare = districtUnitSlots(repos, base, {}).capacity;
    take(repos, base.id, somewhere('neon-docks-barges'));
    expect(districtUnitSlots(repos, base, {}).capacity - bare).toBe(70);
  });

  it('Broadcast Station: two points on every social attribute of every officer', () => {
    const { repos, base } = stack();
    const officer = createCommander('o1', 'Vell', 'engineer', makeAttributes(30));
    const crew: Base = { ...base, commanders: [officer] };
    const bare = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    take(repos, base.id, somewhere('ccs-broadcast'));
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
  it('Broadcast Station at level 5: seven points, paid in full outside the lift cap', () => {
    const { repos, base } = stack();
    const officer = createCommander('o1', 'Vell', 'engineer', makeAttributes(30));
    const crew: Base = { ...base, commanders: [officer] };
    const bare = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    // Five on the card: half of that floored, then one a step, the last level two
    // (`officer_group` in `scaledBonus`).
    take(repos, base.id, somewhere('ccs-broadcast'), MAX_LOCATION_LEVEL);
    const lifted = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    for (const name of ATTRIBUTES_BY_GROUP.social) {
      expect(lifted[name] - bare[name], name).toBe(7);
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

  it('pays what the atlas wrote on the plot', () => {
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
    // Outside the cap, like the group lift: level 5 pays the level's whole figure, twice the
    // card with the double last step (`OFFICER_LEVEL_SCALE`, 5, 6, 7, 8, 10), the cap on lifts
    // being ten.
    take(repos, base.id, at('candlemarket-loft'), MAX_LOCATION_LEVEL);
    const high = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    expect(high.communication - bare.communication).toBe(10);
    expect(high.communication - bare.communication).toBeGreaterThanOrEqual(MAX_OFFICER_LIFT);
  });
});

/** Ironmouth's batch (maintainer, 2026-10-09), each on the plot the atlas wrote it on. */
describe('what Ironmouth`s ground does', () => {
  const at = (id: string): Location => {
    const found = findLocation(id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  const ladder = (id: string, read: (effects: CrewEffects) => number): number[] => {
    const { repos, base } = stack();
    const bare = read(standingEffectsFor(repos, base, NOW));
    return [1, 2, 3, 4, 5].map((level) => {
      take(repos, base.id, at(id), level);
      return read(standingEffectsFor(repos, base, NOW)) - bare;
    });
  };

  it('The Hump: 10 to 20% more seats on every machine', () => {
    expect(ladder('marshalling-yards-hump', (one) => one.vehicleCapacityPercent)).toEqual([
      10, 12, 14, 16, 20,
    ]);
    expect(ladder('marshalling-yards-hump', (one) => one.vehiclePartsPercent)).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  it('The Running Sheds: 5 to 10 armour on every Heavy, and no HQ metal', () => {
    const armour = (one: CrewEffects) =>
      one.unitStatFlats
        .filter((flat) => flat.stat === 'armor' && flat.tier === 'heavy')
        .reduce((sum, flat) => sum + flat.flat, 0);
    expect(ladder('marshalling-yards-sheds', armour)).toEqual([5, 6, 7, 8, 10]);
    expect(ladder('marshalling-yards-sheds', (one) => one.perHour.highQualityMetal ?? 0)).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  it('The Coaling Stage: machines 5 to 10% faster, and 40 to 140 oil an hour', () => {
    expect(ladder('marshalling-yards-coalstage', (one) => one.vehicleSpeedPercent)).toEqual([
      5, 6, 7, 8, 10,
    ]);
    expect(ladder('marshalling-yards-coalstage', (one) => one.perHour.oil ?? 0)).toEqual([
      40, 60, 80, 100, 140,
    ]);
    expect(ladder('marshalling-yards-coalstage', (one) => one.perHour.scrap ?? 0)).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });

  it('Box Nine and the Mess Room: their marks on the crew`s Snipers and Breakers at level 5', () => {
    expect(ladder('marshalling-yards-signalbox', (one) => one.intelYieldPercent)).toEqual([
      0, 0, 0, 0, 0,
    ]);
    expect(ladder('marshalling-yards-messroom', (one) => one.unitMoraleFlat)).toEqual([
      0, 0, 0, 0, 0,
    ]);
    const marks = (id: string, level: number) => {
      const { repos, base } = stack();
      take(repos, base.id, at(id), level);
      return standingEffectsFor(repos, base, NOW).unitMarks;
    };
    expect(marks('marshalling-yards-signalbox', 4)).toEqual({});
    expect(marks('marshalling-yards-signalbox', 5)).toEqual({ snipers: ['safe_distance'] });
    expect(marks('marshalling-yards-messroom', 5)).toEqual({ breakers: ['drunk'] });
  });

  it('Shaft Nine: 30 oil an hour rising to 80, and 10 to 20% off the burn', () => {
    expect(ladder('ironmouth-shaftnine', (one) => one.perHour.oil ?? 0)).toEqual([
      30, 40, 50, 60, 80,
    ]);
    expect(ladder('ironmouth-shaftnine', (one) => one.buildBoostOilPercent)).toEqual([
      10, 12, 14, 16, 20,
    ]);
  });

  it('The Spoil Heap: XP for every yard press, 200 rising to 1000, and no scrap or planks', () => {
    expect(ladder('ironmouth-spoil', (one) => one.scrapyardXp)).toEqual([200, 360, 520, 680, 1000]);
    expect(
      ladder('ironmouth-spoil', (one) => (one.perHour.scrap ?? 0) + (one.perHour.planks ?? 0)),
    ).toEqual([0, 0, 0, 0, 0]);
  });

  it('The Tunnel Chapel: Craft, Resolve and Navigation on every officer, and no steady nerve', () => {
    const { repos, base } = stack();
    const officer = createCommander('o1', 'Vell', 'engineer', makeAttributes(30));
    const crew: Base = { ...base, commanders: [officer] };
    const bare = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
    const moved = (level: number) => {
      take(repos, base.id, at('ironmouth-chapel'), level);
      const lifted = liftedOfficerSheet(officer, officerLiftRoom(repos, crew, NOW)).attributes;
      return Object.fromEntries(
        Object.entries(lifted)
          .map(([name, value]) => [name, value - bare[name as keyof typeof bare]] as const)
          .filter(([, gained]) => gained !== 0),
      );
    };
    expect(moved(1)).toEqual({ craft: 5, resolve: 5, navigation: 5 });
    expect(moved(MAX_LOCATION_LEVEL)).toEqual({ craft: 10, resolve: 10, navigation: 10 });
    expect(standingEffectsFor(repos, base, NOW).steadyNerve).toBe(false);
  });
});

/**
 * Coldwater Halt's rework (maintainer, 2026-10-09): the Station's caps, the Halt Market's Broker,
 * the Standpipe's supplies and the Kitchens' rabble, each on the plot the atlas wrote it on.
 */
describe('what Coldwater Halt`s ground does', () => {
  const at = (id: string): Location => {
    const found = findLocation(id);
    if (!found) throw new Error(`no ${id}`);
    return found;
  };
  const stats = (unitId: string, effects: CrewEffects) =>
    effectiveStats(findUnit(unitId)!, FIELD, { defending: false, outnumbered: 0 }, effects);

  it('Coldwater Platform: caps off the ticket office, 20 rising to 70, and no beds of its own', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    const caps = (level: number): number => {
      take(repos, base.id, at('coldwater-halt-platform'), level);
      const after = standingEffectsFor(repos, base, NOW);
      return (after.perHour.caps ?? 0) - (bare.perHour.caps ?? 0);
    };
    expect([1, 2, 3, 4, 5].map(caps)).toEqual([20, 30, 40, 50, 70]);
    take(repos, base.id, at('coldwater-halt-platform'), 1);
    // Only the beds every held plot gives: the Station's own two went with the rework.
    expect(standingEffectsFor(repos, base, NOW).unitSlotBonus - bare.unitSlotBonus).toBe(
      UNIT_SLOTS_PER_LOCATION,
    );
  });

  it('The Halt Market: the Broker hands back a tenth more, and pays no caps an hour', () => {
    const { repos, base } = stack();
    const trade = { give: 'scrap' as const, want: 'oil' as const, amount: 100, acceptWaste: true };
    const oil = (): number => repos.bases.findById(base.id)!.resources.oil;

    const before = oil();
    expect(barter(repos, repos.bases.findById(base.id)!, trade, 10, NOW).kind).toBe('done');
    const plain = oil() - before;
    take(repos, base.id, at('coldwater-halt-market'));
    const standing = standingEffectsFor(repos, base, NOW);
    expect(standing.brokerRatePercent).toBe(10);
    expect(standing.perHour.caps ?? 0).toBe(0);

    const held = oil();
    expect(barter(repos, repos.bases.findById(base.id)!, trade, 10, NOW).kind).toBe('done');
    const better = oil() - held;
    expect(plain).toBe(barterQuote('scrap', 'oil', 100, brokerRate(base.level)));
    expect(better).toBe(barterQuote('scrap', 'oil', 100, brokerRate(base.level) * 1.1));
    expect(better).toBeGreaterThan(plain);
    // 10, 15, 20, 25, 35 up the levels, the last step double (maintainer, 2026-10-09).
    const ladder = [1, 2, 3, 4, 5].map((level) => {
      take(repos, base.id, at('coldwater-halt-market'), level);
      return standingEffectsFor(repos, base, NOW).brokerRatePercent;
    });
    expect(ladder).toEqual([10, 15, 20, 25, 35]);
  });

  it('The Standpipe: 35 supplies an hour, fifteen more a step', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => bonusesAt(at('coldwater-halt-standpipe'), level)),
    ).toEqual(
      [35, 50, 65, 80, 110].map((perHour, step) => [
        {
          kind: 'resource',
          resource: 'supplies',
          perHour,
          ladder: [35, 50, 65, 80, 110],
          level: step + 1,
        },
      ]),
    );
  });

  it('Tent Row: beds and no caps, 50 rising to 175 on top of the plot`s own', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    const beds = (level: number): number => {
      take(repos, base.id, at('coldwater-halt-tentrow'), level);
      const after = standingEffectsFor(repos, base, NOW);
      expect(after.perHour.caps ?? 0).toBe(bare.perHour.caps ?? 0);
      return (
        after.unitSlotBonus -
        bare.unitSlotBonus -
        UNIT_SLOTS_PER_LOCATION -
        UNIT_SLOTS_PER_LOCATION_LEVEL * levelSteps(level)
      );
    };
    expect([1, 2, 3, 4, 5].map(beds)).toEqual([50, 75, 100, 125, 175]);
  });

  it('The Distant Signal: 40 spy points, twenty more a step', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    const points = (level: number): number => {
      take(repos, base.id, at('coldwater-halt-signal'), level);
      return standingEffectsFor(repos, base, NOW).intelYieldPercent - bare.intelYieldPercent;
    };
    expect([1, 2, 3, 4, 5].map(points)).toEqual([40, 60, 80, 100, 140]);
  });

  it('The Fuelling Point: 25 oil an hour rising to 75, and the scrap cut on vehicles', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    const at5 = (() => {
      take(repos, base.id, at('coldwater-halt-fuelling'), 5);
      return standingEffectsFor(repos, base, NOW);
    })();
    expect((at5.perHour.oil ?? 0) - (bare.perHour.oil ?? 0)).toBe(75);
    expect((at5.perHour.scrap ?? 0) - (bare.perHour.scrap ?? 0)).toBe(0);
    expect(at5.vehicleScrapPercent).toBe(10);
    expect(at5.vehiclePartsPercent).toBe(bare.vehiclePartsPercent);
  });

  it('Trackside Kitchens: vitality on the rabble alone, 10 rising to 20', () => {
    const { repos, base } = stack();
    const bare = standingEffectsFor(repos, base, NOW);
    const gained = (unitId: string, level: number): number => {
      take(repos, base.id, at('coldwater-halt-kitchens'), level);
      const after = standingEffectsFor(repos, base, NOW);
      return stats(unitId, after).vitality - stats(unitId, bare).vitality;
    };
    expect(findUnit('razors')!.tier).toBe('rabble');
    expect([1, 2, 3, 4, 5].map((level) => gained('razors', level))).toEqual([10, 12, 14, 16, 20]);
    // A Heavy beside them eats somewhere else.
    expect(findUnit('ironsides')!.tier).not.toBe('rabble');
    expect(gained('ironsides', 5)).toBe(0);
    // And the kitchen feeds nobody's stores and houses nobody past the beds every plot gives.
    const after = standingEffectsFor(repos, base, NOW);
    expect(after.perHour.supplies ?? 0).toBe(bare.perHour.supplies ?? 0);
    expect(after.unitSlotBonus - bare.unitSlotBonus).toBe(
      UNIT_SLOTS_PER_LOCATION + UNIT_SLOTS_PER_LOCATION_LEVEL * levelSteps(5),
    );
  });
});

describe('the sweep covers the map', () => {
  it('writes nothing above for a bonus kind no location pays', () => {
    const paid = new Set(
      EVERY_LOCATION.flatMap((location) => location.bonuses.map((one) => one.kind)),
    );
    // Every location carries its own list now (2026-10-14), so the map pays more kinds than this
    // sweep covers; the others have their own files. What has to hold is the other direction.
    const swept = new Set<string>([
      'battle_stims',
      // Not `black_market_discount`: no location pays it since the Stationmaster's Office took
      // the one Statue (2026-10-13), and the Statue test above folds it by hand.
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
    ]);
    expect([...swept].filter((kind) => !paid.has(kind as never))).toEqual([]);
  });
});
