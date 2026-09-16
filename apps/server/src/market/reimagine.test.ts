/**
 * §G2/§G3: three named pages to the Lab, one page you do not have back, over the wire.
 *
 * The trade itself is pure and tested in shared. Four things are only reachable here.
 *
 * The first is that the gate is re-checked against the *base record* rather than trusted from the
 * payload that drew the button. Both halves of it live on screens the Reimagining tab never loads,
 * so a stale board is the ordinary case rather than an attack.
 *
 * The second is the unit. The player names the three pages now, so the route has to parse them and
 * has to refuse a crew that names pages it is not holding: that check is the only thing between a
 * hand-made request and an inventory going negative.
 *
 * The third is that a refused trade spends nothing. This route removes three items and adds one,
 * and the shape where a refusal happens after the removal is the classic way to lose a player's
 * collection.
 *
 * The fourth is that the answer says what was traded. The page the crew gained is not named
 * anywhere else: the response is the only time a player learns it, so a route that banked the page
 * and answered with the board alone would look like it did nothing.
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
import { chooseOverseer } from '../testing/overseer.js';

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
  const chosen = await chooseOverseer(app, token);
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

const post = (stack: Stack, pages: unknown) =>
  stack.app.inject({
    method: 'POST',
    url: '/api/blueprints/reimagine',
    headers: auth(stack.token),
    payload: { pages },
  });

/**
 * Four copies of one page, and never a full set of any document.
 *
 * Taking the whole payment off a single page keeps the fixture from accidentally *completing* a
 * document, which would change what the trade is allowed to hand back, and it is the case the
 * counted held-check exists for: three of the four go in on one request.
 */
const PAID: ItemId = ALL_PAGES[0] as ItemId;
const STACK: Partial<Record<ItemId, number>> = { [PAID]: REIMAGINING_PAGES_SPENT + 1 };
const THREE = [PAID, PAID, PAID];

describe('the Reimagining trade (§G2, §G3)', () => {
  it('takes the three the request named and hands back a page the crew has never held', async () => {
    const stack = await crew();
    openTheLab(stack);
    hold(stack, STACK);

    const res = await post(stack, THREE);
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    const body = res.json<ReimagineResponse>();

    expect(body.spent).toEqual(THREE);
    expect(ALL_PAGES, 'the page handed back is not in the catalogue').toContain(body.gained);
    // The whole promise of §G2: what comes back is something they did not have.
    expect(body.gained).not.toBe(PAID);

    // Persisted, rather than only answered.
    const after = heldBy(stack);
    expect(after[PAID] ?? 0).toBe(1);
    expect(after[body.gained] ?? 0).toBe(1);
  });

  /**
   * The one that has to be here rather than in shared.
   *
   * A request is a hand-made object. A route that trusted the three names would take a page the
   * crew never had, `removeItems` would take it to zero or below, and the answer would be a free
   * page: the whole of the trade's cost, skipped.
   */
  it('refuses three pages the crew is not holding, and mints nothing', async () => {
    const stack = await crew();
    openTheLab(stack);
    hold(stack, STACK);
    const other = ALL_PAGES[1] as ItemId;

    const res = await post(stack, [PAID, other, other]);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('pages_not_held');

    const after = heldBy(stack);
    expect(after[PAID] ?? 0, 'a refused trade spent a page').toBe(REIMAGINING_PAGES_SPENT + 1);
    expect(after[other] ?? 0, 'a refused trade invented a page').toBe(0);
  });

  it('refuses a stack named more times than it is held', async () => {
    const stack = await crew();
    openTheLab(stack);
    // Two copies, three names. Every name is a page they hold; the count is the lie.
    hold(stack, { [PAID]: 2 });

    const res = await post(stack, THREE);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('pages_not_held');
    expect(heldBy(stack)[PAID] ?? 0).toBe(2);
  });

  /** Not three, or not pages: the schema turns both away at the door rather than refusing later. */
  it('will not parse a unit that is not three page ids', async () => {
    const stack = await crew();
    openTheLab(stack);
    hold(stack, STACK);

    expect((await post(stack, [PAID, PAID])).statusCode).toBe(400);
    expect((await post(stack, [PAID, PAID, PAID, PAID])).statusCode).toBe(400);
    expect((await post(stack, [PAID, PAID, 'scrap_servo'])).statusCode).toBe(400);
    expect(heldBy(stack)[PAID] ?? 0).toBe(REIMAGINING_PAGES_SPENT + 1);
  });

  it('refuses a crew with no Head of Research, and spends nothing', async () => {
    const stack = await crew();
    openTheLab(stack, { seat: false });
    hold(stack, STACK);

    const res = await post(stack, THREE);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('not_available');
    expect(heldBy(stack)[PAID] ?? 0, 'pages went on a refused trade').toBe(
      REIMAGINING_PAGES_SPENT + 1,
    );
  });

  it('refuses a crew that has not researched it, however many pages they are sitting on', async () => {
    const stack = await crew();
    openTheLab(stack, { research: false });
    hold(stack, STACK);

    const res = await post(stack, THREE);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('not_available');
  });

  it('refuses once the crew holds every page there is, rather than trading for nothing', async () => {
    const stack = await crew();
    openTheLab(stack);
    // One of everything, plus enough spares of the first to pay with.
    hold(stack, {
      ...Object.fromEntries(ALL_PAGES.map((id) => [id, 1])),
      [PAID]: REIMAGINING_PAGES_SPENT + 1,
    });

    const res = await post(stack, THREE);
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
