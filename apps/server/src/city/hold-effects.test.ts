import {
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  createCommander,
  declarationWindow,
  findLocation,
  skirmishOutcome,
  weatherAt,
  weatherLabels,
  type BattlesResponse,
  type BattleTarget,
  type DistrictDetailResponse,
  type MarketResponse,
  type SkirmishEngine,
  marketDay,
  vendorSessionsFor,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { projectMarket } from '../market/board.js';
import { settleBattles } from '../battle/resolve.js';

/**
 * §A4: what holding a location is worth, measured where it is meant to arrive.
 *
 * `channels.test.ts` proves every channel is *non-zero* for a crew holding the city. That is a
 * check on the catalogue and it passes happily while the thing that reads the channel is looking
 * at the wrong fold, assigning over the result, or not looking at all, which is what four of them
 * were doing. So this file measures the other end: the screen, the till and the stockpile.
 *
 * Every case here is a bug that shipped:
 *
 *   * the Bone Market's refund was computed, reported on the battle card, and never banked, and
 *     on the one fight that pays anything, overwritten by the plunder;
 *   * the Watchtower's intel bonus reached neither reader, because both asked the crew-only fold
 *     and the channel lives on territory;
 *   * the Downtown Market quoted the catalogue price and charged the discounted one;
 *   * the Statue's capture infamy was authored and read by nothing.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

/** Hands the fight to the attacker and kills four of the defenders, so there is loss to refund. */
const bloody: SkirmishEngine = {
  resolve: (input) =>
    skirmishOutcome({
      winner: 'attacker',
      log: ['decided'],
      killed: input.defending,
      winnerLosses: { razors: 4 },
    }),
};

/**
 * The same win with nobody killed on either side.
 *
 * For the cases where the *kill* infamy would drown the thing being measured: it scales with the
 * garrison, garrisons scale with a location's `baseDefense`, and two different locations therefore
 * pay wildly different infamy for reasons that have nothing to do with the clause under test.
 */
const bloodless: SkirmishEngine = {
  resolve: () => skirmishOutcome({ winner: 'attacker', log: ['walked in'] }),
};

async function makeStack(engine: SkirmishEngine = bloody): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'holder', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  const baseId = chosen.json<{ base: { id: string } }>().base.id;

  await app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(token),
    payload: { districtId: 'rustyard' },
  });
  return { app, db, token, baseId };
}

/** Hands this crew a location outright, at `level`, so its hold bonus is live. */
function give(stack: Stack, locationId: string, level = MAX_LOCATION_LEVEL): void {
  const control = stack.app.repos.city.control(locationId);
  if (!control) throw new Error(`no control row for ${locationId}`);
  stack.app.repos.city.put({
    ...control,
    holder: { kind: 'faction', baseId: stack.baseId },
    level,
    garrison: {},
  });
}

/** Declares, deploys and settles one fight, and answers with the caps it moved. */
async function fight(stack: Stack, target: BattleTarget, sent: Record<string, number>) {
  const before = stack.app.repos.bases.findById(stack.baseId);
  const declared = await stack.app.inject({
    method: 'POST',
    url: '/api/battles/declare',
    headers: auth(stack.token),
    payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
  });
  expect(declared.statusCode, declared.body).toBe(200);

  const board = await stack.app.inject({
    method: 'GET',
    url: '/api/battles',
    headers: auth(stack.token),
  });
  const view = board.json<BattlesResponse>().coming[0];
  if (!view) throw new Error('expected a declared battle');
  await stack.app.inject({
    method: 'POST',
    url: '/api/battles/deploy',
    headers: auth(stack.token),
    payload: { battleId: view.battle.id, changes: sent, perimeterChanges: {} },
  });
  stack.db
    .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
    .run(new Date(Date.now() - 60_000).toISOString(), view.battle.id);

  settleBattles(stack.app.repos, stack.app.skirmishEngine, new Date());
  const after = stack.app.repos.bases.findById(stack.baseId);
  return {
    caps: (after?.resources.caps ?? 0) - (before?.resources.caps ?? 0),
    infamy: (after?.economy.infamy ?? 0) - (before?.economy.infamy ?? 0),
  };
}

