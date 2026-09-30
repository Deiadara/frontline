import { describe, expect, it } from 'vitest';
import { BLUEPRINTS } from '../blueprints/catalog.js';
import { ITEM_CATALOG, ITEM_IDS, type ItemId } from '../items/catalog.js';
import { hourInZone, instantAtHourInZone } from '../time/zone.js';
import { addItems, hasItems, heldItems, removeItems } from '../items/inventory.js';
import { RESOURCE_KEYS, STARTING_RESOURCES, type ResourceKey } from '../resources.js';
import { STORAGE_SHARES } from '../building/production.js';
import {
  MAX_OPEN_OFFERS,
  bundleValue,
  canSettle,
  creditResources,
  describeBundle,
  emptyBundle,
  offerHasExpired,
  offerRefusal,
  visibleTo,
  type MarketOffer,
} from './offers.js';
import { RESOURCE_CAP_VALUE } from './offers.js';
import {
  SUPPLY_MAX_PERCENT,
  SUPPLY_MIN_PERCENT,
  SUPPLY_RESOURCES,
  SUPPLY_DEEP_POCKETS_PERCENT,
  SUPPLY_RATION_UNIT_VALUE,
  supplyAffordable,
  supplyAllowance,
  supplyAllowancePercent,
  supplyBoard,
  supplyPrice,
  supplyRationCost,
  supplyRefusal,
} from './supply.js';
import { MAX_MARKET_DISCOUNT } from './discount.js';
import {
  BARTER_RATE,
  BARTER_RATE_RESPECTED,
  barterRateFor,
  brokerRate,
  VENDOR_SESSIONS_PER_DAY,
  VENDOR_SESSION_HOURS,
  VENDOR_STOCK_SIZE,
  BARTER_RESOURCES,
  barterQuote,
  currentVendorSession,
  marketDay,
  nextVendorOpening,
  vendorClosesAt,
  vendorOpenAt,
  vendorSessionsFor,
  vendorStockFor,
  isDearVendorLine,
  VENDOR_MARKUP_MIN,
  VENDOR_MARKUP_MAX,
  VENDOR_DEAR_MARKUP_MIN,
  VENDOR_DEAR_MARKUP_MAX,
} from './vendor.js';

/** A month of days, so every property below is checked against a spread rather than one date. */
const DAYS = Array.from({ length: 60 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 1));
  date.setUTCDate(date.getUTCDate() + index);
  return marketDay(date);
});

/** Half past `hour` on `day`, on the game's clock: the same clock the Runner's hours are drawn on. */
const at = (day: string, hour: number): Date =>
  new Date(instantAtHourInZone(day, hour).getTime() + 30 * 60_000);

