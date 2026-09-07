import {
  DEFAULT_ATTRIBUTES,
  cardBonusPercent,
  randomBadge,
  type Attributes,
  type FactionResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { standingEffectsFor } from '../crew/standing.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The table's cards pay the whole table, off each holder's own sheet.
 *
 * The leader's ace reads strength, strategy and authority and pays every member on what their
 * people hit for. Two things are pinned: the screen says the card and the mark the fold pays on
 * (one dealer, two readers), and a member who trained nothing still collects what the leader's
 * sheet is worth. A crew at no table collects nothing.
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
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode).toBe(201);
  const userId = registered.json<{ user: { id: string } }>().user.id;
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  // Established enough to found and join a table: the faction routes gate on standing.
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('fixture: no base');
  app.repos.bases.updateProgression(baseId, 9, base.progression);
  app.repos.bases.updateBuildings(
    baseId,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: 5 } : building,
    ),
  );
  return { token, userId, baseId };
}

describe('the cards at the table', () => {
  it('are dealt on the screen and paid in the standing fold, off the holder’s sheet', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const leader = await register(app, 'the_leader');
    const mate = await register(app, 'the_mate');
    // Nobody at a table yet: nothing is paid.
    const alone = app.repos.bases.findById(mate.baseId);
    if (!alone) throw new Error('fixture: no base');
    const before = standingEffectsFor(app.repos, alone).unitOffensePercent;

    // A leader whose sheet answers the ace well: 70 in each of the three it reads is a B+.
    const owner = app.repos.users.findById(leader.userId);
    const overseer = owner?.overseerId ? app.repos.overseers.findById(owner.overseerId) : undefined;
    if (!overseer) throw new Error('fixture: the leader has no overseer');
    const sheet: Attributes = { ...DEFAULT_ATTRIBUTES, strength: 70, strategy: 70, authority: 70 };
    app.repos.overseers.updateAttributes(overseer.id, sheet);

    const founded = await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(leader.token),
      payload: { name: 'The Ninth Street Crew', badge: randomBadge(9), blurb: '' },
    });
    expect(founded.statusCode, founded.body.slice(0, 200)).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(leader.token),
      payload: { username: 'the_mate' },
    });
    const asked = await app.inject({
      method: 'GET',
      url: '/api/factions',
      headers: auth(mate.token),
    });
    const inviteId = asked.json<FactionResponse>().invites[0]?.id;
    if (!inviteId) throw new Error('fixture: no invitation for the mate');
    await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(mate.token),
      payload: { inviteId, accept: true },
    });

    // The screen: the leader holds the ace at a B+, the mate the king.
    const screen = await app.inject({
      method: 'GET',
      url: '/api/factions',
      headers: auth(mate.token),
    });
    const members = screen.json<FactionResponse>().members;
    const dealtLeader = members.find((member) => member.userId === leader.userId);
    const dealtMate = members.find((member) => member.userId === mate.userId);
    expect(dealtLeader?.card).toBe('ace_spades');
    expect(dealtLeader?.cardMark).toBe('B+');
    expect(dealtMate?.card).toBe('king_diamonds');

    // The fold: the mate, who trained nothing, hits harder for the leader's ace.
    const seated = app.repos.bases.findById(mate.baseId);
    if (!seated) throw new Error('fixture: no base');
    const after = standingEffectsFor(app.repos, seated).unitOffensePercent;
    expect(after - before).toBe(cardBonusPercent('B+'));
    expect(cardBonusPercent('B+')).toBeGreaterThan(0);
  });
});
