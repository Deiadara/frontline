import {
  ITEM_CATALOG,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  bundleValue,
  type ItemId,
  type TradeBundle,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { ResourceIcon } from '../../components/Resources';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { ItemGlyph } from '../inventory/ItemGlyph';

/**
 * The market's shared vocabulary: what a pile of goods looks like when it is drawn rather than
 * written out.
 *
 * The whole screen used to be sentences. `Gives 200 scrap for 100 oil · worth 400 against 300` is
 * a line a player has to *parse*, in a place where every question is "what for what, and is that
 * fair". Drawn as two rows of chips with an arrow between them, the same question is answered
 * before the eye has finished moving. That is the difference between a ledger and a market.
 */

/** One quantity of one thing: the art in a lit well, the figure beside it. */
export function GoodChip({
  amount,
  children,
  tone = 'plain',
  className,
}: {
  amount: number;
  /** The art. A `ResourceIcon` or an `ItemGlyph`, already sized. */
  children: ReactNode;
  /** `give` reads as leaving, `take` as arriving. `plain` is neither, for a total. */
  tone?: 'plain' | 'give' | 'take';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'edge-lit inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-surface-950/50 py-1 pl-1 pr-2',
        tone === 'give' && 'border-oxblood-500/40',
        tone === 'take' && 'border-verdigris-300/40',
        tone === 'plain' && 'border-surface-600/70',
        className,
      )}
    >
      <span className="resource-well flex h-7 w-7 items-center justify-center rounded-md">
        {children}
      </span>
      <span className="font-display text-[13px] font-bold leading-none tabular-nums text-ink-100">
        {amount.toLocaleString()}
      </span>
    </span>
  );
}

/**
 * A whole side of a trade, as chips.
 *
 * Resources in the stockpile's own order rather than in whatever order the object happened to be
 * built in: the bar at the top of the screen puts caps first and planks last, and a bundle that
 * shuffled them would make two identical offers look like different offers.
 */
export function BundleChips({
  bundle,
  tone = 'plain',
  empty = 'nothing',
}: {
  bundle: TradeBundle;
  tone?: 'plain' | 'give' | 'take';
  empty?: string;
}) {
  const resources = RESOURCE_ORDER.filter((key) => (bundle.resources[key] ?? 0) > 0);
  const items = Object.entries(bundle.items).filter(([, count]) => (count ?? 0) > 0);

  if (resources.length === 0 && items.length === 0) {
    return (
      <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
        {empty}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {resources.map((key) => (
        <span key={key} data-tip={RESOURCE_LABELS[key]}>
          <GoodChip amount={bundle.resources[key] ?? 0} tone={tone}>
            <ResourceIcon kind={key} className="h-6 w-6" />
          </GoodChip>
        </span>
      ))}
      {items.map(([id, count]) => (
        <span key={id} data-tip={ITEM_CATALOG[id as ItemId].name}>
          <GoodChip amount={count ?? 0} tone={tone}>
            <ItemGlyph id={id as ItemId} className="h-6 w-6" />
          </GoodChip>
        </span>
      ))}
    </span>
  );
}

/** The mark between the two halves of any trade on this screen. */
export function TradeArrow({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brass-500/40 bg-surface-950/70 text-brass-300',
        className,
      )}
    >
      <Icon name="chevron-down" className="h-4 w-4 -rotate-90" />
    </span>
  );
}

/**
 * How a deal reads, priced against the vendor's own table.
 *
 * The board used to print `worth 400 against 300` and leave the arithmetic to the player. The
 * numbers are still there on the hover, because somebody haggling wants them; what is on the card
 * is the verdict, which is the thing a glance is actually asking for.
 */
export const FAIR_BAND = 0.1;

/**
 * The verdict, always from the player's side of the table.
 *
 * `received` and `paid`, not `give` and `want`: on the board an offer's `give` is what arrives, and
 * in the composer the field called `give` is what *leaves*. Naming these after the two sides of the
 * transaction rather than after whichever object is to hand is what stops the badge telling a
 * player their own lopsided proposal is in their favour, which is what it did.
 */
export function valueVerdict(
  received: number,
  paid: number,
): {
  label: string;
  tone: string;
} {
  if (paid <= 0) return { label: 'a gift', tone: 'border-verdigris-300/60 text-verdigris-100' };
  const ratio = received / paid;
  if (ratio >= 1 + FAIR_BAND) {
    return { label: 'in your favour', tone: 'border-verdigris-300/60 text-verdigris-100' };
  }
  if (ratio <= 1 - FAIR_BAND) {
    return { label: 'steep', tone: 'border-oxblood-500/60 text-oxblood-300' };
  }
  return { label: 'about fair', tone: 'border-surface-600 text-ink-200' };
}

/** The verdict as a badge, with the two figures behind it for anybody who wants them. */
export function ValueBadge({ received, paid }: { received: TradeBundle; paid: TradeBundle }) {
  const gained = bundleValue(received);
  const given = bundleValue(paid);
  const verdict = valueVerdict(gained, given);
  return (
    <span
      data-tip={`Worth ${gained.toLocaleString()} against ${given.toLocaleString()}`}
      className="shrink-0"
    >
      <span
        className={cn(
          'inline-flex items-center rounded-sm border px-2 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em]',
          verdict.tone,
        )}
      >
        {verdict.label}
      </span>
    </span>
  );
}
