import {
  CONTESTED_DISTRICTS,
  DEFAULT_BADGE,
  STACKHOUSE_RESEARCH_ID,
  type BattleTarget,
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
 * The Stackhouse (maintainer, 2026-10-05): a private bet on a fight you or your faction are in,
 * on either side, one at a time, closing an hour before the mark, paying twice the stake.
 */

const worlds: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of worlds.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const world = { app, db };
  worlds.push(world);
  return world;
}

interface Crew {
  token: string;
  baseId: string;
  userId: string;
}

async function crew(app: FastifyInstance, username: string, unlocked = true): Promise<Crew> {
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
  if (unlocked) {
    app.repos.bases.updateResearch(baseId, {
      ...base.research,
      technologies: [...base.research.technologies, STACKHOUSE_RESEARCH_ID],
    });
  }
  app.repos.bases.updateResources(baseId, { ...base.resources, caps: 20_000 });
  return { token, baseId, userId: base.ownerId };
}

const contested = CONTESTED_DISTRICTS[0]!;
const ground: BattleTarget = {
  kind: 'location',
  districtId: contested.id,
  locationId: contested.locations[0]!.id,
};

function fight(app: FastifyInstance, id: string, attackerBaseId: string, minutesOut: number): void {
  app.repos.sieges.insert({
    id,
    target: ground,
    attackerBaseId,
    defender: { kind: 'government' },
    scheduledFor: new Date(Date.now() + minutesOut * 60_000).toISOString(),
    declaredAt: new Date().toISOString(),
    resolvedAt: null,
    seed: 'seed',
    holdAfterCapture: true,
    wokeSleepers: false,
  });
}

/** Lands a fight with a winner, the one field of the report the book reads. */
function land(db: AppDatabase, id: string, winner: 'attacker' | 'defender'): void {
  db.prepare('UPDATE scheduled_battles SET resolved_at = ?, analysis_json = ? WHERE id = ?').run(
    new Date().toISOString(),
    JSON.stringify({ winner }),
    id,
  );
}

const book = async (app: FastifyInstance, who: Crew): Promise<StackhouseResponse> =>
  (
    await app.inject({
      method: 'GET',
      url: '/api/black-market/stackhouse',
      headers: auth(who.token),
    })
  ).json<StackhouseResponse>();

const bet = (
  app: FastifyInstance,
  who: Crew,
  battleId: string,
  side: 'attacker' | 'defender',
  stake: number,
) =>
  app.inject({
    method: 'POST',
    url: '/api/black-market/stackhouse/bet',
    headers: auth(who.token),
    payload: { battleId, side, stake },
  });

/** Seats crews at one faction's table, the first as its leader. */
function sameTable(app: FastifyInstance, ...crews: Crew[]): void {
  app.repos.factions.insert({
    id: 'f1',
    name: 'Iron Wolves',
    badge: DEFAULT_BADGE,
    blurb: '',
    foundedAt: new Date().toISOString(),
  });
  crews.forEach((who, index) =>
    app.repos.factions.addMember({
      userId: who.userId,
      factionId: 'f1',
      rank: index === 0 ? 'leader' : 'member',
      joinedAt: new Date().toISOString(),
    }),
  );
}

const caps = (app: FastifyInstance, who: Crew): number =>
  app.repos.bases.findById(who.baseId)!.resources.caps;

