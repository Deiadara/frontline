import {
  ITEM_CATALOG,
  MarketClaimSchema,
  MarketOfferSchema,
  type MarketClaim,
  type MarketOffer,
  type OfferStatus,
} from '@frontline/shared';
import { readJson } from '../json.js';
import type { Statement } from 'better-sqlite3';
import type { AppDatabase } from '../index.js';

/**
 * The trading board.
 *
 * A table rather than a column on `bases`, because a listing belongs to the *board*: everybody has
 * to be able to see one without loading the crew that posted it, and a crew that goes away leaves
 * its listings behind for exactly as long as it takes to settle or expire them.
 *
 * Nothing here decides anything. Escrow, expiry and who may see what are rules, and they live in
 * `@frontline/shared` where both sides can read them: this only stores rows.
 */

interface OfferRow {
  id: string;
  seller_base_id: string;
  seller_name: string;
  give_json: string;
  want_json: string;
  status: string;
  created_at: string;
  counter_to: string | null;
  directed_at: string | null;
  city_id: string;
}

interface ClaimRow {
  id: string;
  base_id: string;
  offer_id: string;
  reason: string;
  resources_json: string;
  items_json: string;
  taken_by: string | null;
  created_at: string;
  claim_until: string;
}

/** A claim as stored: the crew it is for, beside what the screen is sent. */
export type StoredClaim = MarketClaim & { baseId: string };

export interface MarketRepo {
  insert(offer: MarketOffer): void;
  findById(id: string): MarketOffer | undefined;
  /** Every listing with this status, newest first. */
  listByStatus(status: OfferStatus): MarketOffer[];
  /** Every open listing on one city's board, newest first. */
  openInCity(cityId: string): MarketOffer[];
  /** What one crew has standing, counters included, in every city, newest first. */
  openBySeller(baseId: string): MarketOffer[];
  setStatus(id: string, status: OfferStatus): void;
  /** Counters aimed at a listing, so withdrawing the parent can release theirs too. */
  countersTo(offerId: string): MarketOffer[];
  /** Holds goods for a crew until it claims them (`MarketClaim`). */
  insertClaim(claim: StoredClaim): void;
  findClaim(id: string): StoredClaim | undefined;
  /** What the board is holding for one crew, soonest to lapse first. */
  claimsFor(baseId: string): StoredClaim[];
  /** The ids of claims whose window has closed by `now`, unparsed, for the world clock. */
  lapsedClaimIds(now: Date): string[];
  /** The ids of open listings posted at or before `cutoff`, unparsed, for the world clock. */
  openIdsPostedBy(cutoff: Date): string[];
  deleteClaim(id: string): void;
  /** Drops everything held for a crew, paid to nobody: a reset's clean slate. */
  dropClaimsFor(baseId: string): void;
  /** Units of material this crew has bought with caps today. The whole of the ration's state. */
  supplyUsed(baseId: string, day: string): number;
  /** Adds to it. Upserts, because the first purchase of a day has no row to increment. */
  recordSupply(baseId: string, day: string, units: number, at: string): void;
  /** How many of a vendor line the whole city has taken on `day`. */
  vendorSold(day: string, lineId: string): number;
  /** Books `count` more of a line against the day's stock. */
  recordVendorSale(day: string, lineId: string, count: number, at: string): void;
}

/**
 * A bundle with any item the catalogue no longer carries dropped (bug pass, 2026-09-29).
 *
 * The same floor the inventory has (`db/repos/bases.ts`), for the same reason: `InventorySchema` is
 * keyed on the live catalogue, so a retired good in a stored bundle threw on every read of the row.
 * A listing that threw was only left off the board; its expiry threw on every tick, so the escrow
 * never came home, and a claim that threw was neither shown nor paid, taking the resources beside
 * the retired good down with it. The good itself is worth nothing now, and the inventory would drop
 * it the moment it landed.
 */
function withoutRetiredItems(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const bundle = raw as Record<string, unknown>;
  const items = bundle.items;
  if (items === null || typeof items !== 'object' || Array.isArray(items)) return raw;
  return {
    ...bundle,
    items: Object.fromEntries(
      Object.entries(items).filter(([id]) => Object.hasOwn(ITEM_CATALOG, id)),
    ),
  };
}

