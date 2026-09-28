import { z } from 'zod';
import { ITEM_CATALOG, type ItemId } from '../items/catalog.js';
import { InventorySchema, hasItems, type Inventory } from '../items/inventory.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import {
  PartialResourcesSchema,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  canAfford,
  type PartialResources,
  type Resources,
} from '../resources.js';

/**
 * Trading between players (market extension).
 *
 * A board rather than an auction house. Somebody posts what they will give and what they want;
 * anybody else can take it as it stands, or come back with a different number. That second half is
 * the part that makes it a market rather than a vending machine: the interesting thing about
 * trading with a person is that they can say "no, but".
 *
 * ## Escrow, and why the goods leave immediately
 *
 * What an offer gives is taken out of the seller's stockpile the moment it is posted, not when it
 * is accepted. Otherwise the same hundred oil can back five simultaneous offers, four of them fail
 * at the moment somebody tries to take them, and the board fills with listings that are lies. The
 * goods come back if the offer is withdrawn or expires.
 *
 * What an offer *wants* is not escrowed: the buyer pays at the moment they accept, and cannot
 * accept what they cannot pay.
 *
 * ## Counter-offers are new offers, aimed at one person
 *
 * A counter is a fresh listing with `counterTo` set and a `directedAt`. It sits on the original
 * poster's own board rather than the public one, and accepting it settles both. Modelling a
 * counter as an offer rather than as a message means one settlement path, one escrow rule and one
 * place where goods change hands.
 */

export const OFFER_STATUSES = ['open', 'accepted', 'withdrawn', 'expired'] as const;
export const OfferStatusSchema = z.enum(OFFER_STATUSES);
export type OfferStatus = z.infer<typeof OfferStatusSchema>;

/** One side of a trade: resources, items, or both. */
export const TradeBundleSchema = z.object({
  resources: PartialResourcesSchema,
  items: InventorySchema,
});
export type TradeBundle = z.infer<typeof TradeBundleSchema>;

export const MarketOfferSchema = z.object({
  id: IdSchema,
  sellerBaseId: IdSchema,
  sellerName: z.string().min(1),
  give: TradeBundleSchema,
  want: TradeBundleSchema,
  status: OfferStatusSchema,
  createdAt: IsoDateTimeSchema,
  /** Set when this is a counter to somebody else's offer. */
  counterTo: IdSchema.nullable(),
  /** Set on a counter: only this crew sees it and only this crew can take it. */
  directedAt: IdSchema.nullable(),
});
export type MarketOffer = z.infer<typeof MarketOfferSchema>;

/** How long a listing stands before the goods go home. */
export const OFFER_LIFETIME_HOURS = 48;

/** The most listings one crew may have standing at once, counters included. The board's five. */
export const MAX_OPEN_OFFERS = 5;

export function emptyBundle(): TradeBundle {
  return { resources: {}, items: {} };
}

export function bundleIsEmpty(bundle: TradeBundle): boolean {
  const resources = Object.values(bundle.resources).some((amount) => (amount ?? 0) > 0);
  const items = Object.values(bundle.items).some((count) => (count ?? 0) > 0);
  return !resources && !items;
}

/**
 * What a bundle is worth in caps, at the vendor's own prices.
 *
 * Not a price. Nobody is forced to trade at it. It is the number the board shows beside each side
 * of a listing so a player can tell a fair trade from a robbery at a glance, which is the single
 * most useful thing a trading screen can do for somebody who has not memorised the catalogue.
 */
export function bundleValue(bundle: TradeBundle): number {
  const resources = RESOURCE_KEYS.reduce(
    (total, key) => total + (bundle.resources[key] ?? 0) * RESOURCE_CAP_VALUE[key],
    0,
  );
  const items = Object.entries(bundle.items).reduce(
    (total, [id, count]) => total + ITEM_CATALOG[id as ItemId].capsValue * (count ?? 0),
    0,
  );
  return Math.round(resources + items);
}

/**
 * What a unit of each resource is worth in caps, for the valuation above.
 *
 * Read off what the Broker and the Runner actually charge rather than invented: caps are caps,
 * supplies and oil are the cheap bulk goods, scrap and planks sit above them because everything is
 * built out of the pair, and high-quality metal is the scarce one.
 *
 * Planks price just under scrap: a ruin gives up its timber more readily than its steel, and the
 * two are wanted in roughly the same quantities, so the cheaper one is the one you strip first.
 */
export const RESOURCE_CAP_VALUE: Readonly<Record<keyof Resources, number>> = {
  caps: 1,
  supplies: 1.5,
  oil: 2,
  planks: 2.2,
  scrap: 2.5,
  highQualityMetal: 12,
};

/**
 * A figure worked out of the values above, with the binary noise taken off before it is rounded.
 *
 * 2.2 and 1.5 have no exact binary form, so a hundred planks at the supplier came to
 * 330.00000000000006 caps and `Math.ceil` charged 331, and thirty-three oil at the Broker came to
 * 14.999999999999998 planks and `Math.floor` paid 14. Every honest figure here is a whole number of
 * hundredths, so rounding to a millionth first moves nothing but the noise.
 */