describe('the Runner', () => {
  it('is in twice a day, for two hours each time', () => {
    for (const day of DAYS) {
      const sessions = vendorSessionsFor(day);
      expect(sessions, day).toHaveLength(VENDOR_SESSIONS_PER_DAY);
      for (const session of sessions) expect(session.hours, day).toBe(VENDOR_SESSION_HOURS);
    }
  });

  it('keeps every session inside the day it belongs to', () => {
    for (const day of DAYS) {
      for (const session of vendorSessionsFor(day)) {
        expect(session.startHour, day).toBeGreaterThanOrEqual(0);
        expect(session.startHour + session.hours, day).toBeLessThanOrEqual(24);
      }
    }
  });

  /**
   * The two spells never touch.
   *
   * Two adjacent two-hour sessions are one four-hour session wearing two hats, and the whole point
   * of splitting them is that missing one still leaves the other.
   */
  it('never runs the two sessions back to back', () => {
    for (const day of DAYS) {
      const [first, second] = vendorSessionsFor(day);
      if (!first || !second) throw new Error('expected two sessions');
      expect(second.startHour - (first.startHour + first.hours), day).toBeGreaterThan(0);
    }
  });

  /** The whole city has to be looking at the same shop, and it has to move. */
  it('is the same for everybody on a day, and different on the next', () => {
    for (const day of DAYS) {
      expect(vendorSessionsFor(day)).toEqual(vendorSessionsFor(day));
      expect(vendorStockFor(day)).toEqual(vendorStockFor(day));
    }
    const varied = new Set(DAYS.map((day) => JSON.stringify(vendorSessionsFor(day))));
    // Not all sixty distinct, that would be a different property, but nowhere near constant.
    expect(varied.size).toBeGreaterThan(20);
  });

  it('is in for exactly four hours out of every twenty-four', () => {
    for (const day of DAYS.slice(0, 10)) {
      const open = Array.from({ length: 24 }, (_, hour) => vendorOpenAt(at(day, hour))).filter(
        Boolean,
      ).length;
      expect(open, day).toBe(VENDOR_SESSIONS_PER_DAY * VENDOR_SESSION_HOURS);
    }
  });

  it('closes at the end of the session it is running', () => {
    const day = DAYS[0] ?? '';
    const session = vendorSessionsFor(day)[0];
    if (!session) throw new Error('expected a session');
    const inside = at(day, session.startHour);
    expect(currentVendorSession(inside)).toEqual(session);
    expect(hourInZone(vendorClosesAt(inside) ?? new Date(0))).toBe(
      (session.startHour + session.hours) % 24,
    );
  });

  it('always has a next opening, and it is in the future', () => {
    for (const day of DAYS.slice(0, 10)) {
      for (const hour of [0, 6, 12, 23]) {
        const now = at(day, hour);
        expect(nextVendorOpening(now).getTime(), `${day} ${hour}`).toBeGreaterThan(now.getTime());
      }
    }
  });

  it('finds tomorrow on the eve of the 23-hour spring day', () => {
    // Athens goes from 03:00 straight to 04:00 on 2027-03-28, so 24 hours after 23:30 the night
    // before is half past midnight on the 29th, and a whole day of visits lay in between.
    const now = at('2027-03-27', 23);
    expect(marketDay(nextVendorOpening(now))).toBe('2027-03-28');
  });

  describe('the barrow', () => {
    it('carries a full spread, with nothing listed twice', () => {
      for (const day of DAYS) {
        const stock = vendorStockFor(day);
        expect(stock, day).toHaveLength(VENDOR_STOCK_SIZE);
        expect(new Set(stock.map((line) => line.item)).size, day).toBe(stock.length);
      }
    });

    /** Board request, 2026-09-10: the only paper on the barrow is a page, and one of it. */
    it('never carries a finished blueprint, and only ever one of a page', () => {
      let pages = 0;
      for (const day of DAYS) {
        const stock = vendorStockFor(day);
        for (const line of stock) {
          const spec = ITEM_CATALOG[line.item as ItemId];
          expect(spec.kind, `${day} ${line.item}`).not.toBe('blueprint');
          if (spec.kind === 'page') {
            pages++;
            expect(line.stock, day).toBe(1);
          }
        }
      }
      // The pool without the blueprints still finds a page once in a while: the odds are on the
      // day rather than on the pool, so removing six goods cannot have removed the pages with them.
      expect(pages).toBeGreaterThan(0);
    });

    /**
     * Maintainer, 2026-09-29: a line lives one day and sells one unit a visit, so it never carries
     * more than the day's two visits can sell. The 2 is written out rather than read off
     * `VENDOR_SESSIONS_PER_DAY`, so a third session cannot quietly widen the roll with it.
     */
    it('never stocks more of a line than two visits can sell, and rolls both counts', () => {
      expect(VENDOR_SESSIONS_PER_DAY).toBe(2);
      const seen = new Set<number>();
      for (const day of DAYS) {
        for (const line of vendorStockFor(day)) {
          expect(line.stock, `${day} ${line.item}`).toBeGreaterThanOrEqual(1);
          expect(line.stock, `${day} ${line.item}`).toBeLessThanOrEqual(2);
          if (ITEM_CATALOG[line.item as ItemId].kind !== 'page') seen.add(line.stock);
        }
      }
      expect([...seen].sort()).toEqual([1, 2]);
    });

    /** He is not a charity and not a robbery: every price is above the item's worth, and sane. */
    it('marks everything up, within the band its line belongs to', () => {
      for (const day of DAYS) {
        for (const line of vendorStockFor(day)) {
          const worth = ITEM_CATALOG[line.item as ItemId].capsValue;
          const dear = isDearVendorLine(line.item as ItemId);
          const low = dear ? VENDOR_DEAR_MARKUP_MIN : VENDOR_MARKUP_MIN;
          const high = dear ? VENDOR_DEAR_MARKUP_MAX : VENDOR_MARKUP_MAX;
          expect(line.price, `${day} ${line.item}`).toBeGreaterThanOrEqual(Math.round(worth * low));
          expect(line.price, `${day} ${line.item}`).toBeLessThanOrEqual(Math.round(worth * high));
        }
      }
    });

    /**
     * §F3, maintainer 2026-09-17: there is always something on the barrow worth coming back for.
     *
     * The reserved line, and it is the *last* one, which is what the substitution used to be. A
     * barrow of six basics is a barrow a crew skims once and stops opening.
     */
    it('always ends on a dear line: a component out of the steep end, or a page', () => {
      for (const day of DAYS) {
        const stock = vendorStockFor(day);
        const last = stock[stock.length - 1]!;
        expect(isDearVendorLine(last.item as ItemId), `${day} ${last.item}`).toBe(true);
      }
    });

    /** And it is dearer than the ordinary run, which is the whole point of reserving it. */
    it('prices the dear stock above the ordinary markup band', () => {
      // The bands do not overlap, so the cheapest a dear line can be sold at is above the dearest
      // an ordinary one can. Read off the constants rather than off a sampled barrow: a sample
      // proves today and this proves the rule.
      expect(VENDOR_DEAR_MARKUP_MIN).toBeGreaterThan(VENDOR_MARKUP_MAX);

      let dear = 0;
      for (const day of DAYS) {
        for (const line of vendorStockFor(day)) {
          const spec = ITEM_CATALOG[line.item as ItemId];
          if (!isDearVendorLine(line.item as ItemId)) continue;
          dear += 1;
          expect(line.price, `${day} ${line.item}`).toBeGreaterThan(
            Math.round(spec.capsValue * VENDOR_MARKUP_MAX),
          );
        }
      }
      // One a day at the very least, so the loop above is not vacuously green.
      expect(dear).toBeGreaterThanOrEqual(DAYS.length);
    });

    /** Components, every day, which is what the barrow is made of. */
    it('carries components on every barrow', () => {
      for (const day of DAYS) {
        const components = vendorStockFor(day).filter(
          (line) => ITEM_CATALOG[line.item as ItemId].kind === 'component',
        );
        expect(components.length, day).toBeGreaterThan(0);
      }
    });

    it('shows the masterpiece end far less often than the basic one', () => {
      const seen = new Map<ItemId, number>();
      for (const day of DAYS) {
        for (const line of vendorStockFor(day)) {
          seen.set(line.item as ItemId, (seen.get(line.item as ItemId) ?? 0) + 1);
        }
      }
      const rate = (rarity: string) =>
        ITEM_IDS.filter((id) => ITEM_CATALOG[id].rarity === rarity).reduce(
          (total, id) => total + (seen.get(id) ?? 0),
          0,
        ) / ITEM_IDS.filter((id) => ITEM_CATALOG[id].rarity === rarity).length;
      expect(rate('basic')).toBeGreaterThan(rate('masterpiece'));
    });
  });
});

