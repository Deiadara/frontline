/**
 * §D4: a hurt officer takes their side off the field, not off the mailing list.
 *
 * `reportReaches` is the single enforcement point for who is told what happened, and since
 * 2026-09-23 it says in as many words that "the officer counts for nothing here either way: a
 * report is written by whoever walked back, not by the one on the stretcher". The settler's
 * receipt loop never heard: it skips every row on a side whose officer came home hurt, on a
 * comment that argues the bell would point at a redaction.
 *
 * There is no redaction. The report is on the board, readable, with the full ledger in it, and the
 * one kind of notification a player is not allowed to mute never arrives. An injury is a coin flip
 * at an even fight (`OFFICER_INJURY_BASE_CHANCE` is 0.45), so this is roughly half of every led
 * fight going unannounced, for the crew that led it and for every ally who sent a column to it.
 */
import {
  DECLARE_INFAMY_COST,
  createCommander,
  declarationWindow,
  reportReaches,
  skirmishOutcome,
  type BattleTarget,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { settleBattles } from './resolve.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'steelbelt',
  locationId: 'steelbelt-press',
};

/** The one officer, taken off the field: `fell` is what `officerInjured` settles on without a roll. */
const OFFICER_ID = 'off-hurt';

describe('the receipt for a fight the leader did not walk away from', () => {
  it('still reaches the crew, because the report itself does', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const engine: SkirmishEngine = {
      resolve: () =>
        skirmishOutcome({
          winner: 'attacker',
          log: ['decided'],
          officers: {
            attacker: { officerId: OFFICER_ID, name: 'Vasco Renn', fell: true, damage: 0 },
            defender: null,
          },
        }),
    };
    const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
    instances.push({ app, db });

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'leader', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const userId = registered.json<{ user: { id: string } }>().user.id;
    const chosen = await chooseOverseer(app, token);
    expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
    pinOverseer(app, token);
    const baseId = chosen.json<{ base: { id: string } }>().base.id;

    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 4 });
    app.repos.bases.updateArmy(baseId, { razors: 8 }, base.trainingQueue);
    app.repos.bases.updateCommanders(baseId, [
      createCommander(OFFICER_ID, 'Vasco Renn', 'field_commander'),
    ]);
    // One plot let go, so the district is not shut and a location is a legal call.
    const ramp = app.repos.city.control('steelbelt-ramp')!;
    app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });

    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);
    const battleId = app.repos.sieges.pending()[0]!.id;

    const led = await app.inject({
      method: 'POST',
      url: '/api/battles/lead',
      headers: auth(token),
      payload: { battleId, officerId: OFFICER_ID },
    });
    expect(led.statusCode, led.body.slice(0, 300)).toBe(200);

    // Somebody has to be on the ground for the row to exist at the mark.
    const deployed = await app.inject({
      method: 'POST',
      url: '/api/battles/deploy',
      headers: auth(token),
      payload: { battleId, changes: { razors: 4 }, perimeterChanges: {} },
    });
    expect(deployed.statusCode, deployed.body.slice(0, 300)).toBe(200);

    const mark = new Date(Date.now() - 60_000).toISOString();
    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(mark, battleId);
    const [resolved] = settleBattles(app.repos, app.skirmishEngine, new Date());
    if (!resolved) throw new Error('fixture: the fight did not settle');

    // The premise: the fight was led, the leader is on a stretcher, and the report is *not* held
    // back. Whatever the receipt loop believes, there is nothing here to point at a redaction.
    expect(resolved.analysis.attacker.officer?.injured).toBe(true);
    expect(reportReaches('attacker', resolved.analysis)).toBe(true);

    const bells = app.repos.social
      .notifications(userId, 50)
      .filter((row) => row.kind === 'battle_report' && row.subjectId === battleId);
    expect(bells.length, 'the one notification a player cannot mute never arrived').toBe(1);
    // Dated at the mark, when the fight happened, not at the tick that settled it a minute on.
    expect(bells[0]?.createdAt).toBe(mark);
  });
});
