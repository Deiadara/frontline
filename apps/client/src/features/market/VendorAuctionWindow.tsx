import {
  GAME_TIMEZONE,
  ITEM_CATALOG,
  type ItemSpec,
  type VendorAuction,
  type VendorOffer,
} from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { useMe, usePlaceVendorBid } from '../../lib/queries';
import { RarityTag } from '../../lib/rarity';
import { ItemGlyph } from '../inventory/ItemGlyph';
import { LotBidPanel, LotClock, LotHistory, LotStanding } from './LotParts';

/**
 * The catalogue entry behind a Runner's line, or nothing for an id the catalogue lacks.
 *
 * `ITEM_CATALOG` is total over `ItemId` and the line's item is a plain string off the wire. The
 * lookups used to cast it, which turned an id the catalogue had never heard of (a build older
 * than the item, a fixture) into `undefined.kind` and took the whole barrow down with it.
 */
export function lotSpec(item: string): ItemSpec | undefined {
  return (ITEM_CATALOG as Partial<Record<string, ItemSpec>>)[item];
}

/**
 * Bidding on a lot at the barrow (market extension, maintainer 2026-09-08).
 *
 * The Bar's bidding screen with the sealed half hour taken out, because a visit is two hours and
 * a secret last number is a game for a day. One lot, drawn as a table: what it is down the left,
 * who is in front and for how much, how long until he packs up, every bid in the order it was
 * said, and one control. The window is opened from the lot's card, where the decision is made in
 * front of the figures; in here a player says a number.
 *
 * The clock, the standing, the table and the control are `LotParts`, which the fence's shelf uses
 * too. What is left in here is what belongs to the barrow: the dossier on the thing being sold, and
 * caps as the currency.
 */
export function VendorAuctionWindow({
  offer,
  now,
  caps,
  onClose,
}: {
  offer: VendorOffer & { auction: VendorAuction };
  now: Date;
  /** What the crew has in the tin. A bid it cannot cover is warned about here and refused there. */
  caps: number;
  onClose: () => void;
}) {
  const me = useMe();
  const zone = me.data?.user.timezone ?? GAME_TIMEZONE;
  const name = lotSpec(offer.line.item)?.name ?? offer.line.item;
  const { auction } = offer;

  return (
    <Modal
      onClose={onClose}
      labelledBy="lot-title"
      size="wide"
      data-testid="lot-window"
      className="border-hextech-100/30"
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-surface-600/60 px-5 py-3">
        <span
          aria-hidden
          className="holo-tag flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-hextech-100 [&_svg]:h-5 [&_svg]:w-5"
        >
          <Icon name="market" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[10px] font-bold uppercase tracking-[0.2em] text-ink-300">
            Lot on the barrow
          </span>
          <h2
            id="lot-title"
            className="neon min-w-0 break-words font-stamp text-[18px] leading-tight"
          >
            {name}
          </h2>
        </span>
        <LotClock closesAt={auction.closesAt} now={now} size="lg" testId="lot-clock" />
        <Button size="sm" variant="ghost" onClick={onClose}>
          Leave it
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(0,1fr)_19rem]">
        <LotDossier offer={offer} />
        <div className="flex min-w-0 flex-col gap-3">
          <LotStanding
            auction={auction}
            currency="caps"
            opens={`Opens at ${auction.reserve.toLocaleString()}. He will not take less.`}
          />
          <BarrowBidPanel auction={auction} name={name} caps={caps} now={now} />
          <LotHistory auction={auction} zone={zone} />
        </div>
      </div>
    </Modal>
  );
}

/** What the thing is, on the left: the art, the rarity, the line, and what the catalogue says it is worth. */
function LotDossier({ offer }: { offer: VendorOffer }) {
  const spec = lotSpec(offer.line.item);
  if (spec === undefined) {
    return (
      <p className="font-body text-[13px] italic text-ink-300">
        The catalogue has no entry for {offer.line.item}.
      </p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 gap-4">
        <span className="icon-tile edge-lit flex h-28 w-28 shrink-0 items-center justify-center rounded-md">
          <ItemGlyph id={spec.id} className="h-20 w-20" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <RarityTag rarity={spec.rarity} className="self-start" />
          <p className="font-body text-[14px] italic leading-relaxed text-ink-200">
            {spec.description}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
            <dt>Worth</dt>
            <dd className="tabular-nums text-ink-100">{spec.capsValue.toLocaleString()} caps</dd>
            <dt>Left to sell</dt>
            <dd className="tabular-nums text-ink-100">
              {offer.line.stock} {offer.line.stock === 1 ? 'visit' : 'visits'}
            </dd>
          </dl>
        </div>
      </div>
      <p className="font-body text-[12px] leading-relaxed text-ink-300">
        One goes to the highest bid when he packs up, at what they bid. Every crew's bid is in the
        open; raising yours replaces it, and nothing comes off the table until he leaves.
      </p>
    </div>
  );
}

/** The barrow's bid panel: the shared control, wired to caps and to `/market/bid`. */
function BarrowBidPanel({
  auction,
  name,
  caps,
  now,
}: {
  auction: VendorAuction;
  name: string;
  caps: number;
  now: Date;
}) {
  const bid = usePlaceVendorBid();
  return (
    <LotBidPanel
      auction={auction}
      name={name}
      purse={caps}
      currency="caps"
      now={now}
      pending={bid.isPending}
      error={bid.error}
      shortMessage={(purse) =>
        `You have ${purse.toLocaleString()} caps. He will want the whole figure when he packs up.`
      }
      onPlace={(amount) => bid.mutate({ lineId: auction.lineId, amount })}
    />
  );
}
