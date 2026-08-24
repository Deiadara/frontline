import { describe, expect, it } from 'vitest';
import {
  BLACK_MARKET_GOOD_IDS,
  BLACK_MARKET_GOODS,
  BLACK_MARKET_SLOTS,
  BLACK_MARKET_TAKES_PER_DAY,
  addToStash,
  blackMarketBoard,
  blackMarketDay,
  findBlackMarketGood,
  hasBoost,
  averageCityLevel,
  blackMarketBoost,
  blackMarketEffect,
  blackMarketPotency,
  blackMarketPrice,
  MAX_BLACK_MARKET_POTENCY,
  spentStash,
  stashBoost,
  takeFromStash,
  takeRefusal,
} from './blackmarket.js';
import { GAME_TIMEZONE } from '../time/zone.js';

const NO_TURNOVER = Array.from({ length: BLACK_MARKET_SLOTS }, () => 0);

describe('the shelf', () => {
  it('is five slots and one take a day, as numbers rather than as constants', () => {
    // Written as literals on purpose. Every other assertion in this file derives its expectation
    // from `BLACK_MARKET_SLOTS`, so lowering that constant to four leaves the whole suite green
    // while the shelf quietly loses a slot: the shape of tautology that hides a half-implemented
    // change. These three lines are the independent anchor: they say what the board asked for.
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
    expect([...seen].sort()).toEqual(['battle_boost', 'blueprint', 'contraband', 'unit_upgrade']);
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

describe('taking something', () => {
  const board = blackMarketBoard('2026-08-16', NO_TURNOVER);
  const first = board[0]!;
  const price = BLACK_MARKET_GOODS[first.goodId]!.infamy;

  it('lets a crew with the name for it through', () => {
    expect(
      takeRefusal({
        slotIndex: 0,
        goodId: first.goodId,
        board,
        infamy: price,
        takenToday: 0,
        cityLevel: 1,
        level: 1,
      }),
    ).toBeNull();
  });

  it('refuses one infamy short', () => {
    expect(
      takeRefusal({
        slotIndex: 0,
        goodId: first.goodId,
        board,
        infamy: price - 1,
        takenToday: 0,
        cityLevel: 1,
        level: 1,
      }),
    ).toBe('not_enough_infamy');
  });

  it('refuses the second thing on the same day, however rich the crew is', () => {
    expect(
      takeRefusal({
        slotIndex: 0,
        goodId: first.goodId,
        board,
        infamy: 10 ** 9,
        takenToday: BLACK_MARKET_TAKES_PER_DAY,
        cityLevel: 1,
        level: 1,
      }),
    ).toBe('daily_limit');
  });

  it('refuses a slot that moved between the read and the click', () => {
    // The player is looking at a stale board: somebody else emptied the slot and something else is
    // standing in it. Charging them for the replacement is the defect this refusal exists for.
    expect(
      takeRefusal({
        slotIndex: 0,
        goodId: board[1]!.goodId,
        board,
        infamy: 10 ** 9,
        takenToday: 0,
        cityLevel: 1,
        level: 1,
      }),
    ).toBe('moved_on');
  });

  it('refuses a slot that is not on the shelf', () => {
    expect(
      takeRefusal({
        slotIndex: BLACK_MARKET_SLOTS,
        goodId: first.goodId,
        board,
        infamy: 10 ** 9,
        takenToday: 0,
        cityLevel: 1,
        level: 1,
      }),
    ).toBe('unknown_slot');
  });

  it('checks the limit before the price, so the message is the useful one', () => {
    // A crew that is both out of allowance and short of infamy is told the thing they can do
    // something about tomorrow, not the thing they cannot do anything about at all.
    expect(
      takeRefusal({
        slotIndex: 0,
        goodId: first.goodId,
        board,
        infamy: 0,
        takenToday: 1,
        level: 1,
        cityLevel: 1,
      }),
    ).toBe('daily_limit');
  });
});

describe('the stash of boosts', () => {
  const syringes = 'adrenaline_syringes';
  const explosives = 'banned_explosives';

  it('is empty until something is bought, and reads as no edge at all', () => {
    expect(hasBoost({})).toBe(false);
    expect(stashBoost({}, 1)).toEqual({ offensePercent: 0, defensePercent: 0, moralePercent: 0 });
  });

  it('adds up across different boosts', () => {
    const stash = addToStash(addToStash({}, syringes), explosives);
    const total = stashBoost(stash, 1);
    const a = BLACK_MARKET_GOODS[syringes]!.boost!;
    const b = BLACK_MARKET_GOODS[explosives]!.boost!;
    expect(total.offensePercent).toBe(a.offensePercent + b.offensePercent);
    expect(total.defensePercent).toBe(a.defensePercent + b.defensePercent);
    expect(total.moralePercent).toBe(a.moralePercent + b.moralePercent);
  });

  /**
   * Two of a thing do **not** stack (board. "You can use the same boost only once").
   *
   * The rule this replaced said they did, and the shape that ends one way: the correct play becomes
   * hoarding a fortnight of infamy into six syringes and deleting somebody with a number no defence
   * was balanced against, and every fight before that one is spent saving up rather than fighting.
   */
  it('counts two of the same thing once', () => {
    const stash = addToStash(addToStash({}, syringes), syringes);
    expect(stash[syringes]).toBe(2);
    expect(stashBoost(stash, 1).offensePercent).toBe(
      BLACK_MARKET_GOODS[syringes]!.boost!.offensePercent,
    );
  });

  /** ...and the second one is kept rather than billed for and thrown away. */
  it('spends one of each, leaving the rest for the next fight', () => {
    const stash = addToStash(addToStash({}, syringes), syringes);
    expect(spentStash(stash)).toEqual({ [syringes]: 1 });
    expect(spentStash(spentStash(stash))).toEqual({});
  });

  it('drops the key when the last one is spent, rather than storing a zero', () => {
    const stash = takeFromStash(addToStash({}, syringes), syringes);
    expect(stash).toEqual({});
    expect(hasBoost(stash)).toBe(false);
  });

  it('ignores anything in the stash the catalogue no longer knows about', () => {
    // A save written against a shelf entry that has since been retired must still open.
    expect(stashBoost({ ghost_item: 3 }, 1)).toEqual({
      offensePercent: 0,
      defensePercent: 0,
      moralePercent: 0,
    });
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

  it('charges the weighted price at the door, not the catalogue one', () => {
    const board = blackMarketBoard('2026-08-16', NO_TURNOVER);
    const slot = board[0]!;
    const spec = BLACK_MARKET_GOODS[slot.goodId]!;
    const request = {
      slotIndex: 0,
      goodId: slot.goodId,
      board,
      takenToday: 0,
      level: 1,
    };
    // Exactly the catalogue price, in a city that has run on for a while: refused, because the
    // dealer is not asking the catalogue price any more.
    expect(takeRefusal({ ...request, infamy: spec.infamy, cityLevel: 25 })).toBe(
      'not_enough_infamy',
    );
    expect(
      takeRefusal({ ...request, infamy: blackMarketPrice(spec, 25), cityLevel: 25 }),
    ).toBeNull();
  });
});
