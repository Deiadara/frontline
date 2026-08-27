import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG, ITEM_IDS, type ItemId } from '../items/catalog.js';
import { addItems, hasItems, heldItems, removeItems } from '../items/inventory.js';
import { STARTING_RESOURCES, type ResourceKey } from '../resources.js';
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
  supplyAllowance,
  supplyAllowancePercent,
  supplyBoard,
  supplyPrice,
  supplyRefusal,
} from './supply.js';
import {
  BARTER_RATE,
  BARTER_RATE_RESPECTED,
  barterRateFor,
  VENDOR_SESSIONS_PER_DAY,
  VENDOR_SESSION_HOURS,
  VENDOR_STOCK_SIZE,
  barterQuote,
  currentVendorSession,
  marketDay,
  nextVendorOpening,
  vendorClosesAt,
  vendorOpenAt,
  vendorSessionsFor,
  vendorStockFor,
} from './vendor.js';

/** A month of days, so every property below is checked against a spread rather than one date. */
const DAYS = Array.from({ length: 60 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 1));
  date.setUTCDate(date.getUTCDate() + index);
  return marketDay(date);
});

const at = (day: string, hour: number): Date =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:30:00.000Z`);

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
    expect(vendorClosesAt(inside)?.getUTCHours()).toBe(session.startHour + session.hours);
  });

  it('always has a next opening, and it is in the future', () => {
    for (const day of DAYS.slice(0, 10)) {
      for (const hour of [0, 6, 12, 23]) {
        const now = at(day, hour);
        expect(nextVendorOpening(now).getTime(), `${day} ${hour}`).toBeGreaterThan(now.getTime());
      }
    }
  });

  describe('the barrow', () => {
    it('carries a full spread, with nothing listed twice', () => {
      for (const day of DAYS) {
        const stock = vendorStockFor(day);
        expect(stock, day).toHaveLength(VENDOR_STOCK_SIZE);
        expect(new Set(stock.map((line) => line.item)).size, day).toBe(stock.length);
      }
    });

    it('never carries more than two blueprints, and only ever one of each', () => {
      for (const day of DAYS) {
        const stock = vendorStockFor(day);
        const blueprints = stock.filter(
          (line) => ITEM_CATALOG[line.item as ItemId].kind === 'blueprint',
        );
        expect(blueprints.length, day).toBeLessThanOrEqual(2);
        for (const line of blueprints) expect(line.stock, day).toBe(1);
      }
    });

    /** He is not a charity and not a robbery: every price is above the item's worth, and sane. */
    it('marks everything up, within a band', () => {
      for (const day of DAYS) {
        for (const line of vendorStockFor(day)) {
          const worth = ITEM_CATALOG[line.item as ItemId].capsValue;
          expect(line.price, `${day} ${line.item}`).toBeGreaterThan(worth);
          expect(line.price, `${day} ${line.item}`).toBeLessThan(worth * 2);
        }
      }
    });

    it('shows the exotic end far less often than the common one', () => {
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
      expect(rate('common')).toBeGreaterThan(rate('exotic'));
    });
  });
});

describe('the Broker', () => {
  it('gives back exactly half, rounded down', () => {
    expect(barterQuote(100)).toBe(100 * BARTER_RATE);
    expect(barterQuote(101)).toBe(50);
    expect(barterQuote(1)).toBe(0);
    expect(barterQuote(0)).toBe(0);
  });

  it('never pays out on a negative trade', () => {
    expect(barterQuote(-500)).toBe(0);
  });
});

describe('the satchel', () => {
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

  it('caps how many one crew may have standing', () => {
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

  it('measures the ration against the warehouse, in whole units', () => {
    expect(supplyAllowance(1, 1000)).toBe(300);
    expect(supplyAllowance(36, 1000)).toBe(1000);
    // A district with nothing left standing can still buy a single thing. A zero allowance is a
    // dead account, not a setback.
    expect(supplyAllowance(1, 0)).toBe(1);
    expect(Number.isInteger(supplyAllowance(7, 977))).toBe(true);
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

  it('will not sell caps for caps', () => {
    expect(
      supplyRefusal({
        key: 'caps',
        units: 10,
        stock: rich,
        allowanceLeft: 10_000,
        capacity: 10_000,
      }),
    ).toBe('not_a_resource');
  });

  it('refuses past the ration, past the warehouse and past the wallet: in that order', () => {
    const order = { key: 'scrap' as const, stock: rich, capacity: 10_000 };
    expect(supplyRefusal({ ...order, units: 0, allowanceLeft: 100 })).toBe('nothing_ordered');
    expect(supplyRefusal({ ...order, units: 101, allowanceLeft: 100 })).toBe('over_allowance');
    // Inside the ration, over the shelf: the store already holds what `rich` starts with.
    expect(supplyRefusal({ ...order, units: 9_999, allowanceLeft: 99_999, capacity: 1_000 })).toBe(
      'no_room',
    );
    expect(
      supplyRefusal({
        key: 'highQualityMetal',
        units: 5_000,
        stock: { ...STARTING_RESOURCES, caps: 10 },
        allowanceLeft: 99_999,
        capacity: 999_999,
      }),
    ).toBe('cannot_afford');
    expect(supplyRefusal({ ...order, units: 100, allowanceLeft: 100 })).toBeNull();
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
          capacity: line.capacity,
        }),
        `${line.key} quoted ${line.most} as buyable`,
      ).toBeNull();
    }
  });

  it('spends the ration as one pooled budget rather than a quota a line', () => {
    const board = supplyBoard(1, rich, 1_000, 290, shelf);
    // 300 allowed, 290 spent: ten left, for whichever line the player wants them on.
    expect(board.allowance - board.used).toBe(10);
    for (const line of board.lines) expect(line.most).toBeLessThanOrEqual(10);
  });
});

describe('§I3: the Broker’s cut', () => {
  it('takes half until level 60 and less after it', () => {
    expect(barterRateFor(1)).toBe(BARTER_RATE);
    expect(barterRateFor(59)).toBe(BARTER_RATE);
    expect(barterRateFor(60)).toBe(BARTER_RATE_RESPECTED);
    expect(barterQuote(100, barterRateFor(60))).toBeGreaterThan(
      barterQuote(100, barterRateFor(59)),
    );
  });

  it('still floors, so a single scrap through the window is never a free unit', () => {
    expect(barterQuote(1, BARTER_RATE_RESPECTED)).toBe(0);
    expect(Number.isInteger(barterQuote(37, BARTER_RATE_RESPECTED))).toBe(true);
  });
});