describe('the Bone Market pays for what a fight cost', () => {
  /**
   * The refund is banked, and it is banked on a *location* fight: the path where nothing else
   * touches the stockpile, and therefore the path where the credit was silently skipped.
   */
  it('turns the attacker’s dead into caps', async () => {
    const stack = await makeStack();
    stack.app.repos.bases.updateArmy(stack.baseId, { razors: 20 }, []);
    give(stack, 'rustyard-bones');

    const target: BattleTarget = {
      kind: 'location',
      districtId: 'rustyard',
      locationId: 'rustyard-press',
    };
    const { caps } = await fight(stack, target, { razors: 8 });
    expect(caps, 'the refund never reached the stockpile').toBeGreaterThan(0);
  });

  /** And a crew that does not hold one gets nothing, which is what makes the case above a bonus. */
  it('pays nothing to a crew that does not hold it', async () => {
    const stack = await makeStack();
    stack.app.repos.bases.updateArmy(stack.baseId, { razors: 20 }, []);

    const target: BattleTarget = {
      kind: 'location',
      districtId: 'rustyard',
      locationId: 'rustyard-press',
    };
    const { caps } = await fight(stack, target, { razors: 8 });
    expect(caps).toBe(0);
  });
});

describe('the Statue of the Revolutionist', () => {
  it('pays its infamy the moment it changes hands, and only then', async () => {
    const statue = findLocation('combine-spire-statue');
    expect(statue, 'the Statue is not on the map').toBeDefined();
    expect(LOCATION_CATALOG[statue!.kind].captureInfamy ?? 0).toBeGreaterThan(0);

    // Nobody dies, so the only infamy either fight pays is what the *ground* is worth, which is
    // the whole claim, and is otherwise buried under a kill count that varies by garrison size.
    const stack = await makeStack(bloodless);
    stack.app.repos.bases.updateArmy(stack.baseId, { razors: 20 }, []);
    await stack.app.inject({
      method: 'POST',
      url: '/api/city/scout',
      headers: auth(stack.token),
      payload: { districtId: 'combine-spire' },
    });
    // The Spire is held end to end at the start, so its gate is armed. One location off the
    // Combine opens the seam a location fight needs.
    give(stack, 'combine-spire-uplink', 1);

    const plain = await fight(
      stack,
      {
        kind: 'location',
        districtId: 'combine-spire',
        locationId: 'combine-spire-armory',
      },
      { razors: 6 },
    );
    const withStatue = await fight(
      stack,
      {
        kind: 'location',
        districtId: 'combine-spire',
        locationId: 'combine-spire-statue',
      },
      { razors: 6 },
    );

    /*
     * Both captures pay §D8's flat "took ground off the Combine at a seat of its power" infamy, and
     * with nobody killed that is *all* an ordinary one pays, so the whole difference between the
     * two is the Statue's own clause, and it is asserted to the number rather than to a direction.
     */
    expect(plain.infamy).toBeGreaterThan(0);
    expect(withStatue.infamy - plain.infamy, 'the Statue paid nothing for changing hands').toBe(
      LOCATION_CATALOG[statue!.kind].captureInfamy,
    );
  });
});

