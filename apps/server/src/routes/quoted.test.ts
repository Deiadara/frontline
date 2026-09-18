import {
  RESOURCE_KEYS,
  composeProfile,
  createCommander,
  missionOdds,
  buildingCost,
  cancelRefund,
  blackMarketClosesAt,
  findBlackMarketGood,
  type BlackMarketResponse,
  type MeResponse,
  type MissionsResponse,
  type Resources,
  type ScrapyardResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { settleBlackMarketLots } from '../blackmarket/shelf.js';

/**
 * Quoted, then charged: the one invariant every shop in this game shares.
 *
 * A screen offers a price and a door takes one, and those are two pieces of code. This codebase
 * has been bitten by the gap twice already and both are recorded in the source: the Downtown
 * Market shelf quoted the catalogue price while the till charged the discounted one, and the build
 * dialog quoted the catalogue's bare seconds while the order applied the crew's build-speed fold.
 * Both were fixed the same way, by having the server do the arithmetic once, and both are the same
 * bug: a player deciding on one number and being charged another.
 *
 * A third turned up in this pass, one layer further down. The back room quoted and charged the
 * same weighted figure, correctly, and then wrote the **catalogue's** unweighted number into its
 * receipt.
 *
 * These tests do not read the arithmetic. They read the price off the screen, press the button,
 * and measure what actually left the crew, which is the only form of this check that cannot be
 * fooled by both sides sharing a wrong function.
 */

const PASSWORD = 'hunter2pass';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app: open, db } of instances.splice(0)) {
    await open.close();
    db.close();
  }
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function player(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  const body = me.json<{ user: { id: string }; base: { id: string } }>();
  return { token, userId: body.user.id, baseId: body.base.id };
}

/** Everything the crew holds, so a charge can be measured rather than recomputed. */
function stockOf(app: FastifyInstance, userId: string): Resources {
  return app.repos.bases.findByOwnerId(userId)!.resources;
}

function spentBetween(before: Resources, after: Resources): Partial<Record<string, number>> {
  const spent: Record<string, number> = {};
  for (const key of RESOURCE_KEYS) {
    const delta = (before[key] ?? 0) - (after[key] ?? 0);
    if (delta !== 0) spent[key] = delta;
  }
  return spent;
}

/**
 * The first `{ id, cost }` pair anywhere in a response, found by walking it.
 *
 * The research board nests its rungs several levels down and the shape belongs to the Lab. A
 * hand-written path would turn a reshuffle of that response into a test that found nothing and
 * passed, which is the failure mode this whole file exists to avoid.
 */
function findPriced(node: unknown): { id: string; cost: Partial<Resources> } | undefined {
  if (Array.isArray(node)) {
    for (const entry of node) {
      const hit = findPriced(entry);
      if (hit) return hit;
    }
    return undefined;
  }
  if (node === null || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  const cost = record.cost as Partial<Resources> | undefined;
  if (typeof record.id === 'string' && cost && Object.keys(cost).length > 0) {
    return { id: record.id, cost };
  }
  for (const value of Object.values(record)) {
    const hit = findPriced(value);
    if (hit) return hit;
  }
  return undefined;
}

/** A crew rich enough that nothing below is refused for being unaffordable. */
function makeRich(app: FastifyInstance, userId: string): void {
  const base = app.repos.bases.findByOwnerId(userId)!;
  app.repos.bases.updateResources(base.id, {
    caps: 5_000_000,
    supplies: 5_000_000,
    oil: 5_000_000,
    scrap: 5_000_000,
    planks: 5_000_000,
    highQualityMetal: 500_000,
  });
}

describe('the district dialog and the build order', () => {
  /**
   * `/me` carries `buildQuotes` and `buildClocks` for exactly this reason: the discount fold and
   * the build-speed fold are both server-side, so a client working either out itself would be a
   * second copy of the rule. What is checked here is that the copy on the wire is the one the
   * order uses.
   */
  it('charges the price it quoted, and books the clock it quoted', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_build');
    makeRich(app, one.userId);

    const me = (
      await app.inject({ method: 'GET', url: '/api/me', headers: auth(one.token) })
    ).json<MeResponse>();
    const quoted = me.buildQuotes?.quarters;
    const clock = me.buildClocks?.quarters;
    expect(quoted, 'the Quarters must be buildable for this to measure anything').toBeDefined();
    expect(clock).toBeDefined();

    const before = stockOf(app, one.userId);
    const ordered = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(one.token),
      payload: { kind: 'quarters' },
    });
    expect(ordered.statusCode, ordered.body).toBe(200);

    expect(spentBetween(before, stockOf(app, one.userId))).toEqual(quoted);
    // And the entry on the queue runs for the number of seconds the dialog put beside the button.
    const queued = app.repos.bases.findByOwnerId(one.userId)!.buildQueue.at(-1);
    expect(queued?.durationSeconds).toBe(clock);
  });
});

