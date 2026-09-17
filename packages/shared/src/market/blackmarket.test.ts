import { describe, expect, it } from 'vitest';
import {
  BLACK_MARKET_GOOD_IDS,
  BLACK_MARKET_GOODS,
  BLACK_MARKET_KINDS,
  BLACK_MARKET_SLOTS,
  BLACK_MARKET_TAKES_PER_DAY,
  addToStash,
  blackMarketBoard,
  blackMarketDay,
  findBlackMarketGood,
  averageCityLevel,
  blackMarketBoost,
  blackMarketEffect,
  blackMarketPotency,
  blackMarketPrice,
  discountedInfamy,
  MAX_BLACK_MARKET_POTENCY,
  stashCount,
  takeFromStash,
  blackBidRefusal,
  blackLotId,
  blackLotReserve,
  blackLotSeed,
  blackMarketClosesAt,
} from './blackmarket.js';
import { nextLotBid } from './auction.js';
import { GAME_TIMEZONE } from '../time/zone.js';

const NO_TURNOVER = Array.from({ length: BLACK_MARKET_SLOTS }, () => 0);

describe('the shelf', () => {
  it('is five slots and one take a day, as numbers rather than as constants', () => {
    // Written as literals on purpose. Every other assertion in this file derives its expectation
    // from `BLACK_MARKET_SLOTS`, so lowering that constant to four leaves the whole suite green
    // while the shelf quietly loses a slot: the shape of tautology that hides a half-implemented
    // change. These three lines are the independent anchor: they say what the maintainer asked for.
    expect(BLACK_MARKET_SLOTS).toBe(5);
    expect(BLACK_MARKET_TAKES_PER_DAY).toBe(1);
    expect(blackMarketBoard('2026-08-16', [])).toHaveLength(5);
  });

  it('always stands five deep', () => {
    expect(blackMarketBoard('2026-08-16', NO_TURNOVER)).toHaveLength(BLACK_MARKET_SLOTS);
    // Including from an empty turnover list, which is what a day nobody has shopped on looks like.
    expect(blackMarketBoard('2026-08-16', [])).toHaveLength(BLACK_MARKET_SLOTS);
  });

  it('never shows the same thing twice', () => {
    // A hundred days and a spread of turnover states, because a duplicate that only appears on one
    // seed is a duplicate a player will find on exactly the day it matters.
    for (let day = 1; day <= 100; day++) {
      const date = `2026-08-${String(day % 28 || 1).padStart(2, '0')}`;
      const generations = NO_TURNOVER.map((_, index) => (day * (index + 1)) % 7);
      const board = blackMarketBoard(date, generations);
      expect(new Set(board.map((slot) => slot.goodId)).size).toBe(BLACK_MARKET_SLOTS);
    }
  });

  it('is the same for everybody who asks about the same day', () => {
    const once = blackMarketBoard('2026-08-16', NO_TURNOVER);
    const again = blackMarketBoard('2026-08-16', NO_TURNOVER);
    expect(again).toEqual(once);
  });

  it('is a different shelf tomorrow', () => {
    const today = blackMarketBoard('2026-08-16', NO_TURNOVER).map((slot) => slot.goodId);
    const tomorrow = blackMarketBoard('2026-08-17', NO_TURNOVER).map((slot) => slot.goodId);
    expect(tomorrow).not.toEqual(today);
  });

  it('refills a slot with something else the moment it turns over', () => {
    const before = blackMarketBoard('2026-08-16', NO_TURNOVER);
    const after = blackMarketBoard('2026-08-16', [0, 0, 1, 0, 0]);
    // The slot that moved is different; the four that did not are untouched. That is the whole
    // "taken things are replaced and every slot stays available" rule, in one assertion.
    expect(after[2]?.goodId).not.toBe(before[2]?.goodId);
    expect(after.filter((_, index) => index !== 2).map((slot) => slot.goodId)).toEqual(
      before.filter((_, index) => index !== 2).map((slot) => slot.goodId),
    );
  });

  it('never restocks a slot with the thing that was just taken out of it', () => {
    // The visible half of the refill rule. Walked across a full lap of every slot's deck, because
    // the collision that matters is the wrap-around one.
    for (let index = 0; index < BLACK_MARKET_SLOTS; index++) {
      for (let generation = 0; generation < 40; generation++) {
        const before = blackMarketBoard(
          '2026-08-16',
          NO_TURNOVER.map((_, i) => (i === index ? generation : 0)),
        );
        const after = blackMarketBoard(
          '2026-08-16',
          NO_TURNOVER.map((_, i) => (i === index ? generation + 1 : 0)),
        );
        expect(
          after[index]?.goodId,
          `slot ${index} repeated itself at generation ${generation}`,
        ).not.toBe(before[index]?.goodId);
      }
    }
  });

  it('carries every kind, so the shelf is not five of one thing over a week', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 28; day++) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      for (let generation = 0; generation < 8; generation++) {
        for (const slot of blackMarketBoard(
          date,
          NO_TURNOVER.map(() => generation),
        )) {
          seen.add(BLACK_MARKET_GOODS[slot.goodId]!.kind);
        }
      }
    }
    // Against the enum rather than a list typed here, so a kind added to the shop has to actually
    // reach the shelf: the hardcoded version passed by describing what the shop happened to sell,
    // and went red when pages were added rather than checking that they arrived.
    expect([...seen].sort()).toEqual([...BLACK_MARKET_KINDS].sort());
  });

  it('only ever stocks things the catalogue answers to', () => {
    for (const slot of blackMarketBoard('2026-08-16', [3, 1, 4, 1, 5])) {
      expect(findBlackMarketGood(slot.goodId)).toBeDefined();
    }
  });

  it('prices everything in infamy and nothing in anything else', () => {
    for (const id of BLACK_MARKET_GOOD_IDS) {
      const spec = BLACK_MARKET_GOODS[id];
      expect(spec).toBeDefined();
      expect(spec?.infamy).toBeGreaterThan(0);
      // A boost or a delivery, never neither: a shelf entry that hands over nothing is a price
      // with no product.
      expect(spec?.boost ?? spec?.grants).toBeDefined();
    }
  });

  it('counts its day on the Athens clock', () => {
    // 22:30 UTC in summer is already tomorrow in Athens, and the shelf turns over with it.
    const at = new Date('2026-07-15T22:30:00.000Z');
    expect(blackMarketDay(at, GAME_TIMEZONE)).toBe('2026-07-16');
    expect(blackMarketDay(at, 'UTC')).toBe('2026-07-15');
  });
});