describe('the Downtown Market', () => {
  /**
   * The shelf and the till, from one read.
   *
   * The failure was not that the discount did nothing: the till applied it. It was that the card
   * quoted the catalogue price and judged `affordable` against it, so a crew holding the floor was
   * shown a price they would not pay and, at the margin, a dead button over a purchase that would
   * have gone through.
   */
  it('quotes the price it is going to charge', async () => {
    const stack = await makeStack();
    /*
     * Read through `projectMarket` at an hour the Runner is actually there, rather than over HTTP
     * at whatever hour the suite runs at.
     *
     * The barrow is empty while he is away now, and an empty shelf makes the loop below iterate
     * zero times: the assertion would pass on a discount that was never applied. This is the same
     * function the route calls and the one the discount is applied in.
     */
    const day = marketDay(new Date());
    const session = vendorSessionsFor(day)[0];
    if (!session) throw new Error('fixture error: the Runner keeps no hours today');
    const whileHeIsIn = new Date(`${day}T${String(session.startHour).padStart(2, '0')}:30:00.000Z`);
    const read = (): MarketResponse =>
      projectMarket(stack.app.repos, stack.app.repos.bases.findById(stack.baseId)!, whileHeIsIn);

    const before = read();
    await stack.app.inject({
      method: 'POST',
      url: '/api/city/scout',
      headers: auth(stack.token),
      payload: { districtId: 'chrome-row' },
    });
    give(stack, 'chrome-row-exchange');
    const after = read();

    // Something is on the shelf to compare, or the assertion below is vacuous.
    expect(before.vendor.stock.length).toBeGreaterThan(0);
    for (const [index, offer] of after.vendor.stock.entries()) {
      const was = before.vendor.stock[index]?.line.price ?? 0;
      expect(offer.line.price, 'the shelf still quotes the catalogue price').toBeLessThan(was);
    }
  });
});

describe('the Watchtower', () => {
  /**
   * Intel is people *and* ground.
   *
   * `intelYieldPercent` moved onto `TerritoryEffects` precisely so a Watchtower and a Head Spy
   * would push one lever, and both readers kept asking the crew-only fold, so the location's
   * whole advertised reward moved nothing. Measured through the district view's blurred garrison
   * count, which is the number the channel exists to sharpen.
   */
  it('sharpens what a scout brings back about a rival', async () => {
    const stack = await makeStack();

    // A second crew, so there is somebody whose ground can be looked at and whose deception is
    // what the intel channel has to cut through.
    const registered = await stack.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'rival_crew', password: 'hunter2pass' },
    });
    const rivalToken = registered.json<{ token: string }>().token;
    const rivalBase = await stack.app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(rivalToken),
      payload: { presetId: 'enforcer' },
    });
    const rivalId = rivalBase.json<{ base: { id: string } }>().base.id;

    /*
     * And a liar on their books, or there is nothing for intel to cut through.
     *
     * `blurAgainst` is `max(0, theirResistance - myYield)`, so against a crew with no Deception the
     * count is already exact and no amount of Watchtower can sharpen it further: the test would
     * pass for the wrong reason, or fail for one.
     *
     * Seated as Head Spy deliberately, and carrying **both** attributes that drive the channel.
     * The seat rates Deception as essential rather than irreplaceable, so it pays three quarters
     * (`IMPORTANCE_SHARE`), and one attribute at 90 no longer clears the reader's own yield: the
     * count came back exact and the assertion below failed with `40 not to be 40`, which is this
     * fixture being too weak rather than the Watchtower being broken. Cryptography drives the same
     * channel and the seat rates it useful, so the pair together put a real blur on the count.
     */
    stack.app.repos.bases.updateCommanders(rivalId, [
      createCommander(
        'rival-spy',
        'The Ghost',
        'head_spy',
        { deception: 100, cryptography: 100 },
        [],
      ),
    ]);

    const press = stack.app.repos.city.control('rustyard-press');
    if (!press) throw new Error('no ground to look at');
    stack.app.repos.city.put({
      ...press,
      holder: { kind: 'faction', baseId: rivalId },
      // 37 rather than a round 40, and that is load-bearing. `blurredCount` rounds to a grain of
      // `1 + floor(blur / 8)`, and 40 lands back on 40 at grains 1, 2, 4, 5 and 8: a garrison of
      // forty made this assertion pass or fail on whether the blur happened to hit one of the
      // grains that move it, which is luck rather than a gate. 37 moves at every grain above 1.
      garrison: { razors: 37 },
    });

    const count = async (): Promise<number> => {
      const res = await stack.app.inject({
        method: 'GET',
        url: '/api/city/rustyard',
        headers: auth(stack.token),
      });
      const view = res
        .json<DistrictDetailResponse>()
        .locations.find((l) => l.location.id === 'rustyard-press');
      return view?.garrisonSize ?? -1;
    };

    const blurred = await count();
    await stack.app.inject({
      method: 'POST',
      url: '/api/city/scout',
      headers: auth(stack.token),
      payload: { districtId: 'blacksite-7' },
    });
    give(stack, 'blacksite-7-watchtower');
    const sharp = await count();

    // The rival's deception blurs the count; the Watchtower is what cuts through it. Whichever way
    // this fixture's numbers land, holding it must *change* the reading: nothing is the bug.
    expect(sharp, 'the Watchtower changed nothing about what a scout sees').not.toBe(blurred);
    expect(Math.abs(sharp - 37)).toBeLessThanOrEqual(Math.abs(blurred - 37));
  });
});

