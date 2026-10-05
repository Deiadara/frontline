import {
  CONTESTED_DISTRICTS,
  DEFAULT_BADGE,
  STACKHOUSE_RESEARCH_ID,
  type StackhouseResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { openDoors } from '../testing/doors.js';
import { chooseOverseer } from '../testing/overseer.js';
import { settleStackhouse } from './stackhouse.js';

/**
 * The Stackhouse's money at the edges of a faction (bug pass, 2026-10-05).
 *
 * A bet is on a fight, not on a membership: a crew that walks out of its faction after betting on a
 * faction-mate's fight still collects. And a fight that lands between the book being read and the
 * bet being sent takes no stake.
 */

const worlds: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of worlds.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

interface Crew {
  token: string;
  baseId: string;
  userId: string;
}

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  worlds.push({ app, db });
  return { app, db };
}

async function crew(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  openDoors(app, token, 'market', 'black_market');
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateResearch(baseId, {
    ...base.research,
    technologies: [...base.research.technologies, STACKHOUSE_RESEARCH_ID],
  });
  app.repos.bases.updateResources(baseId, { ...base.resources, caps: 10_000 });
  return { token, baseId, userId: base.ownerId };
}

function sameTable(app: FastifyInstance, crews: readonly Crew[]): void {
  app.repos.factions.insert({
    id: 'f1',
    name: 'Iron Wolves',
    badge: DEFAULT_BADGE,
    blurb: '',
    foundedAt: new Date().toISOString(),
  });
  crews.forEach((one, index) =>
    app.repos.factions.addMember({
      userId: one.userId,
      factionId: 'f1',
      rank: index === 0 ? 'leader' : 'member',
      joinedAt: new Date().toISOString(),
    }),
  );
}

const contested = CONTESTED_DISTRICTS[0]!;

function fight(app: FastifyInstance, id: string, attackerBaseId: string): void {
  app.repos.sieges.insert({
    id,
    target: {
      kind: 'location',
      districtId: contested.id,
      locationId: contested.locations[0]!.id,
    },
    attackerBaseId,
    defender: { kind: 'government' },
    scheduledFor: new Date(Date.now() + 180 * 60_000).toISOString(),
    declaredAt: new Date().toISOString(),
    resolvedAt: null,
    seed: 'seed',
    holdAfterCapture: true,
    wokeSleepers: false,
  });
}

function land(db: AppDatabase, id: string, winner: 'attacker' | 'defender'): void {
  db.prepare('UPDATE scheduled_battles SET resolved_at = ?, analysis_json = ? WHERE id = ?').run(
    new Date().toISOString(),
    JSON.stringify({ winner }),
    id,
  );
}

const bet = (app: FastifyInstance, who: Crew, battleId: string, stake: number) =>
  app.inject({
    method: 'POST',
    url: '/api/black-market/stackhouse/bet',
    headers: auth(who.token),
    payload: { battleId, side: 'attacker', stake },
  });

const caps = (app: FastifyInstance, who: Crew): number =>
  app.repos.bases.findById(who.baseId)!.resources.caps;

describe('the Stackhouse and the faction table', () => {
  it('pays a bet on a faction-mate’s fight after the bettor has left the faction', async () => {
    const { app, db } = await makeApp();
    const punter = await crew(app, 'punter');
    const mate = await crew(app, 'mate');
    sameTable(app, [punter, mate]);
    fight(app, 'mates', mate.baseId);

    expect((await bet(app, punter, 'mates', 1_000)).statusCode).toBe(200);
    expect(caps(app, punter)).toBe(9_000);
    app.repos.factions.removeMember(punter.userId);
    land(db, 'mates', 'attacker');

    expect(settleStackhouse(app.repos, new Date())).toBe(1);
    expect(caps(app, punter)).toBe(11_000);
    // Once only: the next sweep finds nothing to close.
    expect(settleStackhouse(app.repos, new Date())).toBe(0);
    expect(caps(app, punter)).toBe(11_000);
  });

  it('takes no stake on a fight that landed after the book was read', async () => {
    const { app, db } = await makeApp();
    const punter = await crew(app, 'punter');
    // A faction mate's call: the book takes no bet on a crew's own call (2026-10-05).
    const mate = await crew(app, 'mate');
    sameTable(app, [punter, mate]);
    fight(app, 'mine', mate.baseId);
    const read = await app.inject({
      method: 'GET',
      url: '/api/black-market/stackhouse',
      headers: auth(punter.token),
    });
    expect(read.json<StackhouseResponse>().fights.map((one) => one.battleId)).toEqual(['mine']);

    land(db, 'mine', 'attacker');
    expect((await bet(app, punter, 'mine', 1_000)).statusCode).toBe(409);
    expect(caps(app, punter)).toBe(10_000);
    expect(app.repos.stackhouse.riding(punter.baseId)).toBeUndefined();

    // And one abandoned before the click is refused the same way.
    fight(app, 'called-off', mate.baseId);
    app.repos.sieges.abandon('called-off', new Date().toISOString());
    expect((await bet(app, punter, 'called-off', 1_000)).statusCode).toBe(409);
    expect(caps(app, punter)).toBe(10_000);
  });
});