describe('the Broker', () => {
  it('gives back half the value, rounded down, between two things worth the same', () => {
    // Materials only: caps are the one key the Broker will not deal in, and the list is every
    // other resource so a seventh material joins on its own.
    expect(BARTER_RESOURCES).not.toContain('caps');
    expect(BARTER_RESOURCES).toHaveLength(RESOURCE_KEYS.length - 1);
    // A material into itself is the cut alone, which is the rate the rest of this reads against.
    expect(barterQuote('oil', 'oil', 100)).toBe(100 * BARTER_RATE);
    expect(barterQuote('oil', 'oil', 101)).toBe(50);
    expect(barterQuote('oil', 'oil', 1)).toBe(0);
    expect(barterQuote('oil', 'oil', 0)).toBe(0);
  });

  /*
   * By value (maintainer, 2026-09-27). Two supplies used to buy a high-quality metal: the scarcest
   * material was the cheapest thing in the game to make.
   */
  it('prices what comes out by what it is worth, so scarce metal costs its weight', () => {
    const metal = barterQuote('supplies', 'highQualityMetal', 100);
    expect(metal).toBe(
      Math.floor(
        (100 * RESOURCE_CAP_VALUE.supplies * BARTER_RATE) / RESOURCE_CAP_VALUE.highQualityMetal,
      ),
    );
    expect(metal).toBeLessThan(10);
    // The other way round pays out more than went in, by count, and still less than it was worth.
    const supplies = barterQuote('highQualityMetal', 'supplies', 10);
    expect(supplies).toBeGreaterThan(10);
    expect(supplies * RESOURCE_CAP_VALUE.supplies).toBeLessThan(
      10 * RESOURCE_CAP_VALUE.highQualityMetal,
    );
  });

  it('never pays out on a negative trade', () => {
    expect(barterQuote('oil', 'scrap', -500)).toBe(0);
  });

  it('pays the whole plank on a trade that comes out exact, not one short of it', () => {
    // 33 oil is 66 caps of value, half of it is 33, and 33 at 2.2 a plank is exactly 15. The
    // floating-point product was 14.999999999999998, and the floor took a plank off every such trade.
    expect(barterQuote('oil', 'planks', 33)).toBe(15);
    expect(barterQuote('highQualityMetal', 'planks', 11)).toBe(30);
    expect(barterQuote('oil', 'planks', 66, BARTER_RATE_RESPECTED)).toBe(39);
  });
});

