import { MarketOfferSchema, type MarketOffer, type OfferStatus } from '@frontline/shared';
import { readJson } from '../json.js';
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
}

export interface MarketRepo {
  insert(offer: MarketOffer): void;
  findById(id: string): MarketOffer | undefined;
  /** Every listing with this status, newest first. */
  listByStatus(status: OfferStatus): MarketOffer[];
  /** What one crew has standing, counters included. */
  openBySeller(baseId: string): MarketOffer[];
  setStatus(id: string, status: OfferStatus): void;
  /** Counters aimed at a listing, so withdrawing the parent can release theirs too. */
  countersTo(offerId: string): MarketOffer[];
  /** Units of material this crew has bought with caps today. The whole of the ration's state. */
  supplyUsed(baseId: string, day: string): number;
  /** Adds to it. Upserts, because the first purchase of a day has no row to increment. */
  recordSupply(baseId: string, day: string, units: number, at: string): void;
}

function rowToOffer(row: OfferRow): MarketOffer {
  return MarketOfferSchema.parse({
    id: row.id,
    sellerBaseId: row.seller_base_id,
    sellerName: row.seller_name,
    give: readJson(row.give_json),
    want: readJson(row.want_json),
    status: row.status,
    createdAt: row.created_at,
    counterTo: row.counter_to,
    directedAt: row.directed_at,
  });
}

export function createMarketRepo(db: AppDatabase): MarketRepo {
  const insertStmt = db.prepare(
    `INSERT INTO market_offers
       (id, seller_base_id, seller_name, give_json, want_json, status, created_at,
        counter_to, directed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const byIdStmt = db.prepare('SELECT * FROM market_offers WHERE id = ?');
  const byStatusStmt = db.prepare(
    'SELECT * FROM market_offers WHERE status = ? ORDER BY created_at DESC',
  );
  const openBySellerStmt = db.prepare(
    "SELECT * FROM market_offers WHERE seller_base_id = ? AND status = 'open'",
  );
  const setStatusStmt = db.prepare('UPDATE market_offers SET status = ? WHERE id = ?');
  const countersStmt = db.prepare(
    "SELECT * FROM market_offers WHERE counter_to = ? AND status = 'open'",
  );
  const supplyUsedStmt = db.prepare(
    'SELECT units FROM market_supply_runs WHERE base_id = ? AND day = ?',
  );
  const recordSupplyStmt = db.prepare(
    `INSERT INTO market_supply_runs (base_id, day, units, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (base_id, day) DO UPDATE SET
       units = units + excluded.units,
       updated_at = excluded.updated_at`,
  );

  return {
    insert(offer) {
      insertStmt.run(
        offer.id,
        offer.sellerBaseId,
        offer.sellerName,
        JSON.stringify(offer.give),
        JSON.stringify(offer.want),
        offer.status,
        offer.createdAt,
        offer.counterTo,
        offer.directedAt,
      );
    },
    findById(id) {
      const row = byIdStmt.get(id) as OfferRow | undefined;
      return row ? rowToOffer(row) : undefined;
    },
    listByStatus(status) {
      return (byStatusStmt.all(status) as OfferRow[]).map(rowToOffer);
    },
    openBySeller(baseId) {
      return (openBySellerStmt.all(baseId) as OfferRow[]).map(rowToOffer);
    },
    setStatus(id, status) {
      setStatusStmt.run(status, id);
    },
    countersTo(offerId) {
      return (countersStmt.all(offerId) as OfferRow[]).map(rowToOffer);
    },
    supplyUsed(baseId, day) {
      const row = supplyUsedStmt.get(baseId, day) as { units: number } | undefined;
      return row?.units ?? 0;
    },
    recordSupply(baseId, day, units, at) {
      recordSupplyStmt.run(baseId, day, units, at);
    },
  };
}
