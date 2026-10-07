import {
  CAPTURED_GATE_START_LEVEL,
  DEFAULT_BADGE,
  NOISE_SWITCH_COOLDOWN_MS,
  NOISE_SWITCH_TIER,
  PAMPHLET_SWAP_CAPS,
  findDistrict,
  tollingTowerNoise,
  type Base,
  type LocationHolder,
  type ScheduledBattle,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { defenderOf, districtStandingFor } from '../battle/ground.js';
import { battlefieldOf } from '../battle/resolve.js';
import { standingEffectsFor } from '../crew/standing.js';
import { cutFactionTies } from '../factions/ties.js';
import { spyPointsFor } from '../spying/spying.js';
import { putControl } from './actions.js';
import { holdsDistrictWhole } from './gates.js';
import { pinPamphlets, swapPamphlet, throwSwitch } from './ground.js';
import { wholeHolderOf } from './holding.js';
import { projectCity, projectDistrict } from './view.js';

/**
 * Holding a district as a faction, and Reliquary's sheet controls (maintainer, 2026-10-06 and
 * 2026-10-07), through the server's own doors: the gate, the fight's defender, the fold, the
 * views, the tie cut, and the switch and pin writes.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

async function register(app: FastifyInstance, username: string): Promise<Base> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  pinOverseer(app, token);
  const base = app.repos.bases.findById(chosen.json<{ base: { id: string } }>().base.id);
  if (!base) throw new Error('fixture: no base');
  return base;
}

function seat(app: FastifyInstance, members: readonly Base[], factionId = 'wolves'): void {
  app.repos.factions.insert({
    id: factionId,
    name: factionId === 'wolves' ? 'Iron Wolves' : factionId,
    badge: DEFAULT_BADGE,
    blurb: '',
    foundedAt: '2026-01-01T00:00:00.000Z',
  });
  members.forEach((member, index) => {
    app.repos.factions.addMember({
      userId: member.ownerId,
      factionId,
      rank: index === 0 ? 'leader' : 'member',
      joinedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
    });
  });
}

/** Hands every location of a district to the holders in map order, through the one door. */
function hold(
  app: FastifyInstance,
  districtId: string,
  holders: readonly LocationHolder[],
  now: Date,
): void {
  const district = findDistrict(districtId)!;
  district.locations.forEach((location, index) => {
    const control = app.repos.city.control(location.id)!;
    putControl(app.repos, { ...control, holder: holders[index]!, garrison: {} }, now);
  });
}

const crew = (base: Base): LocationHolder => ({ kind: 'crew', baseId: base.id });
const times = (n: number, holder: LocationHolder): LocationHolder[] =>
  Array.from({ length: n }, () => holder);
const T0 = new Date('2026-10-07T12:00:00.000Z');

describe('a district held by a faction', () => {
  it('is whole for every member, arms the gate, and names the member holding the most of it', async () => {
    const app = await world();
    const [a, b, c] = [
      await register(app, 'alpha'),
      await register(app, 'beta'),
      await register(app, 'gamma'),
    ];
    seat(app, [a, b]);
    const printworks = findDistrict('printworks')!;
    hold(app, 'printworks', [...times(4, crew(a)), ...times(3, crew(b))], T0);

    expect(holdsDistrictWhole(app.repos, a.id, 'printworks')).toBe(true);
    expect(holdsDistrictWhole(app.repos, b.id, 'printworks')).toBe(true);
    expect(holdsDistrictWhole(app.repos, c.id, 'printworks')).toBe(false);
    expect(districtStandingFor(app.repos, printworks, T0).shut).toBe(true);
    expect(defenderOf(app.repos, { kind: 'gate', districtId: 'printworks' }, printworks)).toEqual(
      crew(a),
    );
    // The unified bonus (+10% payroll) reaches the member holding the lesser share.
    expect(standingEffectsFor(app.repos, b, T0).payrollPercent).toBe(10);

    // The views say so: green for both members, red for the outsider.
    const mine = projectCity(app.repos, b, T0, 'reliquary').districts.find(
      (summary) => summary.district.id === 'printworks',
    )!;
    expect(mine.wholeBy).toBe('mine');
    expect(mine.holderFaction?.name).toBe('Iron Wolves');
    const theirs = projectCity(app.repos, c, T0, 'reliquary').districts.find(
      (summary) => summary.district.id === 'printworks',
    )!;
    expect(theirs.wholeBy).toBe('enemy');
    const detail = projectDistrict(app.repos, b, printworks, T0);
    expect(detail.locations.map((view) => view.holderSide)).toEqual([
      ...Array<string>(4).fill('ally'),
      ...Array<string>(3).fill('mine'),
    ]);
    expect(detail.holderFaction?.name).toBe('Iron Wolves');
  });

  it("is nobody's when the holders sit at different tables", async () => {
    const app = await world();
    const [a, b] = [await register(app, 'alpha'), await register(app, 'beta')];
    seat(app, [a], 'wolves');
    seat(app, [b], 'crows');
    const printworks = findDistrict('printworks')!;
    hold(app, 'printworks', [...times(4, crew(a)), ...times(3, crew(b))], T0);
    expect(wholeHolderOf(app.repos, printworks)).toBeNull();
    expect(districtStandingFor(app.repos, printworks, T0).shut).toBe(false);
    expect(standingEffectsFor(app.repos, b, T0).payrollPercent).toBe(0);
  });
});

describe('cutting a tie at the table', () => {
  it('drops the gate of a district whole only on the strength of the members together', async () => {
    const app = await world();
    const [a, b] = [await register(app, 'alpha'), await register(app, 'beta')];
    seat(app, [a, b]);
    hold(app, 'printworks', [...times(4, crew(a)), ...times(3, crew(b))], T0);
    // ...and one a holds alone, whose gate is a's and stays.
    hold(app, 'bellfounders', times(7, crew(a)), T0);
    for (const districtId of ['printworks', 'bellfounders']) {
      app.repos.capturedGates.put({
        districtId,
        level: 4,
        upgradingTo: 5,
        upgradingUntil: '2026-10-08T00:00:00.000Z',
        upgradingSince: T0.toISOString(),
      });
    }

    cutFactionTies(app.repos, [b.ownerId], [a.ownerId], T0);

    const fallen = app.repos.capturedGates.find('printworks')!;
    expect(fallen.level).toBe(CAPTURED_GATE_START_LEVEL);
    expect(fallen.upgradingTo).toBeNull();
    expect(app.repos.capturedGates.find('bellfounders')?.level).toBe(4);
  });

  it('keeps the gate of a district one member held outright through a disband', async () => {
    const app = await world();
    const [a, b] = [await register(app, 'alpha'), await register(app, 'beta')];
    seat(app, [a, b]);
    hold(app, 'bellfounders', times(7, crew(a)), T0);
    app.repos.capturedGates.put({
      districtId: 'bellfounders',
      level: 3,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });
    const everyone = [a.ownerId, b.ownerId];
    cutFactionTies(app.repos, everyone, everyone, T0);
    expect(app.repos.capturedGates.find('bellfounders')?.level).toBe(3);
  });
});

describe('the Tolling Tower', () => {
  it('throws once, lays Noisy over the district, and waits twelve hours for the next throw', async () => {
    const app = await world();
    const a = await register(app, 'alpha');
    const bellfounders = findDistrict('bellfounders')!;
    const holders = times(7, { kind: 'looters' });
    holders[bellfounders.locations.findIndex((l) => l.id === 'bellfounders-tollingtower')] =
      crew(a);
    hold(app, 'bellfounders', holders, T0);

    expect(standingEffectsFor(app.repos, a, T0).ignoredLabels).toEqual([]);
    throwSwitch(app.repos, a, 'bellfounders-tollingtower', true, T0);
    expect(standingEffectsFor(app.repos, a, T0).ignoredLabels).toEqual(['noisy']);

    const detail = projectDistrict(app.repos, a, bellfounders, T0);
    for (const view of detail.locations) {
      expect(view.noisyFromTower).toBe(true);
      expect(view.labels.find((label) => label.id === 'noisy')?.tier ?? 0).toBeGreaterThanOrEqual(
        NOISE_SWITCH_TIER,
      );
    }
    const tower = detail.locations.find(
      (view) => view.location.id === 'bellfounders-tollingtower',
    )!;
    expect(tower.switch).toEqual({
      on: true,
      changesAt: new Date(T0.getTime() + NOISE_SWITCH_COOLDOWN_MS).toISOString(),
    });

    const soon = new Date(T0.getTime() + NOISE_SWITCH_COOLDOWN_MS - 60_000);
    expect(() => throwSwitch(app.repos, a, 'bellfounders-tollingtower', false, soon)).toThrow(
      /thrown again in 1 minute/,
    );
    const later = new Date(T0.getTime() + NOISE_SWITCH_COOLDOWN_MS);
    throwSwitch(app.repos, a, 'bellfounders-tollingtower', false, later);
    expect(standingEffectsFor(app.repos, a, later).ignoredLabels).toEqual([]);
  });

  it('refuses anybody but the holder', async () => {
    const app = await world();
    const [a, b] = [await register(app, 'alpha'), await register(app, 'beta')];
    const bellfounders = findDistrict('bellfounders')!;
    const holders = times(7, { kind: 'looters' });
    holders[bellfounders.locations.findIndex((l) => l.id === 'bellfounders-tollingtower')] =
      crew(a);
    hold(app, 'bellfounders', holders, T0);
    expect(() => throwSwitch(app.repos, b, 'bellfounders-tollingtower', true, T0)).toThrow(
      /You do not hold/,
    );
  });
});

describe('the Pamphlet Wall', () => {
  const WALL = 'printworks-pamphletwall';

  function wallHeldBy(app: FastifyInstance, a: Base, level: number): void {
    const printworks = findDistrict('printworks')!;
    const holders = times(7, { kind: 'looters' });
    holders[printworks.locations.findIndex((l) => l.id === WALL)] = crew(a);
    hold(app, 'printworks', holders, T0);
    const control = app.repos.city.control(WALL)!;
    putControl(app.repos, { ...control, level }, T0);
  }

  it('pins once per level, locks the pins, and unlocks them on the next level', async () => {
    const app = await world();
    const a = await register(app, 'alpha');
    wallHeldBy(app, a, 2);
    const printworks = findDistrict('printworks')!;
    const wall = () =>
      projectDistrict(app.repos, a, printworks, T0).locations.find((v) => v.location.id === WALL)!
        .pamphlets!;
    expect(wall()).toMatchObject({ pins: [], capacity: 2, unlocked: true, swapCostCaps: null });

    expect(() => pinPamphlets(app.repos, a, WALL, ['razors', 'ghosts', 'wardens'])).toThrow(
      /takes 2 pins/,
    );
    pinPamphlets(app.repos, a, WALL, ['razors', 'ghosts']);
    expect(wall()).toMatchObject({ pins: ['razors', 'ghosts'], unlocked: false });
    expect(standingEffectsFor(app.repos, a, T0).pamphletUnits).toEqual(['razors', 'ghosts']);
    expect(() => pinPamphlets(app.repos, a, WALL, ['razors'])).toThrow(/set until the wall/);

    // The next level reopens the set once.
    const control = app.repos.city.control(WALL)!;
    putControl(app.repos, { ...control, level: 3 }, T0);
    expect(wall()).toMatchObject({ capacity: 3, unlocked: true });
    pinPamphlets(app.repos, a, WALL, ['razors']);
    expect(wall()).toMatchObject({ pins: ['razors'], unlocked: false });
  });

  it('swaps one pin on a full wall at the top level for caps, once every twelve hours', async () => {
    const app = await world();
    const a = await register(app, 'alpha');
    wallHeldBy(app, a, 5);
    const funded = app.repos.bases.findById(a.id)!;
    app.repos.bases.updateResources(a.id, { ...funded.resources, caps: PAMPHLET_SWAP_CAPS + 1 });
    const stocked = app.repos.bases.findById(a.id)!;

    const four = ['razors', 'ghosts', 'wardens', 'ironsides'];
    pinPamphlets(app.repos, a, WALL, four);
    expect(() =>
      swapPamphlet(app.repos, stocked, WALL, { from: 'razors', to: 'cyber_dogs' }, T0),
    ).toThrow(/every pin set/);
    // Reopen (level change) is not available at the top, so set five through the row directly.
    const control = app.repos.city.control(WALL)!;
    app.repos.city.put({ ...control, pamphlets: [...four, 'the_saint'], pamphletsPinnedAt: 5 });

    const swapped = swapPamphlet(
      app.repos,
      stocked,
      WALL,
      { from: 'razors', to: 'cyber_dogs' },
      T0,
    );
    expect(swapped.base.resources.caps).toBe(1);
    expect(swapped.control.pamphlets).toEqual([
      'cyber_dogs',
      'ghosts',
      'wardens',
      'ironsides',
      'the_saint',
    ]);
    expect(() =>
      swapPamphlet(app.repos, swapped.base, WALL, { from: 'ghosts', to: 'razors' }, T0),
    ).toThrow(/swapped recently/);
    expect(() =>
      swapPamphlet(
        app.repos,
        swapped.base,
        WALL,
        { from: 'ghosts', to: 'razors' },
        new Date(T0.getTime() + 13 * 3_600_000),
      ),
    ).toThrow(/costs/);
  });

  it('comes down with the wall when it changes hands', async () => {
    const app = await world();
    const [a, b] = [await register(app, 'alpha'), await register(app, 'beta')];
    wallHeldBy(app, a, 2);
    pinPamphlets(app.repos, a, WALL, ['razors']);
    const control = app.repos.city.control(WALL)!;
    app.repos.city.put({ ...control, switchedOn: true, trophies: { razors: 3 } });
    putControl(app.repos, { ...app.repos.city.control(WALL)!, holder: crew(b) }, T0);
    const taken = app.repos.city.control(WALL)!;
    expect(taken.pamphlets ?? []).toEqual([]);
    expect(taken.switchedOn ?? false).toBe(false);
    expect(taken.trophies ?? {}).toEqual({});
    expect(taken.trophiesSince).toBe(T0.toISOString());
    expect(standingEffectsFor(app.repos, a, T0).pamphletUnits).toEqual([]);
  });
});

describe('the sheet of a hall and a door', () => {
  it("quotes the Trophy Hall's pay per unit type killed, by level, and a door's ladder", async () => {
    const app = await world();
    const a = await register(app, 'alpha');
    const bloodstone = findDistrict('bloodstone')!;
    const holders = times(7, { kind: 'government' });
    holders[bloodstone.locations.findIndex((l) => l.id === 'bloodstone-trophyhall')] = crew(a);
    holders[bloodstone.locations.findIndex((l) => l.id === 'bloodstone-stage')] = crew(a);
    hold(app, 'bloodstone', holders, T0);
    const hall = app.repos.city.control('bloodstone-trophyhall')!;
    app.repos.city.put({ ...hall, level: 3, trophies: { razors: 4, ghosts: 1, wardens: 0 } });
    const stage = app.repos.city.control('bloodstone-stage')!;
    app.repos.city.put({ ...stage, level: 2 });

    const views = projectDistrict(app.repos, a, bloodstone, T0).locations;
    const trophies = views.find((v) => v.location.id === 'bloodstone-trophyhall')!.trophies!;
    expect(trophies.counted).toEqual({ razors: 4, ghosts: 1, wardens: 0 });
    // Two types killed, at level 3 (scale 2): 10 HQ metal and 100 of each other, times two, times two.
    expect(trophies.perDay).toEqual({
      highQualityMetal: 40,
      caps: 400,
      supplies: 400,
      oil: 400,
      scrap: 400,
      planks: 400,
    });
    const door = views.find((v) => v.location.id === 'bloodstone-stage')!.door!;
    expect(door).toMatchObject({ unitId: 'the_crimson_dancer', level: 2 });
    expect(door.steps).toHaveLength(4);
    // Somebody else's hall shows no count; the door is public.
    const b = await register(app, 'beta');
    const theirs = projectDistrict(app.repos, b, bloodstone, T0).locations;
    expect(theirs.find((v) => v.location.id === 'bloodstone-trophyhall')!.trophies).toBeNull();
    expect(theirs.find((v) => v.location.id === 'bloodstone-stage')!.door?.level).toBe(2);
  });
});

describe("the fight's ground under the tower", () => {
  it("carries the tower's Noisy on every location of the district while it is on", async () => {
    const app = await world();
    const a = await register(app, 'alpha');
    const bellfounders = findDistrict('bellfounders')!;
    const holders = times(7, { kind: 'looters' });
    holders[bellfounders.locations.findIndex((l) => l.id === 'bellfounders-tollingtower')] =
      crew(a);
    hold(app, 'bellfounders', holders, T0);
    const battle = {
      // The tower's own ground, which is not Noisy on its own.
      target: { kind: 'location', locationId: 'bellfounders-tollingtower' },
      scheduledFor: T0.toISOString(),
    } as ScheduledBattle;
    const noisyTier = () =>
      battlefieldOf(
        battle,
        'Bellfounders',
        tollingTowerNoise(bellfounders, app.repos.city.controls()),
      ).labels.find((label) => label.id === 'noisy')?.tier ?? 0;
    // The sky can be noisy too; the ground alone is not.
    const before = noisyTier();
    throwSwitch(app.repos, a, 'bellfounders-tollingtower', true, T0);
    expect(noisyTier()).toBe(Math.max(before, NOISE_SWITCH_TIER));
    expect(
      battlefieldOf(battle, 'Bellfounders').labels.find((label) => label.id === 'noisy')?.tier ?? 0,
    ).toBe(before);
  });
});

describe('spy points', () => {
  it("are the crew's own two totals, on the standing and on its own district", async () => {
    const app = await world();
    const a = await register(app, 'alpha');
    const points = spyPointsFor(app.repos, a, T0);
    expect(points.offence).toBeGreaterThanOrEqual(0);
    expect(points.defence).toBeGreaterThanOrEqual(0);
    const home = findDistrict(a.districtId)!;
    expect(projectDistrict(app.repos, a, home, T0).spyPoints).toEqual(points);
    const away = findDistrict('printworks')!;
    expect(projectDistrict(app.repos, a, away, T0).spyPoints).toBeUndefined();
  });
});
