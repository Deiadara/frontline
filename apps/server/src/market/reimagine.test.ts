/**
 * §G2/§G3: three spare pages to the Lab, one page you do not have back, over the wire.
 *
 * The trade itself is pure and tested in shared. Three things are only reachable here.
 *
 * The first is that the gate is re-checked against the *base record* rather than trusted from the
 * payload that drew the button. Both halves of it live on screens the Blueprints page never loads,
 * so a stale board is the ordinary case rather than an attack.
 *
 * The second is that a refused trade spends nothing. This route removes three items and adds one,
 * and the shape where a refusal happens after the removal is the classic way to lose a player's
 * collection.
 *
 * The third is that the answer says what was traded. The page the crew gained is not named anywhere
 * else: the response is the only time a player learns it, so a route that banked the page and
 * answered with the board alone would look like it did nothing.
 */
import {
  BLUEPRINTS,
  REIMAGINING_PAGES_SPENT,
  REIMAGINING_RESEARCH_ID,
  createCommander,
  type ItemId,
  type ReimagineResponse,
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

const ALL_PAGES = BLUEPRINTS.flatMap((spec) => spec.pages.map((page) => page.id));

interface Stack {
  app: FastifyInstance;
  token: string;
  baseId: string;
}

async function crew(): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'drafter', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

/** Seats a Head of Research and banks the Reimagining rung: the two halves of the §G4 gate. */
function openTheLab(stack: Stack, { seat = true, research = true } = {}): void {
  const base = stack.app.repos.bases.findById(stack.baseId);
  if (!base) throw new Error('no base');
  stack.app.repos.bases.updateCommanders(
    stack.baseId,
    seat ? [createCommander('off-1', 'Vell Ashgrove', 'head_of_research')] : [],
  );
  stack.app.repos.bases.updateResearch(stack.baseId, {
    ...base.research,
    technologies: research ? [REIMAGINING_RESEARCH_ID] : [],
  });
}

function hold(stack: Stack, inventory: Partial<Record<ItemId, number>>): void {
  const base = stack.app.repos.bases.findById(stack.baseId);
  if (!base) throw new Error('no base');
  stack.app.repos.bases.updateHoldings(base.id, base.resources, inventory);
}

const heldBy = (stack: Stack): Record<string, number> =>
  stack.app.repos.bases.findById(stack.baseId)?.inventory ?? {};

const post = (stack: Stack) =>
  stack.app.inject({
    method: 'POST',
    url: '/api/blueprints/reimagine',
    headers: auth(stack.token),
  });

/**
 * Enough spare pages to trade, out of one document, and never a full set of it.
 *
 * Spares are counted per page (`sparePages`), so four copies of one page is three spares. Taking
 * them all off a single page keeps the fixture from accidentally *completing* a document, which
 * would change what the trade is allowed to hand back.
 */
const SPARES: Partial<Record<ItemId, number>> = {
  [ALL_PAGES[0] as ItemId]: REIMAGINING_PAGES_SPENT + 1,
};

describe('the Reimagining trade (§G2, §G3)', () => {
  it('takes three spares and hands back a page the crew has never held', async () => {
    const stack = await crew();
    openTheLab(stack);
    hold(stack, SPARES);

    const res = await post(stack);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const body = res.json<ReimagineResponse>();

    expect(body.spent).toHaveLength(REIMAGINING_PAGES_SPENT);
    expect(ALL_PAGES, 'the page handed back is not in the catalogue').toContain(body.gained);
    // The whole promise of §G2: what comes back is something they did not have.
    expect(Object.keys(SPARES)).not.toContain(body.gained);

    // Persisted, rather than only answered.
    const after = heldBy(stack);
    expect(after[ALL_PAGES[0]!] ?? 0).toBe(1);
    expect(after[body.gained] ?? 0).toBe(1);
  });

  it('refuses a crew with no Head of Research, and spends nothing', async () => {
    const stack = await crew();
    openTheLab(stack, { seat: false });
    hold(stack, SPARES);

    const res = await post(stack);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('not_available');
    expect(heldBy(stack)[ALL_PAGES[0]!] ?? 0, 'pages went on a refused trade').toBe(
      REIMAGINING_PAGES_SPENT + 1,
    );
  });

  it('refuses a crew that has not researched it, however many pages they are sitting on', async () => {
    const stack = await crew();
    openTheLab(stack, { research: false });
    hold(stack, SPARES);

    const res = await post(stack);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('not_available');
  });

  it('refuses when the spares are one short, and spends nothing', async () => {
    const stack = await crew();
    openTheLab(stack);
    const short = { [ALL_PAGES[0] as ItemId]: REIMAGINING_PAGES_SPENT };
    hold(stack, short);

    const res = await post(stack);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('not_enough_spare_pages');
    expect(heldBy(stack)[ALL_PAGES[0]!] ?? 0).toBe(REIMAGINING_PAGES_SPENT);
  });

  it('refuses once the crew holds every page there is, rather than trading for nothing', async () => {
    const stack = await crew();
    openTheLab(stack);
    // One of everything, plus enough spares of the first to pay with.
    hold(stack, {
      ...Object.fromEntries(ALL_PAGES.map((id) => [id, 1])),
      [ALL_PAGES[0] as ItemId]: REIMAGINING_PAGES_SPENT + 1,
    });

    const res = await post(stack);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('nothing_left_to_find');
  });

  it('says the Lab is open on the board once both halves are met', async () => {
    const stack = await crew();
    openTheLab(stack);
    const shut = await crew();
    openTheLab(shut, { seat: false });

    const read = async (s: Stack) =>
      (await s.app.inject({ method: 'GET', url: '/api/market', headers: auth(s.token) })).json<{
        reimagining: { hasHeadOfResearch: boolean; hasReimaginingResearch: boolean };
      }>().reimagining;

    expect(await read(stack)).toEqual({ hasHeadOfResearch: true, hasReimaginingResearch: true });
    expect((await read(shut)).hasHeadOfResearch).toBe(false);
  });
});