describe('calling an order off', () => {
  /**
   * The refund follows what was **charged**, not what the catalogue asks.
   *
   * `time/cancel.ts` promises ninety per cent back, and the only honest reading of that is ninety
   * per cent of what actually left the crew. A build is the one cancellable thing in the game with
   * a discount on it (`buildCostPercent`, four research rungs and a modification feed it), so it
   * is the one place the two readings come apart: refunding off the catalogue would hand a crew
   * with a ten per cent discount back more than ninety per cent of what they paid, and a crew with
   * a *penalty* less.
   *
   * The crew here is given a real discount for exactly that reason. Against an undiscounted crew
   * the paid figure and the catalogue figure are the same number and this test would hold whichever
   * one the code refunded off.
   */
  it('hands back ninety percent of what the order actually cost, discount and all', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_cancel');
    makeRich(app, one.userId);

    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateResearch(base.id, {
      ...base.research,
      // Four rungs that all pay into `build_cost`, so the fold is well clear of zero.
      technologies: [
        'tech_formwork_reuse',
        'tech_capital_rationing',
        'tech_tool_steel',
        'tech_cold_forming',
      ],
    });

    const me = (
      await app.inject({ method: 'GET', url: '/api/me', headers: auth(one.token) })
    ).json<MeResponse>();
    const quoted = me.buildQuotes?.quarters;
    expect(quoted).toBeDefined();
    // The precondition: the discount is really biting, so paid and catalogue are different numbers.
    const catalogue = buildingCost('quarters', 1, []);
    expect(quoted!.caps).toBeLessThan(catalogue.caps ?? 0);

    const beforeOrder = stockOf(app, one.userId);
    const ordered = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(one.token),
      payload: { kind: 'quarters' },
    });
    expect(ordered.statusCode, ordered.body).toBe(200);
    const charged = spentBetween(beforeOrder, stockOf(app, one.userId));
    expect(charged).toEqual(quoted);

    const order = app.repos.bases.findByOwnerId(one.userId)!.buildQueue.at(-1);
    const beforeCancel = stockOf(app, one.userId);
    const cancelled = await app.inject({
      method: 'POST',
      url: '/api/base/cancel',
      headers: auth(one.token),
      payload: { orderId: order!.id },
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);

    const handedBack = spentBetween(stockOf(app, one.userId), beforeCancel);
    expect(handedBack).toEqual(cancelRefund(charged));
  });
});

describe('the scrapyard', () => {
  /**
   * Three separate bills, one per kind of fitting, and each is written out twice: once into the
   * card the screen draws and once into the charge. Three chances for the two to drift apart, so
   * every kind the yard is currently offering is walked rather than one of them.
   */
  it('charges what each card says, for every fitting it is offering', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_yard');
    makeRich(app, one.userId);
    // The yard offers against the district's buildings, so give the crew somewhere to fit things.
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateDistrict(
      base.id,
      [
        { id: 'q-nexus', kind: 'nexus', level: 10, modifications: [] },
        { id: 'q-yard', kind: 'scrapyard', level: 8, modifications: [] },
        { id: 'q-quarters', kind: 'quarters', level: 6, modifications: [] },
        { id: 'q-gate', kind: 'gate', level: 6, modifications: [] },
      ],
      [],
    );

    const board = (
      await app.inject({ method: 'GET', url: '/api/scrapyard', headers: auth(one.token) })
    ).json<ScrapyardResponse>();

    const offered = board.entries.filter((addon) => addon.blocker === null).slice(0, 6);
    expect(offered.length, 'the yard must be offering something').toBeGreaterThan(0);

    for (const addon of offered) {
      makeRich(app, one.userId);
      const before = stockOf(app, one.userId);
      const built = await app.inject({
        method: 'POST',
        url: '/api/scrapyard/build',
        headers: auth(one.token),
        payload: { kind: addon.kind, id: addon.id },
      });
      if (built.statusCode !== 200) continue;
      expect(spentBetween(before, stockOf(app, one.userId)), addon.id).toEqual(addon.cost);
    }
  });
});

