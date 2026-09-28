import {
  DECLARE_INFAMY_COST,
  TRAP_CATALOG,
  NOTORIETY_TO_FIELD,
  declarationWindow,
  emptyDeployment,
  featMeasureKey,
  findDistrict,
  skirmishOutcome,
  startingHolder,
  type BattleMutationResponse,
  type BattleTarget,
  type BuildQueue,
  type Building,
  type CapturedGate,
  type ItemId,
  type SkirmishEngine,
  type SkirmishInput,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBattles } from './resolve.js';
import { settleMovements } from './movement.js';
import { lowerDistrictGate, lowerHomeGate } from './wall-breaker.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * The Wall Breaker, end to end (maintainer, 2026-09-26).
 *
 * The engine half (the gate's toughness taken off the fight) is pinned in `@frontline/shared`. What
 * is pinned here is what the settler writes: a trap set against a Colossus is spent and takes
 * nobody, and every gate that stood behind the defence comes down one level, win or lose, never
 * below one. Each case runs beside the same fight without the Colossus, so a mutation that stops
 * checking for it shows up as the control moving rather than as nothing.
 */

const COLOSSUS = 'the_colossus';
const TRAP = TRAP_CATALOG[0]!;
const TRAP_ITEM = TRAP.id as ItemId;

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

const LOCATION: BattleTarget = { kind: 'location', districtId: 'steelbelt', locationId: SQUATTED };
const DISTRICT_GATE: BattleTarget = { kind: 'gate', districtId: 'steelbelt' };

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function gateBuilding(level: number): Building {
  return { id: 'gate-under-test', kind: 'gate', level, modifications: [] };
}

function gateOrder(level: number): BuildQueue[number] {
  return {
    id: `order-${level}`,
    kind: 'gate',
    level,
    startedAt: new Date().toISOString(),
    durationSeconds: 600,
    paid: {},
    parts: {},
  };
}

function districtGate(level: number, upgradingTo: number | null = null): CapturedGate {
  return {
    districtId: 'steelbelt',
    level,
    upgradingTo,
    upgradingUntil: upgradingTo === null ? null : new Date().toISOString(),
    upgradingSince: upgradingTo === null ? null : new Date().toISOString(),
  };
}

describe('what a gate comes down to', () => {
  it('takes one level off the home Gate', () => {
    const lowered = lowerHomeGate([gateBuilding(5)], []);
    expect(lowered?.buildings.find((one) => one.kind === 'gate')?.level).toBe(4);
    expect(lowered).toMatchObject({ from: 5, to: 4 });
  });

  it('leaves a level-one Gate where it is, and a crew with no Gate alone', () => {
    expect(lowerHomeGate([gateBuilding(1)], [])).toBeNull();
    // Level 0 is "not built". The floor must not raise it to one.
    expect(lowerHomeGate([], [gateOrder(1)])).toBeNull();
  });

  it('brings a queued Gate order down with it, and keeps the queue climbing', () => {
    const lowered = lowerHomeGate([gateBuilding(5)], [gateOrder(6), gateOrder(7)]);
    // Five knocked to four: the orders that would have made six and seven now make five and six.
    expect(lowered?.queue.map((entry) => entry.level)).toEqual([5, 6]);
  });

  it('takes one level off a district gate, and its raise with it', () => {
    expect(lowerDistrictGate(districtGate(6))).toMatchObject({ level: 5, upgradingTo: null });
    expect(lowerDistrictGate(districtGate(6, 7))).toMatchObject({ level: 5, upgradingTo: 6 });
  });

  it('leaves a district gate at one, and never raises one at zero', () => {
    expect(lowerDistrictGate(districtGate(1))).toBeNull();
    expect(lowerDistrictGate(districtGate(0))).toBeNull();
  });
});

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
  rivalId: string;
  engine: SkirmishEngine & { seen: SkirmishInput[] };
}

function spy(winner: 'attacker' | 'defender'): SkirmishEngine & { seen: SkirmishInput[] } {
  const seen: SkirmishInput[] = [];
  return {
    seen,
    resolve: (input) => {
      seen.push(input);
      return skirmishOutcome({ winner, log: ['decided'] });
    },
  };
}

/**
 * One attacking crew, and a rival living in the Rustyard with a home Gate at `homeGate`.
 *
 * The rival is planted straight into the repos because a crew cannot attack itself and a second
 * registration would land them in some other district.
 */
