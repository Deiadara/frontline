import {
  SCOUTING_RESEARCH_ID,
  SPY_GATE_POINTS_PER_LEVEL,
  armySize,
  counterScore,
  createCommander,
  makeAttributes,
  type BattlesResponse,
  type Building,
  type SpyRun,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { groundBehind, writeSpyReport } from '../spying/spying.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * §B7: the Gate is half of what a spy has to see past (2026-09-22).
 *
 * This file used to measure the Gate through the deployment screen's blurred count, which is
 * gone: nothing about the other side is free now, and what the board shows is the caller's last
 * spy report on the ground. So the Gate is measured where it lives, in the counter score of a
 * job on the resident's door, and the board is measured on whether it prints the report.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  // Both crews are the same person: a signature perk on one side only would land in the
  // difference below as if it were the Gate.
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  return { token, baseId };
}

interface Looked {
  app: FastifyInstance;
  attacker: { token: string; baseId: string };
  defender: { token: string; baseId: string };
  districtId: string;
  counter: number;
  seen: number;
}

/** The attacker's spies on the defender's front door, with the Gate at `level`. */
async function lookedThroughGate(level: number, fittings: readonly string[] = []): Promise<Looked> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const attacker = await register(app, 'attacker');
  const defender = await register(app, 'defender');
  const theirs = app.repos.bases.findById(defender.baseId)!;

  const without = theirs.buildings.filter((building) => building.kind !== 'gate');
  const buildings: Building[] =
    level <= 0
      ? without
      : [...without, { id: 'gate-under-test', kind: 'gate', level, modifications: [] }];
  app.repos.bases.updateBuildings(defender.baseId, buildings);
  // At the door (2026-09-22): a call on the gate is met by the gate garrison, and so is a spy.
  app.repos.bases.updateGateArmy(defender.baseId, { razors: 57 });
  if (fittings.length > 0) {
    app.repos.bases.updateUnitLoadouts(defender.baseId, { razors: [...fittings] });
  }

  // A middling chair and the rung, so there is a budget to spend and a Gate can eat into it.
  const mine = app.repos.bases.findById(attacker.baseId)!;
  app.repos.bases.updateCommanders(attacker.baseId, [
    ...mine.commanders,
    createCommander('spy', 'Wire', 'master_of_whispers', makeAttributes(55), []),
  ]);
  app.repos.bases.updateResearch(attacker.baseId, {
    ...mine.research,
    technologies: [...mine.research.technologies, SCOUTING_RESEARCH_ID],
  });
  app.repos.city.markScouted(attacker.baseId, theirs.districtId, new Date().toISOString());

  const reader = app.repos.bases.findById(attacker.baseId)!;
  const target = { kind: 'gate', districtId: theirs.districtId } as const;
  const looked = groundBehind(app.repos, reader, target);
  if (looked.kind !== 'ground') throw new Error(`fixture: refused ${looked.reason}`);
  const run: SpyRun = {
    id: `run-${level}-${fittings.join('-')}`,
    baseId: attacker.baseId,
    target,
    tier: 'paid_whisper',
    capsPaid: 500,
    departedAt: new Date().toISOString(),
    returnsAt: new Date().toISOString(),
    travelMinutes: 0,
    recalledAt: null,
  };
  const report = writeSpyReport(app.repos, reader, run, new Date());
  return {
    app,
    attacker,
    defender,
    districtId: theirs.districtId,
    counter: counterScore(looked.ground.counter),
    seen: armySize(report.exposed),
  };
}

describe('a Gate standing behind the door', () => {
  it('costs a spy exactly its level in points, and reads fewer bodies for it', async () => {
    const open = await lookedThroughGate(0);
    expect(open.seen, 'the spies could not read an undefended door').toBeGreaterThan(0);

    const walled = await lookedThroughGate(20);
    expect(walled.counter - open.counter).toBe(20 * SPY_GATE_POINTS_PER_LEVEL);
    expect(walled.seen, 'a maxed Gate did nothing for the count it was built to hide').toBeLessThan(
      open.seen,
    );
  });
});

describe('what the squad is wearing', () => {
  it('hides a garrison by the cards actually bolted to it', async () => {
    const bare = await lookedThroughGate(0);
    const hidden = await lookedThroughGate(0, ['ghost_protocol']);

    expect(hidden.seen, 'a squad in Ghost Protocol read as clearly as one in nothing').toBeLessThan(
      bare.seen,
    );
  });
});

describe('the board', () => {
  it('prints the last report on the ground, and nothing without one', async () => {
    const { app, attacker, defender, districtId } = await lookedThroughGate(0);
    const purse = app.repos.bases.findById(attacker.baseId)!.economy;
    app.repos.bases.updateEconomy(attacker.baseId, { ...purse, infamy: 9999 });

    const slots = (
      await app.inject({ method: 'GET', url: '/api/battles', headers: auth(attacker.token) })
    ).json<BattlesResponse>().slots;
    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(attacker.token),
      payload: { target: { kind: 'gate', districtId }, scheduledFor: slots[0] },
    });
    expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);

    const before = (
      await app.inject({ method: 'GET', url: '/api/battles', headers: auth(attacker.token) })
    ).json<BattlesResponse>().coming[0]!;
    expect(before.enemySize).toBeNull();

    const reader = app.repos.bases.findById(attacker.baseId)!;
    const report = writeSpyReport(
      app.repos,
      reader,
      {
        id: 'run-board',
        baseId: attacker.baseId,
        target: { kind: 'gate', districtId },
        tier: 'paid_whisper',
        capsPaid: 500,
        departedAt: new Date().toISOString(),
        returnsAt: new Date().toISOString(),
        travelMinutes: 0,
        recalledAt: null,
      },
      new Date(),
    );
    app.repos.spying.insertReport(report);

    const after = (
      await app.inject({ method: 'GET', url: '/api/battles', headers: auth(attacker.token) })
    ).json<BattlesResponse>().coming[0]!;
    expect(after.enemySize).toBe(armySize(report.exposed));
    expect(after.enemyIntel).toMatch(/spy report/);

    // The defender reads nothing of the column coming at them: nobody spies a road.
    const theirs = (
      await app.inject({ method: 'GET', url: '/api/battles', headers: auth(defender.token) })
    ).json<BattlesResponse>().coming[0]!;
    expect(theirs.enemySize).toBeNull();
  });
});