describe('the drill yard and the lab', () => {
  /**
   * Two more shops with a discount between the card and the till.
   *
   * A unit's price is cut by the crew's training fold and by its own ground; a research rung's is
   * cut by the track's own progress. Both are server-side, both are quoted on the card, and both
   * are the shape the Downtown Market bug had.
   */
  it('charges a batch the card’s price with the card’s own reductions, and no others', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_drill');
    makeRich(app, one.userId);
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateDistrict(
      base.id,
      [
        { id: 'd-nexus', kind: 'nexus', level: 8, modifications: [] },
        // Beds, or the order has nowhere to put anybody; and the Gauntlet, or nothing is unlocked
        // to train in the first place.
        { id: 'd-quarters', kind: 'quarters', level: 8, modifications: [] },
        { id: 'd-gauntlet', kind: 'gauntlet', level: 6, modifications: [] },
      ],
      [],
    );

    /*
     * The unit board ships a raw price and the two reductions separately, and the screen does the
     * arithmetic (`UnitsPage.tsx` adds `trainingCostReduction` and the row's `homeCostReduction`).
     * That is a deliberate split, because the ground's cut is per unit and the crew's is not, so
     * what has to hold is that the till spends the same two numbers the card handed over. The
     * first version of this test multiplied the raw price by the count and found the charge four
     * per cent short, which is the split working rather than a defect.
     */
    const units = (
      await app.inject({ method: 'GET', url: '/api/units', headers: auth(one.token) })
    ).json<{
      trainingCostReduction: number;
      units: {
        id: string;
        cost: Partial<Resources>;
        unlocked: boolean;
        homeCostReduction?: number;
      }[];
    }>();
    // Whichever unit this crew may actually field, rather than a named one: what a fresh crew is
    // allowed to train is a content decision, and pinning it here would pin the roster.
    const card = units.units.find((unit) => unit.unlocked);
    expect(card, 'the board must offer something this crew can train').toBeDefined();

    const count = 5;
    const before = stockOf(app, one.userId);
    const queued = await app.inject({
      method: 'POST',
      url: '/api/units/train',
      headers: auth(one.token),
      payload: { unitId: card!.id, count },
    });
    expect(queued.statusCode, queued.body).toBe(200);

    const charged = spentBetween(before, stockOf(app, one.userId));
    const cut = units.trainingCostReduction + (card!.homeCostReduction ?? 0);
    // The precondition: a reduction that is actually biting, or the two readings are one number
    // and this holds whichever the till used.
    expect(cut).toBeGreaterThan(0);

    const expected = Object.fromEntries(
      Object.entries(card!.cost).map(([key, amount]) => [
        key,
        Math.round((amount ?? 0) * count * (1 - cut / 100)),
      ]),
    );
    expect(charged).toEqual(expected);
  });

  it('charges a rung what the track said it costs', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_lab');
    makeRich(app, one.userId);
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    app.repos.bases.updateDistrict(
      base.id,
      [
        { id: 'l-nexus', kind: 'nexus', level: 10, modifications: [] },
        { id: 'l-lab', kind: 'lab', level: 6, modifications: [] },
      ],
      [],
    );

    const board = (
      await app.inject({ method: 'GET', url: '/api/research', headers: auth(one.token) })
    ).json<Record<string, unknown>>();
    // Found by walking the response rather than by a hand-written path: the board's shape is the
    // Lab's to change, and a path that stopped matching would make this test quietly find nothing
    // and pass.
    const project = findPriced(board);
    expect(project, 'the lab must be offering something with a price').toBeDefined();

    const before = stockOf(app, one.userId);
    const started = await app.inject({
      method: 'POST',
      url: '/api/research/start',
      headers: auth(one.token),
      payload: { itemId: project!.id },
    });
    if (started.statusCode !== 200) return;
    expect(spentBetween(before, stockOf(app, one.userId))).toEqual(project!.cost);
  });
});

