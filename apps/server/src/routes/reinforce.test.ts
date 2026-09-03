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

/**
 * §A4: sending units to an ally's fight, for the case the feature exists for.
 *
 * `/factions/reinforce` decided which side a caller was allowed to join by scanning the battle's
 * *deployment rows*. The attacking side also consulted `battle.attackerBaseId`; the defending side
 * consulted nothing but the rows. A break-in seeds its defender row with
 * `baseId = defender.kind === 'crew' ? defender.baseId : null` (`battle/declare.ts`), and
 * `defenderOf` for a non-location target is `districtHolder`, which is null unless one crew holds
 * *every* location in the district. So on the ordinary break-in, where the defender lives in the
 * district without owning all of it, the only defender row carried a null base id and an ally was
 * refused `not_a_member` while their friend's home was being emptied.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

interface Crew {
  token: string;
  userId: string;
  baseId: string;
}

async function register(app: FastifyInstance, username: string): Promise<Crew> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const body = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(body.token),
    payload: { presetId: 'enforcer' },
  });
  return {
    token: body.token,
    userId: body.user.id,
    baseId: chosen.json<{ base: { id: string } }>().base.id,
  };
}

/** Raises a crew to the level and Nexus a faction needs, and gives it something to send. */
function establish(app: FastifyInstance, crew: Crew): void {
  const base = app.repos.bases.findById(crew.baseId);
  if (!base) throw new Error('no base');
  app.repos.bases.updateProgression(crew.baseId, 9, base.progression);
  app.repos.bases.updateBuildings(
    crew.baseId,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: 5 } : building,
    ),
  );
  app.repos.bases.updateArmy(crew.baseId, { razors: 20 }, []);
}

describe('reinforcing an ally who is being broken into', () => {
  it('lets a faction-mate send units to the defence before the defender has deployed', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const raider = await register(app, 'the_raider');
    const victim = await register(app, 'the_victim');
    const ally = await register(app, 'the_ally');
    establish(app, victim);
    establish(app, ally);

    // Every crew is planted on the same opening ground, so the victim is moved next door: a
    // break-in needs two districts, and a crew cannot raid itself.
    const HOME = 'ashen-terraces';
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(HOME, victim.baseId);

    // The victim and the ally are at the same table.
    const founded = await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(victim.token),
      payload: { name: 'The Ninth Street Crew', badge: randomBadge(7), blurb: '' },
    });
    expect(founded.statusCode, founded.body).toBe(200);
    const invited = await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(victim.token),
      payload: { username: 'the_ally' },
    });
    expect(invited.statusCode, invited.body).toBe(200);
    const pending = await app.inject({
      method: 'GET',
      url: '/api/factions',
      headers: auth(ally.token),
    });
    const inviteId = pending.json<FactionResponse>().invites[0]?.id;
    if (!inviteId) throw new Error('fixture: no invitation reached the ally');
    const answered = await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(ally.token),
      payload: { inviteId, accept: true },
    });
    expect(answered.statusCode, answered.body).toBe(200);

    // The way in is already open: breaking the gate is its own fight with its own tests.
    app.repos.city.markScouted(raider.baseId, HOME, new Date().toISOString());
    app.repos.sieges.breakGate(HOME, new Date(Date.now() + 3_600_000).toISOString());

    const building = app.repos.bases.findById(victim.baseId)?.buildings[0];
    if (!building) throw new Error('fixture: the victim has nothing to break into');
    const target: BattleTarget = { kind: 'building', districtId: HOME, buildingId: building.id };
    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(raider.token),
      payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });
    expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);
    const battleId = app.repos.sieges.pending()[0]?.id;
    if (!battleId) throw new Error('fixture: the declaration produced no battle');

    // The precondition the finding turns on: the defender's seeded row names nobody, because the
    // victim does not hold every location in their own district.
    const defenderRows = app.repos.sieges.side(battleId, 'defender');
    expect(defenderRows.every((row) => row.baseId === null)).toBe(true);

    // The victim is asleep and has deployed nothing. The ally steps in.
    const helped = await app.inject({
      method: 'POST',
      url: '/api/factions/reinforce',
      headers: auth(ally.token),
      payload: { battleId, army: { razors: 5 } },
    });
    expect(helped.statusCode, helped.body).toBe(200);
    // The ally now has a row of their own on the defending side, and the units have left their
    // roster: they are on the road, which is the same path a crew's own deployment takes.
    expect(
      app.repos.sieges.side(battleId, 'defender').some((row) => row.baseId === ally.baseId),
    ).toBe(true);
    expect(app.repos.bases.findById(ally.baseId)?.army.razors).toBe(15);
  });
});
