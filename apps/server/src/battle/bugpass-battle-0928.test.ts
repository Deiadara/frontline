import {
  DECLARE_INFAMY_COST,
  declarationWindow,
  findDistrict,
  raidDisruptionPercent,
  skirmishOutcome,
  startingHolder,
  type Army,
  type BattleTarget,
  type ActionsResponse,
  type BattlesResponse,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { armTheAttack } from '../testing/attack.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMoves } from '../moves/moves.js';
import { settleBattles } from './resolve.js';
import { chooseOverseer } from '../testing/overseer.js';
import { everybodyHome } from '../testing/walk.js';

/**
 * Battle, city and movement fixes from the bug pass of 2026-09-28, each pinned by what a player
 * would see: whose units are left standing, and what the board tells the other side.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface Crew {
  token: string;
  baseId: string;
}

/** A plot of the Belt somebody holds at the start, so the district is open to a location call. */
const SQUATTED: string = (() => {
  const district = findDistrict('steelbelt');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Belt has nobody on it at all');
  return held.id;
})();

/** What the defending line was handed at the mark, by the engine that was asked to fight it. */
interface Seen {
  defending: Army | null;
}

async function world(winner: 'attacker' | 'defender') {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const seen: Seen = { defending: null };
  // Decided by hand and nobody dies, so the only thing that can move a unit is the settle.
  const engine: SkirmishEngine = {
    resolve: (input) => {
      seen.defending = input.defending;
      return skirmishOutcome({ winner, log: [input.locationName] });
    },
  };
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });
  for (const location of findDistrict('steelbelt')?.locations ?? [])
    app.repos.city.control(location.id);
  const ramp = app.repos.city.control('steelbelt-ramp')!;
  app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });
  return { app, db, engine, seen };
}

async function register(app: FastifyInstance, username: string, army: Army): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const body = registered.json<{ token: string }>();
  const chosen = await chooseOverseer(app, body.token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 8 });
  app.repos.bases.updateArmy(baseId, army, []);
  return { token: body.token, baseId };
}

async function declare(app: FastifyInstance, crew: Crew, target: BattleTarget): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
  const battleId = app.repos.sieges.pending().at(-1)?.id;
  if (!battleId) throw new Error('fixture: no battle');
  return battleId;
}

/** Puts the mark a minute in the past. */
function markPassed(db: AppDatabase, battleId: string): Date {
  const mark = new Date(Date.now() - 60_000);
  db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
    mark.toISOString(),
    battleId,
  );
  return mark;
}

describe('a home raided and lost', () => {
  it('keeps the porters, who never stood in the line', async () => {
    const { app, db, engine } = await world('attacker');
    const raider = await register(app, 'raider', { razors: 20 });
    const resident = await register(app, 'resident', { razors: 6, scavengers: 10, haulers: 4 });
    const HOME = 'ashen-terraces';
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, resident.baseId);
    app.repos.sieges.breakGate(HOME, new Date(Date.now() + 24 * 3_600_000).toISOString());
    const battleId = await declare(app, raider, { kind: 'district', districtId: HOME });

    markPassed(db, battleId);
    expect(settleBattles(app.repos, engine, new Date())).toHaveLength(1);

    const army = app.repos.bases.findById(resident.baseId)!.army;
    expect(army.scavengers).toBe(10);
    expect(army.haulers).toBe(4);
  });

  it('is disrupted by what the line lost, not diluted by the porters behind it', async () => {
    const { app, db } = await world('attacker');
    const everyRazor: SkirmishEngine = {
      resolve: (input) =>
        skirmishOutcome({ winner: 'attacker', killed: { razors: 6 }, log: [input.locationName] }),
    };
    const raider = await register(app, 'raider', { razors: 20 });
    const resident = await register(app, 'resident', { razors: 6, scavengers: 30 });
    const HOME = 'ashen-terraces';
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, resident.baseId);
    app.repos.sieges.breakGate(HOME, new Date(Date.now() + 24 * 3_600_000).toISOString());
    const battleId = await declare(app, raider, { kind: 'district', districtId: HOME });

    markPassed(db, battleId);
    expect(settleBattles(app.repos, everyRazor, new Date())).toHaveLength(1);

    // Every one of the six in the line died: the whole defence was lost.
    const disruption = app.repos.bases.findById(resident.baseId)!.economy.disruption;
    expect(disruption.percent).toBe(raidDisruptionPercent(1));
  });
});

describe('an attack turned back', () => {
  it('brings home porters that were sent while they could fight and are out of the line now', async () => {
    const { app, db, engine } = await world('defender');
    const caller = await register(app, 'caller', {});
    const battleId = await declare(app, caller, {
      kind: 'location',
      districtId: 'steelbelt',
      locationId: SQUATTED,
    });
    // Sent while the crew held the Fight Pit (`carriers_fight`), which it no longer does.
    const row = app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    app.repos.sieges.putDeployment({ ...row, army: { razors: 4, scavengers: 3 } });

    markPassed(db, battleId);
    expect(settleBattles(app.repos, engine, new Date())).toHaveLength(1);
    everybodyHome(app.repos);

    expect(app.repos.bases.findById(caller.baseId)!.army.scavengers).toBe(3);
  });
});

