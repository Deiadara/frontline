/**
 * §F1: a blueprint page as mission pay, from the card to the satchel.
 *
 * The rate is measured in shared, over the boards the game really produces. What only this level
 * can answer is the chain: the card promises a category and not a page, the promise survives the
 * board turning over while the crew is out, the page lands in the inventory on arrival, and the
 * finished mission names which one so the report can print it.
 */
import { BLUEPRINTS, MISSION_TEMPLATES, findBlueprintPage, type Mission } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { resolveDueMissions, rollMissionOutcome } from './resolve.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function crew(): Promise<{ app: FastifyInstance; token: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'runner', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: { authorization: `Bearer ${token}` },
    payload: { presetId: 'enforcer' },
  });
  return { app, token };
}

describe('a page won on a mission (§F1)', () => {
  it('names a category on the card and never the page', async () => {
    const { app, token } = await crew();
    const res = await app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.body;

    // Not one page name reaches the board, on any card, ever. If a card could name the page the
    // whole mechanic collapses into shopping.
    for (const blueprint of BLUEPRINTS) {
      for (const page of blueprint.pages) {
        expect(body, `the board named ${page.name}`).not.toContain(page.name);
      }
    }
  });

  it('lands the page in the satchel on arrival and records which one', async () => {
    const { app } = await crew();
    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('runner')!.id)!;

    // A run that was carrying a Unit page and has already come home. Written straight onto the row
    // rather than launched, because a launch that happened to draw no page would make this test
    // silently vacuous: the thing under test is the payout, not the draw.
    const started = new Date(Date.now() - 8 * 3600 * 1000);
    const mission: Mission = {
      id: 'm-page',
      baseId: base.id,
      templateId: MISSION_TEMPLATES[0]!.id,
      areaId: 'misc',
      payPercent: 0,
      xp: 10,
      force: { razors: 4 },
      vehicles: {},
      startedAt: started.toISOString(),
      travelMinutes: 1,
      durationMinutes: 1,
      status: 'active',
      officerId: null,
      outcome: null,
      rewards: {},
      spoils: {},
      resolvedAt: null,
      recalledAt: null,
      pagePrize: 'unit',
      pageWon: null,
    };
    // A seed that rolls a success, found by asking rather than by hoping.
    const seed = [...Array(200).keys()].find(
      (candidate) =>
        rollMissionOutcome({ mission, seed: candidate, successChance: 100 }) === 'success',
    );
    expect(seed, 'no seed produced a success').toBeDefined();
    app.repos.missions.insert({ mission, seed: seed!, successChance: 100 });

    const before = app.repos.bases.findById(base.id)!.inventory;
    const settled = resolveDueMissions(app.repos, base, new Date());
    expect(settled.resolved, 'the mission was not due').toHaveLength(1);

    const won = settled.resolved[0]!.pageWon;
    expect(won, 'a successful run carrying a page won nothing').not.toBeNull();
    // It is a real page of the promised category, not any old item id.
    const page = findBlueprintPage(won!);
    expect(page, `${won} is not a page in the catalogue`).toBeDefined();
    expect(BLUEPRINTS.find((b) => b.pages.some((p) => p.id === won))?.category).toBe('unit');

    // And it is actually in the satchel afterwards, which is the half a settler can get wrong.
    const after = app.repos.bases.findById(base.id)!.inventory;
    const held = (bag: Record<string, number>) => bag[won!] ?? 0;
    expect(held(after) - held(before), 'the page never reached the satchel').toBe(1);
  });

  it('gives a failed run nothing, even when it was carrying one', async () => {
    const { app } = await crew();
    const base = app.repos.bases.findByOwnerId(app.repos.users.findByUsername('runner')!.id)!;
    const started = new Date(Date.now() - 8 * 3600 * 1000);
    const mission: Mission = {
      id: 'm-fail',
      baseId: base.id,
      templateId: MISSION_TEMPLATES[0]!.id,
      areaId: 'misc',
      payPercent: 0,
      xp: 10,
      force: { razors: 4 },
      vehicles: {},
      startedAt: started.toISOString(),
      travelMinutes: 1,
      durationMinutes: 1,
      status: 'active',
      officerId: null,
      outcome: null,
      rewards: {},
      spoils: {},
      resolvedAt: null,
      recalledAt: null,
      pagePrize: 'unit',
      pageWon: null,
    };
    const seed = [...Array(200).keys()].find(
      (candidate) =>
        rollMissionOutcome({ mission, seed: candidate, successChance: 0 }) === 'failure',
    );
    expect(seed, 'no seed produced a failure').toBeDefined();
    app.repos.missions.insert({ mission, seed: seed!, successChance: 0 });

    const settled = resolveDueMissions(app.repos, base, new Date());
    expect(settled.resolved[0]!.pageWon, 'a failed run was paid a page').toBeNull();
  });
});
