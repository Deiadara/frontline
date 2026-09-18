/**
 * The crew being attacked is in the fight (maintainer, 2026-09-17).
 *
 * Two lookups answer "whose fight is this" and until now they disagreed. `defendingBaseOf` resolves
 * a gate or a raid to the crew who lives on the ground, and the settler uses it: their roster
 * fights, their buildings take the damage and their stockpile is what gets carried off. `sideOf`
 * answers the board and the deploy route, and it only ever matched `battle.defender`, which for
 * residential ground is `unoccupied` because a home district holds no locations to control. So the
 * crew whose army and stockpile were on the line read `You are not in this one.`, had no red mark,
 * and was refused by `/battles/deploy`. The fight then ran with whatever they happened to have at
 * home and they found out from the report.
 *
 * Nothing surfaced it because nothing could reach it: every account was created in the same
 * district, and a crew cannot call on the district it lives in, so no human could ever be the
 * resident of a district somebody else was allowed to call on. Spreading new crews across the four
 * residential plots (`quietestDistrict`, 2026-09-17) made it reachable on the first fight of a
 * five-player world.
 *
 * The second case is the same question with a bot in the room. The three non-starter residential
 * districts each hold a seeded crew, and `residentOf` took the first base in the district by
 * `created_at`, which is always the seed. A player living there was invisible: the bot answered for
 * their home, the bot's roster defended it, and the player was never told.
 */
import {
  DECLARE_INFAMY_COST,
  declarationWindow,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  STARTING_RESOURCES,
  type Base,
  type BattlesResponse,
  type MeResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** The plot the victim is moved onto: a crew cannot be called out on the ground it declared from. */
const HOME = 'ashen-terraces';

interface Crew {
  token: string;
  baseId: string;
}

async function register(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const purse = app.repos.bases.findById(baseId)!.economy;
  app.repos.bases.updateEconomy(baseId, { ...purse, infamy: DECLARE_INFAMY_COST * 8 });
  return { token, baseId };
}

interface World {
  app: FastifyInstance;
  raider: Crew;
  victim: Crew;
}

/**
 * A seeded crew on the same ground, older than every player, exactly as the boot seed leaves it.
 *
 * `created_at` is the whole point of the fixture: `listSummaries` is ordered by it, so a bot
 * planted after the player would be found second and the case would pass without the fix.
 */
function plantBot(app: FastifyInstance, districtId: string): string {
  const born = new Date(Date.now() - 86_400_000).toISOString();
  app.repos.users.insert({
    id: 'seeded-user',
    // A user row, so it must pass the username rules the real seeded crews pass.
    username: 'ninth_street',
    passwordHash: 'x',
    createdAt: born,
  });
  const bot: Base = {
    id: 'seeded-base',
    ownerId: 'seeded-user',
    name: 'The Ninth Street Irregulars',
    districtId,
    level: 4,
    isBot: true,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(born),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [{ id: 'bot-nexus', kind: 'nexus', level: 4, modifications: [] }],
    buildQueue: [],
    army: { razors: 4 },
    trainingQueue: [],
    training: startingTraining(born),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: born,
  };
  app.repos.bases.insert(bot);
  return bot.id;
}

async function makeWorld(withBot: boolean): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  if (withBot) plantBot(app, HOME);
  const raider = await register(app, 'raider');
  const victim = await register(app, 'victim');
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, victim.baseId);
  // People to put into the defence, and somewhere for them to be put from.
  app.repos.bases.updateArmy(victim.baseId, { razors: 6 }, []);
  app.repos.city.markScouted(raider.baseId, HOME, new Date().toISOString());
  return { app, raider, victim };
}

/** Calls a fight at the victim's gate and answers with the battle id it created. */
async function callTheGate(world: World): Promise<string> {
  const called = await world.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(world.raider.token),
    payload: {
      target: { kind: 'gate', districtId: HOME },
      scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
    },
  });
  expect(called.statusCode, called.body.slice(0, 300)).toBe(200);
  const pending = world.app.repos.sieges.pending();
  expect(pending).toHaveLength(1);
  return pending[0]!.id;
}

const boardFor = async (world: World, crew: Crew): Promise<BattlesResponse> => {
  const board = await world.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(crew.token),
  });
  expect(board.statusCode, board.body.slice(0, 200)).toBe(200);
  return board.json<BattlesResponse>();
};

describe('a crew called out at its own gate', () => {
  it('reads the fight as theirs rather than as somebody else’s', async () => {
    const world = await makeWorld(false);
    const battleId = await callTheGate(world);

    const theirs = (await boardFor(world, world.victim)).coming.find(
      (view) => view.battle.id === battleId,
    );
    expect(theirs, 'the fight is not on the defender’s board at all').toBeDefined();
    expect(theirs?.role).toBe('defender');
  });

  it('is told, on the mark the rest of the game reads', async () => {
    const world = await makeWorld(false);
    await callTheGate(world);

    const me = await world.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(world.victim.token),
    });
    expect(me.json<MeResponse>().unread?.fightsOnYou).toBe(1);
  });

  it('can put people into the defence', async () => {
    const world = await makeWorld(false);
    const battleId = await callTheGate(world);

    const sent = await world.app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(world.victim.token),
      payload: { battleId, changes: { razors: 3 } },
    });
    expect(sent.statusCode, sent.body.slice(0, 300)).toBe(200);
  });
});

describe('a person living beside a seeded crew', () => {
  it('is the one who answers for the district, not the bot', async () => {
    const world = await makeWorld(true);
    const battleId = await callTheGate(world);

    const theirs = (await boardFor(world, world.victim)).coming.find(
      (view) => view.battle.id === battleId,
    );
    expect(theirs?.role, 'the seeded crew answered for somebody’s home').toBe('defender');

    const me = await world.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(world.victim.token),
    });
    expect(me.json<MeResponse>().unread?.fightsOnYou).toBe(1);
  });
});
