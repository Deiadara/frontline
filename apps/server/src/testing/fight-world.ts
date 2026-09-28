import {
  DECLARE_INFAMY_COST,
  DEFAULT_BADGE,
  declarationWindow,
  findDistrict,
  skirmishOutcome,
  startingHolder,
  type Army,
  type BattleTarget,
  type SkirmishEngine,
  type SkirmishInput,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { settleBattles } from '../battle/resolve.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMoves } from '../moves/moves.js';
import { chooseOverseer } from './overseer.js';

/**
 * A small world to fight in, for the tests that read what the engine was handed and what the
 * settle wrote afterwards: several crews, the Steelbelt open, and an engine decided by hand that
 * records its input. Nobody dies unless the outcome says so, so the only thing that can move a unit
 * is the settle.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

/** Closes every world opened since the last call. Wire it into the test file's `afterEach`. */
export async function closeWorlds(): Promise<void> {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
}

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

export interface Crew {
  token: string;
  userId: string;
  baseId: string;
}

export interface World {
  app: FastifyInstance;
  db: AppDatabase;
  engine: SkirmishEngine;
  /** The lines the engine was handed on its last run. */
  seen: () => SkirmishInput;
}

/** The plot of the Belt somebody is standing on at the start, handed to the defender by a test. */
export const PLOT: string = (() => {
  const district = findDistrict('steelbelt');
  const held = district?.locations.find(
    (location) => startingHolder(location, district).kind !== 'unoccupied',
  );
  if (!held) throw new Error('the Belt has nobody on it at all');
  return held.id;
})();
export const ON_PLOT: BattleTarget = {
  kind: 'location',
  districtId: 'steelbelt',
  locationId: PLOT,
};

export async function makeWorld(
  winner: 'attacker' | 'defender',
  /** More of the outcome, for a loser with runners: `{ fled: { razors: 2 } }`. */
  extra: Partial<Parameters<typeof skirmishOutcome>[0]> = {},
): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  let last: SkirmishInput | null = null;
  const engine: SkirmishEngine = {
    resolve: (input) => {
      last = input;
      return skirmishOutcome({ winner, log: [input.locationName], ...extra });
    },
  };
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });
  // One plot of the Belt left empty, so the district is open and a location can be called on.
  for (const location of findDistrict('steelbelt')?.locations ?? []) {
    app.repos.city.control(location.id);
  }
  const ramp = app.repos.city.control('steelbelt-ramp')!;
  app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });
  return {
    app,
    db,
    engine,
    seen: () => {
      if (!last) throw new Error('the engine never ran');
      return last;
    },
  };
}

export async function register(world: World, username: string, army: Army = {}): Promise<Crew> {
  const registered = await world.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const body = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await chooseOverseer(world.app, body.token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = world.app.repos.bases.findById(baseId)!;
  world.app.repos.bases.updateEconomy(baseId, {
    ...base.economy,
    infamy: DECLARE_INFAMY_COST * 8,
  });
  world.app.repos.bases.updateArmy(baseId, army, []);
  world.app.repos.city.markScouted(baseId, 'steelbelt', new Date().toISOString());
  return { token: body.token, userId: body.user.id, baseId };
}

/** A faction with these crews in it, written straight onto the tables: the door is not the point. */
export function faction(world: World, id: string, crews: readonly Crew[]): void {
  world.app.repos.factions.insert({
    id,
    name: `Faction ${id}`,
    badge: DEFAULT_BADGE,
    blurb: '',
    foundedAt: new Date().toISOString(),
  });
  crews.forEach((crew, index) =>
    world.app.repos.factions.addMember({
      userId: crew.userId,
      factionId: id,
      rank: index === 0 ? 'leader' : 'member',
      joinedAt: new Date().toISOString(),
    }),
  );
}

export function holdPlot(world: World, crew: Crew, garrison: Army): void {
  const control = world.app.repos.city.control(PLOT)!;
  world.app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: crew.baseId }, garrison });
}

/** Calls a fight through the route, at the earliest mark, and answers its id. Throws if refused. */
export async function declare(
  world: World,
  crew: Crew,
  target: BattleTarget = ON_PLOT,
  scheduledFor: string = declarationWindow(new Date()).earliest.toISOString(),
): Promise<string> {
  const res = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(crew.token),
    payload: { target, scheduledFor },
  });
  if (res.statusCode !== 200) throw new Error(`the call was refused: ${res.body.slice(0, 300)}`);
  const battle = world.app.repos.sieges
    .pending()
    .find(
      (one) =>
        one.attackerBaseId === crew.baseId && JSON.stringify(one.target) === JSON.stringify(target),
    );
  if (!battle) throw new Error('the call wrote no battle');
  return battle.id;
}

/** The mark is a minute gone, and the world settles the fight. Throws unless exactly one ran. */
export function runTheFight(world: World, battleId: string): void {
  world.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), battleId);
  const ran = settleBattles(world.app.repos, world.engine, new Date());
  if (ran.length !== 1) throw new Error(`${ran.length} fights ran, not one`);
}

/** Every column walking anywhere, landed now. */
export function landEveryMove(world: World): void {
  world.db
    .prepare('UPDATE unit_moves SET returns_at = ?')
    .run(new Date(Date.now() - 1_000).toISOString());
  settleMoves(world.app.repos, new Date());
}