async function makeStack(winner: 'attacker' | 'defender', homeGate: number): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const engine = spy(winner);
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'breaker', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const purse = app.repos.bases.findById(baseId)!.economy;
  // A Colossus is only fielded by a legendary name (`NOTORIETY_TO_FIELD`).
  app.repos.bases.updateEconomy(baseId, {
    ...purse,
    infamy: DECLARE_INFAMY_COST * 8,
    notoriety: NOTORIETY_TO_FIELD.legendary,
  });
  app.repos.city.markScouted(baseId, 'steelbelt', new Date().toISOString());
  for (const locationId of RUSTYARD_LOCATIONS) app.repos.city.control(locationId);

  app.repos.users.insert({
    id: 'rival-user',
    username: 'Rival',
    passwordHash: 'x',
    createdAt: new Date().toISOString(),
  });
  const mine = app.repos.bases.findById(baseId)!;
  const rivalId = 'rival-base';
  app.repos.bases.insert({
    ...mine,
    id: rivalId,
    ownerId: 'rival-user',
    name: 'The Other Crew',
    districtId: 'steelbelt',
    army: { razors: 10 },
    commanders: [],
    inventory: {},
    buildings: [
      ...mine.buildings.filter((one) => one.kind !== 'gate'),
      ...(homeGate > 0 ? [gateBuilding(homeGate)] : []),
    ],
    buildQueue: [],
  });

  return { app, db, token, baseId, rivalId, engine };
}

/** Hands the rival every location in the Rustyard, so the district gate stands over the fight. */
function rivalHoldsTheDistrict(stack: Stack, gateLevel: number): void {
  for (const locationId of RUSTYARD_LOCATIONS) {
    const control = stack.app.repos.city.control(locationId)!;
    stack.app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: stack.rivalId },
      garrison: {},
    });
  }
  stack.app.repos.capturedGates.put(districtGate(gateLevel));
}

/** Hands the rival the one location the looters were on, so the fight is theirs to defend. */
function rivalHoldsTheLocation(stack: Stack): void {
  const control = stack.app.repos.city.control(SQUATTED)!;
  stack.app.repos.city.put({
    ...control,
    holder: { kind: 'crew', baseId: stack.rivalId },
    garrison: { razors: 2 },
  });
}

async function declare(stack: Stack, target: BattleTarget): Promise<string> {
  const res = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  const coming = res.json<BattleMutationResponse>().battles.coming;
  return coming[coming.length - 1]!.battle.id;
}

async function deploy(stack: Stack, battleId: string, army: Record<string, number>) {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateArmy(base.id, army, base.trainingQueue);
  const res = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId, changes: army, perimeterChanges: {} },
  });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
}

/** Lands the column and winds the mark back, then settles. Returns the one resolved fight. */
function settle(stack: Stack, battleId: string) {
  const at = new Date(Date.now() - 1000);
  stack.db
    .prepare('UPDATE troop_movements SET departed_at = ?, arrives_at = ? WHERE battle_id = ?')
    .run(new Date(at.getTime() - 60_000).toISOString(), at.toISOString(), battleId);
  settleMovements(stack.app.repos, new Date());
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(at.toISOString(), battleId);
  const resolved = settleBattles(stack.app.repos, stack.engine, new Date());
  expect(resolved).toHaveLength(1);
  return resolved[0]!;
}

const homeGateOf = (stack: Stack): number =>
  stack.app.repos.bases.findById(stack.rivalId)!.buildings.find((one) => one.kind === 'gate')
    ?.level ?? 0;

const districtGateOf = (stack: Stack): number =>
  stack.app.repos.capturedGates.find('steelbelt')?.level ?? 0;

const levelsBroken = (stack: Stack): number =>
  stack.app.repos.feats.tallies(stack.baseId)[featMeasureKey('gate_levels_broken')] ?? 0;

const WITH_COLOSSUS = { razors: 6, [COLOSSUS]: 1 };
const WITHOUT = { razors: 6 };