function rowToOffer(row: OfferRow): MarketOffer {
  return MarketOfferSchema.parse({
    id: row.id,
    sellerBaseId: row.seller_base_id,
    sellerName: row.seller_name,
    give: withoutRetiredItems(readJson(row.give_json)),
    // On an open listing too (maintainer, 2026-09-29: "drop whatever is removed"). The listing gets
    // cheaper, which is accepted; one left asking for nothing is closed by the board's sweep with
    // its escrow held for the poster (`settleMarketBoard`), so nobody takes it for free.
    want: withoutRetiredItems(readJson(row.want_json)),
    status: row.status,
    createdAt: row.created_at,
    counterTo: row.counter_to,
    directedAt: row.directed_at,
    cityId: row.city_id,
  });
}

function rowToClaim(row: ClaimRow, offer: MarketOffer): StoredClaim {
  return {
    ...MarketClaimSchema.parse({
      id: row.id,
      offer,
      reason: row.reason,
      goods: withoutRetiredItems({
        resources: readJson(row.resources_json),
        items: readJson(row.items_json),
      }),
      takenBy: row.taken_by,
      createdAt: row.created_at,
      claimUntil: row.claim_until,
    }),
    baseId: row.base_id,
  };
}

/**
 * Listings for a board, leaving out any that no longer parse (bug pass, 2026-09-28). A retired
 * item id in one bundle made every read of the board a 500 for every crew in the city; the rest
 * of the board is still a board without it, and the world clock reports it (`world/guard.ts`)
 * when it tries to settle it.
 */
function readableOffers(rows: OfferRow[]): MarketOffer[] {
  return rows.flatMap((row) => {
    try {
      return [rowToOffer(row)];
    } catch {
      return [];
    }
  });
}

