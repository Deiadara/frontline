import { z } from 'zod';
import { BLUEPRINTS } from '../blueprints/catalog.js';
import { ITEM_CATALOG, ITEM_IDS, type ItemId } from '../items/catalog.js';
import { MILESTONE_BROKERS_RESPECT, isPlayerUnlockActive } from '../progression/unlocks.js';
import { RESOURCE_KEYS, type ResourceKey } from '../resources.js';
import { seedFrom } from '../rng.js';
import { GAME_TIMEZONE, dayInZone, hourInZone, instantAtHourInZone } from '../time/zone.js';

/**
 * The market's two traders (GDD §D, market extension).
 *
 * ## The Runner: in town four hours a day, and never the same four
 *
 * A vendor who is always there is a shop, and a shop is a menu: a player buys what they need when
 * they need it and the market stops being a place. The Runner is in the district for two two-hour
 * sessions each game day, and *which* hours changes every day. That does three things at once. It
 * gives the day a shape, it makes a blueprint you wanted and missed sting, and it gives players a
 * reason to tell each other when he is in.
 *
 * **The same for the whole city.** Everyone sees the same hours and the same stock on the same
 * day, because a market where two players are looking at different shops cannot be talked about.
 * Both are derived from the game date alone: no table, no scheduler, no row anybody has to write.
 * Two servers, two months apart, agree about what he was selling on any given day.
 *
 * ## The Broker: always open, and always taking half
 *
 * The other end of the same idea. He will turn any resource into any other at a flat fifty
 * percent, which is a terrible rate and exactly the point: it is the floor under every shortage,
 * never the plan. A crew that is one hundred oil short of a Generator can always get there; a crew
 * that funds itself through the Broker is burning half of everything it earns.
 */

/** How many sessions a day, and how long each runs. Four hours in total, split in two. */
export const VENDOR_SESSIONS_PER_DAY = 2;
export const VENDOR_SESSION_HOURS = 2;

/** What the Broker keeps. 100 oil in, 50 scrap out. */
export const BARTER_RATE = 0.5;

/** How many lines the Runner carries on a given day. */
export const VENDOR_STOCK_SIZE = 6;

/*
 * The hash is `../rng.js` now, not a private copy.
 *
 * It used to be duplicated here with a note explaining that the Bar's version "lives on the server
 * and the market has to be derivable on both sides". That was the right observation and the wrong
 * conclusion: a hash both sides need belongs in the shared package, which is where it is. Four
 * copies of FNV-1a existed by the time anybody counted (two spelled with shifts and two with
 * `Math.imul`, which are the same function and were checked to be, over 200,000 strings).
 */
