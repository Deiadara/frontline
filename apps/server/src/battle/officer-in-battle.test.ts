import {
  chairPassiveOf,
  overseerLift,
  seatPoints,
  OFFICER_INJURY_HOURS,
  CITY_DISTRICTS,
  DECLARE_INFAMY_COST,
  DEFAULT_BADGE,
  CAPTURED_GATE_MAX_LEVEL,
  CAPTURED_GATE_START_LEVEL,
  capturedGateDefensePercent,
  CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL,
  CASUALTY_RECOVERY_CEILING,
  casualtyRecoveryShare,
  createCommander,
  declarationWindow,
  effectiveSpeed,
  findDistrict,
  findUnit,
  findVehicle,
  hastenedRoadMinutes,
  mapDistance,
  NOTORIETY_TO_FIELD,
  officerBattleStats,
  officerIsInjured,
  recoverCasualties,
  skirmishOutcome,
  startingHolder,
  travelMinutesBetween,
  TRAVEL_MINUTES_PER_MAP_UNIT,
  UNIT_MODIFICATIONS,
  upgradedStats,
  type ApiError,
  type BattlesResponse,
  type DeployQuoteResponse,
  type BattleTarget,
  type SideAnalysis,
  type SkirmishEngine,
  type SkirmishInput,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { armTheAttack } from '../testing/attack.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import {
  crewEffectsFor,
  crewSheetsFor,
  liftedOfficerSheet,
  officerLiftRoom,
  standingEffectsFor,
} from '../crew/standing.js';
import { officerTravelMinutesTo, settleMovements } from './movement.js';
import { settleBattles } from './resolve.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { everybodyHome } from '../testing/walk.js';

/**
 * Officers on the field, end to end (§D, §B10, §C3).
 *
 * The shared suite has the arithmetic (`battle/officer.test.ts` in `@frontline/shared`). This is
 * about the seams the arithmetic reaches through: whether the officer the player named actually
 * arrives at the engine, whether an injury is written back to the roster and turns their bonuses
 * off, whether the report is withheld, and whether the machines come home.
 */

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

const RUSTYARD_LOCATIONS: readonly string[] = (findDistrict('steelbelt')?.locations ?? []).map(
  (location) => location.id,
);

const SQUATTED: string = (() => {
  const district = findDistrict('steelbelt');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Rustyard has nobody on it at all');
  return held.id;
})();

const PRESS: BattleTarget = { kind: 'location', districtId: 'steelbelt', locationId: SQUATTED };

async function makeStack(engine?: SkirmishEngine, username = 'leader'): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = engine
    ? await buildApp({ config, db, skirmishEngine: engine, logger: false })
    : await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  // Casualties and survivors are counted to the body here, and a §F6 signature gives some of the
  // dead back or hardens the living, so the crew gets a character rather than a draw.
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  // §D7: calling a fight costs infamy and nobody starts with any. Fixture money, enough for every
  // call this file makes.
  const purse = app.repos.bases.findById(baseId)!.economy;
  app.repos.bases.updateEconomy(baseId, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });

  for (const locationId of RUSTYARD_LOCATIONS) app.repos.city.control(locationId);
  const ramp = app.repos.city.control('steelbelt-ramp')!;
  app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });

  return { app, db, token, baseId };
}

/** One officer on the books, with a sheet worth fighting with. */
function hire(stack: Stack, id = 'off-1', injuredUntil: string | null = null) {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  const officer = {
    ...createCommander(id, 'Vasco Renn', 'field_commander', {
      strength: 70,
      toughness: 60,
      dexterity: 50,
      resolve: 60,
      reflexes: 55,
    }),
    injuredUntil,
  };
  stack.app.repos.bases.updateCommanders(base.id, [...base.commanders, officer]);
  return officer;
}

async function declare(stack: Stack, target: BattleTarget = PRESS): Promise<string> {
  const res = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(res.statusCode).toBe(200);
  const coming = res.json<{ battles: BattlesResponse }>().battles.coming;
  return coming[coming.length - 1]!.battle.id;
}

const lead = (stack: Stack, battleId: string, officerId: string | null): Promise<InjectResponse> =>
  stack.app.inject({
    method: 'POST',
    url: '/api/battles/lead',
    headers: auth(stack.token),
    payload: { battleId, officerId },
  });

const takeVehicles = (
  stack: Stack,
  battleId: string,
  vehicles: Record<string, number>,
): Promise<InjectResponse> =>
  stack.app.inject({
    method: 'POST',
    url: '/api/battles/vehicles',
    headers: auth(stack.token),
    payload: { battleId, vehicles },
  });

async function deploy(stack: Stack, battleId: string, changes: Record<string, number>) {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateArmy(base.id, { ...base.army, razors: 30 }, base.musterQueue);
  const res = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId, changes, perimeterChanges: {} },
  });
  expect(res.statusCode).toBe(200);
}

/** Winds both clocks back so the settler picks the fight up with the column already landed. */
function bringForward(stack: Stack, battleId: string, at: Date): void {
  stack.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(at.getTime() - 60_000).toISOString(), at.toISOString(), battleId);
  settleMovements(stack.app.repos, new Date());
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(at.toISOString(), battleId);
}

/** An engine that records what it was handed and hands back a decided outcome. */
function spy(
  winner: 'attacker' | 'defender',
  extra: Parameters<typeof skirmishOutcome>[0] = {},
): SkirmishEngine & { seen: SkirmishInput[] } {
  const seen: SkirmishInput[] = [];
  return {
    seen,
    resolve: (input) => {
      seen.push(input);
      return skirmishOutcome({ winner, log: ['decided'], ...extra });
    },
  };
}