describe('bidding on a slot', () => {
  const board = blackMarketBoard('2026-08-16', NO_TURNOVER);
  const first = board[0]!;
  const spec = BLACK_MARKET_GOODS[first.goodId]!;
  const reserve = blackLotReserve(spec, 1);

  /** Everything a bid is judged against, with the one field under test overridden per case. */
  const ask = (patch: Record<string, unknown> = {}) =>
    blackBidRefusal({
      slotIndex: 0,
      goodId: first.goodId,
      board,
      amount: reserve,
      infamy: reserve,
      cityLevel: 1,
      leading: null,
      leadingIsYou: false,
      notoriety: 99,
      ...patch,
    });

  it('opens at the weighted price and takes a bid that meets it', () => {
    expect(reserve).toBe(blackMarketPrice(spec, 1));
    expect(ask()).toBeNull();
  });

  it('refuses a number under where the lot opens', () => {
    expect(ask({ amount: reserve - 1, infamy: reserve })).toBe('too_low');
  });

  it('refuses a number that does not clear the crew in front', () => {
    const leading = reserve * 2;
    const minimum = nextLotBid(reserve, leading);
    expect(minimum, 'the step is what makes this case real').toBeGreaterThan(leading);
    expect(ask({ leading, amount: minimum - 1, infamy: 10 ** 9 })).toBe('too_low');
    expect(ask({ leading, amount: minimum, infamy: 10 ** 9 })).toBeNull();
  });

  it('refuses a crew bidding against its own leading number', () => {
    expect(
      ask({ leading: reserve, leadingIsYou: true, amount: reserve * 3, infamy: 10 ** 9 }),
    ).toBe('outbid_yourself');
  });

  it('refuses a bid the crew could not cover tonight', () => {
    expect(ask({ amount: reserve, infamy: reserve - 1 })).toBe('not_enough_infamy');
  });

  it('refuses a slot that moved between the read and the click', () => {
    // The player is looking at a stale board: the shelf turned over and something else is standing
    // in that slot. Writing their number against the replacement is the defect this exists for.
    expect(ask({ goodId: board[1]!.goodId, infamy: 10 ** 9, amount: 10 ** 8 })).toBe('moved_on');
  });

  it('refuses a slot that is not on the shelf', () => {
    expect(ask({ slotIndex: BLACK_MARKET_SLOTS, infamy: 10 ** 9 })).toBe('unknown_slot');
  });

  it('checks the rank before the price, so the message is the useful one', () => {
    // A crew that is both unknown and broke is told the thing that is actually in their way, not
    // sent off to earn a number that was never the reason.
    const gated = board.find((slot) => (findBlackMarketGood(slot.goodId)?.minNotoriety ?? 0) > 0);
    const target = gated ?? first;
    const wanted = findBlackMarketGood(target.goodId)?.minNotoriety ?? 0;
    expect(
      blackBidRefusal({
        slotIndex: target.index,
        goodId: target.goodId,
        board,
        amount: blackLotReserve(findBlackMarketGood(target.goodId)!, 1),
        infamy: 0,
        cityLevel: 1,
        leading: null,
        leadingIsYou: false,
        notoriety: wanted > 0 ? wanted - 1 : 0,
      }),
    ).toBe(wanted > 0 ? 'not_known_enough' : 'not_enough_infamy');
  });
});