export function withoutFloatNoise(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export type OfferRefusal =
  'nothing_offered' | 'nothing_wanted' | 'cannot_cover' | 'too_many_offers' | 'untradeable';

/** Why this listing cannot be posted, or `null`. Checked before anything is escrowed. */
export function offerRefusal(
  give: TradeBundle,
  want: TradeBundle,
  stock: Resources,
  inventory: Inventory,
  openOffers: number,
): OfferRefusal | null {
  if (bundleIsEmpty(give)) return 'nothing_offered';
  if (bundleIsEmpty(want)) return 'nothing_wanted';
  if (openOffers >= MAX_OPEN_OFFERS) return 'too_many_offers';
  /*
   * Both sides, not just the one being escrowed.
   *
   * `give` was the only side checked, and an unlocked blueprint is the one thing in the catalogue
   * that may never change hands. A listing that *wanted* one settled without complaint: the buyer
   * pays `want` out of their own inventory in `acceptOffer`, so the document walked from the buyer
   * to the seller through the half of the trade nobody was looking at.
   */
  const untradeable = [...Object.keys(give.items), ...Object.keys(want.items)].some(
    (id) => !ITEM_CATALOG[id as ItemId]?.tradeable,
  );
  if (untradeable) return 'untradeable';
  if (!canAfford(stock, give.resources)) return 'cannot_cover';
  if (!hasItems(inventory, give.items)) return 'cannot_cover';
  return null;
}

/** Whether a crew can pay what a listing asks for. */
export function canSettle(want: TradeBundle, stock: Resources, inventory: Inventory): boolean {
  return canAfford(stock, want.resources) && hasItems(inventory, want.items);
}

export function offerExpiresAt(offer: MarketOffer): Date {
  return new Date(Date.parse(offer.createdAt) + OFFER_LIFETIME_HOURS * 3_600_000);
}

export function offerHasExpired(offer: MarketOffer, now: Date): boolean {
  return offerExpiresAt(offer).getTime() <= now.getTime();
}

/**
 * Goods the board is holding for a crew until it presses Claim (maintainer, 2026-09-28).
 *
 * *"When you have a fulfilled trade, there is a claim button instead, and when you claim it you get
 * the resources. This lasts 24 hours and then is auto claimed and doesn't matter if it overflows,
 * then you lose it."*
 *
 * Everything the board hands a crew while it is not pressing anything waits here: the payment for
 * a listing somebody took, a listing's own goods when it expires untaken, and a counter's goods
 * when the listing it answered closes. The crew pressing Accept or Withdraw is on the screen and is
 * warned there instead, so their goods never wait.
 */
export const CLAIM_WINDOW_HOURS = 24;

/** Why the goods are waiting: somebody took the listing, nobody did, or its parent closed. */
export const MARKET_CLAIM_REASONS = ['taken', 'expired', 'closed'] as const;
export const MarketClaimReasonSchema = z.enum(MARKET_CLAIM_REASONS);
export type MarketClaimReason = z.infer<typeof MarketClaimReasonSchema>;

export const MarketClaimSchema = z.object({
  id: IdSchema,
  /** The listing the goods came off, as it stands now: it is closed for good once it is here. */
  offer: MarketOfferSchema,
  reason: MarketClaimReasonSchema,
  goods: TradeBundleSchema,
  /** The crew that took the listing. Null when nobody did. */
  takenBy: z.string().min(1).nullable(),
  createdAt: IsoDateTimeSchema,
  /** When the board stops holding them and credits them whether the stores have room or not. */
  claimUntil: IsoDateTimeSchema,
});
export type MarketClaim = z.infer<typeof MarketClaimSchema>;

export function claimUntil(createdAt: Date): Date {
  return new Date(createdAt.getTime() + CLAIM_WINDOW_HOURS * 3_600_000);
}

/** A listing a given crew is allowed to see: public ones, plus counters aimed at them. */
export function visibleTo(offer: MarketOffer, baseId: string): boolean {
  if (offer.status !== 'open') return false;
  if (offer.directedAt === null) return true;
  return offer.directedAt === baseId || offer.sellerBaseId === baseId;
}

/** Resources and items in one shape, for a summary line. */
export function describeBundle(bundle: TradeBundle): string {
  const parts: string[] = [];
  for (const key of RESOURCE_KEYS) {
    const amount = bundle.resources[key] ?? 0;
    // `toLowerCase()` on the label would write "hq metal": "HQ" is an acronym, and the label table
    // is the display form. A listing reads perfectly well with it as authored.
    if (amount > 0) parts.push(`${amount.toLocaleString()} ${RESOURCE_LABELS[key]}`);
  }
  for (const [id, count] of Object.entries(bundle.items)) {
    if ((count ?? 0) > 0) parts.push(`${count}× ${ITEM_CATALOG[id as ItemId].name}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

/** Add one bundle's resources to a stockpile, for settlement. */
export function creditResources(stock: Resources, gained: PartialResources): Resources {
  return RESOURCE_KEYS.reduce((next, key) => ({ ...next, [key]: next[key] + (gained[key] ?? 0) }), {
    ...stock,
  });
}