describe('naming a leader (§D1)', () => {
  it('puts the officer the player named in front of the engine', async () => {
    const engine = spy('attacker');
    const stack = await makeStack(engine);
    const officer = hire(stack);
    const battleId = await declare(stack);

    expect((await lead(stack, battleId, officer.id)).statusCode).toBe(200);
    await deploy(stack, battleId, { razors: 10 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    expect(engine.seen).toHaveLength(1);
    expect(engine.seen[0]!.attackerOfficer?.officerId).toBe(officer.id);
    // The sheet reaches the engine, not a summary of it: the mapping happens in one place.
    expect(engine.seen[0]!.attackerOfficer?.attributes.strength).toBe(70);
  });

  it('sends nobody when nobody was named', async () => {
    const engine = spy('attacker');
    const stack = await makeStack(engine);
    hire(stack);
    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 10 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    expect(engine.seen[0]!.attackerOfficer).toBeUndefined();
  });

  /**
   * Bug pass, 2026-09-28: a benched officer is inert, and a fight named before that rule (the
   * seat route refuses to bench somebody named now) must not be led by one at the mark.
   */
  it('sends nobody when the officer named has since been benched', async () => {
    const engine = spy('attacker');
    const stack = await makeStack(engine);
    const officer = hire(stack);
    const battleId = await declare(stack);
    expect((await lead(stack, battleId, officer.id)).statusCode).toBe(200);
    await deploy(stack, battleId, { razors: 10 });
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateCommanders(
      base.id,
      base.commanders.map((one) => (one.id === officer.id ? { ...one, role: null } : one)),
    );
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    expect(engine.seen[0]!.attackerOfficer).toBeUndefined();
  });

  it('refuses an officer who is still laid up (§D4)', async () => {
    const stack = await makeStack();
    const hurt = hire(stack, 'off-hurt', new Date(Date.now() + 3_600_000).toISOString());
    const battleId = await declare(stack);
    const res = await lead(stack, battleId, hurt.id);
    expect(res.statusCode).toBe(403);
  });

  // The road the picker prints counts (maintainer, 2026-10-02): an officer who cannot reach the
  // fight before it starts cannot be named for it, and one who can, can.
  it('refuses an officer who cannot get there before the fight starts', async () => {
    const stack = await makeStack();
    const officer = hire(stack, 'off-far');
    const battleId = await declare(stack);
    // The attack's least commitment, or the lock calls it off (2026-10-05).
    armTheAttack(stack.app.repos, battleId, stack.baseId);
    const markIn = (minutes: number) =>
      stack.db
        .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
        .run(new Date(Date.now() + minutes * 60_000).toISOString(), battleId);

    markIn(1);
    const late = await lead(stack, battleId, officer.id);
    expect(late.statusCode, late.body.slice(0, 200)).toBe(403);
    expect(late.json<{ error: { message: string } }>().error.message).toMatch(/minutes away/);

    markIn(24 * 60);
    expect((await lead(stack, battleId, officer.id)).statusCode).toBe(200);
  });

  it('refuses somebody who does not work here', async () => {
    const stack = await makeStack();
    const battleId = await declare(stack);
    expect((await lead(stack, battleId, 'nobody')).statusCode).toBe(404);
  });

  it('offers only fit officers on the board, with the sheet they would fight at', async () => {
    const stack = await makeStack();
    const fit = hire(stack, 'off-fit');
    hire(stack, 'off-hurt', new Date(Date.now() + 3_600_000).toISOString());
    await declare(stack);

    const res = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const view = res.json<BattlesResponse>().coming[0]!;
    expect(view.leaders.map((leader) => leader.officerId)).toEqual([fit.id]);
    expect(view.leaders[0]!.stats).toEqual(officerBattleStats(fit.attributes));
  });

  /**
   * The lifted sheet, not the card (maintainer, 2026-09-29). A peer with Grip Coach puts +5
   * Strength on every other officer; the crew screen has drawn it since the perk existed, and the
   * leader row and the engine now read it too.
   */
  it('fights on the sheet the crew screen draws, lifts and all', async () => {
    const engine = spy('attacker');
    const stack = await makeStack(engine);
    const officer = hire(stack);
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateCommanders(base.id, [
      ...base.commanders,
      createCommander('off-grip', 'Coach', 'trader', {}, ['grip_coach']),
    ]);
    const battleId = await declare(stack);

    const view = (
      await stack.app.inject({ method: 'GET', url: '/api/battles', headers: auth(stack.token) })
    ).json<BattlesResponse>().coming[0]!;
    const row = view.leaders.find((leader) => leader.officerId === officer.id)!;
    // The Grip Coach's +5 strength, and the Overseer's grade on the officer's tagged skills
    // (`overseerLift`, maintainer 2026-10-04).
    const owner = stack.app.repos.users.findById(base.ownerId)!;
    const overseer = stack.app.repos.overseers.findById(owner.overseerId!)!;
    const grade =
      officer.role === null
        ? {}
        : overseerLift(seatPoints(overseer.attributes, 'overseer'), officer.role, officer.id);
    const taught = { ...officer.attributes, strength: officer.attributes.strength + 5 };
    for (const [name, points] of Object.entries(grade)) {
      taught[name as keyof typeof taught] += points ?? 0;
    }
    expect(row.stats).toEqual(officerBattleStats(taught));
    expect(row.stats).not.toEqual(officerBattleStats(officer.attributes));

    expect((await lead(stack, battleId, officer.id)).statusCode).toBe(200);
    await deploy(stack, battleId, { razors: 10 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    expect(engine.seen[0]!.attackerOfficer?.attributes).toEqual(taught);
  });
});

/**
 * §D1: a leader has to cross the city to get to the fight (maintainer request, 2026-09-15).
 *
 * Clocked through the same two functions a column is, so one map and one set of road bonuses serve
 * both: `columnSpeed` decides whether this officer is walking or riding, and `travelMinutesBetween`
 * turns that into minutes. The pace is the person's own `speed`, which is what a spy job's walk
 * is priced with too.
 *
 * What the fight then does about an officer who has not arrived by the mark is not decided here.
 * Nothing in `resolve.ts` reads this figure.
 */
/** The one perk in the book whose whole promise is time off the road while leading. */
const SHORT_WAY = 'short_way';

describe('the road an officer has to take (§D1)', () => {
  const leaders = async (stack: Stack) => {
    const res = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    return res.json<BattlesResponse>().coming[0]!.leaders;
  };

  it('prices the walk off the officer’s own speed and the real map', async () => {
    const stack = await makeStack();
    const officer = hire(stack);
    await declare(stack);

    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const home = findDistrict(base.districtId)!;
    const target = findDistrict('steelbelt')!;
    const effects = standingEffectsFor(stack.app.repos, base);
    const road = (speed: number) =>
      travelMinutesBetween(home, target, {
        speed,
        reductionPercent: effects.travelSpeedPercent,
      });
    const onFoot = officerBattleStats(officer.attributes).speed;

    const [listed] = await leaders(stack);
    expect(listed!.officerId).toBe(officer.id);
    expect(listed!.travelMinutes).toBe(Math.round(road(onFoot)));

    // ...and the officer's own speed is load-bearing rather than incidental: the same road walked
    // by somebody with no speed at all is longer.
    expect(onFoot).toBeGreaterThan(0);
    expect(road(onFoot)).toBeLessThan(road(0));

    // So is the destination. The nearest district on the map is a shorter walk than the farthest,
    // which is the half a figure hardcoded to one district would pass anyway.
    const byDistance = CITY_DISTRICTS.filter((district) => district.id !== base.districtId).sort(
      (a, b) => mapDistance(home.position, a.position) - mapDistance(home.position, b.position),
    );
    // The road answers `null` for ground it cannot price, and every district in this sweep is on
    // the map, so a `null` here is the test's own fixture having gone wrong.
    const room = officerLiftRoom(stack.app.repos, base, new Date());
    const minutesTo = (districtId: string) => {
      const minutes = officerTravelMinutesTo(stack.app.repos, base, districtId, officer, {}, room);
      expect(minutes, districtId).not.toBeNull();
      return minutes!;
    };
    expect(minutesTo(byDistance[0]!.id)).toBeLessThan(
      minutesTo(byDistance[byDistance.length - 1]!.id),
    );
  });

  /**
   * The lifted sheet sets the pace (maintainer, 2026-09-30), as it sets the figures they fight on.
   * A peer teaching the physical group puts five on Speed and Stamina; the leader row walked the
   * printed card, so the lesson showed on the crew screen and the road ignored it.
   */
  it('walks on the lifted sheet, lessons and all', async () => {
    const stack = await makeStack();
    const officer = hire(stack);
    const printed = stack.app.repos.bases.findById(stack.baseId)!;
    // The farthest district, so five points of pace is whole minutes on the road.
    const home = findDistrict(printed.districtId)!;
    const far = CITY_DISTRICTS.filter((district) => district.id !== home.id).sort(
      (a, b) => mapDistance(home.position, b.position) - mapDistance(home.position, a.position),
    )[0]!;
    const walk = (base: typeof printed) =>
      officerTravelMinutesTo(
        stack.app.repos,
        base,
        far.id,
        officer,
        {},
        officerLiftRoom(stack.app.repos, base, new Date()),
      );
    const untaught = walk(printed);

    stack.app.repos.bases.updateCommanders(printed.id, [
      ...printed.commanders,
      createCommander('off-teach', 'Old Hand', 'trader', {}, ['old_instructor']),
    ]);
    const taught = stack.app.repos.bases.findById(stack.baseId)!;
    const room = officerLiftRoom(stack.app.repos, taught, new Date());
    expect(officerBattleStats(liftedOfficerSheet(officer, room).attributes).speed).toBeGreaterThan(
      officerBattleStats(officer.attributes).speed,
    );
    expect(walk(taught)).toBeLessThan(untaught!);

    // ...and the leader row on the board quotes that same walk.
    await declare(stack);
    const listed = (await leaders(stack)).find((row) => row.officerId === officer.id)!;
    expect(listed.travelMinutes).toBe(
      officerTravelMinutesTo(stack.app.repos, taught, PRESS.districtId, officer, {}, room),
    );
  });

  /**
   * §D5: `lead_arrival` shortens the column's road, which is half of what it promises.
   *
   * `leading()` folds the channel into `travelSpeedPercent`, and the only caller of `leading()` was
   * the settler, where neither travel channel is read. So the perk paid on a mission and did
   * nothing at all on a declared fight, under copy that says "off the road while leading" and a
   * channel doc that says "both to a battle and on a mission".
   *
   * Measured on the column rather than on the officer's own walk: the officer is clocked
   * separately (`officerTravelMinutesTo`) and the units are the thing a raid is waiting for.
   */
  it('shortens the column road when an officer is named to lead it', async () => {
    // One world per reading: a crew may only have one declaration standing on a target, and the
    // two roads have to be the same road.
    const road = async (named: boolean): Promise<number> => {
      const stack = await makeStack(undefined, named ? 'led' : 'alone');
      const officer = { ...hire(stack), perks: [SHORT_WAY] };
      const base = stack.app.repos.bases.findById(stack.baseId)!;
      stack.app.repos.bases.updateCommanders(base.id, [officer]);

      const battleId = await declare(stack);
      if (named) {
        const took = await lead(stack, battleId, officer.id);
        expect(took.statusCode, took.body.slice(0, 200)).toBe(200);
      }
      await deploy(stack, battleId, { razors: 4 });
      const movement = stack.app.repos.movements
        .forBattle(battleId)
        .find((one) => one.baseId === stack.baseId);
      if (!movement) throw new Error('fixture: the column never left');
      return Date.parse(movement.arrivesAt) - Date.parse(movement.departedAt);
    };

    const alone = await road(false);
    const led = await road(true);
    expect(alone, 'the fixture road is instant, so nothing can be taken off it').toBeGreaterThan(0);
    expect(led, 'naming a leader took nothing off the road they promised to shorten').toBeLessThan(
      alone,
    );
  });

  /** Bug pass, 2026-10-05: a column sent before the leader was named takes the leader's pace too. */
  it('retimes a column already on the road when a leader is named', async () => {
    const stack = await makeStack(undefined, 'late_lead');
    const officer = { ...hire(stack), perks: [SHORT_WAY] };
    stack.app.repos.bases.updateCommanders(stack.baseId, [officer]);
    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 4 });
    const arrives = () =>
      Date.parse(
        stack.app.repos.movements.forBattle(battleId).find((one) => one.baseId === stack.baseId)!
          .arrivesAt,
      );
    const before = arrives();
    const took = await lead(stack, battleId, officer.id);
    expect(took.statusCode, took.body.slice(0, 200)).toBe(200);
    expect(arrives(), 'the column kept the pace it left with').toBeLessThan(before);
  });

  /**
   * §C3: the figure the deploy window quotes is the road the column then walks.
   *
   * The window cannot work the road out itself, so it asks (`POST /battles/deploy/quote`): the
   * march is spent with `standingEffectsFor`, which folds the crew's ground, and the client only
   * ever receives the people-only fold. The quote read the *unled* fold while the send read the led
   * one, so a crew that had named an officer was told a march up to a tenth longer than the one it
   * got, and `columnMinutesTo`'s own doc claimed the two could not disagree.
   *
   * Both worlds are asserted equal, and the led one is asserted shorter than the other, because
   * equality alone is what a quote that ignores the leader also passes: it agrees with a send that
   * ignores the leader too, and the perk being worth nothing is the bug next door.
   */
  it('quotes the road the column actually walks, leader and all', async () => {
    const quoted = async (named: boolean): Promise<{ said: number; walked: number }> => {
      const stack = await makeStack(undefined, named ? 'quoted_led' : 'quoted_alone');
      const officer = { ...hire(stack), perks: [SHORT_WAY] };
      const base = stack.app.repos.bases.findById(stack.baseId)!;
      stack.app.repos.bases.updateCommanders(base.id, [officer]);

      const battleId = await declare(stack);
      if (named) {
        const took = await lead(stack, battleId, officer.id);
        expect(took.statusCode, took.body.slice(0, 200)).toBe(200);
      }

      const said = await stack.app.inject({
        method: 'POST',
        url: '/api/battles/deploy/quote',
        headers: auth(stack.token),
        payload: { battleId, changes: { razors: 4 }, perimeterChanges: {} },
      });
      expect(said.statusCode, said.body.slice(0, 200)).toBe(200);
      const minutes = said.json<DeployQuoteResponse>().minutes;

      await deploy(stack, battleId, { razors: 4 });
      const movement = stack.app.repos.movements
        .forBattle(battleId)
        .find((one) => one.baseId === stack.baseId);
      if (!movement) throw new Error('fixture: the column never left');
      const road = Date.parse(movement.arrivesAt) - Date.parse(movement.departedAt);
      return { said: minutes, walked: Math.round(road / 60_000) };
    };

    const alone = await quoted(false);
    const led = await quoted(true);
    expect(alone.said, 'the window quoted a march nobody walks').toBe(alone.walked);
    expect(led.said, 'the window quoted a march nobody walks').toBe(led.walked);
    expect(
      led.said,
      'naming a leader moved neither figure, so the pair agree about nothing',
    ).toBeLessThan(alone.said);
  });

  /**
   * A quick officer gets there sooner than a slow one, on the same road.
   *
   * The fixture officer's `speed` comes off their sheet, so this is the assertion that the pace is
   * the person rather than a flat crew figure.
   */
  it('gets a quicker officer there sooner', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    // `officerBattleStats` reads speed off Speed and Stamina, so those are the two that move.
    const sheet = (id: string, pace: number) =>
      createCommander(id, id, 'field_commander', { speed: pace, stamina: pace });
    stack.app.repos.bases.updateCommanders(base.id, [sheet('slow', 1), sheet('quick', 100)]);
    await declare(stack);

    const listed = await leaders(stack);
    const slow = listed.find((entry) => entry.officerId === 'slow')!;
    const quick = listed.find((entry) => entry.officerId === 'quick')!;
    expect(officerBattleStats(sheet('quick', 95).attributes).speed).toBeGreaterThan(
      officerBattleStats(sheet('slow', 5).attributes).speed,
    );
    expect(quick.travelMinutes).toBeLessThan(slow.travelMinutes);
  });

  /**
   * §C3: a machine the crew has committed to this fight carries the officer too.
   *
   * The Heli Porter is the fastest thing in the game, so a machine the officer can outrun would
   * prove nothing: `columnSpeed` refuses a seat that is slower than the legs it would replace.
   */
  it('puts the officer in a committed machine when it beats their legs', async () => {
    const stack = await makeStack();
    const officer = hire(stack);
    stack.app.repos.bases.updateFleet(stack.baseId, { heli_porter: 1 });
    const battleId = await declare(stack);

    const walking = (await leaders(stack))[0]!.travelMinutes;
    expect((await takeVehicles(stack, battleId, { heli_porter: 1 })).statusCode).toBe(200);
    const riding = (await leaders(stack))[0]!.travelMinutes;

    expect(findVehicle('heli_porter')!.speed).toBeGreaterThan(
      officerBattleStats(officer.attributes).speed,
    );
    expect(riding).toBeLessThan(walking);
  });

  /** A machine still parked in the yard carries nobody. Only what is committed counts. */
  it('leaves the officer on foot while the machine is still in the yard', async () => {
    const stack = await makeStack();
    hire(stack);
    await declare(stack);
    const walking = (await leaders(stack))[0]!.travelMinutes;

    stack.app.repos.bases.updateFleet(stack.baseId, { heli_porter: 1 });
    expect((await leaders(stack))[0]!.travelMinutes).toBe(walking);
  });
});

describe('coming home hurt (§D4)', () => {
  /**
   * A wipe, so the officer certainly falls and the injury is settled rather than rolled.
   *
   * The stub engine reports the officer as having fallen: that is `SkirmishOutcome.officers`, which
   * the real engine fills in from the stack it built. Driving it from the stub keeps this test
   * about the *settlement* rather than about the round loop, which the shared suite already covers.
   */
  const officerDown = (officerId: string, winner: 'attacker' | 'defender') =>
    spy(winner, {
      killed: { razors: 10 },
      fled: { razors: 4 },
      officers: {
        attacker: { officerId, name: 'Vasco Renn', fell: true, damage: 400 },
        defender: null,
      },
    });

  it('writes a recovery clock onto the officer and takes their bonuses off the crew', async () => {
    const stack = await makeStack();
    const officer = hire(stack);
    const engine = officerDown(officer.id, 'defender');
    const battleId = await declare(stack);
    expect((await lead(stack, battleId, officer.id)).statusCode).toBe(200);
    await deploy(stack, battleId, { razors: 10 });
    const now = new Date();
    // Settled three hours late: the clock runs from the fight's mark, not from the settle
    // (maintainer, 2026-10-06).
    const mark = new Date(now.getTime() - 3 * 3_600_000);
    bringForward(stack, battleId, mark);
    settleBattles(stack.app.repos, engine, now);

    const after = stack.app.repos.bases.findById(stack.baseId)!.commanders[0]!;
    expect(officerIsInjured(after.injuredUntil, now)).toBe(true);
    // The board's number, to the minute, read off the constant rather than typed: it moved from
    // 24 to 12 on 2026-09-23 and a hand-written 24 here would have been the only thing left
    // claiming otherwise.
    expect(Date.parse(after.injuredUntil!) - mark.getTime()).toBe(OFFICER_INJURY_HOURS * 3_600_000);
  });

  /*
   * The officer counts for nothing towards the report (maintainer, 2026-09-23): a report is
   * written by whoever walked back, and a winner always has somebody. The injury still lands on
   * the roster and on the report's officer line; it no longer takes the report with it.
   */
  it('lands on the report rather than withholding it, on a fight it won', async () => {
    const stack = await makeStack();
    const officer = hire(stack);
    const engine = officerDown(officer.id, 'attacker');
    const battleId = await declare(stack);
    await lead(stack, battleId, officer.id);
    await deploy(stack, battleId, { razors: 10 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    const res = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const report = res.json<BattlesResponse>().reports[0]!;
    expect(report.redacted).toBe(false);
    expect(report.analysis?.attacker.officer?.injured).toBe(true);
  });

  it('leaves the report alone when nobody led', async () => {
    const stack = await makeStack();
    const engine = spy('attacker', { killed: { razors: 1 } });
    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 10 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    const res = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const report = res.json<BattlesResponse>().reports[0]!;
    expect(report.redacted).toBe(false);
    expect(report.analysis).not.toBeNull();
  });
});

describe('an injured officer is out of the room (§D4)', () => {
  it('contributes nothing to the crew while the clock is running, and everything after it', async () => {
    const stack = await makeStack();
    // A specialist: an Engineer's passive (2026-10-04) is a direct read of whether the crew has
    // them at all, since nothing else on this fixture pays it.
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const production = (now: Date): number =>
      chairPassiveOf(
        crewEffectsFor(stack.app.repos, stack.app.repos.bases.findById(base.id)!, now),
        'engineer',
        'building_cost',
      );

    stack.app.repos.bases.updateCommanders(base.id, []);
    const alone = production(new Date());
    expect(alone).toBe(0);

    const specialist = createCommander('off-eng', 'Bo Adeyemi', 'engineer', {
      engineering: 90,
    });
    stack.app.repos.bases.updateCommanders(base.id, [specialist]);
    const fit = production(new Date());
    expect(fit).toBeGreaterThan(alone);

    const later = new Date(Date.now() + 3_600_000);
    stack.app.repos.bases.updateCommanders(base.id, [
      { ...specialist, injuredUntil: later.toISOString() },
    ]);
    expect(production(new Date())).toBe(alone);

    // ...and the clock settles itself: nothing has to run for them to come back.
    expect(production(new Date(later.getTime() + 1000))).toBe(fit);
  });

  it('stops their perks lifting the other officers too', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    // `grip_coach` puts flat Strength on every *other* officer. The pupil has nothing of their own.
    const coach = createCommander('coach', 'Ines Vaz', 'engineer', {}, ['grip_coach']);
    const pupil = createCommander('pupil', 'Tam Osei', 'field_commander', { strength: 20 });
    // The pupil's own line, not anybody else's: the Overseer is in the room with a sheet of their own.
    const pupilStrength = (): number => {
      const sheets = crewSheetsFor(stack.app.repos, stack.app.repos.bases.findById(base.id)!);
      // The Overseer is first and the officers follow in roster order, so the pupil is last.
      return sheets[sheets.length - 1]!.attributes.strength;
    };

    stack.app.repos.bases.updateCommanders(base.id, [coach, pupil]);
    const taught = pupilStrength();
    expect(taught).toBeGreaterThan(20);

    stack.app.repos.bases.updateCommanders(base.id, [
      { ...coach, injuredUntil: new Date(Date.now() + 3_600_000).toISOString() },
      pupil,
    ]);
    expect(pupilStrength()).toBe(20);
  });
});

/**
 * Razors on the roster plus Razors standing on ground the crew holds. Winners hold what they took
 * (maintainer, 2026-09-28), so a won location's survivors are its garrison rather than back home.
 */
function razorsKept(stack: Stack): number {
  const home = stack.app.repos.bases.findById(stack.baseId)!.army.razors ?? 0;
  let held = 0;
  for (const control of stack.app.repos.city.controls().values()) {
    if (control.holder.kind === 'crew' && control.holder.baseId === stack.baseId) {
      held += control.garrison.razors ?? 0;
    }
  }
  return home + held;
}

describe('the Infirmary gets some of the dead back (§B10)', () => {
  it('adds the structure to whatever the crew was already recovering, on a win', async () => {
    const stack = await makeStack();
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings,
        {
          id: 'inf-1',
          kind: 'infirmary' as const,
          level: 8,
          modifications: [],
        },
      ],
      base.buildQueue,
    );

    const engine = spy('attacker', { winnerLosses: { razors: 10 }, killed: { razors: 4 } });
    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 20 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());
    everybodyHome(stack.app.repos);

    // 20 sent, 10 lost outright, and the Infirmary hands some of the ten back.
    const expectedDead =
      recoverCasualties({ razors: 10 }, 8 * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL).razors ?? 0;
    expect(expectedDead).toBeLessThan(10);
    // 30 mustered, 20 sent, so 10 stayed at home and the survivors hold the ground they took.
    expect(razorsKept(stack)).toBe(10 + (20 - expectedDead));
  });

  /**
   * ...and says so on the report, not only on the roster.
   *
   * `analyseBattle` runs inside the engine, and the engine has never heard of this crew's
   * Infirmary: it counts every one of the winner's dead as dead. The medics are applied by the
   * settler, which patched only the officer and the infamy onto that analysis. So the roster handed
   * the survivors back and the report a player reads afterwards still listed them as casualties:
   * two numbers for one fight, and the one on the screen was the wrong one.
   *
   * Driven through a stub that carries a **real** analysis, rather than through the tactical
   * engine. The bug is in the seam between the engine's rows and the settler's recovery, so what
   * the fixture needs is a fight whose casualty numbers are chosen rather than rolled: with the
   * real engine the same ground cost two hundred razors nothing on some seeds and the whole test
   * held at zero.
   */
  it('takes the recovered off the report as well, so it agrees with the roster', async () => {
    const SENT = 20;
    const FELL = 10;

    /** The rows the engine would hand over: ten of the twenty dead, before any medic sees them. */
    const side = (name: string, started: number, lost: number): SideAnalysis => ({
      name,
      committed: started,
      lost,
      survived: started - lost,
      fled: 0,
      perimeter: 0,
      perimeterCaught: 0,
      perimeterLost: 0,
      intimidated: 0,
      infamy: 0,
      officer: null,
      units: [
        {
          unitId: 'razors',
          name: 'Razors',
          tier: 'rabble',
          unique: false,
          started,
          lost,
          fled: 0,
          caught: 0,
          survived: started - lost,
          damage: 100,
          damageShare: 1,
          brokeAtRound: null,
          state: 'steady',
        },
      ],
    });

    const engine: SkirmishEngine = {
      resolve: (input) =>
        skirmishOutcome({
          winner: 'attacker',
          winnerLosses: { razors: FELL },
          killed: { razors: 5 },
          analysis: {
            battleId: input.battleId ?? input.seed,
            locationName: input.locationName ?? 'the press',
            winner: 'attacker',
            rounds: 3,
            decidedOnPower: false,
            settledBy: 'standing' as const,
            // No Combine leader over this ground, so no name on it and neither toll was taken.
            underLeader: null,
            turned: {},
            executed: 0,
            attacker: side('Your crew', SENT, FELL),
            defender: side('The looters', 5, 5),
            log: ['decided'],
            findings: [],
            trap: null,
            legends: [],
            headline: 'Taken.',
            spoils: {},
            target: 'location',
            brokeThrough: true,
            weather: 'normal',
            ground: [],
          },
        }),
    };

    const stack = await makeStack(engine);
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateDistrict(
      base.id,
      [
        ...base.buildings,
        { id: 'inf-1', kind: 'infirmary' as const, level: 20, modifications: [] },
      ],
      base.buildQueue,
    );

    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: SENT });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    const [resolved] = settleBattles(stack.app.repos, engine, new Date());
    everybodyHome(stack.app.repos);
    if (!resolved) throw new Error('fixture: the fight did not resolve');

    // The crew's own medic points count as well. Under the old 40% cap a level 20 ward hid them;
    // on the curve every point shows.
    const crewPoints = standingEffectsFor(
      stack.app.repos,
      stack.app.repos.bases.findById(stack.baseId)!,
    ).casualtyRecoveryPercent;
    const recovery = 20 * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL + crewPoints;
    const expectedDead = recoverCasualties({ razors: FELL }, recovery).razors ?? 0;
    // The anchor: with nothing recovered the report and the roster agree whatever the settler does,
    // and reverting the fix would leave this green.
    expect(expectedDead, 'fixture: the medics saved nobody').toBeLessThan(FELL);

    const reported = resolved.analysis.attacker;
    expect(reported.lost, 'the report counted the recovered as dead').toBe(expectedDead);
    // P14-B: and the medics' ladder counts the same bodies the report hands back.
    expect(stack.app.repos.feats.tallies(stack.baseId)['casualties_recovered']).toBe(
      FELL - expectedDead,
    );
    expect(reported.survived).toBe(SENT - expectedDead);
    expect(reported.lost + reported.survived).toBe(reported.committed);
    // The unit table has to move with the totals: it is the half a player reads to decide what to
    // field next, and rows that do not add up to the side's own figures are worse than stale ones.
    expect(reported.units.reduce((sum, unit) => sum + unit.lost, 0)).toBe(reported.lost);
    expect(reported.units.reduce((sum, unit) => sum + unit.survived, 0)).toBe(reported.survived);

    // And the roster it is supposed to agree with. 30 on the books, `deploy` sends SENT of them.
    expect(razorsKept(stack)).toBe(30 - SENT + (SENT - expectedDead));

    // The loser recovers nobody: a routed force leaves its wounded where they fell.
    expect(resolved.analysis.defender.lost).toBe(5);
  });

  it('never hands back half, however deep the Infirmary', () => {
    // The curve lives on `recoverCasualties`, which both sources feed. Pinned here rather than
    // only in the shared suite because this is the call site that adds two sources together.
    const recovered = recoverCasualties({ razors: 100 }, 999).razors ?? 0;
    expect(100 - recovered).toBeLessThan(CASUALTY_RECOVERY_CEILING);
    expect(100 - recovered).toBe(Math.floor(casualtyRecoveryShare(999)));
  });
});

