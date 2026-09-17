import { CITIES, DEFAULT_CITY_ID } from '../city/cities.js';
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

/**
 * How much the Runner marks up the ordinary stock, at worst and at best.
 *
 * He is not a charity and not a robbery. Exported because the band is a design number the balance
 * tests measure a barrow against, and a test that restates it is a test of its own copy.
 */
export const VENDOR_MARKUP_MIN = 1.15;
export const VENDOR_MARKUP_MAX = 1.6;

/**
 * §F3: the dear end of the barrow, and what he charges for standing there (maintainer, 2026-09-17).
 *
 * The barrow was twelve components at one markup band, so every line on it was the same *kind* of
 * purchase and the only question was which material a crew happened to be short of. Six lines with
 * nothing to save up for is a shop, not a barrow.
 *
 * Two things fix it together. The last line is **reserved** for the dear stock (see
 * {@link VENDOR_DEAR_GOODS}, or a page at {@link VENDOR_PAGE_ODDS}), so there is always one thing
 * on it worth walking down for; and anything dear is priced out of its own, steeper band wherever
 * it lands, not only in the reserved slot. A Rotor Hub in the middle of the barrow is the same
 * Rotor Hub.
 */
export const VENDOR_DEAR_MARKUP_MIN = 1.75;
export const VENDOR_DEAR_MARKUP_MAX = 2.4;

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
 * What the Runner carries: parts and relics, never a finished blueprint (maintainer request, 2026-09-10).
 *
 * The six pre-war `blueprint_*` goods used to be on the barrow up to twice a day. A blueprint is a
 * document assembled out of pages now, and a shop that sold the finished thing beside the pages a
 * crew is collecting was two prices for one idea. So the barrow's pool is the goods list without
 * them; the only paper he ever carries is a **page**, at the odds below. The old documents stay in
 * the catalogue and in inventories, and the Black Market's shelf is its own call.
 */
export const VENDOR_GOODS: readonly ItemId[] = ITEM_IDS.filter(
  (id) => ITEM_CATALOG[id].kind !== 'blueprint',
);

/**
 * The rarities that count as dear, and the goods that carry them.
 *
 * Advanced and masterpiece. Those are the four-figure parts a build is actually held up by, and
 * they are what the reserved line is drawn from when he has no page to put there.
 */
export const VENDOR_DEAR_RARITIES = ['advanced', 'masterpiece'] as const;

export const VENDOR_DEAR_GOODS: readonly ItemId[] = VENDOR_GOODS.filter((id) =>
  (VENDOR_DEAR_RARITIES as readonly string[]).includes(ITEM_CATALOG[id].rarity),
);

/**
 * Whether a line is priced out of the steep band.
 *
 * Read off the *item*, not off which slot it landed in, so a Rotor Hub that came up in the ordinary
 * five costs what a Rotor Hub costs. A page is always dear: it is one particular sheet of paper and
 * the only other counter that sells it wants infamy.
 */
export function isDearVendorLine(item: ItemId): boolean {
  const spec = ITEM_CATALOG[item];
  return spec.kind === 'page' || (VENDOR_DEAR_RARITIES as readonly string[]).includes(spec.rarity);
}

/**
 * What the Runner is carrying today: five drawn lines and one reserved one.
 *
 * The five are weighted away from the masterpiece end, because a barrow with a Rotor Hub on it
 * every day is a barrow nobody has to plan around. The sixth is {@link dearLineFor}: a dear
 * component, or a page at {@link VENDOR_PAGE_ODDS}, so there is always one thing on the barrow
 * worth saving for and it is priced out of the steep band.
 *
 * `cityId` is what a barrow belongs to (maintainer, 2026-09-17): a market is a city's, so the city
 * is in the seed and in every line id, and two cities carry different stock on the same day. It
 * defaults to the open city, whose id folds to an empty prefix, so every fixture, test and
 * screenshot pinned on the old draw still names the same six lines at the same ids.
 *
 * ## Why the city's standing is not in here
 *
 * The Bar's room is weighted by who holds the city (`cityCalibre`), and the obvious next step was to
 * tilt this rarity draw the same way. It is the wrong step, and the reason is the auction: a line is
 * a **lot** that bids stand against all day, so the six items and their ids have to be the same six
 * at the close as they were when the first bid was placed. A draw that read the live map would
 * redraw the barrow the moment anybody anywhere took a location, and every bid on a line that
 * vanished would be a bid on nothing. A barrow is a pure function of the day and the city, and that
 * is what makes it safe to bid on.
 */