describe('the Stackhouse book', () => {
  it('lists only fights you or your faction are in, and only until an hour before the mark', async () => {
    const { app } = await makeApp();
    const me = await crew(app, 'punter');
    const ally = await crew(app, 'ally');
    const stranger = await crew(app, 'stranger');
    sameTable(app, me, ally);
    // Never a fight the crew called itself (maintainer, 2026-10-05): `mine` is off the book.
    fight(app, 'mine', me.baseId, 180);
    fight(app, 'allys', ally.baseId, 240);
    fight(app, 'strangers', stranger.baseId, 180);
    fight(app, 'too-close', ally.baseId, 59);

    const read = await book(app, me);
    expect(read.unlocked).toBe(true);
    expect(read.fights.map((one) => one.battleId)).toEqual(['allys']);
    const allys = read.fights[0]!;
    expect(allys.attacker.yours).toBe(true);
    expect(allys.defender).toEqual({ name: 'The Combine', yours: false });
    expect(Date.parse(allys.startsAt) - Date.parse(allys.closesAt)).toBe(60 * 60_000);
  });

  it('refuses a crew whose Fixer has not opened it, and lists nothing for it', async () => {
    const { app } = await makeApp();
    const me = await crew(app, 'punter', false);
    fight(app, 'mine', me.baseId, 180);
    expect((await book(app, me)).unlocked).toBe(false);
    expect((await book(app, me)).fights).toEqual([]);
    const refused = await bet(app, me, 'mine', 'attacker', 100);
    expect(refused.statusCode).toBe(409);
    expect(refused.body).toContain('Put Your Money Where Your Mouth Is');
  });

  it('takes the stake, holds one bet at a time, and refuses closed and foreign fights', async () => {
    const { app } = await makeApp();
    const me = await crew(app, 'punter');
    const mate = await crew(app, 'mate');
    const stranger = await crew(app, 'stranger');
    sameTable(app, me, mate);
    fight(app, 'mine', mate.baseId, 180);
    fight(app, 'second', mate.baseId, 200);
    fight(app, 'too-close', mate.baseId, 59);
    fight(app, 'strangers', stranger.baseId, 180);
    fight(app, 'own-call', me.baseId, 180);

    // The crew that called a fight cannot bet on it, either side (maintainer, 2026-10-05).
    const own = await bet(app, me, 'own-call', 'defender', 100);
    expect(own.statusCode).toBe(409);
    expect(own.body).toContain('You called that fight yourself');
    expect((await bet(app, me, 'too-close', 'attacker', 100)).statusCode).toBe(409);
    expect((await bet(app, me, 'strangers', 'attacker', 100)).statusCode).toBe(409);
    expect((await bet(app, me, 'mine', 'attacker', 5_001)).statusCode).toBe(400);
    expect((await bet(app, me, 'mine', 'attacker', 30_000)).statusCode).toBe(400);

    const placed = await bet(app, me, 'mine', 'defender', 5_000);
    expect(placed.statusCode, placed.body).toBe(200);
    expect(caps(app, me)).toBe(15_000);
    const after = placed.json<StackhouseResponse>();
    expect(after.activeBet).toMatchObject({ battleId: 'mine', side: 'defender', stake: 5_000 });
    expect(after.activeBet?.backing).toBe('The Combine');
    // One riding at a time: the list empties and a second bet is refused.
    expect(after.fights).toEqual([]);
    const second = await bet(app, me, 'second', 'attacker', 100);
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain('already have a bet riding');
    expect(caps(app, me)).toBe(15_000);
  });

  it('pays twice the stake on a win, nothing on a loss, and the stake back on an abandoned fight', async () => {
    const { app, db } = await makeApp();
    const me = await crew(app, 'punter');
    const mate = await crew(app, 'mate');
    sameTable(app, me, mate);
    fight(app, 'won', mate.baseId, 180);
    fight(app, 'lost', mate.baseId, 180);
    fight(app, 'never', mate.baseId, 180);

    // Landed between the read and the click: closed, not somebody else's (bug pass, 2026-10-05).
    fight(app, 'gone', mate.baseId, 180);
    land(db, 'gone', 'attacker');
    const late = await bet(app, me, 'gone', 'attacker', 100);
    expect(late.statusCode).toBe(409);
    expect(late.body).toContain('Betting on that fight has closed');
    expect(caps(app, me)).toBe(20_000);

    expect((await bet(app, me, 'won', 'attacker', 1_000)).statusCode).toBe(200);
    expect(settleStackhouse(app.repos, new Date())).toBe(0);
    land(db, 'won', 'attacker');
    const won = await book(app, me);
    expect(won.lastResult).toMatchObject({ outcome: 'won', stake: 1_000, payout: 2_000 });
    expect(won.activeBet).toBe(null);
    expect(caps(app, me)).toBe(21_000);

    expect((await bet(app, me, 'lost', 'attacker', 2_000)).statusCode).toBe(200);
    land(db, 'lost', 'defender');
    expect((await book(app, me)).lastResult).toMatchObject({ outcome: 'lost', payout: 0 });
    expect(caps(app, me)).toBe(19_000);

    expect((await bet(app, me, 'never', 'defender', 500)).statusCode).toBe(200);
    app.repos.sieges.abandon('never', new Date().toISOString());
    expect((await book(app, me)).lastResult).toMatchObject({ outcome: 'refunded', payout: 500 });
    expect(caps(app, me)).toBe(19_000);
    // Settled once: a second sweep pays nothing more.
    expect(settleStackhouse(app.repos, new Date())).toBe(0);
    expect(caps(app, me)).toBe(19_000);
    // Three bets down, one came in: the two feat counters.
    expect(app.repos.feats.tallies(me.baseId)).toMatchObject({
      stackhouse_bets: 3,
      stackhouse_wins: 1,
    });
  });
});