function rngFrom(seed: string): () => number {
  let state = seedFrom(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  const chosen = items[Math.floor(rng() * items.length)];
  if (chosen === undefined) throw new Error('cannot pick from an empty list');
  return chosen;
}

/**
 * The game day an instant belongs to, `YYYY-MM-DD`. The market's unit of time.
 *
 * Athens, like every other daily reset in the game. The Runner's hours, his stock and the supply
 * ration are all keyed on this, so they turn over together with the black market's shelf rather
 * than three hours apart for half the year.
 */
export function marketDay(now: Date, zone: string = GAME_TIMEZONE): string {
  return dayInZone(now, zone);
}

export const VendorSessionSchema = z.object({
  /** Hour of the game day the session opens, 0..23. Athens, not UTC. */
  startHour: z.number().int().min(0).max(23),
  /** Hours it runs for. */
  hours: z.number().int().positive(),
});
export type VendorSession = z.infer<typeof VendorSessionSchema>;

/**
 * When the Runner is in, on this day.
 *
 * Two sessions, two hours each, never overlapping and never adjacent: a four-hour block would be
 * one session wearing two hats, and the whole point is that missing one still leaves the other.
 * The second is drawn from the hours far enough from the first to guarantee it.
 */
export function vendorSessionsFor(day: string): VendorSession[] {
  const rng = rngFrom(`${day}:vendor-hours`);
  // First anywhere in the day that leaves room for the session itself.
  const first = Math.floor(rng() * (24 - VENDOR_SESSION_HOURS));
  // Second at least three hours clear of the first on either side, wrapped into the day.
  const gap = VENDOR_SESSION_HOURS + 1;
  const openings: number[] = [];
  for (let hour = 0; hour <= 24 - VENDOR_SESSION_HOURS; hour++) {
    if (Math.abs(hour - first) >= gap) openings.push(hour);
  }
  const second = openings.length > 0 ? pick(rng, openings) : first;

  return [first, second]
    .sort((a, b) => a - b)
    .map((startHour) => ({ startHour, hours: VENDOR_SESSION_HOURS }));
}

/** Whether the Runner is in the district at this instant. */
export function vendorOpenAt(now: Date, zone: string = GAME_TIMEZONE): boolean {
  return currentVendorSession(now, zone) !== null;
}

/** The session currently running, if any. */
export function currentVendorSession(
  now: Date,
  zone: string = GAME_TIMEZONE,
): VendorSession | null {
  const hour = hourInZone(now, zone);
  return (
    vendorSessionsFor(marketDay(now, zone)).find(
      (session) => hour >= session.startHour && hour < session.startHour + session.hours,
    ) ?? null
  );
}

/**
 * When the Runner next opens, as an absolute instant.
 *
 * Looks into tomorrow as well as today, because "next" at 23:00 is almost always tomorrow, and a
 * countdown that says "in -4 hours" is worse than no countdown.
 */
export function nextVendorOpening(now: Date, zone: string = GAME_TIMEZONE): Date {
  const today = marketDay(now, zone);
  // A whole day on, then read back through the zone, so the "tomorrow" this looks at is tomorrow
  // in the game's calendar rather than 24 hours of wall clock that a summer-time night shortens.
  const tomorrow = marketDay(new Date(now.getTime() + 86_400_000), zone);
  const days = today === tomorrow ? [today] : [today, tomorrow];
  for (const day of days) {
    for (const session of vendorSessionsFor(day)) {
      const opens = instantAtHourInZone(day, session.startHour, zone);
      if (opens.getTime() > now.getTime()) return opens;
    }
  }
  // Unreachable while there is at least one session a day, but a total function beats a throw on
  // a clock edge nobody will ever reproduce.
  return new Date(now.getTime() + 86_400_000);
}

/** When the running session closes. `null` when he is not in. */
export function vendorClosesAt(now: Date, zone: string = GAME_TIMEZONE): Date | null {
  const session = currentVendorSession(now, zone);
  if (!session) return null;
  // `startHour + hours` can reach 24, which `instantAtHourInZone` reads as midnight tomorrow.
  return instantAtHourInZone(marketDay(now, zone), session.startHour + session.hours, zone);
}

export const VendorLineSchema = z.object({
  id: z.string().min(1),
  item: z.string().min(1),
  /** How many are on the barrow today. Sold out is a real state and it is shared by the city. */
  stock: z.number().int().nonnegative(),
  /** Caps each. Marked up from the item's own value, and it moves day to day. */
  price: z.number().int().positive(),
});
export type VendorLine = z.infer<typeof VendorLineSchema>;

/** How much the Runner marks up, at worst and at best. He is not a charity and not a robbery. */
const MARKUP_MIN = 1.15;
const MARKUP_MAX = 1.6;

/**
 * §F3: how often the Runner has a page on the barrow, and what he charges over the odds for it.
 *
 * Rare and dear, which is the brief. At 0.15 a page turns up on roughly one barrow in six, so a
 * player who checks every day sees a handful a month and can never count on one.
 *
 * Dear without a special markup: a page's `capsValue` already scales with how many pages its
 * document takes, from 360 for a two page blueprint to 1440 for an eight, against ordinary goods
 * that run from 120. Giving pages their own multiplier on top bought nothing except an exception to
 * the one rule the barrow has, and broke the invariant that every line is inside the markup band.
 */
export const VENDOR_PAGE_ODDS = 0.15;

/**
 * What the Runner is carrying today.
 *
 * Weighted away from the exotic end: a barrow with a Rotor Hub on it every day is a barrow nobody
 * has to plan around. Blueprints appear at most twice, so a player who wants a specific one is
 * waiting for a day rather than for a purchase.
 */
export function vendorStockFor(day: string): VendorLine[] {
  const rng = rngFrom(`${day}:vendor-stock`);
  const weighted: ItemId[] = ITEM_IDS.flatMap((id) => {
    const spec = ITEM_CATALOG[id];
    const weight =
      spec.rarity === 'common'
        ? 5
        : spec.rarity === 'uncommon'
          ? 3
          : spec.rarity === 'rare'
            ? 2
            : 1;
    return Array.from({ length: weight }, () => id);
  });

  const chosen: ItemId[] = [];
  let blueprints = 0;
  let guard = 0;
  while (chosen.length < VENDOR_STOCK_SIZE && guard++ < 200) {
    const id = pick(rng, weighted);
    if (chosen.includes(id)) continue;
    if (ITEM_CATALOG[id].kind === 'blueprint') {
      if (blueprints >= 2) continue;
      blueprints++;
    }
    chosen.push(id);
  }

  /*
   * §F3: and once in a while, a page.
   *
   * Off the goods list on purpose. `ITEM_IDS` is what every shop draws from and pages are not on
   * it, so the Runner carries one only because this says so, at odds low enough that a player
   * cannot plan a barrow around it. Caps rather than infamy: the Black Market is where infamy buys
   * the page you are short of and this is the lucky find, so the two never compete for the same
   * currency.
   */
  if (rng() < VENDOR_PAGE_ODDS) {
    const pages = BLUEPRINTS.flatMap((blueprint) => blueprint.pages.map((page) => page.id));
    const page = pick(rng, pages) as ItemId;
    // Substituted for the last line rather than appended. The barrow is `VENDOR_STOCK_SIZE` wide,
    // and a seventh line on exactly the days a page is on it would tell a player what they had
    // before they read a word of it.
    if (!chosen.includes(page) && chosen.length > 0) chosen[chosen.length - 1] = page;
  }

  return chosen.map((id, index) => {
    const spec = ITEM_CATALOG[id];
    const markup = MARKUP_MIN + rng() * (MARKUP_MAX - MARKUP_MIN);
    // One of a blueprint, one of a page, a handful of anything else. A blueprint is knowledge and
    // two is nothing; a page is one particular sheet of paper and there is only ever one of it.
    const stock = spec.kind === 'blueprint' || spec.kind === 'page' ? 1 : 1 + Math.floor(rng() * 4);
    return {
      id: `${day}-${index}-${id}`,
      item: id,
      stock,
      price: Math.max(1, Math.round(spec.capsValue * markup)),
    };
  });
}

/**
 * §I3: what the Broker keeps once a crew is worth being careful with.
 *
 * `MILESTONE_BROKERS_RESPECT` is the only thing that has ever moved this rate. Sixty-five percent
 * back rather than fifty is a third more on every trade, which is large enough to feel at level 60
 * and still bad enough that the Broker remains a floor under a shortage rather than an income.
 */
export const BARTER_RATE_RESPECTED = 0.65;

export function barterRateFor(level: number): number {
  return isPlayerUnlockActive(MILESTONE_BROKERS_RESPECT, level)
    ? BARTER_RATE_RESPECTED
    : BARTER_RATE;
}

/**
 * What the Broker gives for a resource, in another resource.
 *
 * Flat, symmetric and deliberately bad. Floored at zero rather than at one: handing over a single
 * scrap and getting something back would be a rounding exploit before it was a mercy.
 *
 * The rate is a parameter rather than the constant so the level-60 milestone lands in one place and
 * the client's quote and the server's settlement cannot disagree about which rate applied.
 */
export function barterQuote(giveAmount: number, rate: number = BARTER_RATE): number {
  return Math.floor(Math.max(0, giveAmount) * Math.max(0, rate));
}

/** The smallest trade the Broker will look at. Below this the rate rounds to nothing anyway. */
export const BARTER_MINIMUM = 10;

/** The resources the Broker deals in: all of them, in stockpile order. */
export const BARTER_RESOURCES: readonly ResourceKey[] = RESOURCE_KEYS;
