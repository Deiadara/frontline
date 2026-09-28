import {
  DECLARE_INFAMY_COST,
  MISC_AREA_ID,
  createCommander,
  declarationWindow,
  findDistrict,
  missionBoardKey,
  missionOffers,
  startingHolder,
  type Army,
  type BattleTarget,
  type DeployQuoteResponse,
  type MovePlace,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { plantSleepers } from '../city/sleepers.js';
import { moveMinutes, sendMove, settleMoves } from '../moves/moves.js';
import { chooseOverseer } from '../testing/overseer.js';
import { settleMovements } from './movement.js';

/**
 * The last hour before a fight, over everything leaving the place of it, and nothing that moves
 * without walking (maintainer, 2026-09-28): "the garrison locks in the last hour before a fight so
 * nothing can be pulled out, and any unit that is there fights", and "Nothing sends units
 * immediately, you need to move them".
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
  userId: string;
  baseId: string;
}

const PLOT: string = (() => {
  const district = findDistrict('steelbelt');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Belt has nobody on it at all');
  return held.id;
})();
const ON_PLOT: BattleTarget = { kind: 'location', districtId: 'steelbelt', locationId: PLOT };

async function makeWorld() {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  for (const location of findDistrict('steelbelt')?.locations ?? []) {
    app.repos.city.control(location.id);
  }
  const ramp = app.repos.city.control('steelbelt-ramp')!;
  app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });
  return { app, db };
}

async function register(app: FastifyInstance, username: string, army: Army): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const body = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await chooseOverseer(app, body.token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 8 });
  app.repos.bases.updateArmy(baseId, army, []);
  app.repos.city.markScouted(baseId, 'steelbelt', new Date().toISOString());
  return { token: body.token, userId: body.user.id, baseId };
}

/**
 * A fight on `target`, `minutesOut` from now, written straight onto the table: the lock reads the
 * calendar and nothing else, and a raid through a breach needs a lot of world to call honestly.
 */
function fightOn(
  app: FastifyInstance,
  attacker: Crew,
  target: BattleTarget,
  minutesOut: number,
): string {
  const id = `fight-${target.kind}-${minutesOut}`;
  app.repos.sieges.insert({
    id,
    target,
    attackerBaseId: attacker.baseId,
    defender: { kind: 'unoccupied' },
    scheduledFor: new Date(Date.now() + minutesOut * 60_000).toISOString(),
    declaredAt: new Date().toISOString(),
    resolvedAt: null,
    seed: 'seed',
    holdAfterCapture: true,
    wokeSleepers: false,
  });
  return id;
}

const districtOf = (app: FastifyInstance, crew: Crew) =>
  app.repos.bases.findById(crew.baseId)!.districtId;

function move(app: FastifyInstance, crew: Crew, from: MovePlace, to: MovePlace, army: Army) {
  return sendMove(app.repos, {
    base: app.repos.bases.findById(crew.baseId)!,
    from,
    to,
    army,
    vehicles: {},
    now: new Date(),
  });
}

function landEveryMove(app: FastifyInstance, db: AppDatabase): void {
  db.prepare('UPDATE unit_moves SET returns_at = ?').run(
    new Date(Date.now() - 1_000).toISOString(),
  );
  settleMoves(app.repos, new Date());
}

async function declare(app: FastifyInstance, crew: Crew): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: {
      target: ON_PLOT,
      scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
    },
  });
  expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
  return app.repos.sieges.pending().find((battle) => battle.attackerBaseId === crew.baseId)!.id;
}

const deploy = (app: FastifyInstance, crew: Crew, battleId: string, changes: Army) =>
  app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(crew.token),
    payload: { battleId, changes, perimeterChanges: {} },
  });