describe('the inventory', () => {
  it('adds, counts and takes back out', () => {
    const held = addItems(addItems({}, { scrap_servo: 2 }), { scrap_servo: 1, neural_shunt: 1 });
    expect(held).toEqual({ scrap_servo: 3, neural_shunt: 1 });
    expect(hasItems(held, { scrap_servo: 3 })).toBe(true);
    expect(hasItems(held, { scrap_servo: 4 })).toBe(false);
    expect(removeItems(held, { scrap_servo: 3 })).toEqual({ neural_shunt: 1 });
  });

  /** A zero is not a fact about a crew; it is the absence of one. */
  it('drops a key that reaches zero rather than storing it', () => {
    expect(Object.keys(removeItems({ scrap_servo: 1 }, { scrap_servo: 1 }))).toHaveLength(0);
  });

  it('floors at zero rather than going negative on an unchecked take', () => {
    expect(removeItems({ scrap_servo: 1 }, { scrap_servo: 9 })).toEqual({});
  });

  it('lists only what is actually held', () => {
    expect(heldItems({ scrap_servo: 2, neural_shunt: 1 })).toHaveLength(2);
    expect(heldItems({})).toHaveLength(0);
  });
});

describe('listings', () => {
  const bundle = (over: Partial<ReturnType<typeof emptyBundle>> = {}) => ({
    ...emptyBundle(),
    ...over,
  });
  const stock = { ...STARTING_RESOURCES, scrap: 5000, caps: 5000 };

  it('refuses a listing that gives nothing or asks for nothing', () => {
    expect(offerRefusal(bundle(), bundle({ resources: { caps: 1 } }), stock, {}, 0)).toBe(
      'nothing_offered',
    );
    expect(offerRefusal(bundle({ resources: { caps: 1 } }), bundle(), stock, {}, 0)).toBe(
      'nothing_wanted',
    );
  });

  it('refuses what the seller cannot actually cover', () => {
    expect(
      offerRefusal(
        bundle({ resources: { scrap: 999_999 } }),
        bundle({ resources: { caps: 1 } }),
        stock,
        {},
        0,
      ),
    ).toBe('cannot_cover');
    expect(
      offerRefusal(
        bundle({ items: { rotor_hub: 1 } }),
        bundle({ resources: { caps: 1 } }),
        stock,
        {},
        0,
      ),
    ).toBe('cannot_cover');
  });

  /*
   * An unlocked blueprint is the one thing in the catalogue that may never change hands, and a
   * listing has two sides. `give` is escrowed at posting and was checked; `want` is paid out of the
   * *buyer's* inventory at settlement and was not, so a document walked out of a crew that never
   * agreed a document could be traded at all.
   */
  it('refuses a listing that moves an untradeable document, whichever side it is on', () => {
    const document = BLUEPRINTS[0].id;
    expect(ITEM_CATALOG[document].tradeable, 'the fixture is not untradeable after all').toBe(
      false,
    );
    expect(
      offerRefusal(
        bundle({ items: { [document]: 1 } }),
        bundle({ resources: { caps: 1 } }),
        stock,
        { [document]: 1 },
        0,
      ),
    ).toBe('untradeable');
    expect(
      offerRefusal(
        bundle({ resources: { caps: 1 } }),
        bundle({ items: { [document]: 1 } }),
        stock,
        {},
        0,
      ),
    ).toBe('untradeable');
    // A page of the same document is the tradeable half, and it stays postable on both sides.
    const page = BLUEPRINTS[0].pages[0].id;
    expect(ITEM_CATALOG[page].tradeable).toBe(true);
    expect(
      offerRefusal(
        bundle({ items: { [page]: 1 } }),
        bundle({ resources: { caps: 1 } }),
        stock,
        { [page]: 1 },
        0,
      ),
    ).toBeNull();
    expect(
      offerRefusal(
        bundle({ resources: { caps: 1 } }),
        bundle({ items: { [page]: 1 } }),
        stock,
        {},
        0,
      ),
    ).toBeNull();
  });

  it('caps how many one crew may have standing', () => {
    // The board's number, as a literal: a cap derived from the constant it tests would follow it
    // anywhere.
    expect(MAX_OPEN_OFFERS).toBe(5);
    expect(
      offerRefusal(
        bundle({ resources: { scrap: 10 } }),
        bundle({ resources: { caps: 10 } }),
        stock,
        {},
        MAX_OPEN_OFFERS,
      ),
    ).toBe('too_many_offers');
  });

  it('takes a listing it can cover', () => {
    expect(
      offerRefusal(
        bundle({ resources: { scrap: 100 }, items: { scrap_servo: 1 } }),
        bundle({ resources: { caps: 100 } }),
        stock,
        { scrap_servo: 2 },
        0,
      ),
    ).toBeNull();
  });

  it('will not settle for a buyer who cannot pay', () => {
    const want = bundle({ resources: { caps: 999_999 } });
    expect(canSettle(want, stock, {})).toBe(false);
    expect(canSettle(bundle({ items: { rotor_hub: 1 } }), stock, {})).toBe(false);
    expect(canSettle(bundle({ items: { rotor_hub: 1 } }), stock, { rotor_hub: 1 })).toBe(true);
  });

  describe('what a listing is worth', () => {
    it('prices both sides off the same table', () => {
      expect(bundleValue(bundle({ resources: { caps: 100 } }))).toBe(100);
      expect(bundleValue(bundle({ items: { rotor_hub: 1 } }))).toBe(
        ITEM_CATALOG.rotor_hub.capsValue,
      );
      expect(bundleValue(bundle())).toBe(0);
    });

    /** High-quality metal is the scarce one, and the valuation has to say so. */
    it('prices the scarce resource above the bulk ones', () => {
      const metal = bundleValue(bundle({ resources: { highQualityMetal: 100 } }));
      const supplies = bundleValue(bundle({ resources: { supplies: 100 } }));
      expect(metal).toBeGreaterThan(supplies * 4);
    });
  });

  it('writes a bundle in words a player can read', () => {
    expect(describeBundle(bundle({ resources: { highQualityMetal: 400 } }))).toBe('400 HQ metal');
    expect(describeBundle(bundle({ items: { rotor_hub: 2 } }))).toBe('2× Rotor Hub');
    expect(describeBundle(bundle())).toBe('nothing');
  });

  describe('who sees what', () => {
    const offer = (over: Partial<MarketOffer>): MarketOffer => ({
      id: 'o1',
      sellerBaseId: 'seller',
      sellerName: 'Somebody',
      give: bundle({ resources: { scrap: 1 } }),
      want: bundle({ resources: { caps: 1 } }),
      status: 'open',
      createdAt: '2026-08-16T00:00:00.000Z',
      counterTo: null,
      directedAt: null,
      cityId: 'ashfall',
      ...over,
    });

    it('shows a public listing to anybody', () => {
      expect(visibleTo(offer({}), 'anyone')).toBe(true);
    });

    it('shows a counter only to the two crews it is between', () => {
      const counter = offer({ counterTo: 'o0', directedAt: 'target' });
      expect(visibleTo(counter, 'target')).toBe(true);
      expect(visibleTo(counter, 'seller')).toBe(true);
      expect(visibleTo(counter, 'somebody-else')).toBe(false);
    });

    it('shows nothing that is not open', () => {
      expect(visibleTo(offer({ status: 'accepted' }), 'anyone')).toBe(false);
      expect(visibleTo(offer({ status: 'expired' }), 'anyone')).toBe(false);
    });

    it('expires on its own clock', () => {
      const one = offer({});
      expect(offerHasExpired(one, new Date('2026-08-17T00:00:00.000Z'))).toBe(false);
      expect(offerHasExpired(one, new Date('2026-08-18T01:00:00.000Z'))).toBe(true);
    });
  });

  it('credits a stockpile without touching what was not traded', () => {
    const after = creditResources(STARTING_RESOURCES, { scrap: 100 });
    expect(after.scrap).toBe(STARTING_RESOURCES.scrap + 100);
    expect(after.caps).toBe(STARTING_RESOURCES.caps);
  });
});