describe('taking machines to a fight (§C3)', () => {
  function park(stack: Stack, fleet: Record<string, number>): void {
    stack.app.repos.bases.updateFleet(stack.baseId, fleet);
  }

  it('takes them out of the yard when they are committed and puts them back when they are not', async () => {
    const stack = await makeStack();
    park(stack, { motorcycle: 3 });
    const battleId = await declare(stack);

    expect((await takeVehicles(stack, battleId, { motorcycle: 2 })).statusCode).toBe(200);
    expect(stack.app.repos.bases.findById(stack.baseId)!.fleet).toEqual({ motorcycle: 1 });

    expect((await takeVehicles(stack, battleId, {})).statusCode).toBe(200);
    expect(stack.app.repos.bases.findById(stack.baseId)!.fleet).toEqual({ motorcycle: 3 });
  });

  it('refuses more than the crew owns', async () => {
    const stack = await makeStack();
    park(stack, { motorcycle: 1 });
    const battleId = await declare(stack);
    expect((await takeVehicles(stack, battleId, { motorcycle: 2 })).statusCode).toBe(403);
  });

  it('brings them home after a win that cost nobody, and wrecks them after a wipe', async () => {
    // Four unit slots against two bikes, which is what the two of them seat: the seat cap is a
    // server rule as of 2026-09-16 (`no_seats`), so a fixture that loads a machine has to send a
    // batch it can actually carry.
    const won = await makeStack(undefined, 'won');
    park(won, { motorcycle: 2 });
    const wonBattle = await declare(won);
    await takeVehicles(won, wonBattle, { motorcycle: 2 });
    await deploy(won, wonBattle, { razors: 4 });
    const engine = spy('attacker', { winnerLosses: {} });
    bringForward(won, wonBattle, new Date(Date.now() - 1000));
    settleBattles(won.app.repos, engine, new Date());
    everybodyHome(won.app.repos);
    expect(won.app.repos.bases.findById(won.baseId)!.fleet).toEqual({ motorcycle: 2 });

    const lost = await makeStack(undefined, 'lost');
    park(lost, { motorcycle: 2 });
    const lostBattle = await declare(lost);
    await takeVehicles(lost, lostBattle, { motorcycle: 2 });
    await deploy(lost, lostBattle, { razors: 4 });
    // Wiped: nobody came home, so nobody drove a bike home either.
    const wipe = spy('defender', { killed: { razors: 4 }, fled: {} });
    bringForward(lost, lostBattle, new Date(Date.now() - 1000));
    settleBattles(lost.app.repos, wipe, new Date());
    everybodyHome(lost.app.repos);
    expect(lost.app.repos.bases.findById(lost.baseId)!.fleet).toEqual({});
  });

  /**
   * §C3: the seats are the ceiling on the server as well as in the window.
   *
   * The deploy dialog has capped a batch by unit slots since 2026-09-15 and the route took whatever
   * was posted, so the rule was a piece of the client, which is to say not a rule: one Scrappy and
   * a `POST` of two hundred Razors was accepted in full. Priced in unit slots rather than heads,
   * because that is the currency a seat is sold in everywhere else.
   */
  it('refuses a batch the loaded machines cannot seat', async () => {
    const stack = await makeStack(undefined, 'overloaded');
    park(stack, { motorcycle: 1 });
    const battleId = await declare(stack);
    expect((await takeVehicles(stack, battleId, { motorcycle: 1 })).statusCode).toBe(200);

    const bike = findVehicle('motorcycle');
    if (!bike) throw new Error('fixture: the bike left the catalogue');
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateArmy(base.id, { razors: 30 }, base.musterQueue);

    const over = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: {
        battleId,
        changes: { razors: bike.capacity + 1 },
        perimeterChanges: {},
      },
    });
    expect(over.statusCode, over.body.slice(0, 200)).toBe(409);
    expect(over.body).toContain('no room');

    // ...and exactly what it seats still goes.
    const fits = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: { battleId, changes: { razors: bike.capacity }, perimeterChanges: {} },
    });
    expect(fits.statusCode, fits.body.slice(0, 200)).toBe(200);
  });

  /*
   * A unit that has landed rides nothing and frees its seat (maintainer, 2026-10-06). The deploy
   * door counted everybody landed or walking, so a crew whose first batch had arrived was refused
   * a second the bike could carry, while the machines door counted only the road.
   */
  it('frees a seat when its rider lands', async () => {
    const stack = await makeStack(undefined, 'landed');
    park(stack, { motorcycle: 1 });
    const battleId = await declare(stack);
    expect((await takeVehicles(stack, battleId, { motorcycle: 1 })).statusCode).toBe(200);
    const bike = findVehicle('motorcycle');
    if (!bike) throw new Error('fixture: the bike left the catalogue');
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateArmy(base.id, { razors: 30 }, base.musterQueue);

    const send = (razors: number) =>
      stack.app.inject({
        method: 'POST',
        url: '/api/battles/deploy',
        headers: auth(stack.token),
        payload: { battleId, changes: { razors }, perimeterChanges: {} },
      });
    expect((await send(bike.capacity)).statusCode).toBe(200);
    // On the road, the seats are full.
    expect((await send(1)).statusCode).toBe(409);

    stack.db
      .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
      .run(
        new Date(Date.now() - 120_000).toISOString(),
        new Date(Date.now() - 60_000).toISOString(),
        battleId,
      );
    settleMovements(stack.app.repos, new Date());
    // Landed, they ride nothing: the bike seats a second batch.
    const second = await send(bike.capacity);
    expect(second.statusCode, second.body.slice(0, 200)).toBe(200);
  });

  /**
   * Only what somebody was riding is at risk. Two Cheese Wagons under ten units is one bus with
   * ten in it and one with nobody: the settle used to wreck both on a wipe and hand the enemy
   * sixty infamy for a seating plan.
   */
  it('wrecks only the machines the force could fill, and sends the idle ones home', async () => {
    const stack = await makeStack(undefined, 'convoy');
    park(stack, { armoured_car: 2 });
    const battleId = await declare(stack);
    await takeVehicles(stack, battleId, { armoured_car: 2 });
    await deploy(stack, battleId, { razors: 10 });
    const wipe = spy('defender', { killed: { razors: 10 }, fled: {} });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, wipe, new Date());
    everybodyHome(stack.app.repos);
    expect(stack.app.repos.bases.findById(stack.baseId)!.fleet).toEqual({ armoured_car: 1 });
  });

  /**
   * A unit that cannot get in fills no seat, and the settle has to count seats (§C3, `no_ride`).
   *
   * A Colossus and a Cheese Wagon. `loadable` trims the yard down to what the units going could
   * fill and its whole contract is that `units` means the **riders**, which is how the client's
   * own quote reads it. The settle handed it the plain force size instead, so one Colossus made a
   * thirty-seat bus "carrying somebody": wiped, and the crew lost a bus nobody was ever in and paid
   * the enemy thirty infamy for it. The Colossus walks and the wagon never left the yard.
   */
  it('leaves a machine idle when the only unit going will not ride', async () => {
    const stack = await makeStack(undefined, 'colossus');
    /*
     * The crew gives up the Breaker's Yard first, and that is now part of the setup rather than a
     * detail: the yard grants `any_ride` (`city/locations.ts`), which waives the very rule this
     * test is about. `makeStack` hands the crew every location in the Rustyard, the yard among
     * them, so without this the Colossus takes a seat and the wagon is correctly wrecked with it.
     */
    const yard = stack.app.repos.city.control('steelbelt-bonefield')!;
    stack.app.repos.city.put({ ...yard, holder: { kind: 'unoccupied' }, garrison: {} });
    park(stack, { armoured_car: 1 });
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateArmy(base.id, { the_colossus: 1 }, base.musterQueue);
    // A legendary needs a name behind it before anybody will field one (§A5).
    stack.app.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      notoriety: NOTORIETY_TO_FIELD.legendary,
    });
    const battleId = await declare(stack);
    await takeVehicles(stack, battleId, { armoured_car: 1 });
    const sent = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: { battleId, changes: { the_colossus: 1 }, perimeterChanges: {} },
    });
    expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);
    expect(findUnit('the_colossus')?.no_ride).toBe(true);

    const wipe = spy('defender', { killed: { the_colossus: 1 }, fled: {} });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, wipe, new Date());
    everybodyHome(stack.app.repos);
    expect(stack.app.repos.bases.findById(stack.baseId)!.fleet).toEqual({ armoured_car: 1 });
  });

  /**
   * The share a machine is written off on is measured in **unit slots**, not in heads (§C3).
   *
   * The seats were sold in slots and the survival was counted in heads, which is the same fault
   * line the deploy window opened: a crew that lost the one heavy sheet out of a column kept both
   * cars, because six of seven heads walked home and the settle read that as a scratch. In the
   * currency the seats were actually spent in, half the column is gone and half the convoy with it.
   *
   * One Juggernaut at ten slots and six Razors at one: seven heads, sixteen slots, a Dirt Runner
   * at ten seats for the Juggernaut and a Scar at eight for the Razors (the Juggernaut went to six
   * slots and two Scars until Arca made it ten, 2026-10-07, and ten does not fit in a Scar).
   * Killing only the Juggernaut is 1/7 of the heads and 10/16 of the slots; `wrecked` rounds
   * down over two machines, so the two arithmetics give floor(2/7) = 0 and floor(20/16) = 1. The
   * machine written off is the one at the front of the column, the faster Runner (58 to 55).
   */
  it('wrecks on the share of the unit slots lost, not the share of the heads', async () => {
    const stack = await makeStack(undefined, 'slotshare');
    const jugg = findUnit('juggernauts')!;
    const razor = findUnit('razors')!;
    const runner = findVehicle('dirt_runner')!;
    const scar = findVehicle('scrap_car')!;
    // The preconditions, off the catalogues: a heavy sheet that only the Runner can seat, a yard
    // whose two machines are both needed to seat sixteen slots and neither to seat seven heads,
    // and the Runner at the front of the column so it is the one machine the share writes off.
    expect(jugg.unitSlots).toBeGreaterThan(scar.capacity);
    expect(jugg.unitSlots).toBeLessThanOrEqual(runner.capacity);
    expect(razor.unitSlots).toBe(1);
    expect(runner.capacity).toBeLessThan(jugg.unitSlots + 6 * razor.unitSlots);
    expect(runner.speed).toBeGreaterThan(scar.speed);

    park(stack, { dirt_runner: 1, scrap_car: 1 });
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateArmy(base.id, { juggernauts: 1, razors: 6 }, base.musterQueue);
    // A heavy sheet needs a name behind it before anybody will field one (§D7).
    stack.app.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      notoriety: NOTORIETY_TO_FIELD.heavy,
    });

    const battleId = await declare(stack);
    await takeVehicles(stack, battleId, { dirt_runner: 1, scrap_car: 1 });
    const sent = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(stack.token),
      payload: { battleId, changes: { juggernauts: 1, razors: 6 }, perimeterChanges: {} },
    });
    expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);

    // Won, so the survivors are the committed force less what it cost: the Juggernaut and nobody
    // else. That is a seventh of the heads and ten sixteenths of the unit slots.
    const cost = spy('attacker', { winnerLosses: { juggernauts: 1 } });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, cost, new Date());
    everybodyHome(stack.app.repos);
    expect(stack.app.repos.bases.findById(stack.baseId)!.fleet).toEqual({ scrap_car: 1 });
  });

  /** Nobody rode, nobody died, nothing is wrecked: a committed yard with no column comes home. */
  it('hands everything back to a crew that fielded nobody', async () => {
    const stack = await makeStack(undefined, 'idle');
    park(stack, { motorcycle: 2 });
    const battleId = await declare(stack);
    await takeVehicles(stack, battleId, { motorcycle: 2 });
    const engine = spy('defender', { killed: {}, fled: {} });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());
    everybodyHome(stack.app.repos);
    expect(stack.app.repos.bases.findById(stack.baseId)!.fleet).toEqual({ motorcycle: 2 });
  });

  /**
   * The picker and the deploy share a screen and nothing orders them. A column sent first walked
   * at the old pace whatever was loaded onto the fight afterwards.
   */
  it('re-times a column already on the road when the machines are picked after it left', async () => {
    const stack = await makeStack(undefined, 'late');
    park(stack, { motorcycle: 5 });
    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 10 });
    const walking = stack.app.repos.movements.forBase(stack.baseId)[0]!;

    // Ten seats for ten units: the whole column rides.
    expect((await takeVehicles(stack, battleId, { motorcycle: 5 })).statusCode).toBe(200);
    const riding = stack.app.repos.movements.find(walking.id)!;
    expect(Date.parse(riding.arrivesAt)).toBeLessThan(Date.parse(walking.arrivesAt));
    expect(riding.departedAt).toBe(walking.departedAt);

    // And narrowing the set puts the walk back.
    expect((await takeVehicles(stack, battleId, {})).statusCode).toBe(200);
    expect(stack.app.repos.movements.find(walking.id)!.arrivesAt).toBe(walking.arrivesAt);
  });

  /**
   * One arithmetic under both roads (§C3, the speed rebalance).
   *
   * The march and the mission leg are the same function now: `roadMinutes` divides the length by
   * the column's speed and takes the ground's cut off what is left. This asks it of the *battle*
   * road twice, walking and riding, and then feeds the same length and the same two speeds through
   * the mission-side name and checks it lands on the same minutes. They used to be two divisions
   * that happened to agree, with the machines' contribution summed into the ground's percentage on
   * one of them and not the other.
   */
  it('walks the battle road on the same arithmetic the mission road uses', async () => {
    const stack = await makeStack(undefined, 'onemap');
    park(stack, { motorcycle: 10 });
    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 20 });

    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const effects = crewEffectsFor(stack.app.repos, base);
    const walking = stack.app.repos.movements.forBase(stack.baseId)[0]!;
    const from = findDistrict(base.districtId)!;
    const to = findDistrict(walking.toDistrictId)!;
    const legMinutes = (movement: { departedAt: string; arrivesAt: string }): number =>
      (Date.parse(movement.arrivesAt) - Date.parse(movement.departedAt)) / 60_000;

    const onFoot = effectiveSpeed(findUnit('razors')!.stats.speed, {
      percent: effects.unitSpeedPercent,
    });
    const onWheels = findVehicle('motorcycle')!.speed;
    expect(onWheels).toBeGreaterThan(onFoot);

    expect(legMinutes(walking)).toBe(
      travelMinutesBetween(from, to, {
        speed: onFoot,
        reductionPercent: effects.travelSpeedPercent,
      }),
    );

    // Ten bikes, twenty seats, twenty units: the whole column rides and moves at the Scrappy.
    expect((await takeVehicles(stack, battleId, { motorcycle: 10 })).statusCode).toBe(200);
    const riding = stack.app.repos.movements.find(walking.id)!;
    expect(legMinutes(riding)).toBe(
      travelMinutesBetween(from, to, {
        speed: onWheels,
        reductionPercent: effects.travelSpeedPercent,
      }),
    );

    // ...and the mission side, given this road's own length and these same two speeds, agrees to
    // the minute. One length, one column, one answer, whichever screen asked.
    const length = mapDistance(from.position, to.position) * TRAVEL_MINUTES_PER_MAP_UNIT;
    expect(hastenedRoadMinutes(length, onFoot, effects.travelSpeedPercent)).toBe(
      legMinutes(walking),
    );
    expect(hastenedRoadMinutes(length, onWheels, effects.travelSpeedPercent)).toBe(
      legMinutes(riding),
    );
  });

  /**
   * The march reads the sheet the workshop fitted, not the one the catalogue prints (§C3).
   *
   * `upgradedStats` is what `battle/effects.ts` hands the engine, so a Neural Lace is twelve points
   * of speed inside the fight. `unitColumnSpeed` read `unit.stats.speed` straight off the
   * catalogue, so the same Razors crossed the city slower than they crossed the battlefield they
   * were crossing it to reach, and the one upgrade line whose whole flavour is "goes faster" moved
   * no clock a player watches. The armour line's negative speed is the same rule the other way up.
   */
  it('walks the road at the sheet the workshop fitted', async () => {
    const stack = await makeStack(undefined, 'laced');
    // The largest of them, so the two sheets are more than a rounding step apart on this road.
    const quickening = [...UNIT_MODIFICATIONS]
      .sort((a, b) => (b.effect.speed ?? 0) - (a.effect.speed ?? 0))
      .find((spec) => (spec.effect.speed ?? 0) > 0 && spec.fits === undefined);
    if (!quickening) throw new Error('no universal card adds speed');
    stack.app.repos.bases.updateUnitLoadouts(stack.baseId, { razors: [quickening.id] });

    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 10 });

    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const effects = crewEffectsFor(stack.app.repos, base);
    const walking = stack.app.repos.movements.forBase(stack.baseId)[0]!;
    const from = findDistrict(base.districtId)!;
    const to = findDistrict(walking.toDistrictId)!;
    const leg = (Date.parse(walking.arrivesAt) - Date.parse(walking.departedAt)) / 60_000;

    const sheet = findUnit('razors')!.stats;
    const printed = effectiveSpeed(sheet.speed, { percent: effects.unitSpeedPercent });
    const fitted = effectiveSpeed(upgradedStats(sheet, [quickening.id]).speed, {
      percent: effects.unitSpeedPercent,
    });
    expect(fitted).toBeGreaterThan(printed);
    const road = (speed: number): number =>
      travelMinutesBetween(from, to, { speed, reductionPercent: effects.travelSpeedPercent });
    expect(leg).toBe(road(fitted));
    // The teeth: this road is long enough that the two sheets are different numbers of minutes.
    expect(road(printed)).toBeGreaterThan(road(fitted));
  });

  /**
   * A side can be several crews, and each row holds its own machines. The settle used to handle
   * the declarer's row and nobody else's, so an ally's yard sat on the deployment row for ever.
   */
  it("settles an ally's machines on their own row, and brings them home", async () => {
    const stack = await makeStack(undefined, 'caller');
    const registered = await stack.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'helper', password: 'hunter2pass' },
    });
    const allyToken = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(stack.app, allyToken);
    pinOverseer(stack.app, allyToken);
    const allyId = chosen.json<{ base: { id: string } }>().base.id;
    const joined = new Date().toISOString();
    stack.app.repos.factions.insert({
      id: 'f1',
      name: 'Iron Wolves',
      badge: DEFAULT_BADGE,
      blurb: '',
      foundedAt: joined,
    });
    for (const [baseId, rank] of [
      [stack.baseId, 'leader'],
      [allyId, 'member'],
    ] as const) {
      const owner = stack.app.repos.bases.findById(baseId)!.ownerId;
      stack.app.repos.factions.addMember({
        userId: owner,
        factionId: 'f1',
        rank,
        joinedAt: joined,
      });
    }
    const ally = stack.app.repos.bases.findById(allyId)!;
    stack.app.repos.bases.updateArmy(ally.id, { ...ally.army, razors: 6 }, ally.musterQueue);
    stack.app.repos.bases.updateFleet(ally.id, { motorcycle: 3 });

    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 10 });
    const reinforced = await stack.app.inject({
      method: 'POST',
      url: '/api/factions/reinforce',
      headers: auth(allyToken),
      payload: { battleId, army: { razors: 6 } },
    });
    expect(reinforced.statusCode, reinforced.body.slice(0, 200)).toBe(200);
    const took = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/vehicles',
      headers: auth(allyToken),
      payload: { battleId, vehicles: { motorcycle: 3 } },
    });
    expect(took.statusCode, took.body.slice(0, 200)).toBe(200);
    expect(stack.app.repos.bases.findById(allyId)!.fleet).toEqual({});

    const engine = spy('attacker', { winnerLosses: {} });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());
    everybodyHome(stack.app.repos);
    expect(stack.app.repos.bases.findById(allyId)!.fleet).toEqual({ motorcycle: 3 });
  });

  /** The yard says where its machines went rather than showing an empty row. */
  it('counts committed machines as out on the Garage page', async () => {
    const stack = await makeStack(undefined, 'yard');
    park(stack, { motorcycle: 3 });
    const battleId = await declare(stack);
    await takeVehicles(stack, battleId, { motorcycle: 2 });
    const page = await stack.app.inject({
      method: 'GET',
      url: '/api/garage',
      headers: auth(stack.token),
    });
    const bike = page.json<{ vehicles: { id: string; owned: number; out: number }[] }>().vehicles;
    expect(bike.find((row) => row.id === 'motorcycle')).toMatchObject({ owned: 1, out: 2 });
  });
});

