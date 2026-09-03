import {
  declarationWindow,
  randomBadge,
  type BattleTarget,
  type FactionResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleMovements } from '../battle/movement.js';

/**
 * Which side the faction screen says an ally is on, and what it is allowed to count.
 *
 * Membership of a fight was tested against a deployment row on *either* side, and then the side was
 * derived from "is this member the declarer" alone. So an ally who reinforced somebody else's
 * attack, which is the whole point of the reinforcement feature, was listed as **defending**, and
 * `committed` was then summed over the enemy's rows: the other side's exact deployed strength,
 * perimeter included, handed to everybody in the faction as an integer. The battle board blurs that
 * number through `observedForceSize` with the holder's counter-intel weighed against the reader's
 * own, and for an NPC muster it is otherwise unobservable at all.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

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
  const userId = registered.json<{ user: { id: string } }>().user.id;
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  app.repos.bases.updateProgression(baseId, 9, base.progression);
  app.repos.bases.updateBuildings(
    baseId,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: 5 } : building,
    ),
  );
  app.repos.bases.updateArmy(baseId, { razors: 40 }, []);
  return { token, userId, baseId };
}

describe('an ally who reinforced somebody else’s attack', () => {
  it('is listed as attacking, and the screen counts their own side', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const declarer = await register(app, 'the_declarer');
    const helper = await register(app, 'the_helper');
    const watcher = await register(app, 'the_watcher');

    // All three at one table: reinforcing somebody's fight is what a faction is for.
    const founded = await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(declarer.token),
      payload: { name: 'The Ninth Street Crew', badge: randomBadge(3), blurb: '' },
    });
    expect(founded.statusCode, founded.body.slice(0, 200)).toBe(200);
    for (const [username, joiner] of [
      ['the_helper', helper],
      ['the_watcher', watcher],
    ] as const) {
      await app.inject({
        method: 'POST',
        url: '/api/factions/invite',
        headers: auth(declarer.token),
        payload: { username },
      });
      const screen = await app.inject({
        method: 'GET',
        url: '/api/factions',
        headers: auth(joiner.token),
      });
      const inviteId = screen.json<FactionResponse>().invites[0]?.id;
      if (!inviteId) throw new Error(`fixture: no invitation for ${username}`);
      await app.inject({
        method: 'POST',
        url: '/api/factions/answer',
        headers: auth(joiner.token),
        payload: { inviteId, accept: true },
      });
    }

    // Somebody else's attack, on ground held by nobody in the faction.
    app.repos.city.markScouted(declarer.baseId, 'rustyard', new Date().toISOString());
    const target: BattleTarget = {
      kind: 'location',
      districtId: 'rustyard',
      locationId: 'rustyard-press',
    };
    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(declarer.token),
      payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });
    expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);
    const battleId = app.repos.sieges.pending()[0]?.id;
    if (!battleId) throw new Error('fixture: no battle');

    // The helper joins the attack, which is the case the whole feature exists for.
    const deployed = await app.inject({
      method: 'POST',
      url: '/api/factions/reinforce',
      headers: auth(helper.token),
      payload: { battleId, army: { razors: 6 } },
    });
    expect(deployed.statusCode, deployed.body.slice(0, 300)).toBe(200);

    // Put both columns on the ground: reinforcements walk, so a deployment row is empty until they
    // land, and this test is about what the *screen* counts rather than about the march.
    const column = app.repos.movements.forBattle(battleId)[0];
    if (!column) throw new Error('fixture: the reinforcement never set out');
    settleMovements(app.repos, new Date(Date.parse(column.arrivesAt) + 1000));
    const defence = app.repos.sieges.side(battleId, 'defender')[0];
    if (!defence) throw new Error('fixture: no defender row');
    app.repos.sieges.putDeployment({ ...defence, army: { razors: 13 } });

    const sizeOf = (side: 'attacker' | 'defender') =>
      app.repos.sieges
        .side(battleId, side)
        .reduce(
          (total, row) => total + Object.values(row.army).reduce((n, count) => n + (count ?? 0), 0),
          0,
        );
    // The precondition that makes the two answers distinguishable: the two sides differ, so a
    // `committed` taken off the wrong one is visible rather than a coincidence.
    expect(sizeOf('attacker'), 'fixture: nobody joined the attack').toBeGreaterThan(0);
    expect(sizeOf('defender')).not.toBe(sizeOf('attacker'));

    const screen = await app.inject({
      method: 'GET',
      url: '/api/factions',
      headers: auth(watcher.token),
    });
    const rows = screen.json<FactionResponse>().battles.filter((row) => row.battleId === battleId);
    // Both allies are in this fight, so the screen carries a row each: the declarer's was right
    // under the old code too, and the helper's is the one the finding is about.
    expect(rows.map((row) => row.memberUserId).sort()).toEqual(
      [declarer.userId, helper.userId].sort(),
    );
    const listed = rows.find((row) => row.memberUserId === helper.userId);
    if (!listed) throw new Error('the reinforcing ally is not on the faction screen');

    expect(listed.side).toBe('attacker');
    // Counted off the ally's own side. Taken off the other one this is the enemy's exact deployed
    // strength, which is the number the battle board deliberately blurs.
    expect(listed.committed).toBe(sizeOf('attacker'));
    expect(listed.committed).not.toBe(sizeOf('defender'));
  });
});