export function vendorStockFor(day: string, cityId: string = DEFAULT_CITY_ID): VendorLine[] {
  const room = cityId === DEFAULT_CITY_ID ? '' : `${cityId}:`;
  const rng = rngFrom(`${room}${day}:vendor-stock`);
  const weighted: ItemId[] = VENDOR_GOODS.flatMap((id) => {
    const spec = ITEM_CATALOG[id];
    const weight =
      spec.rarity === 'basic'
        ? 5
        : spec.rarity === 'intricate'
          ? 3
          : spec.rarity === 'advanced'
            ? 2
            : 1;
    return Array.from({ length: weight }, () => id);
  });

  // One short of the barrow: the last line is the reserved one, below.
  const chosen: ItemId[] = [];
  let guard = 0;
  while (chosen.length < VENDOR_STOCK_SIZE - 1 && guard++ < 200) {
    const id = pick(rng, weighted);
    if (chosen.includes(id)) continue;
    chosen.push(id);
  }

  chosen.push(dearLineFor(rng, chosen));

  return chosen.map((id, index) => {
    const spec = ITEM_CATALOG[id];
    const dear = isDearVendorLine(id);
    const low = dear ? VENDOR_DEAR_MARKUP_MIN : VENDOR_MARKUP_MIN;
    const high = dear ? VENDOR_DEAR_MARKUP_MAX : VENDOR_MARKUP_MAX;
    const markup = low + rng() * (high - low);
    // One of a page, a handful of anything else: a page is one particular sheet of paper and
    // there is only ever one of it on the barrow.
    const stock = spec.kind === 'page' ? 1 : 1 + Math.floor(rng() * 4);
    return {
      // The city is in the id for the reason the Bar's recruit ids carry it: two cities on one day
      // would otherwise mint the same six ids, and a bid filed against one would name a different
      // crate in the other.
      id: `${room}${day}-${index}-${id}`,
      item: id,
      stock,
      price: Math.max(1, Math.round(spec.capsValue * markup)),
    };
  });
}

/**
 * One line off any city's barrow, found by its id alone.
 *
 * A line id carries its city, so the city is recoverable from the id and nothing that looks up a
 * lot has to be told which barrow to look in. That matters most on the close: a bid is settled from
 * a stored row that names a day, a session and a line, and threading a city through the bid table,
 * the settle and the world tick to re-derive a barrow the id already identifies would be three
 * migrations to say something the string says.
 *
 * Walks the cities in map order, which is three barrows of six. The ids are unique across them
 * (`vendor.test.ts` holds that), so the first match is the only match.
 */
export function findVendorLine(day: string, lineId: string): VendorLine | undefined {
  for (const city of CITIES) {
    const line = vendorStockFor(day, city.id).find((candidate) => candidate.id === lineId);
    if (line !== undefined) return line;
  }
  return undefined;
}

/**
 * §F3: the one line he always has something good on, and once in a while it is paper.
 *
 * Off the goods list on purpose where it is a page. `ITEM_IDS` is what every shop draws from and
 * pages are not on it, so the Runner carries one only because this says so, at odds low enough that
 * a player cannot plan a barrow around it. Caps rather than infamy: the Black Market is where infamy
 * buys the page you are short of and this is the lucky find, so the two never compete for the same
 * currency.
 *
 * The rest of the time it is a dear component, which is the half of this the barrow was missing: a
 * shelf of basics is a shelf a crew skims, and a Targeting Core at the end of it is a reason to
 * come back with money.
 *
 * `taken` is what the ordinary five already hold, so the reserved line is never a second copy of
 * one of them. If the five somehow swallowed every dear good, it falls back to anything left rather
 * than looping: a barrow one line short would be worse than a barrow with a cheap line on the end.
 */
function dearLineFor(rng: () => number, taken: readonly ItemId[]): ItemId {
  if (rng() < VENDOR_PAGE_ODDS) {
    const pages = BLUEPRINTS.flatMap((blueprint) => blueprint.pages.map((page) => page.id));
    const page = pick(rng, pages) as ItemId;
    if (!taken.includes(page)) return page;
  }
  const dear = VENDOR_DEAR_GOODS.filter((id) => !taken.includes(id));
  if (dear.length > 0) return pick(rng, dear);
  const rest = VENDOR_GOODS.filter((id) => !taken.includes(id));
  return rest.length > 0 ? pick(rng, rest) : pick(rng, VENDOR_GOODS);
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

/**
 * The resources the Broker deals in: every material, and never caps (maintainer request, 2026-09-09).
 *
 * Caps are money, and the supply run is where money becomes material at a price the day rations.
 * A Broker that took caps at half would be a second, unrationed supply run, and one that paid
 * caps out would be a cash machine for anybody with a full warehouse.
 */
export const BARTER_RESOURCES: readonly ResourceKey[] = RESOURCE_KEYS.filter(
  (key) => key !== 'caps',
);

/** Whether the Broker will touch this resource at all. */
export function brokerDealsIn(key: ResourceKey): boolean {
  return BARTER_RESOURCES.includes(key);
}