describe('the supply run: caps into materials', () => {
  const rich = { ...STARTING_RESOURCES, caps: 1_000_000 };
  /** The three shelves, off the same table the district's own store uses. */
  const shelf = (key: ResourceKey): number => Math.round(2_000 * (STORAGE_SHARES[key] ?? 0));

  it('widens the day’s ration from 30% of a store to 100%, and no further', () => {
    expect(supplyAllowancePercent(1)).toBe(SUPPLY_MIN_PERCENT);
    // Two points a level, so the top of the curve is level 36 and it stays there for ever after.
    expect(supplyAllowancePercent(36)).toBe(SUPPLY_MAX_PERCENT);
    expect(supplyAllowancePercent(60)).toBe(SUPPLY_MAX_PERCENT);
    // Monotonic in between, or the promise a player plans against is a lie.
    for (let level = 2; level <= 36; level++) {
      expect(supplyAllowancePercent(level)).toBeGreaterThanOrEqual(
        supplyAllowancePercent(level - 1),
      );
    }
  });

  it('measures the ration against the warehouse, in caps of worth a unit of supplies spends', () => {
    // 30% of a thousand is 300 units, which is 450 caps' worth at a supply's 1.5.
    expect(supplyAllowance(1, 1000)).toBe(300 * SUPPLY_RATION_UNIT_VALUE);
    expect(supplyAllowance(36, 1000)).toBe(1000 * SUPPLY_RATION_UNIT_VALUE);
    // A district with nothing left standing can still buy a single thing, the dearest included. A
    // zero allowance is a dead account, not a setback.
    for (const key of SUPPLY_RESOURCES) {
      expect(supplyAffordable(key, rich, supplyAllowance(1, 0), 10_000), key).toBeGreaterThan(0);
    }
    expect(Number.isInteger(supplyAllowance(7, 977))).toBe(true);
  });

  /*
   * Maintainer, 2026-09-29: the ration counts worth, not units. It counted units, so a day spent on
   * high-quality metal (12 caps each) and bartered down at the Broker came to four or five days of
   * supplies (1.5 each). Measured at the levels the bug pass quoted, with the best discount a crew
   * can stack on the Broker's cut, and on every route from a dear material to a cheap one.
   */
  it('lets no dear material bartered down beat buying the cheap one directly', () => {
    for (const level of [15, 36, 60, 70]) {
      for (const discount of [0, MAX_MARKET_DISCOUNT]) {
        const ration = supplyAllowance(level, 860);
        const rate = brokerRate(level, discount);
        for (const dear of SUPPLY_RESOURCES) {
          for (const cheap of SUPPLY_RESOURCES) {
            if (RESOURCE_CAP_VALUE[dear] <= RESOURCE_CAP_VALUE[cheap]) continue;
            const bought = supplyAffordable(dear, rich, ration, 1_000_000, discount);
            const bartered = barterQuote(dear, cheap, bought, rate);
            const direct = supplyAffordable(cheap, rich, ration, 1_000_000, discount);
            expect(
              bartered,
              `${dear} into ${cheap} at level ${level}, ${discount}% off`,
            ).toBeLessThan(direct);
          }
        }
      }
    }
  });

  it('spends a metal at eight supplies of ration', () => {
    expect(supplyRationCost('highQualityMetal', 1)).toBe(12);
    expect(supplyRationCost('supplies', 8)).toBe(12);
    expect(
      supplyRefusal({ key: 'highQualityMetal', units: 2, stock: rich, allowanceLeft: 23 }),
    ).toBe('over_allowance');
    expect(
      supplyRefusal({ key: 'highQualityMetal', units: 2, stock: rich, allowanceLeft: 24 }),
    ).toBeNull();
  });

  it('§I3: Deep Pockets at 70 lifts the ceiling past a full store', () => {
    expect(supplyAllowancePercent(69)).toBe(SUPPLY_MAX_PERCENT);
    expect(supplyAllowancePercent(70)).toBe(SUPPLY_DEEP_POCKETS_PERCENT);
  });

  it('prices an order in whole caps, above what the thing is worth', () => {
    for (const key of SUPPLY_RESOURCES) {
      const price = supplyPrice(key, 100);
      expect(Number.isInteger(price)).toBe(true);
      expect(price).toBeGreaterThan(100 * RESOURCE_CAP_VALUE[key]);
    }
    // Never free, however small the order and however cheap the thing.
    expect(supplyPrice('supplies', 1)).toBeGreaterThan(0);
    expect(supplyPrice('supplies', 0)).toBe(0);
  });

  it('charges a round order of planks its exact price, and sells it to a purse that holds it', () => {
    // 2.2 x 1.5 is 3.3 caps a plank. The float product of a hundred was 330.00000000000006, which
    // `Math.ceil` charged as 331: the default order on the panel cost a cap more than it should.
    expect(supplyPrice('planks', 100)).toBe(330);
    expect(supplyPrice('planks', 10)).toBe(33);
    expect(
      supplyAffordable('planks', { ...STARTING_RESOURCES, caps: 330, planks: 0 }, 1_000, 10_000),
    ).toBe(100);
  });

  it('will not sell caps for caps', () => {
    expect(
      supplyRefusal({
        key: 'caps',
        units: 10,
        stock: rich,
        allowanceLeft: 10_000,
      }),
    ).toBe('not_a_resource');
  });

  it('refuses past the ration and past the wallet, in that order, and never for the warehouse', () => {
    const order = { key: 'scrap' as const, stock: rich };
    expect(supplyRefusal({ ...order, units: 0, allowanceLeft: 100 })).toBe('nothing_ordered');
    // Forty scrap is a hundred caps' worth, so forty-one is over a ration of a hundred.
    expect(supplyRefusal({ ...order, units: 41, allowanceLeft: 100 })).toBe('over_allowance');
    // Inside the ration and far over any shelf: warned about at the till, not refused here
    // (maintainer ruling, 2026-09-28).
    expect(supplyRefusal({ ...order, units: 9_999, allowanceLeft: 99_999 })).toBeNull();
    expect(
      supplyRefusal({
        key: 'highQualityMetal',
        units: 5_000,
        stock: { ...STARTING_RESOURCES, caps: 10 },
        allowanceLeft: 99_999,
      }),
    ).toBe('cannot_afford');
    expect(supplyRefusal({ ...order, units: 40, allowanceLeft: 100 })).toBeNull();
  });

  it('quotes a board whose "most" is actually buyable on every line', () => {
    const board = supplyBoard(5, rich, 2_000, 0, shelf);
    expect(board.percent).toBe(supplyAllowancePercent(5));
    expect(board.lines).toHaveLength(SUPPLY_RESOURCES.length);
    for (const line of board.lines) {
      if (line.most === 0) continue;
      expect(
        supplyRefusal({
          key: line.key,
          units: line.most,
          stock: rich,
          allowanceLeft: board.allowance - board.used,
        }),
        `${line.key} quoted ${line.most} as buyable`,
      ).toBeNull();
    }
  });

  it('spends the ration as one pooled budget rather than a quota a line', () => {
    const board = supplyBoard(1, rich, 1_000, 435, shelf);
    // 450 allowed, 435 spent: fifteen caps' worth left, for whichever line the player wants.
    expect(board.allowance - board.used).toBe(15);
    for (const line of board.lines) {
      expect(line.most).toBe(Math.floor(15 / RESOURCE_CAP_VALUE[line.key]));
    }
  });

  /*
   * Maintainer, 2026-09-29: "market prices" discounts reach every shop. The supply run's price is
   * quoted after the discount, the till charges the same figure, and the stack stops at the cap.
   */
  it('quotes and charges the supply run after the market discount, capped', () => {
    const plain = supplyBoard(20, rich, 2_000, 0, shelf);
    const cheap = supplyBoard(20, rich, 2_000, 0, shelf, 20);
    for (const [index, line] of cheap.lines.entries()) {
      const full = plain.lines[index]!;
      expect(line.capsPerUnit).toBeCloseTo(full.capsPerUnit * 0.8, 6);
      expect(supplyPrice(line.key, 100, 20)).toBe(Math.ceil(full.capsPerUnit * 0.8 * 100 - 1e-6));
    }
    expect(supplyPrice('scrap', 100, 90)).toBe(supplyPrice('scrap', 100, MAX_MARKET_DISCOUNT));
    // A purse that covers the discounted order is sold it, and refused one cap short.
    const price = supplyPrice('oil', 50, 20);
    const purse = { ...STARTING_RESOURCES, caps: price };
    const order = { key: 'oil' as const, units: 50, allowanceLeft: 10_000, discountPercent: 20 };
    expect(supplyRefusal({ ...order, stock: purse })).toBeNull();
    expect(supplyRefusal({ ...order, stock: { ...purse, caps: price - 1 } })).toBe('cannot_afford');
  });
});