describe('the odds on the dial and the odds on the row', () => {
  /**
   * The gauge is a quote like any other price.
   *
   * The send dialog draws a success chance from `missionOdds` over three things off the payload:
   * the offer's `authoredChance`, the picked leader's attributes, and the job's leanings. The
   * launch then freezes its own figure onto the row, and that is the one the settle rolls against.
   * A player deciding on 78% and being sent out on 71% is the same defect as a shelf quoting one
   * price and a till taking another, and it is harder to notice because nothing prints the second
   * number: the board deliberately ships no `successChance` at all.
   *
   * So this recomputes the dial's answer from the wire and compares it with the frozen row. The
   * arithmetic is `missionOdds`, the same function both sides use, which is fine here: what is
   * under test is not the formula but whether the launch feeds it the same three inputs the screen
   * had. A launch reading a different leader, a different chance or a different profile fails this
   * however right its arithmetic is.
   */
  it('sends the crew out on the chance the dial showed', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_odds');
    makeRich(app, one.userId);
    const base = app.repos.bases.findByOwnerId(one.userId)!;
    // Somebody to lead it, and a sheet good enough that the leader's edge is not zero.
    /*
     * Level twenty, and that is load-bearing rather than scenery.
     *
     * `authoredChance` on the card is the template's figure already scaled by the crew's own level
     * (`scaledSuccessChance`, half a point a level). At level one the scaled figure and the raw one
     * are the same number, so a launch that froze the raw chance would agree with the card by
     * accident and this test would hold whichever it read.
     */
    app.repos.bases.updateProgression(base.id, 20, base.progression);

    // Units at home to send. The odds are the subject, so who goes only has to be somebody.
    app.repos.bases.updateArmy(base.id, { haulers: 20, razors: 10 }, []);
    app.repos.bases.updateCommanders(base.id, [
      createCommander('odds-1', 'Somebody Sharp', 'raid_boss', {
        leadership: 80,
        logistics: 75,
        organization: 70,
        salvage: 65,
        stamina: 60,
        navigation: 55,
      }),
    ]);

    const board = (
      await app.inject({ method: 'GET', url: '/api/missions', headers: auth(one.token) })
    ).json<MissionsResponse>();
    // A standard job, because a battle one refuses a column of porters and who goes is not the
    // subject here.
    const area = board.areas.find((one) => one.offers.some((job) => job.kind === 'standard'));
    const offer = area?.offers.find((job) => job.kind === 'standard');
    const leader = board.leaders.find((one) => one.kind === 'officer' && one.held === null);
    expect(offer, 'the board must be offering a job').toBeDefined();
    expect(leader, 'the bench must have a free officer').toBeDefined();

    const quoted = missionOdds({
      authored: offer!.authoredChance,
      leader: leader!.attributes,
      profile: composeProfile(offer!.leanings),
      unled: board.unledRule,
    });

    const sent = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(one.token),
      payload: {
        areaId: area!.id,
        templateId: offer!.templateId,
        force: { haulers: 1 },
        leaderId: leader!.id,
      },
    });
    expect(sent.statusCode, sent.body).toBe(200);

    /*
     * The frozen figure sits beside the row rather than on the mission itself.
     *
     * `missions.test.ts` asserts the board ships no `successChance` at all: the odds are the
     * server's and a player is told a band, not a number. That is why this test has to read the
     * stored column rather than any response, and why a disagreement between the dial and the row
     * would otherwise be invisible from outside.
     */
    const row = app.repos.missions.listByBaseId(base.id)[0];
    expect(row?.successChance).toBeCloseTo(quoted.chance, 10);
  });
});