describe('the gate and the district are held by their own fights', () => {
  it('keeps the gate garrison at the gate in the last hour before a call on it', async () => {
    const { app } = await makeWorld();
    const home = await register(app, 'home', { razors: 6 });
    const caller = await register(app, 'caller', {});
    const base = app.repos.bases.findById(home.baseId)!;
    app.repos.bases.updateGateArmy(base.id, { razors: 4 });
    fightOn(app, caller, { kind: 'gate', districtId: districtOf(app, home) }, 30);

    expect(move(app, home, { kind: 'gate' }, { kind: 'district' }, { razors: 1 })).toEqual({
      kind: 'refused',
      reason: 'garrison_locked',
    });
    // Arrivals are welcome to the last second, and the district is not the gate.
    expect(move(app, home, { kind: 'district' }, { kind: 'gate' }, { razors: 2 }).kind).toBe(
      'sent',
    );
  });

  it('keeps the district army home in the last hour before a raid, and not before', async () => {
    const { app } = await makeWorld();
    const home = await register(app, 'home', { razors: 6 });
    const caller = await register(app, 'caller', {});
    const raid = { kind: 'district' as const, districtId: districtOf(app, home) };
    const early = fightOn(app, caller, raid, 5 * 60);

    expect(move(app, home, { kind: 'district' }, { kind: 'gate' }, { razors: 1 }).kind).toBe(
      'sent',
    );
    app.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() + 30 * 60_000).toISOString(), early);
    expect(move(app, home, { kind: 'district' }, { kind: 'gate' }, { razors: 1 })).toEqual({
      kind: 'refused',
      reason: 'garrison_locked',
    });
  });

  it('keeps Sleepers at home in the last hour before a raid', async () => {
    const { app } = await makeWorld();
    const home = await register(app, 'home', { sleepers: 4 });
    const caller = await register(app, 'caller', {});
    fightOn(app, caller, { kind: 'district', districtId: districtOf(app, home) }, 30);
    const planted = plantSleepers(app.repos, {
      base: app.repos.bases.findById(home.baseId)!,
      locationId: PLOT,
      army: { sleepers: 2 },
      now: new Date(),
    });
    expect(planted).toEqual({ kind: 'refused', reason: 'garrison_locked' });
  });

  it('keeps a party at home in the last hour before a raid', async () => {
    const { app } = await makeWorld();
    const home = await register(app, 'home', { razors: 6 });
    const caller = await register(app, 'caller', {});
    // Seated: the bench leads nothing (maintainer, 2026-09-28).
    app.repos.bases.updateCommanders(home.baseId, [
      createCommander('off-1', 'Halvard Nyx', 'field_commander'),
    ]);
    const job = missionOffers(MISC_AREA_ID, missionBoardKey(MISC_AREA_ID, new Date()), 1).find(
      (offer) => offer.template.kind === 'standard',
    );
    if (!job) throw new Error('the misc board offers no plain job today');
    const launch = () =>
      app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(home.token),
        payload: {
          templateId: job.template.id,
          areaId: MISC_AREA_ID,
          force: { razors: 1 },
          leaderId: 'off-1',
        },
      });

    const raid = fightOn(app, caller, { kind: 'district', districtId: districtOf(app, home) }, 30);
    const refused = await launch();
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('within the hour');

    // The control: the same party goes once the raid is further off.
    app.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(new Date(Date.now() + 5 * 3_600_000).toISOString(), raid);
    const sent = await launch();
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
  });
});

describe('a deployment in the last hour', () => {
  it('lets nobody be pulled back out of the fight, and still takes arrivals', async () => {
    const { app, db } = await makeWorld();
    const caller = await register(app, 'caller', { razors: 10 });
    const battleId = await declare(app, caller);
    expect((await deploy(app, caller, battleId, { razors: 4 })).statusCode).toBe(200);
    db.prepare('UPDATE troop_movements SET arrives_at = ? WHERE battle_id = ?').run(
      new Date(Date.now() - 1_000).toISOString(),
      battleId,
    );
    settleMovements(app.repos, new Date());

    // Pulled back freely before the last hour: and they walk home.
    expect((await deploy(app, caller, battleId, { razors: -1 })).statusCode).toBe(200);
    expect(app.repos.moves.activeFor(caller.baseId)[0]?.army).toEqual({ razors: 1 });

    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
      new Date(Date.now() + 30 * 60_000).toISOString(),
      battleId,
    );
    const refused = await deploy(app, caller, battleId, { razors: -1 });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('within the hour');
    expect(app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)?.army).toEqual({
      razors: 3,
    });
    expect((await deploy(app, caller, battleId, { razors: 2 })).statusCode).toBe(200);
  });

  it('sends nobody from home to another fight while a raid on home is in its last hour', async () => {
    const { app } = await makeWorld();
    const caller = await register(app, 'caller', { razors: 10 });
    const raider = await register(app, 'raider', {});
    const battleId = await declare(app, caller);
    const raid = fightOn(
      app,
      raider,
      { kind: 'district', districtId: districtOf(app, caller) },
      30,
    );

    const refused = await deploy(app, caller, battleId, { razors: 2 });
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('within the hour');
    // Turning out onto the raid's own ground is not leaving it.
    expect((await deploy(app, caller, raid, { razors: 2 })).statusCode).toBe(200);
  });
});

