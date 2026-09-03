/**
 * §D12e: a manufactured boost is behind its drawings, and the board says which drawings.
 *
 * `blueprintForBattleBoost` shipped with the catalogue and had no consumer, so the four boosts that
 * are *made* rather than proposed could be bought by anyone holding the Lab project or the chair.
 * The gate itself is a pure rule and is tested in shared. What is only reachable here is the board
 * a player actually reads.
 *
 * The reason line is the half worth a test of its own. A shut boost whose `source` still names the
 * officer who proposed it reads as broken to a crew that already has that officer sitting down:
 * they have met every requirement the screen mentions and the button is still dead. So this asserts
 * the row says *blueprint*, not just that it says no.
 */
import {
  BATTLE_BOOSTS,
  blueprintForBattleBoost,
  createCommander,
  declarationWindow,
  type BattlesResponse,
  type ItemId,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Every boost that is made rather than proposed, with the document it is made from. */
const GATED = BATTLE_BOOSTS.flatMap((spec) => {
  const blueprint = blueprintForBattleBoost(spec.id);
  return blueprint ? [{ spec, blueprint }] : [];
});

interface Stack {
  app: FastifyInstance;
  token: string;
  baseId: string;
}

async function stage(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'quartermaster', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  /*
   * Everything each gated boost asks for *except* the drawings.
   *
   * This is the whole fixture. Without it these tests pass against a build with no blueprint gate
   * at all, because the same four boosts are also shut for want of the officer or the Lab project
   * that proposes them: `available: false` would be true for a reason this file is not about.
   * Seating the proposer and banking the projects leaves the document as the only thing missing.
   */
  const proposers = GATED.map(({ spec }) => spec.unlock);
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  app.repos.bases.updateCommanders(
    baseId,
    proposers.flatMap((unlock, index) =>
      unlock.kind === 'officer'
        ? [createCommander(`off-${index}`, `Proposer ${index}`, unlock.role)]
        : [],
    ),
  );
  app.repos.bases.updateResearch(baseId, {
    ...base.research,
    technologies: proposers.flatMap((unlock) => (unlock.kind === 'tech' ? [unlock.techId] : [])),
  });

  // The Rustyard, scouted and one location off the looters, so a fight can be called there. Same
  // fixture the other battle-route tests use: the trip and the gate are not what this covers.
  app.repos.city.markScouted(baseId, 'rustyard', new Date().toISOString());
  const control = app.repos.city.control('rustyard-bonefield');
  if (control) {
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }

  const declared = await app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(token),
    payload: {
      target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
      scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
    },
  });
  expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);
  return { app, token, baseId };
}

/** The boost rows off the real board, for the one fight that is coming. */
async function boostRows(stack: Stack) {
  const board = await stack.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(stack.token),
  });
  expect(board.statusCode).toBe(200);
  const coming = board.json<BattlesResponse>().coming[0];
  if (!coming) throw new Error('fixture error: no fight is coming');
  return coming.boosts;
}

function hold(stack: Stack, inventory: Partial<Record<ItemId, number>>): void {
  const base = stack.app.repos.bases.findById(stack.baseId);
  if (!base) throw new Error('no base');
  stack.app.repos.bases.updateHoldings(base.id, base.resources, inventory);
}

describe('a boost behind a blueprint, on the board (§D12e)', () => {
  it('has something to gate: some boost is made rather than proposed', () => {
    expect(
      GATED.length,
      'nothing is behind a blueprint, so this file proves nothing',
    ).toBeGreaterThan(0);
  });

  it('is shut for a crew holding no documents', async () => {
    const stack = await stage();
    const rows = await boostRows(stack);
    for (const { spec } of GATED) {
      const row = rows.find((option) => option.id === spec.id);
      expect(row, `${spec.id} is missing from the board`).toBeDefined();
      expect(row?.available, `${spec.id} is on offer without its blueprint`).toBe(false);
    }
  });

  it('names the document as the reason, not the person who proposed it', async () => {
    const stack = await stage();
    const rows = await boostRows(stack);
    for (const { spec, blueprint } of GATED) {
      const row = rows.find((option) => option.id === spec.id);
      expect(row?.source, `${spec.id} does not say which drawings it wants`).toContain(
        blueprint.name,
      );
    }
  });

  it('opens once the document is assembled, and says who proposed it again', async () => {
    const stack = await stage();
    const first = GATED[0];
    if (!first) throw new Error('fixture error: nothing is gated');
    hold(stack, { [first.blueprint.id as ItemId]: 1 });

    const row = (await boostRows(stack)).find((option) => option.id === first.spec.id);
    expect(row?.available, 'the document is assembled and the boost is still shut').toBe(true);
    expect(
      row?.source,
      'the board still blames the blueprint after it was assembled',
    ).not.toContain(first.blueprint.name);
  });
});