describe('the fence settles at midnight', () => {
  it('closes a day at the first instant of the next one, on the Athens clock', () => {
    // The shelf turns over and the lots settle at the same instant rather than a second apart.
    expect(blackMarketClosesAt('2026-07-15', GAME_TIMEZONE).toISOString()).toBe(
      '2026-07-15T21:00:00.000Z',
    );
  });

  it('names every slot a lot of its own, and seeds each one differently', () => {
    const ids = new Set(
      Array.from({ length: BLACK_MARKET_SLOTS }, (_, index) => blackLotId('2026-08-16', index)),
    );
    expect(ids.size).toBe(BLACK_MARKET_SLOTS);
    expect(blackLotSeed('2026-08-16', 0)).not.toBe(blackLotSeed('2026-08-16', 1));
    expect(blackLotSeed('2026-08-16', 0)).not.toBe(blackLotSeed('2026-08-17', 0));
  });
});

/**
 * The bag: a count of crates, and nothing that knows about a fight.
 *
 * What a crate is worth and when it is spent used to live here, as a bag that added itself up and
 * emptied itself into whichever battle resolved next. Both moved to the fight's own screen when
 * contraband became something a player applies; the bag is now just a count, and this is what is
 * left to say about it.
 */
describe('the bag of contraband', () => {
  const syringes = 'adrenaline_syringes';
  const explosives = 'banned_explosives';

  it('is empty until something is bought', () => {
    expect(stashCount({}, syringes)).toBe(0);
  });

  it('counts each crate separately, and two of one as two', () => {
    const stash = addToStash(addToStash(addToStash({}, syringes), explosives), syringes);
    expect(stashCount(stash, syringes)).toBe(2);
    expect(stashCount(stash, explosives)).toBe(1);
  });

  it('takes one out at a time, leaving the rest for another fight', () => {
    const stash = addToStash(addToStash({}, syringes), syringes);
    expect(takeFromStash(stash, syringes)).toEqual({ [syringes]: 1 });
  });

  it('drops the key when the last one is spent, rather than storing a zero', () => {
    const stash = takeFromStash(addToStash({}, syringes), syringes);
    expect(stash).toEqual({});
    expect(stashCount(stash, syringes)).toBe(0);
  });

  it('never goes negative on a crate the crew does not have', () => {
    expect(takeFromStash({}, syringes)).toEqual({});
    expect(stashCount(takeFromStash({}, syringes), syringes)).toBe(0);
  });
});

/**
 * §D8: one shelf for the whole city, priced and stocked for the company the dealer is keeping.
 *
 * The shelf is the only shared thing in the game, which is what makes this necessary rather than
 * decorative: a fixed catalogue is either unaffordable to the crews who need it or free to the
 * crews who do not, depending entirely on how far along everybody else happens to be.
 */