describe('nothing arrives or leaves in an instant', () => {
  it('walks a column home from ground that will no longer have it', async () => {
    const { app, db } = await makeWorld();
    const walker = await register(app, 'walker', { razors: 6 });
    const stranger = await register(app, 'stranger', {});
    expect(
      move(
        app,
        walker,
        { kind: 'district' },
        { kind: 'location', locationId: 'steelbelt-ramp' },
        { razors: 3 },
      ).kind,
    ).toBe('sent');
    // Somebody else takes the lot while they walk.
    const ramp = app.repos.city.control('steelbelt-ramp')!;
    app.repos.city.put({ ...ramp, holder: { kind: 'crew', baseId: stranger.baseId } });

    landEveryMove(app, db);
    expect(app.repos.bases.findById(walker.baseId)!.army, 'home in an instant').toEqual({
      razors: 3,
    });
    const [back] = app.repos.moves.activeFor(walker.baseId);
    expect(back?.from).toEqual({ kind: 'location', locationId: 'steelbelt-ramp' });
    expect(Date.parse(back!.arrivesAt)).toBeGreaterThan(Date.now());
    landEveryMove(app, db);
    expect(app.repos.bases.findById(walker.baseId)!.army).toEqual({ razors: 6 });
  });

  it('never sends a column to the streets, and never from them', async () => {
    const { app } = await makeWorld();
    const crew = await register(app, 'crew', { razors: 6 });
    const street: MovePlace = { kind: 'street', districtId: 'steelbelt' };
    expect(move(app, crew, { kind: 'district' }, street, { razors: 1 })).toEqual({
      kind: 'refused',
      reason: 'no_road',
    });
    expect(move(app, crew, street, { kind: 'district' }, { razors: 1 })).toEqual({
      kind: 'refused',
      reason: 'not_yours',
    });
  });

  it('prices the walk home from the streets of another district as the road and the door', async () => {
    const { app } = await makeWorld();
    const crew = await register(app, 'crew', { razors: 6 });
    const base = app.repos.bases.findById(crew.baseId)!;
    const riding = { army: { razors: 2 }, vehicles: {} };
    const home: MovePlace = { kind: 'district' };
    const fromStreets = moveMinutes(
      app.repos,
      base,
      { kind: 'street', districtId: 'steelbelt' },
      home,
      riding,
    );
    const fromPlot = moveMinutes(
      app.repos,
      base,
      { kind: 'location', locationId: PLOT },
      home,
      riding,
    );
    const fromGate = moveMinutes(app.repos, base, { kind: 'gate' }, home, riding);
    expect(base.districtId).not.toBe('steelbelt');
    // The same road as from any plot there, and more than the door on its own.
    expect(fromStreets).toBe(fromPlot);
    expect(fromStreets!).toBeGreaterThan(fromGate!);
  });

  it('walks a column turned round back the way it came', async () => {
    const { app } = await makeWorld();
    const caller = await register(app, 'caller', { razors: 10 });
    const battleId = await declare(app, caller);
    expect((await deploy(app, caller, battleId, { razors: 4 })).statusCode).toBe(200);
    const column = app.repos.movements.forBattle(battleId)[0]!;
    const recalled = await app.inject({
      method: 'POST',
      url: '/api/actions/recall',
      headers: auth(caller.token),
      payload: { movementId: column.id },
    });
    expect(recalled.statusCode, recalled.body.slice(0, 300)).toBe(200);
    expect(app.repos.bases.findById(caller.baseId)!.army.razors).toBe(6);
    const [back] = app.repos.moves.activeFor(caller.baseId);
    expect(back?.army).toEqual({ razors: 4 });
    expect(back?.to).toEqual({ kind: 'district' });
  });
});

describe('the deploy quote says whether a column makes the mark', () => {
  it('answers in time for a mark hours out, and late for one a minute away', async () => {
    const { app, db } = await makeWorld();
    const caller = await register(app, 'caller', { razors: 10 });
    const battleId = await declare(app, caller);
    const quote = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/battles/deploy/quote',
        headers: auth(caller.token),
        payload: { battleId, changes: { razors: 2 }, perimeterChanges: {} },
      });
      expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
      return res.json<DeployQuoteResponse>();
    };

    const early = await quote();
    expect(early.minutes).toBeGreaterThan(1);
    expect(early.inTime).toBe(true);
    // The same sum the send makes: now plus the whole minutes of the road.
    expect(
      Math.abs(Date.parse(early.arrivesAt) - (Date.now() + early.minutes * 60_000)),
    ).toBeLessThan(5_000);

    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
      new Date(Date.now() + 60_000).toISOString(),
      battleId,
    );
    const late = await quote();
    expect(late.inTime).toBe(false);
    expect(Date.parse(late.arrivesAt)).toBeGreaterThan(Date.now() + 60_000);
  });
});
