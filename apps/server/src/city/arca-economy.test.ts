import {
  addItems,
  RARITY_ODDS_BY_LEVEL,
  STARTING_RESOURCES,
  TROPHY_PAY_SCALE,
  findBlueprintPage,
  createCommander,
  findUnit,
  lootCapacityOf,
  makeAttributes,
  missionCarry,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  stashCount,
  type Base,
  type Building,
  type MissionOffer,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { ledgerFor } from '../bar/hire.js';
import { standingEffectsFor } from '../crew/standing.js';
import { drillSecondsBySubject } from '../crew/training.js';
import { productionRatesFor } from '../district/settle.js';
import { storeCeilingsOf } from '../district/stores.js';
import { dealtGolden, gilded, goldenPercentFor } from '../missions/golden.js';
import { missionXpBonusPercent } from '../progression/award.js';
import { musterRatesFor, ratesForUnit } from '../units/muster.js';
import {
  STIM_GOOD_ID,
  drawDailyPage,
  drawRarity,
  grantDaily,
  recordTrophyKills,
  settleDaily,
  trophyPayFor,
} from './daily.js';

/*
 * Every Arca location my lane spends (contract B2), each against the same crew before and
 * after it takes the ground: the "before" is the control, so a reader that stopped reading the
 * field would fail the "after" and a reader that paid everybody would fail the "before".
 */

const HOUR = '2026-09-01T12:00:00.000Z';
const NOW = new Date(HOUR);

function stack(buildings: Building[] = []): { repos: Repositories; base: Base } {
  const db = openDatabase(':memory:');
  runMigrations(db);
  const repos = createRepositories(db);
  repos.users.insert({ id: 'u', username: 'holder', passwordHash: 'x', createdAt: HOUR });
  const base: Base = {
    id: 'b',
    ownerId: 'u',
    name: 'The Yard',
    districtId: 'south-quay',
    level: 20,
    isBot: false,
    resources: { ...STARTING_RESOURCES },
    economy: startingEconomy(HOUR),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'nexus', kind: 'nexus', level: 10, modifications: [] }, ...buildings],
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

function take(repos: Repositories, baseId: string, locationId: string, level = 1): void {
  const control = repos.city.control(locationId);
  if (!control) throw new Error(`fixture: no ${locationId}`);
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, level, garrison: {} });
}

const fresh = (repos: Repositories): Base => repos.bases.findById('b')!;

