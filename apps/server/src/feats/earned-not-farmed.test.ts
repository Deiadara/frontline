import {
  BARTER_MINIMUM,
  MARKET_DEAL_FLOOR_CAPS,
  featMeasureKey,
  unitSlotsUsed,
  type FeatMeasure,
  type Resources,
} from '@frontline/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { settleMovements } from '../battle/movement.js';
import { acceptOffer, barter, postOffer } from '../market/board.js';
import {
  auth,
  closeWorlds,
  declare,
  faction,
  holdPlot,
  makeWorld,
  register,
  runTheFight,
  type Crew,
  type World,
} from '../testing/fight-world.js';

/**
 * Four feat counters the 2026-09-28 audit found paying for things that did not happen.
 *
 * - A column sent to a fight and recalled banked `bodies_deployed` and `supply_deployed` at the send.
 * - Every Broker barter and every listing taken was a buy or a sale, however small and however often.
 * - A gate fight won counted as a gate captured, and nobody holds a gate after winning at it.
 * - A faction ally who fought in somebody's fight was credited nothing, and its kills went to the
 *   crew that called it.
 *
 * Each case below drives the real door and reads `crew_tallies` afterwards, and pins what must not
 * move beside what must.
 */

afterEach(closeWorlds);

const read = (world: World, crew: Crew, measure: FeatMeasure): number =>
  world.app.repos.feats.tallies(crew.baseId)[featMeasureKey(measure)] ?? 0;

const RICH: Resources = {
  caps: 50_000,
  supplies: 5_000,
  oil: 5_000,
  scrap: 5_000,
  planks: 5_000,
  highQualityMetal: 500,
};

describe('a column put on the ground', () => {
  it('counts nothing for a column recalled on the way, and the whole column when one lands', async () => {
    const world = await makeWorld('attacker');
    // Enough for every press: a recalled column is still walking home when the next one goes.
    const caller = await register(world, 'caller', { razors: 200 });
    const holder = await register(world, 'holder');
    holdPlot(world, holder, { razors: 1 });
    const battleId = await declare(world, caller);
    const send = async (razors: number) => {
      const sent = await world.app.inject({
        method: 'POST',
        url: '/api/battles/deploy',
        headers: auth(caller.token),
        payload: { battleId, changes: { razors }, perimeterChanges: {} },
      });
      expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);
      return world.app.repos.movements.forBattle(battleId).find((m) => m.baseId === caller.baseId)!;
    };

    for (let press = 0; press < 5; press += 1) {
      const column = await send(20);
      const recalled = await world.app.inject({
        method: 'POST',
        url: '/api/actions/recall',
        headers: auth(caller.token),
        payload: { movementId: column.id },
      });
      expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);
    }
    expect(read(world, caller, 'bodies_deployed'), 'five recalled columns').toBe(0);
    expect(read(world, caller, 'supply_deployed')).toBe(0);

    const column = await send(20);
    expect(read(world, caller, 'bodies_deployed'), 'still on the road').toBe(0);
    settleMovements(world.app.repos, new Date(column.arrivesAt));
    expect(read(world, caller, 'bodies_deployed')).toBe(20);
    expect(read(world, caller, 'supply_deployed')).toBe(unitSlotsUsed({ razors: 20 }));
  });
});