/**
 * §D1: one officer, one fight.
 *
 * The lead route asked whether *this* fight already had a leader and nothing else, so the same
 * person could be written onto every battle a crew had declared: their sheet in each line and
 * their leading perks paid out several times over, off one wage. Declaring is free and reversible,
 * which made it cheap to do by accident as well as deliberately.
 */
describe('an officer cannot lead two fights at once', () => {
  /** A second location in the same district, so the crew can have two fights coming at once. */
  const SECOND: BattleTarget = (() => {
    const district = findDistrict('steelbelt');
    const other = district?.locations.find((location) => location.id !== SQUATTED);
    if (!other) throw new Error('the Rustyard has only one location');
    return { kind: 'location', districtId: 'steelbelt', locationId: other.id };
  })();

  it('refuses the second fight, and says where they already are', async () => {
    const stack = await makeStack(undefined, 'doubled');
    const officerId = hire(stack).id;

    const first = await declare(stack);
    const second = await declare(stack, SECOND);
    expect(first).not.toBe(second);

    expect((await lead(stack, first, officerId)).statusCode).toBe(200);

    const refused = await lead(stack, second, officerId);
    expect(refused.statusCode).toBe(403);
    // The one sentence a fight holds somebody with, wherever they are turned away
    // (`LEADER_HOLD_MESSAGES`): the launch says it too.
    expect(refused.json<ApiError>().error.message).toBe('Vasco Renn is at a fight');
  });

  /** Standing them down frees them, which is what makes the refusal a choice rather than a trap. */
  it('lets them take the second one once they are stood down from the first', async () => {
    const stack = await makeStack(undefined, 'moved');
    const officerId = hire(stack).id;
    const first = await declare(stack);
    const second = await declare(stack, SECOND);

    expect((await lead(stack, first, officerId)).statusCode).toBe(200);
    expect((await lead(stack, first, null)).statusCode).toBe(200);

    expect((await lead(stack, second, officerId)).statusCode).toBe(200);
  });

  /** The picker on each fight agrees with the door: the leader of the first stays on the first's
   *  list and is off the second's, instead of being offered there and refused. */
  it('keeps them on their own fight’s picker and off the other one’s', async () => {
    const stack = await makeStack(undefined, 'listed');
    const officerId = hire(stack).id;
    const first = await declare(stack);
    const second = await declare(stack, SECOND);
    expect((await lead(stack, first, officerId)).statusCode).toBe(200);

    const res = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const coming = res.json<BattlesResponse>().coming;
    const pickerOf = (battleId: string) =>
      coming.find((view) => view.battle.id === battleId)!.leaders.map((one) => one.officerId);
    expect(pickerOf(first)).toEqual([officerId]);
    expect(pickerOf(second)).toEqual([]);
  });

  /** And naming the same officer on the fight they already lead is not "elsewhere". */
  it('does not refuse a crew re-confirming the fight they are already on', async () => {
    const stack = await makeStack(undefined, 'again');
    const officerId = hire(stack).id;
    const battleId = await declare(stack);

    expect((await lead(stack, battleId, officerId)).statusCode).toBe(200);
    expect((await lead(stack, battleId, officerId)).statusCode).toBe(200);
  });
});

