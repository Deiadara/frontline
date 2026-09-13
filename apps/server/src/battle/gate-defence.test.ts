/**
 * The Gate is worth what the Gate is worth, once.
 *
 * Two separate fixes put the same structure into the same channel and neither knew about the
 * other. `withGate` in `battle/resolve.ts` was written when `districtDefense` was "computed and
 * read by nothing", and it adds that **rating** straight into `defensePercent`. §B7 then added
 * `gateDefensePercent`, a real percentage per level, into `standingEffectsFor` on the same grounds
 * ("the percentage existed, had tests, and never reached `battle/effects.ts`"). Both are live, so a
 * defending crew carried its Gate twice: 2.5 points a level from one and 6 a level from the other,
 * with the `defense_percent` modifications counted once as points and again as a multiplier inside
 * the rating.
 *
 * The two are not even the same quantity. `districtDefense` is the flat "what a raider has to beat"
 * figure the structure dialog prints with no percent sign on it (`features/base/bonus.ts`);
 * `gateDefensePercent` is the percentage the fight is meant to read, and it is the one the battle
 * page quotes back to the player (`battle/view.ts`).
 *
 * Measured on the slope rather than on one absolute number: raising the Gate by four levels must
 * move the defender's `defensePercent` by exactly what four levels of `gateDefensePercent` are
 * worth. An absolute assertion would have to restate the whole fold (the crew's Strategy, the
 * ground, the table) and would go green the moment any of those moved.
 */
import {
  GATE_DEFENSE_PERCENT_PER_LEVEL,
  declarationWindow,
  gateDefensePercent,
  skirmishOutcome,
  type BattleTarget,
  type BattlesResponse,
  type Building,
  type SkirmishEngine,
  type SkirmishInput,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBattles } from './resolve.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** The plot the victim is moved onto: a crew cannot raid the district it lives in. */
const HOME = 'ashen-terraces';
const GATE: BattleTarget = { kind: 'gate', districtId: HOME };

/** Records what the engine was asked to resolve. Who wins is not what this file is about. */
function spy(): { engine: SkirmishEngine; seen: SkirmishInput[] } {
  const seen: SkirmishInput[] = [];
  return {
    seen,
    engine: {
      resolve: (input) => {
        seen.push(input);
        return skirmishOutcome({ winner: 'attacker', log: ['decided'] });
      },
    },
  };
}

interface World {
  app: FastifyInstance;
  db: AppDatabase;
  raiderToken: string;
  victimBaseId: string;
  seen: SkirmishInput[];
}

async function register(
  app: FastifyInstance,
  username: string,
): Promise<{ token: string; baseId: string }> {
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
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  return { token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

async function makeWorld(): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const { engine, seen } = spy();
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const raider = await register(app, 'raider');
  const victim = await register(app, 'victim');
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, victim.baseId);
  app.repos.city.markScouted(raider.baseId, HOME, new Date().toISOString());

  return { app, db, raiderToken: raider.token, victimBaseId: victim.baseId, seen };
}

/** The victim's structures, with a Gate standing at `level` and nothing else changed. */
function raiseGate(world: World, level: number): readonly Building[] {
  const base = world.app.repos.bases.findById(world.victimBaseId);
  if (!base) throw new Error('fixture error: no victim base');
  const without = base.buildings.filter((building) => building.kind !== 'gate');
  const buildings: Building[] =
    level <= 0
      ? without
      : [...without, { id: 'gate-under-test', kind: 'gate', level, modifications: [], damage: 0 }];
  world.app.repos.bases.updateBuildings(world.victimBaseId, buildings);
  return buildings;
}

/** Calls the fight at the victim's door, sends a squad, drags the mark back and settles it. */
async function fightAtTheGate(world: World): Promise<void> {
  const declared = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(world.raiderToken),
    payload: { target: GATE, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);

  const board = await world.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(world.raiderToken),
  });
  const view = board.json<BattlesResponse>().coming[0];
  if (!view) throw new Error('expected a declared battle');

  await world.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(world.raiderToken),
    payload: { battleId: view.battle.id, changes: { razors: 4 }, perimeterChanges: {} },
  });
  world.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE resolved_at IS NULL')
    .run(new Date(Date.now() - 60_000).toISOString());
  settleBattles(world.app.repos, world.app.skirmishEngine, new Date());
}

/** The defence the engine was handed for the crew holding the door. */
async function defenceWithGateAt(level: number): Promise<number> {
  const world = await makeWorld();
  raiseGate(world, level);
  await fightAtTheGate(world);
  const handed = world.seen[0]?.defenderTerritory?.defensePercent;
  expect(handed, 'the defender must have reached the engine with a fold').toBeDefined();
  return handed ?? 0;
}

const GATE_LEVEL = 4;

describe('a Gate a crew is defending behind', () => {
  it('lands on the engine once, at the rate the battle page quotes', async () => {
    const bare = await defenceWithGateAt(0);
    const walled = await defenceWithGateAt(GATE_LEVEL);

    // What the player is told the Gate is worth (`battle/view.ts` sends exactly this figure).
    const quoted = gateDefensePercent([
      { id: 'gate-under-test', kind: 'gate', level: GATE_LEVEL, modifications: [], damage: 0 },
    ]);
    expect(quoted).toBeCloseTo(GATE_LEVEL * GATE_DEFENSE_PERCENT_PER_LEVEL, 6);
    expect(walled - bare).toBeCloseTo(quoted, 6);
  });
});