describe('a deal on the market', () => {
  const DAY_ONE = new Date('2026-09-28T10:00:00.000Z');
  const LATER_THAT_DAY = new Date('2026-09-28T16:00:00.000Z');
  const DAY_TWO = new Date('2026-09-29T10:00:00.000Z');

  async function traders(): Promise<{ world: World; one: Crew; two: Crew }> {
    const world = await makeWorld('attacker');
    const one = await register(world, 'one');
    const two = await register(world, 'two');
    for (const crew of [one, two]) {
      world.app.repos.bases.updateHoldings(crew.baseId, RICH, {});
    }
    return { world, one, two };
  }
  const baseOf = (world: World, crew: Crew) => world.app.repos.bases.findById(crew.baseId)!;

  it('counts a Broker barter only over the floor, and once a day', async () => {
    const { world, one } = await traders();
    const trade = (amount: number, now: Date) => {
      const done = barter(
        world.app.repos,
        baseOf(world, one),
        { give: 'scrap', want: 'oil', amount, acceptWaste: true },
        BARTER_MINIMUM,
        now,
      );
      expect(done.kind).toBe('done');
    };

    for (let press = 0; press < 10; press += 1) trade(BARTER_MINIMUM, DAY_ONE);
    expect(read(world, one, 'market_buys'), 'ten scrap is a trade, not a rung').toBe(0);

    // 200 scrap at half is 125 oil, 250 caps' worth: the floor exactly.
    trade(200, DAY_ONE);
    expect(read(world, one, 'market_buys')).toBe(1);
    trade(200, LATER_THAT_DAY);
    trade(400, LATER_THAT_DAY);
    expect(read(world, one, 'market_buys'), 'the Broker is one counterparty a day').toBe(1);
    trade(200, DAY_TWO);
    expect(read(world, one, 'market_buys')).toBe(2);
  });

  it('counts no wash trade, and one real deal a day between the same two crews', async () => {
    const { world, one, two } = await traders();
    const deal = (give: Partial<Resources>, want: Partial<Resources>, now: Date) => {
      const posted = postOffer(
        world.app.repos,
        baseOf(world, one),
        { resources: give, items: {} },
        { resources: want, items: {} },
        undefined,
        now,
      );
      if (posted.kind !== 'done' || !posted.offer) throw new Error('fixture: listing refused');
      const taken = acceptOffer(world.app.repos, baseOf(world, two), posted.offer.id, now, true);
      expect(taken.kind).toBe('done');
    };
    const tallies = () => [read(world, one, 'market_sales'), read(world, two, 'market_buys')];

    for (let press = 0; press < 5; press += 1) deal({ scrap: 1 }, { scrap: 1 }, DAY_ONE);
    expect(tallies(), 'one scrap for one scrap, five times').toEqual([0, 0]);

    // Lopsided counts its smaller side: a thousand caps for ten scrap is a 25-cap deal.
    deal({ scrap: 10 }, { caps: 1_000 }, DAY_ONE);
    expect(tallies()).toEqual([0, 0]);

    const worth = MARKET_DEAL_FLOOR_CAPS / 2.5;
    deal({ scrap: worth }, { caps: MARKET_DEAL_FLOOR_CAPS }, DAY_ONE);
    expect(tallies()).toEqual([1, 1]);
    deal({ scrap: worth }, { caps: MARKET_DEAL_FLOOR_CAPS }, LATER_THAT_DAY);
    expect(tallies(), 'the same pair, the same day').toEqual([1, 1]);
    deal({ scrap: worth }, { caps: MARKET_DEAL_FLOOR_CAPS }, DAY_TWO);
    expect(tallies()).toEqual([2, 2]);
  });
});

describe('a gate fight won', () => {
  it('counts a gate broken and no location captured', async () => {
    const world = await makeWorld('attacker');
    const caller = await register(world, 'caller');
    const resident = await register(world, 'resident');
    const districtId = world.app.repos.bases.findById(resident.baseId)!.districtId;
    world.app.repos.sieges.insert({
      id: 'gate-fight',
      target: { kind: 'gate', districtId },
      attackerBaseId: caller.baseId,
      defender: { kind: 'unoccupied' },
      scheduledFor: new Date(Date.now() + 9 * 3_600_000).toISOString(),
      declaredAt: new Date().toISOString(),
      resolvedAt: null,
      seed: 'seed',
      holdAfterCapture: true,
      wokeSleepers: false,
    });
    runTheFight(world, 'gate-fight');
    expect(
      world.app.repos.sieges.gate(districtId)?.brokenUntil,
      'fixture: the gate broke',
    ).toBeTruthy();
    expect(read(world, caller, 'gates_breached')).toBe(1);
    expect(read(world, caller, 'locations_captured')).toBe(0);
    expect(read(world, caller, 'battles_won'), 'the fight itself still counts').toBe(1);
  });
});

describe('a fight with allies in it', () => {
  it('credits every crew in the line its own fight and its own share of the kills', async () => {
    // The attacker wins and kills all eight on the plot; the defence takes four with it.
    const world = await makeWorld('attacker', {
      killed: { razors: 8 },
      winnerLosses: { razors: 4 },
    });
    const caller = await register(world, 'caller');
    const friend = await register(world, 'friend');
    const holder = await register(world, 'holder');
    const helper = await register(world, 'helper');
    faction(world, 'f1', [caller, friend]);
    faction(world, 'f2', [holder, helper]);
    holdPlot(world, holder, { razors: 6 });
    const battleId = await declare(world, caller);
    const row = world.app.repos.sieges.deployment(battleId, 'attacker', caller.baseId)!;
    world.app.repos.sieges.putDeployment({ ...row, army: { razors: 9 } });
    world.app.repos.sieges.putDeployment({ ...row, baseId: friend.baseId, army: { razors: 3 } });
    world.app.repos.sieges.putDeployment({
      ...row,
      side: 'defender',
      baseId: helper.baseId,
      army: { razors: 2 },
    });

    runTheFight(world, battleId);
    expect(world.seen().attacking, 'fixture: both attackers stood in the line').toEqual({
      razors: 12,
    });
    expect(world.seen().defending, 'fixture: both defenders stood in the line').toEqual({
      razors: 8,
    });

    const record = (crew: Crew) =>
      (['battles_fought', 'battles_won', 'battles_attacked_won', 'kills'] as const).map((measure) =>
        read(world, crew, measure),
      );
    // Eight killed, split 9:3 between the attackers; four killed, split 6:2 between the defenders.
    expect(record(caller)).toEqual([1, 1, 1, 6]);
    expect(record(friend), 'an ally in the attack').toEqual([1, 1, 1, 2]);
    expect(record(holder)).toEqual([1, 0, 0, 3]);
    expect(record(helper), 'an ally in the defence').toEqual([1, 0, 0, 1]);
  });
});