/**
 * §B7: a crew defending a district they took whole fights behind its gate.
 *
 * Asserted on what reaches the engine, not on the helper, and that is the point. `withGate` is
 * arithmetic and was never the risk: the risk is the same one this area has shipped twice, where a
 * percentage is computed correctly and handed to nobody. The home Gate's own defence sat unread
 * until integration; `officerGroupFlat` sat unread for eight perks.
 *
 * The condition is a fact about *this fight*, not about the crew: the same defenders get nothing
 * from the wall when the fight is somewhere else, and nothing at all while the district is split.
 */
describe('a captured gate in the fight it stands over (§B7)', () => {
  /** Hands `baseId` every location in the Rustyard, so the district is theirs outright. */
  function takeRustyard(stack: Stack, baseId: string): void {
    for (const locationId of RUSTYARD_LOCATIONS) {
      const control = stack.app.repos.city.control(locationId)!;
      stack.app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
    }
  }

  /*
   * The fight has to be at the **gate**, and that is the mechanic rather than a workaround.
   *
   * Holding every location in a district closes it (§A4): there is no longer a location to declare
   * against, and an attacker has to come through the door first. So the fight a captured gate is
   * ever in is the fight *for* the gate, which is exactly where a wall should count.
   *
   * The defender is a planted rival holding the whole district, because a crew cannot attack
   * itself.
   */
  async function defenceReaching(gateLevel: number | null): Promise<number> {
    const engine = spy('attacker');
    const stack = await makeStack(engine, `walled${gateLevel ?? 'none'}`);
    const rivalId = plantRustyardRival(stack);
    takeRustyard(stack, rivalId);
    if (gateLevel !== null) {
      stack.app.repos.capturedGates.put({
        districtId: 'steelbelt',
        level: gateLevel,
        upgradingTo: null,
        upgradingUntil: null,
        upgradingSince: null,
      });
    }

    const battleId = await declare(stack, { kind: 'gate', districtId: 'steelbelt' });
    await deploy(stack, battleId, { razors: 4 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    return engine.seen[0]?.defenderTerritory?.gatePercent ?? 0;
  }

  /** A rival crew living in the Rustyard, so the district has somebody to defend it. */
  function plantRustyardRival(stack: Stack): string {
    const now = new Date().toISOString();
    stack.app.repos.users.insert({
      id: 'rival-user',
      username: 'Rival',
      passwordHash: 'x',
      createdAt: now,
    });
    const mine = stack.app.repos.bases.findById(stack.baseId)!;
    const rival = {
      ...mine,
      id: 'rival-base',
      ownerId: 'rival-user',
      name: 'The Other Crew',
      districtId: 'steelbelt',
      army: { razors: 10 },
      commanders: [],
    };
    stack.app.repos.bases.insert(rival);
    return rival.id;
  }

  it('puts the wall in front of the defenders', async () => {
    const fresh = await defenceReaching(null);
    const walled = await defenceReaching(CAPTURED_GATE_MAX_LEVEL);

    /*
     * The baseline is a level *1* gate, not no gate.
     *
     * A crew that holds a district whole has its gate from that moment, at level 1: there is no
     * "they hold everything and there is no door" state. So the wall's worth is the difference
     * between the two levels, and asserting the full ten-level figure was wrong about the rule
     * rather than about the wiring. It read 22.5 where the test wanted 25, which is exactly
     * `capturedGateDefensePercent(max) - capturedGateDefensePercent(1)`.
     */
    expect(walled).toBeGreaterThan(fresh);
    expect(walled - fresh).toBeCloseTo(
      capturedGateDefensePercent(CAPTURED_GATE_MAX_LEVEL) -
        capturedGateDefensePercent(CAPTURED_GATE_START_LEVEL),
      5,
    );
  });

  it('is worth more the higher it is raised', async () => {
    expect(await defenceReaching(5)).toBeGreaterThan(await defenceReaching(3));
  });

  /**
   * And it pays nothing at all while the district is still split.
   *
   * This is the clause that makes the bonus conditional rather than free, and it is the one the
   * first version of these tests could not see: every scenario above has the defender holding the
   * whole district, so removing the `holdsDistrictWhole` check changed none of them and the mutant
   * passed. Measured, not assumed.
   *
   * The row is deliberately left at level 12 here. A gate that has been built and then partly
   * lost must stop paying the moment the sweep breaks, or "hold all of it" means nothing.
   */
  it('pays nothing to a crew that has lost part of the district', async () => {
    const engine = spy('attacker');
    const stack = await makeStack(engine, 'halftaken');
    const rivalId = plantRustyardRival(stack);
    takeRustyard(stack, rivalId);
    stack.app.repos.capturedGates.put({
      districtId: 'steelbelt',
      level: CAPTURED_GATE_MAX_LEVEL,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });

    // One location back in somebody else's hands: the district is no longer theirs outright, so
    // there is a location to attack again and no wall behind it.
    const loose = RUSTYARD_LOCATIONS.find((id) => id !== SQUATTED)!;
    const control = stack.app.repos.city.control(loose)!;
    stack.app.repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: {} });

    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 4 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    const defence = engine.seen[0]?.defenderTerritory?.gatePercent ?? 0;
    // Whatever else the defenders have, none of it is the maxed wall.
    expect(defence).toBeLessThan(capturedGateDefensePercent(CAPTURED_GATE_MAX_LEVEL));
  });
});