describe('what the city’s average level does to the back room', () => {
  const syringes = BLACK_MARKET_GOODS['adrenaline_syringes']!;

  it('reads the average off the players, and floors it at the reference', () => {
    expect(averageCityLevel([10, 20, 30])).toBe(20);
    // An empty city, and a city of nothing but level-zero rows, both read as the reference rather
    // than as zero: a divide by nobody must not make everything free.
    expect(averageCityLevel([])).toBe(1);
    expect(averageCityLevel([0, -4])).toBe(1);
  });

  it('charges more in a city that has been at it longer', () => {
    expect(blackMarketPrice(syringes, 1)).toBe(syringes.infamy);
    expect(blackMarketPrice(syringes, 20)).toBeGreaterThan(blackMarketPrice(syringes, 5));
    // Never free, whatever the arithmetic does to a cheap crate.
    expect(blackMarketPrice({ ...syringes, infamy: 1 }, 1)).toBeGreaterThan(0);
  });

  it('stocks better goods for a city that has been at it longer, up to a ceiling', () => {
    const early = blackMarketBoost(syringes, 1)!;
    const late = blackMarketBoost(syringes, 30)!;
    expect(late.offensePercent).toBeGreaterThan(early.offensePercent);
    expect(early.offensePercent).toBe(syringes.boost!.offensePercent);

    // Capped, because a price may run away and a boost may not: doubling every figure on the crate
    // is past the point where a defence can be built against it at all.
    expect(blackMarketPotency(1000)).toBe(MAX_BLACK_MARKET_POTENCY);
    expect(blackMarketBoost(syringes, 1000)!.offensePercent).toBe(
      Math.round(syringes.boost!.offensePercent * MAX_BLACK_MARKET_POTENCY),
    );
  });

  it('quotes the figures the fight will actually use, on the card', () => {
    // The authored line has the *catalogue's* numbers baked into its prose. A card reading
    // "+18% offense" over a fight that applied +27% is the card lying, which is worse than plain.
    const late = blackMarketEffect(syringes, 30);
    const applied = blackMarketBoost(syringes, 30)!;
    expect(late).toContain(`+${applied.offensePercent}% offense`);
    expect(late).not.toContain(`+${syringes.boost!.offensePercent}% offense`);
    // Anything that is not a boost keeps its authored line. There are no figures in it to move.
    const blueprint = Object.values(BLACK_MARKET_GOODS).find((spec) => !spec.boost)!;
    expect(blackMarketEffect(blueprint, 30)).toBe(blueprint.effect);
  });

  it('opens a lot at the weighted price, not at the catalogue one', () => {
    const board = blackMarketBoard('2026-08-16', NO_TURNOVER);
    const slot = board[0]!;
    const spec = BLACK_MARKET_GOODS[slot.goodId]!;
    const request = {
      slotIndex: 0,
      goodId: slot.goodId,
      board,
      cityLevel: 25,
      leading: null,
      leadingIsYou: false,
      notoriety: 99,
      infamy: 10 ** 9,
    };
    // Exactly the catalogue price, in a city that has run on for a while: under the reserve,
    // because the dealer is not asking the catalogue price any more.
    expect(blackBidRefusal({ ...request, amount: spec.infamy })).toBe('too_low');
    expect(blackBidRefusal({ ...request, amount: blackMarketPrice(spec, 25) })).toBeNull();
  });
});

/**
 * §A4: the guard and the close must ask for the same number.
 *
 * The close spends the discounted figure and the card marks a slot biddable against the discounted
 * figure, and the guard used to compare the crew's infamy against the *undiscounted* one. The
 * window where that shows is narrow and entirely real: hold the Statue of the Revolutionist, stand
 * between 85% and 100% of a price, and the control is lit, the dealer has the goods, the crew can
 * afford them, and saying a number says "He has heard of you, but not enough."
 *
 * Written as a sweep over the window rather than one number, because the bug is the *shape* of the
 * disagreement and a single sample sits wherever the author happened to put it.
 */
describe('a crew with a standing discount (§A4)', () => {
  const DISCOUNT = 15;
  const day = '2026-04-11';
  const board = blackMarketBoard(day, []);
  const slot = board[0]!;
  const spec = findBlackMarketGood(slot.goodId)!;
  const full = blackLotReserve(spec, 10);

  const ask = (infamy: number, discountPercent?: number) =>
    blackBidRefusal({
      slotIndex: 0,
      goodId: slot.goodId,
      board,
      amount: full,
      infamy,
      cityLevel: 10,
      leading: null,
      leadingIsYou: false,
      notoriety: 99,
      // Spread rather than assigned: `exactOptionalPropertyTypes` is on, so an optional field
      // cannot be handed an explicit `undefined`, and this helper's whole job is to omit it.
      ...(discountPercent === undefined ? {} : { discountPercent }),
    });

  it('is refused only below what the close would actually charge', () => {
    const asking = discountedInfamy(full, DISCOUNT);
    expect(
      asking,
      'the fixture discount does not move this price, so nothing is proved',
    ).toBeLessThan(full);

    // Every point of infamy across the window the discount opens up.
    for (let infamy = asking; infamy < full; infamy += 1) {
      expect(
        ask(infamy, DISCOUNT),
        `refused at ${infamy} infamy while the close charges ${asking}`,
      ).toBeNull();
    }
    // And it still refuses below the discounted price, which is the half a permissive fix loses.
    expect(ask(asking - 1, DISCOUNT)).toBe('not_enough_infamy');
  });

  it('leaves the reserve alone: a discount is not a lower floor for one crew', () => {
    // Two crews at the same table are bidding against the same number. The discount moves what the
    // winner pays, never what anybody is allowed to say.
    expect(blackLotReserve(spec, 10)).toBe(full);
    expect(
      blackBidRefusal({
        slotIndex: 0,
        goodId: slot.goodId,
        board,
        amount: full - 1,
        infamy: 10 ** 9,
        cityLevel: 10,
        leading: null,
        leadingIsYou: false,
        notoriety: 99,
        discountPercent: DISCOUNT,
      }),
    ).toBe('too_low');
  });

  it('charges a crew with no discount the full price, as before', () => {
    expect(ask(full)).toBeNull();
    expect(ask(full - 1)).toBe('not_enough_infamy');
  });
});