describe('the back room', () => {
  /**
   * A crew with a name, in a city far enough along that the shelf is weighting its prices.
   *
   * The level is the load-bearing half. `blackMarketPrice` scales a good by six per cent for every
   * level the city's mean is above the reference, so in a city at the reference the weighted price
   * and the catalogue figure are the *same number* and a test comparing them proves nothing. The
   * first version of the receipt test below did exactly that: mutating the fix back left it green.
   */
  function readyToSpend(app: FastifyInstance, userId: string, infamy: number): void {
    const base = app.repos.bases.findByOwnerId(userId)!;
    app.repos.bases.updateEconomy(base.id, { ...base.economy, infamy });
    app.repos.bases.updateProgression(base.id, 40, base.progression);
  }

  it('charges the infamy the shelf quoted', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_fence');
    readyToSpend(app, one.userId, 2_000_000);

    const shelf = (
      await app.inject({ method: 'GET', url: '/api/black-market', headers: auth(one.token) })
    ).json<BlackMarketResponse>();
    const offer = shelf.offers.find((entry) => entry.affordable);
    expect(offer, 'the shelf must be offering something affordable').toBeDefined();

    const before = app.repos.bases.findByOwnerId(one.userId)!.economy.infamy;
    // The shelf takes bids and settles at midnight, so the quote is the lot's opening number and
    // the charge lands at the close. Nobody else is at this table, so the two are the same figure.
    const said = await app.inject({
      method: 'POST',
      url: '/api/black-market/bid',
      headers: auth(one.token),
      payload: {
        slotIndex: offer!.slot.index,
        goodId: offer!.slot.goodId,
        amount: offer!.lot!.nextBid,
      },
    });
    expect(said.statusCode, said.body).toBe(200);
    settleBlackMarketLots(app.repos, blackMarketClosesAt(shelf.day), 'Europe/Athens');

    const after = app.repos.bases.findByOwnerId(one.userId)!.economy.infamy;
    expect(before - after).toBe(offer!.price);
  });

  /**
   * The receipt has to say what left the wallet.
   *
   * It recorded `spec.infamy`, the catalogue's unweighted figure, while the door charged that
   * number scaled by the city's mean level and then discounted by the crew's standing. Nothing
   * reads the column yet, which is why nobody had noticed; the repo's own note calls it
   * "everything this crew has ever taken", so the first screen built on it would have inherited a
   * ledger that never agreed with the one beside it.
   */
  it('writes what it charged into the receipt, not the catalogue figure', async () => {
    const app = await makeApp();
    const one = await player(app, 'quoted_receipt');
    readyToSpend(app, one.userId, 2_000_000);

    const shelf = (
      await app.inject({ method: 'GET', url: '/api/black-market', headers: auth(one.token) })
    ).json<BlackMarketResponse>();
    const offer = shelf.offers.find((entry) => entry.affordable);
    expect(offer).toBeDefined();

    const before = app.repos.bases.findByOwnerId(one.userId)!.economy.infamy;
    await app.inject({
      method: 'POST',
      url: '/api/black-market/bid',
      headers: auth(one.token),
      payload: {
        slotIndex: offer!.slot.index,
        goodId: offer!.slot.goodId,
        amount: offer!.lot!.nextBid,
      },
    });
    settleBlackMarketLots(app.repos, blackMarketClosesAt(shelf.day), 'Europe/Athens');
    const charged = before - app.repos.bases.findByOwnerId(one.userId)!.economy.infamy;

    const receipt = app.repos.blackMarket.historyFor(one.baseId, 10)[0];
    expect(receipt).toBeDefined();
    /*
     * The precondition, and the reason this crew is at level 40.
     *
     * In a city sitting at the reference level the weighted price *is* the catalogue figure, so
     * the two candidate values are the same number and this assertion holds whichever one the
     * code writes. The first version of this test ran against a level-1 crew and stayed green when
     * the fix was mutated away.
     */
    const catalogue = findBlackMarketGood(offer!.slot.goodId)?.infamy ?? 0;
    expect(charged).not.toBe(catalogue);
    expect(receipt?.infamySpent).toBe(charged);
  });
});