export function createMarketRepo(db: AppDatabase): MarketRepo {
  // Prepared on first use: `market_claims` arrived with 0125 and `city_id` with 0132, and the
  // repositories are also built over older schemas by the migration tests.
  const lazy = (sql: string): (() => Statement) => {
    let held: Statement | null = null;
    return () => (held ??= db.prepare(sql));
  };
  const insertStmt = lazy(
    `INSERT INTO market_offers
       (id, seller_base_id, seller_name, give_json, want_json, status, created_at,
        counter_to, directed_at, city_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM market_offers WHERE id = ?');
  const byStatusStmt = db.prepare(
    'SELECT * FROM market_offers WHERE status = ? ORDER BY created_at DESC',
  );
  const openInCityStmt = lazy(
    "SELECT * FROM market_offers WHERE city_id = ? AND status = 'open' ORDER BY created_at DESC",
  );
  const openBySellerStmt = db.prepare(
    "SELECT * FROM market_offers WHERE seller_base_id = ? AND status = 'open' ORDER BY created_at DESC",
  );
  const setStatusStmt = db.prepare('UPDATE market_offers SET status = ? WHERE id = ?');
  const openPostedByStmt = db.prepare(
    "SELECT id FROM market_offers WHERE status = 'open' AND created_at <= ? ORDER BY created_at DESC",
  );
  const countersStmt = db.prepare(
    "SELECT * FROM market_offers WHERE counter_to = ? AND status = 'open'",
  );
  const insertClaimStmt = lazy(
    `INSERT INTO market_claims
       (id, base_id, offer_id, reason, resources_json, items_json, taken_by, created_at, claim_until)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const claimByIdStmt = lazy('SELECT * FROM market_claims WHERE id = ?');
  const claimsForStmt = lazy(
    'SELECT * FROM market_claims WHERE base_id = ? ORDER BY claim_until ASC, id ASC',
  );
  const lapsedClaimsStmt = lazy(
    'SELECT id FROM market_claims WHERE claim_until <= ? ORDER BY claim_until ASC, id ASC',
  );
  const deleteClaimStmt = lazy('DELETE FROM market_claims WHERE id = ?');
  const dropClaimsStmt = lazy('DELETE FROM market_claims WHERE base_id = ?');
  const withOffer = (row: ClaimRow): StoredClaim[] => {
    const offer = byIdStmt.get(row.offer_id) as OfferRow | undefined;
    return offer ? [rowToClaim(row, rowToOffer(offer))] : [];
  };
  const supplyUsedStmt = db.prepare(
    'SELECT units FROM market_supply_runs WHERE base_id = ? AND day = ?',
  );
  const vendorSoldStmt = db.prepare('SELECT sold FROM vendor_sales WHERE day = ? AND line_id = ?');
  const recordVendorSaleStmt = db.prepare(
    `INSERT INTO vendor_sales (day, line_id, sold, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (day, line_id) DO UPDATE SET
       sold = sold + excluded.sold,
       updated_at = excluded.updated_at`,
  );
  const recordSupplyStmt = db.prepare(
    `INSERT INTO market_supply_runs (base_id, day, units, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (base_id, day) DO UPDATE SET
       units = units + excluded.units,
       updated_at = excluded.updated_at`,
  );

  return {
    insert(offer) {
      insertStmt().run(
        offer.id,
        offer.sellerBaseId,
        offer.sellerName,
        JSON.stringify(offer.give),
        JSON.stringify(offer.want),
        offer.status,
        offer.createdAt,
        offer.counterTo,
        offer.directedAt,
        offer.cityId,
      );
    },
    findById(id) {
      const row = byIdStmt.get(id) as OfferRow | undefined;
      return row ? rowToOffer(row) : undefined;
    },
    listByStatus(status) {
      return readableOffers(byStatusStmt.all(status) as OfferRow[]);
    },
    openInCity(cityId) {
      return readableOffers(openInCityStmt().all(cityId) as OfferRow[]);
    },
    openBySeller(baseId) {
      return readableOffers(openBySellerStmt.all(baseId) as OfferRow[]);
    },
    setStatus(id, status) {
      setStatusStmt.run(status, id);
    },
    countersTo(offerId) {
      return readableOffers(countersStmt.all(offerId) as OfferRow[]);
    },
    insertClaim(claim) {
      insertClaimStmt().run(
        claim.id,
        claim.baseId,
        claim.offer.id,
        claim.reason,
        JSON.stringify(claim.goods.resources),
        JSON.stringify(claim.goods.items),
        claim.takenBy,
        claim.createdAt,
        claim.claimUntil,
      );
    },
    findClaim(id) {
      const row = claimByIdStmt().get(id) as ClaimRow | undefined;
      return row ? withOffer(row)[0] : undefined;
    },
    claimsFor(baseId) {
      // Skipped rather than thrown for the reason `readableOffers` gives: one bad claim must not
      // close the market screen. The world clock reports it when it comes to pay it out.
      return (claimsForStmt().all(baseId) as ClaimRow[]).flatMap((row) => {
        try {
          return withOffer(row);
        } catch {
          return [];
        }
      });
    },
    lapsedClaimIds(now) {
      return (lapsedClaimsStmt().all(now.toISOString()) as { id: string }[]).map((row) => row.id);
    },
    openIdsPostedBy(cutoff) {
      return (openPostedByStmt.all(cutoff.toISOString()) as { id: string }[]).map((row) => row.id);
    },
    deleteClaim(id) {
      deleteClaimStmt().run(id);
    },
    dropClaimsFor(baseId) {
      dropClaimsStmt().run(baseId);
    },
    supplyUsed(baseId, day) {
      const row = supplyUsedStmt.get(baseId, day) as { units: number } | undefined;
      return row?.units ?? 0;
    },
    recordSupply(baseId, day, units, at) {
      recordSupplyStmt.run(baseId, day, units, at);
    },
    vendorSold(day, lineId) {
      const row = vendorSoldStmt.get(day, lineId) as { sold: number } | undefined;
      return row?.sold ?? 0;
    },
    recordVendorSale(day, lineId, count, at) {
      recordVendorSaleStmt.run(day, lineId, count, at);
    },
  };
}