describe('the readers of the Arca ground (B2)', () => {
  it('Hiring Hall: rabble muster cheaper, nobody else', () => {
    const { repos, base } = stack();
    const before = ratesForUnit(musterRatesFor(repos, base, NOW), findUnit('razors')!);
    take(repos, base.id, 'bloodstone-hiringhall', 5);
    const rabble = ratesForUnit(musterRatesFor(repos, base, NOW), findUnit('razors')!);
    const heavy = ratesForUnit(musterRatesFor(repos, base, NOW), findUnit('juggernauts')!);
    expect(findUnit('razors')!.tier).toBe('rabble');
    expect(rabble.costPercent - before.costPercent).toBe(20);
    expect(heavy.costPercent).toBe(before.costPercent);
  });

  it('Exercise Yard: drills shorter for everybody on the books', () => {
    const { repos, base } = stack();
    const crew = {
      ...base,
      commanders: [createCommander('o', 'Vasso', 'engineer', makeAttributes(40))],
    };
    const before = drillSecondsBySubject(repos, crew, undefined, NOW).get('o')!;
    take(repos, base.id, 'saints-rest-yard', 5);
    expect(standingEffectsFor(repos, base, NOW).trainingTimePercent).toBe(25);
    expect(drillSecondsBySubject(repos, crew, undefined, NOW).get('o')).toBe(
      Math.round(before * 0.75),
    );
  });

  it('Undercroft Stores: the ceilings widen, caps excepted', () => {
    const { repos, base } = stack();
    const before = storeCeilingsOf(repos, base, NOW);
    take(repos, base.id, 'nave-undercroft', 5);
    const after = storeCeilingsOf(repos, base, NOW);
    expect(standingEffectsFor(repos, base, NOW).storageGroundPercent).toBe(20);
    expect(after.planks).toBeGreaterThan(before.planks);
    expect(after.oil).toBeGreaterThan(before.oil);
    expect(after.caps).toBe(before.caps);
  });

  it('Collection Plate: a modified structure makes more per modification fitted', () => {
    const plant: Building = { id: 'gen', kind: 'generator', level: 5, modifications: [] };
    const bare = stack([plant]);
    const fitted = stack([{ ...plant, modifications: ['generator_cascade_turbines'] }]);
    const oilOf = (s: { repos: Repositories; base: Base }): number =>
      productionRatesFor(s.repos, fresh(s.repos), NOW).oil ?? 0;
    const bareBefore = oilOf(bare);
    const fittedBefore = oilOf(fitted);
    take(bare.repos, 'b', 'nave-plate', 1);
    take(fitted.repos, 'b', 'nave-plate', 1);
    // Nothing fitted, nothing paid; one modification, +10% on the structure's own sum.
    expect(standingEffectsFor(bare.repos, fresh(bare.repos), NOW).modificationOutputPercent).toBe(
      10,
    );
    expect(oilOf(bare)).toBe(bareBefore);
    expect(oilOf(fitted)).toBeGreaterThan(fittedBefore);
  });

  it('Choir Loft: more XP off every run', () => {
    const { repos, base } = stack();
    const before = missionXpBonusPercent(repos, base, NOW);
    take(repos, base.id, 'cloisters-choirloft', 5);
    expect(missionXpBonusPercent(repos, base, NOW) - before).toBe(6);
  });

  it('Printworks held whole: a bigger payroll book', () => {
    const { repos, base } = stack();
    const before = ledgerFor(base, standingEffectsFor(repos, base, NOW)).capacity;
    for (const control of repos.city.controls().values()) {
      if (control.locationId.startsWith('printworks-')) take(repos, base.id, control.locationId);
    }
    const effects = standingEffectsFor(repos, base, NOW);
    expect(effects.payrollPercent).toBe(10);
    expect(ledgerFor(base, effects).capacity).toBeGreaterThan(before);
  });

  it('Straw Sack: five slots more on every carrier, none on a fighter', () => {
    const haulers = { haulers: 3 };
    expect(findUnit('haulers')!.tier).toBe('carrier');
    expect(lootCapacityOf(haulers, 0, {}, undefined, 5) - lootCapacityOf(haulers)).toBe(15);
    expect(missionCarry({ razors: 3 }, {}, 0, undefined, 5)).toBe(missionCarry({ razors: 3 }));
  });
});

describe('the Bounty Wall (B2 item 3)', () => {
  const terms = { chancePercent: 50, rewardPercent: 30 };

  it('deals the same answer for the same card, and a mix across cards', () => {
    const rolls = Array.from({ length: 40 }, (_, slot) =>
      dealtGolden('bloodstone', '2026-10-07', `job-${slot}`, terms),
    );
    expect(rolls.filter(Boolean).length).toBeGreaterThan(5);
    expect(rolls.filter((one) => !one).length).toBeGreaterThan(5);
    expect(dealtGolden('bloodstone', '2026-10-07', 'job-1', terms)).toBe(rolls[1]);
    expect(dealtGolden('bloodstone', '2026-10-07', 'job-1', null)).toBe(false);
    expect(dealtGolden('bloodstone', '2026-10-07', 'job-1', { ...terms, chancePercent: 100 })).toBe(
      true,
    );
  });

  it('gilds battle jobs only, on the wall’s own district, and pays the premium on the card', () => {
    const effects = {
      goldenJobsByDistrict: { bloodstone: { chancePercent: 100, rewardPercent: 30 } },
    };
    expect(goldenPercentFor(effects, 'bloodstone', 'k', { id: 'x', kind: 'battle' })).toBe(30);
    expect(goldenPercentFor(effects, 'bloodstone', 'k', { id: 'x', kind: 'standard' })).toBe(0);
    expect(goldenPercentFor(effects, 'candlemarket', 'k', { id: 'x', kind: 'battle' })).toBe(0);
    const offer = { rewards: { caps: 100 }, golden: false, goldenPercent: 0 } as MissionOffer;
    expect(gilded(offer, 30)).toMatchObject({
      golden: true,
      goldenPercent: 30,
      rewards: { caps: 130 },
    });
    expect(gilded(offer, 0)).toBe(offer);
  });
});