describe('the Broker after the market discount', () => {
  it('takes the discount off his cut, so a trade gets nearer even and never past it', () => {
    expect(brokerRate(1)).toBe(BARTER_RATE);
    expect(brokerRate(60)).toBe(BARTER_RATE_RESPECTED);
    expect(brokerRate(1, 20)).toBeCloseTo(1 - (1 - BARTER_RATE) * 0.8, 6);
    for (const level of [1, 60]) {
      for (const discount of [0, 10, MAX_MARKET_DISCOUNT, 100, 500]) {
        expect(brokerRate(level, discount)).toBeLessThan(1);
        expect(brokerRate(level, discount)).toBeGreaterThanOrEqual(barterRateFor(level));
      }
    }
    // Round and round the Broker at the best rate a crew can reach still loses goods.
    const rate = brokerRate(60, MAX_MARKET_DISCOUNT);
    expect(
      barterQuote('oil', 'scrap', barterQuote('scrap', 'oil', 1_000, rate), rate),
    ).toBeLessThan(1_000);
  });
});

describe('§I3: the Broker’s cut', () => {
  it('takes half until level 60 and less after it', () => {
    expect(barterRateFor(1)).toBe(BARTER_RATE);
    expect(barterRateFor(59)).toBe(BARTER_RATE);
    expect(barterRateFor(60)).toBe(BARTER_RATE_RESPECTED);
    expect(barterQuote('oil', 'oil', 100, barterRateFor(60))).toBeGreaterThan(
      barterQuote('oil', 'oil', 100, barterRateFor(59)),
    );
  });

  it('still floors, so a single scrap through the window is never a free unit', () => {
    expect(barterQuote('oil', 'oil', 1, BARTER_RATE_RESPECTED)).toBe(0);
    expect(Number.isInteger(barterQuote('oil', 'scrap', 37, BARTER_RATE_RESPECTED))).toBe(true);
  });
});
