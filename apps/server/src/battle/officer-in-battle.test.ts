import {
  CAPTURED_GATE_START_LEVEL,
  capturedGateDefensePercent,
  CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL,
  MAX_CASUALTY_RECOVERY,
  createCommander,
  declarationWindow,
  findDistrict,
  officerBattleStats,
  officerIsInjured,
  recoverCasualties,
  skirmishOutcome,
  startingHolder,
  type BattlesResponse,
  type BattleTarget,
  type SkirmishEngine,
  type SkirmishInput,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { crewEffectsFor, crewSheetsFor } from '../crew/standing.js';
import { settleMovements } from './movement.js';
import { settleBattles } from './resolve.js';

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

const RUSTYARD_LOCATIONS: readonly string[] = (findDistrict('rustyard')?.locations ?? []).map(
  (location) => location.id,
);

const SQUATTED: string = (() => {
  const district = findDistrict('rustyard');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Rustyard has nobody on it at all');
  return held.id;
})();

const PRESS: BattleTarget = { kind: 'location', districtId: 'rustyard', locationId: SQUATTED };

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
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  app.repos.city.markScouted(baseId, 'rustyard', new Date().toISOString());
  for (const locationId of RUSTYARD_LOCATIONS) app.repos.city.control(locationId);
  const ramp = app.repos.city.control('rustyard-ramp')!;
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
  stack.app.repos.bases.updateArmy(base.id, { ...base.army, razors: 30 }, base.trainingQueue);
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

  it('refuses an officer who is still laid up (§D4)', async () => {
    const stack = await makeStack();
    const hurt = hire(stack, 'off-hurt', new Date(Date.now() + 3_600_000).toISOString());
    const battleId = await declare(stack);
    const res = await lead(stack, battleId, hurt.id);
    expect(res.statusCode).toBe(403);
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
    bringForward(stack, battleId, new Date(now.getTime() - 1000));
    settleBattles(stack.app.repos, engine, now);

    const after = stack.app.repos.bases.findById(stack.baseId)!.commanders[0]!;
    expect(officerIsInjured(after.injuredUntil, now)).toBe(true);
    // 24 hours, to the minute.
    expect(Date.parse(after.injuredUntil!) - now.getTime()).toBe(24 * 3_600_000);
  });

  /*
   * The fight is **won**, deliberately.
   *
   * A loser with nobody home already gets no report (`reportReaches`, the perimeter rule), so
   * hanging this test on a defeat would have passed with the §D4 clause deleted: the first draft
   * did exactly that and the mutation went straight through. A winner is the one case where the
   * injury is the only thing that can withhold it.
   */
  it('withholds this side of the report even on a fight it won', async () => {
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
    expect(report.redacted).toBe(true);
    expect(report.analysis).toBeNull();
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
    // A specialist: their Engineering drives `productionPercent`, so the channel is a direct read
    // of whether the crew has them at all.
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const production = (now: Date): number =>
      crewEffectsFor(stack.app.repos, stack.app.repos.bases.findById(base.id)!, now)
        .productionPercent;

    // The Overseer is in the room too and has an Engineering of their own, so the baseline is
    // "nobody hired" rather than zero: measuring against zero would pass even if the officer had
    // simply never been added.
    stack.app.repos.bases.updateCommanders(base.id, []);
    const alone = production(new Date());

    const specialist = createCommander('off-eng', 'Bo Adeyemi', 'lead_engineer', {
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
    const coach = createCommander('coach', 'Ines Vaz', 'lead_engineer', {}, ['grip_coach']);
    const pupil = createCommander('pupil', 'Tam Osei', 'field_commander', { strength: 20 });
    // The pupil's own line, not the crew's best-of: the Overseer is in the room and would win it.
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
          damage: 0,
        },
      ],
      base.buildQueue,
    );

    const engine = spy('attacker', { winnerLosses: { razors: 10 }, killed: { razors: 4 } });
    const battleId = await declare(stack);
    await deploy(stack, battleId, { razors: 20 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    // 20 sent, 10 lost outright, and the Infirmary hands some of the ten back.
    const expectedDead =
      recoverCasualties({ razors: 10 }, 8 * CASUALTY_RECOVERY_PER_INFIRMARY_LEVEL).razors ?? 0;
    expect(expectedDead).toBeLessThan(10);
    const home = stack.app.repos.bases.findById(stack.baseId)!.army.razors ?? 0;
    // 30 trained, 20 sent, so 10 stayed at home and the survivors joined them.
    expect(home).toBe(10 + (20 - expectedDead));
  });

  it('never hands back more than the ceiling, however deep the Infirmary', () => {
    // The cap lives on `recoverCasualties`, which both sources feed. Pinned here rather than only
    // in the shared suite because this is the call site that adds two sources together, and two
    // uncapped sources is exactly how a cap stops binding.
    const recovered = recoverCasualties({ razors: 100 }, 999).razors ?? 0;
    expect(100 - recovered).toBe(Math.floor(100 * (MAX_CASUALTY_RECOVERY / 100)));
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
    const won = await makeStack(undefined, 'won');
    park(won, { motorcycle: 2 });
    const wonBattle = await declare(won);
    await takeVehicles(won, wonBattle, { motorcycle: 2 });
    await deploy(won, wonBattle, { razors: 10 });
    const engine = spy('attacker', { winnerLosses: {} });
    bringForward(won, wonBattle, new Date(Date.now() - 1000));
    settleBattles(won.app.repos, engine, new Date());
    expect(won.app.repos.bases.findById(won.baseId)!.fleet).toEqual({ motorcycle: 2 });

    const lost = await makeStack(undefined, 'lost');
    park(lost, { motorcycle: 2 });
    const lostBattle = await declare(lost);
    await takeVehicles(lost, lostBattle, { motorcycle: 2 });
    await deploy(lost, lostBattle, { razors: 10 });
    // Wiped: nobody came home, so nobody drove a bike home either.
    const wipe = spy('defender', { killed: { razors: 10 }, fled: {} });
    bringForward(lost, lostBattle, new Date(Date.now() - 1000));
    settleBattles(lost.app.repos, wipe, new Date());
    expect(lost.app.repos.bases.findById(lost.baseId)!.fleet).toEqual({});
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
    const district = findDistrict('rustyard');
    const other = district?.locations.find((location) => location.id !== SQUATTED);
    if (!other) throw new Error('the Rustyard has only one location');
    return { kind: 'location', districtId: 'rustyard', locationId: other.id };
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
    expect(refused.body).toContain('already leading another fight');
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
        districtId: 'rustyard',
        level: gateLevel,
        upgradingTo: null,
        upgradingUntil: null,
      });
    }

    const battleId = await declare(stack, { kind: 'gate', districtId: 'rustyard' });
    await deploy(stack, battleId, { razors: 4 });
    bringForward(stack, battleId, new Date(Date.now() - 1000));
    settleBattles(stack.app.repos, engine, new Date());

    return engine.seen[0]?.defenderTerritory?.defensePercent ?? 0;
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
      districtId: 'rustyard',
      army: { razors: 10 },
      commanders: [],
    };
    stack.app.repos.bases.insert(rival);
    return rival.id;
  }

  it('puts the wall in front of the defenders', async () => {
    const fresh = await defenceReaching(null);
    const walled = await defenceReaching(10);

    /*
     * The baseline is a level *1* gate, not no gate.
     *
     * A crew that holds a district whole has its gate from that moment, at level 1: there is no
     * "they hold everything and there is no door" state. So the wall's worth is the difference
     * between the two levels, and asserting the full ten-level figure was wrong about the rule
     * rather than about the wiring. It read 22.5 where the test wanted 25, which is exactly
     * `capturedGateDefensePercent(10) - capturedGateDefensePercent(1)`.
     */
    expect(walled).toBeGreaterThan(fresh);
    expect(walled - fresh).toBeCloseTo(
      capturedGateDefensePercent(10) - capturedGateDefensePercent(CAPTURED_GATE_START_LEVEL),
      5,
    );
  });

  it('is worth more the higher it is raised', async () => {
    expect(await defenceReaching(12)).toBeGreaterThan(await defenceReaching(3));
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
      districtId: 'rustyard',
      level: 12,
      upgradingTo: null,
      upgradingUntil: null,
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

    const defence = engine.seen[0]?.defenderTerritory?.defensePercent ?? 0;
    // Whatever else the defenders have, none of it is the twelve-level wall.
    expect(defence).toBeLessThan(capturedGateDefensePercent(12));
  });
});