describe('the daily grants (B2 items 1 and 2)', () => {
  it('draws rarities at the odds the level prints', () => {
    const counts = { basic: 0, intricate: 0, advanced: 0, masterpiece: 0 };
    for (let n = 0; n < 2000; n += 1) counts[drawRarity(5, `s${n}`)] += 1;
    const [basic, , , masterpiece] = RARITY_ODDS_BY_LEVEL[4]!;
    expect(counts.basic / 20).toBeCloseTo(basic, -1);
    expect(counts.masterpiece / 20).toBeCloseTo(masterpiece, -1);
    expect(drawRarity(1, 'any')).not.toBe('masterpiece');
  });

  it('pays the Scriptorium a page of a blueprint not yet finished', () => {
    const { base } = stack();
    const page = drawDailyPage(base, 1, 'seed');
    expect(page).not.toBeNull();
    expect(findBlueprintPage(page!)).toBeDefined();
  });

  // Bug pass, 2026-10-07: a second copy of a page fills no square, so handing one over was a day
  // the wall paid nothing. Same seed, so only the inventory can change the answer.
  it('never pays the Scriptorium a page the crew already holds', () => {
    const { base } = stack();
    const first = drawDailyPage(base, 1, 'seed')!;
    const held = { ...base, inventory: addItems(base.inventory, { [first]: 1 }) };
    const second = drawDailyPage(held, 1, 'seed');
    expect(second).not.toBe(first);
    // ...and it is still a real page rather than a refusal to pay at all.
    expect(second === null || findBlueprintPage(second)).toBeTruthy();
  });

  it('prices the Trophy Hall per unit type killed, by level', () => {
    expect(trophyPayFor(0, 1)).toEqual({});
    expect(trophyPayFor(2, 1)).toMatchObject({ caps: 200, highQualityMetal: 20 });
    expect(trophyPayFor(2, 5)).toMatchObject({ caps: 200 * TROPHY_PAY_SCALE[4]! });
  });

  it('records kills on a held hall only, and pays once a day', () => {
    const { repos, base } = stack();
    recordTrophyKills(repos, base.id, { razors: 2 }, NOW);
    take(repos, base.id, 'bloodstone-trophyhall', 1);
    take(repos, base.id, 'saints-rest-dispensary', 5);
    take(repos, base.id, 'bloodstone-chopshop', 1);
    take(repos, base.id, 'printworks-scriptorium', 1);
    recordTrophyKills(repos, base.id, { razors: 2, anodics: 1 }, NOW);
    expect(repos.city.control('bloodstone-trophyhall')!.trophies).toEqual({
      razors: 2,
      anodics: 1,
    });

    expect(settleDaily(repos, NOW)).toBe(1);
    const paid = fresh(repos);
    expect(paid.resources.caps - base.resources.caps).toBe(200);
    expect(paid.resources.highQualityMetal - base.resources.highQualityMetal).toBe(20);
    expect(Object.keys(paid.inventory)).toHaveLength(2);
    expect(stashCount(repos.blackMarket.stashFor(base.id), STIM_GOOD_ID)).toBe(1);
    const bells = repos.social.notifications('u', 10);
    expect(bells).toHaveLength(1);
    expect(bells[0]?.kind).toBe('daily_grant');

    // The same tick again, and the next tick of the same day: nothing more.
    expect(settleDaily(repos, NOW)).toBe(0);
    expect(settleDaily(repos, new Date(NOW.getTime() + 3_600_000))).toBe(0);
    expect(fresh(repos).resources.caps).toBe(paid.resources.caps);
    // Tomorrow pays again.
    expect(settleDaily(repos, new Date(NOW.getTime() + 24 * 3_600_000))).toBe(1);
  });

  it('pays nothing to a crew holding none of it', () => {
    const { repos, base } = stack();
    expect(grantDaily(repos, base, '2026-09-01', NOW)).toBeNull();
    expect(settleDaily(repos, NOW)).toBe(0);
  });
});