describe('a column that reaches a garrison after the mark', () => {
  it('is not in the fight, and lands on what the fight left', async () => {
    const { app, db, engine, seen } = await world('defender');
    const caller = await register(app, 'caller', { razors: 20 });
    const holder = await register(app, 'holder', { razors: 20 });
    const control = app.repos.city.control(SQUATTED)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: holder.baseId },
      garrison: { razors: 5 },
    });
    const battleId = await declare(app, caller, {
      kind: 'location',
      districtId: 'steelbelt',
      locationId: SQUATTED,
    });
    const mark = markPassed(db, battleId);

    // Eight more Razors on the road to the plot, due thirty seconds after the mark.
    app.repos.bases.updateArmy(holder.baseId, { razors: 12 }, []);
    app.repos.moves.insert({
      id: 'late-column',
      baseId: holder.baseId,
      from: { kind: 'district' },
      to: { kind: 'location', locationId: SQUATTED },
      army: { razors: 8 },
      vehicles: {},
      departedAt: new Date(mark.getTime() - 600_000).toISOString(),
      arrivesAt: new Date(mark.getTime() + 30_000).toISOString(),
      travelMinutes: 10,
      recalledAt: null,
    });

    // The order `settleWorld` runs them in: the columns first, then the fights.
    const now = new Date();
    settleMoves(app.repos, now);
    settleBattles(app.repos, engine, now);
    expect(seen.defending).toEqual({ razors: 5 });

    // The next tick lands them on the ground the defence held.
    settleMoves(app.repos, new Date());
    expect(app.repos.city.control(SQUATTED)!.garrison).toEqual({ razors: 13 });
  });
});

describe('a Sleeper cell woken into a call', () => {
  it('is on the attacker’s board and nobody else’s', async () => {
    const { app } = await world('attacker');
    const caller = await register(app, 'caller', { razors: 20 });
    const holder = await register(app, 'holder', { razors: 20 });
    const control = app.repos.city.control(SQUATTED)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: holder.baseId },
      garrison: { razors: 5 },
    });
    const at = new Date().toISOString();
    app.repos.sleepers.insert({
      id: 'cell',
      baseId: caller.baseId,
      locationId: SQUATTED,
      army: { sleepers: 3 },
      phase: 'waiting',
      departedAt: at,
      arrivesAt: at,
      travelMs: 60_000,
    });
    await declare(app, caller, { kind: 'location', districtId: 'steelbelt', locationId: SQUATTED });

    const woke = async (crew: Crew) => {
      const board = await app.inject({
        method: 'GET',
        url: '/api/battles',
        headers: auth(crew.token),
      });
      return board.json<BattlesResponse>().coming[0]!.battle.wokeSleepers;
    };
    expect(await woke(caller)).toBe(true);
    expect(await woke(holder)).toBe(false);
  });
});

/*
 * Bug pass, 2026-10-02: the Monitor offered "Pull them out" on a cell its fight's last hour holds,
 * and the recall refused it. The row says it is held instead.
 */
describe('a cell waiting on ground a fight is about to land on', () => {
  it('is marked held on the Monitor inside the last hour, and not before', async () => {
    const { app, db } = await world('attacker');
    const caller = await register(app, 'caller2', { razors: 20 });
    const holder = await register(app, 'holder2', { razors: 20 });
    const bystander = await register(app, 'bystander2', { razors: 5 });
    const control = app.repos.city.control(SQUATTED)!;
    app.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: holder.baseId },
      garrison: { razors: 5 },
    });
    const at = new Date().toISOString();
    app.repos.sleepers.insert({
      id: 'watching',
      baseId: bystander.baseId,
      locationId: SQUATTED,
      army: { sleepers: 2 },
      phase: 'waiting',
      departedAt: at,
      arrivesAt: at,
      travelMs: 60_000,
    });
    const battleId = await declare(app, caller, {
      kind: 'location',
      districtId: 'steelbelt',
      locationId: SQUATTED,
    });
    // The attack's least commitment, or the lock calls it off (2026-10-05).
    armTheAttack(app.repos, battleId, caller.baseId);

    const cell = async () =>
      (await app.inject({ method: 'GET', url: '/api/actions', headers: auth(bystander.token) }))
        .json<ActionsResponse>()
        .sleepers.find((one) => one.cellId === 'watching');
    expect((await cell())?.locked).toBe(false);

    db.prepare('UPDATE scheduled_battles SET scheduled_for = ?').run(
      new Date(Date.now() + 20 * 60_000).toISOString(),
    );
    expect((await cell())?.locked).toBe(true);
  });
});
