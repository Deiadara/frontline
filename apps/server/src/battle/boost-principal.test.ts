/**
 * §D7: one name to a fight, and it is the name of the crew whose fight it is.
 *
 * `/battles/boost` works out the principal from `battle.defender`, which is the control table's
 * answer and reads `unoccupied` on every lived-in district: a home has no locations to hold, so
 * `districtHolder` names nobody however plainly somebody lives there. The route then took
 * `principal === null` as "nobody owns this slot" and let anybody on the defending side buy.
 *
 * Every other door on the same fight asks `defendingBaseOf` instead: `sideOf` decides who may
 * deploy, `assemble` musters the defence, `leaderFor` reads the officer off that crew's row, and
 * the settler prices the boost against **that** crew (`appliedBoost` is handed `defenderBase.id`).
 * So an ally's purchase on a home defence was charged to the ally and then settled against the
 * principal: a bought name stacked past the crew's own slot count, and a contraband crate was
 * looked for in the principal's stash and taken out of it if one happened to be there.
 *
 * This is the same cross-wire `sideOf` and the reinforcement route each had to fix, in the one
 * door that still had it.
 */
import {
  FOUND_FACTION_PLAYER_LEVEL,
  DECLARE_INFAMY_COST,
  declarationWindow,
  findBattleBoost,
  randomBadge,
  skirmishOutcome,
  type BattleTarget,
  type FactionResponse,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

/** Open to anybody, so nothing but the principal rule can refuse it. */
const OPEN_BOOST = findBattleBoost('boost_call_in_the_name');
if (!OPEN_BOOST) throw new Error('fixture: the open offense boost moved');

const HOME = 'ashen-terraces';
const GATE: BattleTarget = { kind: 'gate', districtId: HOME };

async function register(
  app: FastifyInstance,
  db: AppDatabase,
  username: string,
  districtId: string,
) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  // One crew to a plot, so `residentOf` has one answer and the fixture is not deciding the test.
  db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(districtId, baseId);
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateEconomy(baseId, {
    ...base.economy,
    infamy: DECLARE_INFAMY_COST + OPEN_BOOST!.cost * 4,
  });
  app.repos.bases.updateArmy(baseId, { razors: 20 }, base.trainingQueue);
  // What founding a table asks for: a crew with some standing and a Nexus to run it out of.
  app.repos.bases.updateProgression(baseId, FOUND_FACTION_PLAYER_LEVEL, base.progression);
  app.repos.bases.updateBuildings(
    baseId,
    base.buildings.map((building) =>
      building.kind === 'nexus' ? { ...building, level: 5 } : building,
    ),
  );
  return { token, baseId };
}

describe('a name burned on somebody else’s home defence', () => {
  it('is refused from an ally and taken from the crew being attacked', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const engine: SkirmishEngine = { resolve: () => skirmishOutcome({ winner: 'attacker' }) };
    const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
    instances.push({ app, db });

    const raider = await register(app, db, 'raider', 'upper-roofs');
    const victim = await register(app, db, 'victim', HOME);
    const ally = await register(app, db, 'ally', 'kettle-row');

    // The victim's table, so the ally is allowed to send help at all.
    const founded = await app.inject({
      method: 'POST',
      url: '/api/factions',
      headers: auth(victim.token),
      payload: { name: 'The Ninth Street Crew', badge: randomBadge(3), blurb: '' },
    });
    expect(founded.statusCode, founded.body.slice(0, 300)).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/api/factions/invite',
      headers: auth(victim.token),
      payload: { username: 'ally' },
    });
    const screen = await app.inject({
      method: 'GET',
      url: '/api/factions',
      headers: auth(ally.token),
    });
    const inviteId = screen.json<FactionResponse>().invites[0]?.id;
    if (!inviteId) throw new Error('fixture: no invitation');
    await app.inject({
      method: 'POST',
      url: '/api/factions/answer',
      headers: auth(ally.token),
      payload: { inviteId, accept: true },
    });

    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(raider.token),
      payload: { target: GATE, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });
    expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);
    const battleId = app.repos.sieges.pending()[0]!.id;

    // The ally sends a column, which is what puts them on the defending side at all.
    const helped = await app.inject({
      method: 'POST',
      url: '/api/factions/reinforce',
      headers: auth(ally.token),
      payload: { battleId, army: { razors: 6 } },
    });
    expect(helped.statusCode, helped.body.slice(0, 300)).toBe(200);

    const buy = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/api/battles/boost',
        headers: auth(token),
        payload: { battleId, boostId: OPEN_BOOST.id },
      });

    const byTheAlly = await buy(ally.token);
    expect(byTheAlly.statusCode, 'an ally put a name on a fight that is not theirs').toBe(403);

    // ...and the crew the call was actually on still may, so the refusal is the principal rule
    // rather than the door being shut on everybody.
    const byTheVictim = await buy(victim.token);
    expect(byTheVictim.statusCode, byTheVictim.body.slice(0, 300)).toBe(200);

    const names = app.repos.sieges
      .side(battleId, 'defender')
      .flatMap((row) => row.boostIds.map((id) => ({ baseId: row.baseId, id })));
    expect(names).toEqual([{ baseId: victim.baseId, id: OPEN_BOOST.id }]);
  });
});