describe('the sky a fight happens under', () => {
  /**
   * A battle is fought in the weather it was **called for**, not the weather it was settled in.
   *
   * Battles settle lazily, so the gap between the two is however long it takes somebody to open a
   * page: hours, overnight, longer. Reading the settle clock meant a fight declared for a foggy
   * evening could be decided in the next morning's sunshine, and *which* morning depended on when
   * a stranger loaded a screen.
   */
  it('reads the sky at the scheduled hour rather than at the settle', async () => {
    // A day apart, so two different rolls. The precondition is asserted rather than assumed: if
    // these two moments ever shared a sky the test below would pass without measuring anything.
    const called = new Date('2026-12-03T23:30:00.000Z');
    const settled = new Date('2026-12-04T11:00:00.000Z');
    expect(weatherAt(called)).not.toBe(weatherAt(settled));

    const stack = await makeStack(bloodless);
    stack.app.repos.bases.updateArmy(stack.baseId, { razors: 20 }, []);

    const declared = await stack.app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(stack.token),
      payload: {
        target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body).toBe(200);
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/battles',
      headers: auth(stack.token),
    });
    const view = board.json<BattlesResponse>().coming[0];
    if (!view) throw new Error('expected a declared battle');

    // Called for that stormy evening; settled the next lunchtime, which is when somebody happened
    // to open a page. The fight is the one that was called for.
    stack.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(called.toISOString(), view.battle.id);
    settleBattles(stack.app.repos, stack.app.skirmishEngine, settled);

    const [resolved] = stack.app.repos.sieges.resolvedFor(stack.baseId, 1);
    expect(resolved, 'the battle never resolved').toBeDefined();
    expect(resolved?.analysis.weather, 'the fight was resolved in the settler’s weather').toBe(
      weatherAt(called),
    );
    /*
     * And the ground actually carries that sky's labels.
     *
     * The line above is the discriminating half: `analysis.weather` names which of the two days
     * was read. This half is the one that catches a sky recorded on the report and never applied
     * to the fight, which is the same feature-shipped-and-inert shape the boost seam guards.
     *
     * Positive only. A "not the settler's sky" assertion cannot be written cleanly here because
     * the location carries labels of its own (`crammed`, `noisy`) that overlap whatever the other
     * day happens to roll, and an assertion that has to exclude those is one that will be quietly
     * vacuous the day the catalogue changes.
     */
    const ground = resolved?.analysis.ground.map((label) => label.id) ?? [];
    const sky = weatherLabels(weatherAt(called));
    expect(sky.length, 'the called day must have a sky worth asserting').toBeGreaterThan(0);
    for (const label of sky) expect(ground).toContain(label.id);
  });
});