describe('a Colossus at the gate', () => {
  async function fightAtTheDistrictGate(
    winner: 'attacker' | 'defender',
    army: Record<string, number>,
    gates: { home: number; district: number },
  ) {
    const stack = await makeStack(winner, gates.home);
    rivalHoldsTheDistrict(stack, gates.district);
    const battleId = await declare(stack, DISTRICT_GATE);
    await deploy(stack, battleId, army);
    const resolved = settle(stack, battleId);
    return { stack, resolved };
  }

  /*
   * Only the gate the fight is at (maintainer, 2026-09-28: "A gate bonus only counts when fighting
   * at that gate"). The defender's home Gate is in another district and was never in this fight,
   * so it keeps its level; it used to come down with the district's.
   */
  it.each(['attacker', 'defender'] as const)(
    'takes a level off the district gate, and only that one, when the %s wins',
    async (winner) => {
      const { stack, resolved } = await fightAtTheDistrictGate(winner, WITH_COLOSSUS, {
        home: 4,
        district: 6,
      });
      expect(homeGateOf(stack)).toBe(4);
      expect(districtGateOf(stack)).toBe(5);
      // The level counts towards the Breaker feats, for the crew that called the fight.
      expect(levelsBroken(stack)).toBe(1);
      expect(resolved.analysis.log).not.toContain(
        'The Gate came down a level under the Colossus, from 4 to 3.',
      );
      expect(resolved.analysis.log).toContain(
        'The district gate came down a level under the Colossus, from 6 to 5.',
      );
    },
  );

  it('leaves both gates standing when no Colossus came', async () => {
    const { stack, resolved } = await fightAtTheDistrictGate('defender', WITHOUT, {
      home: 4,
      district: 6,
    });
    expect(homeGateOf(stack)).toBe(4);
    expect(districtGateOf(stack)).toBe(6);
    expect(levelsBroken(stack)).toBe(0);
    expect(resolved.analysis.log.join('\n')).not.toContain('Colossus');
  });

  it('leaves a gate at level one where it is, and says nothing about it', async () => {
    const { stack, resolved } = await fightAtTheDistrictGate('defender', WITH_COLOSSUS, {
      home: 1,
      district: 1,
    });
    expect(homeGateOf(stack)).toBe(1);
    expect(districtGateOf(stack)).toBe(1);
    expect(levelsBroken(stack)).toBe(0);
    expect(resolved.analysis.log.join('\n')).not.toContain('came down a level');
  });
});

describe('a Colossus walking into a trap', () => {
  async function trappedFight(army: Record<string, number>) {
    const stack = await makeStack('defender', 3);
    rivalHoldsTheLocation(stack);
    const battleId = await declare(stack, LOCATION);
    const rival = stack.app.repos.bases.findById(stack.rivalId)!;
    stack.app.repos.bases.updateHoldings(stack.rivalId, rival.resources, { [TRAP_ITEM]: 2 });
    // What `/battles/trap` writes, set straight on the row: the rival has no session to call it.
    stack.app.repos.sieges.putDeployment({
      ...emptyDeployment(battleId, stack.rivalId, 'defender', new Date().toISOString()),
      trapId: TRAP.id,
    });
    await deploy(stack, battleId, army);
    const resolved = settle(stack, battleId);
    const sent = Object.values(stack.engine.seen[0]?.attacking ?? {}).reduce((a, b) => a + b, 0);
    const held = stack.app.repos.bases.findById(stack.rivalId)!.inventory[TRAP_ITEM] ?? 0;
    return { stack, resolved, sent, held };
  }

  it('spends the trap and takes nobody', async () => {
    const { resolved, sent, held } = await trappedFight({ razors: 30, [COLOSSUS]: 1 });
    expect(held, 'the trap was not spent').toBe(1);
    expect(sent, 'the trap bit a column with a Colossus in it').toBe(31);
    expect(resolved.analysis.trap).toEqual({ name: TRAP.name, killed: 0 });
    expect(resolved.analysis.log).toContain(`The Colossus walked through the ${TRAP.name}.`);
  });

  it('bites the same column without the Colossus', async () => {
    const { sent, held } = await trappedFight({ razors: 30 });
    expect(held).toBe(1);
    expect(sent, 'the control trap did not bite').toBeLessThan(30);
  });

  // A location fight has no gate in it (maintainer, 2026-09-28), so the home Gate a district away
  // is not what the Colossus walked through. It used to come down a level for it.
  it('leaves the home Gate of a crew defending a location away from it alone', async () => {
    const { stack, resolved } = await trappedFight({ razors: 30, [COLOSSUS]: 1 });
    expect(homeGateOf(stack)).toBe(3);
    expect(resolved.analysis.log.join('\n')).not.toContain('came down a level');
  });
});
