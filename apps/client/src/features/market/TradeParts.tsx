import {
  ITEM_CATALOG,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
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

/**
 * How big a pile is drawn.
 *
 * `md` is the chip beside a quote or a form, where the pile is one line of a panel that is about
 * something else. `lg` is for the board, where the two piles *are* the screen: a card whose whole
 * subject is what for what has to be legible from across a desk, and a 24px icon with a 13px
 * figure beside it is not.
 */
export type ChipSize = 'md' | 'lg';

const CHIP_SIZE: Record<ChipSize, { frame: string; well: string; figure: string; art: string }> = {
  md: { frame: 'gap-1.5 py-1 pl-1 pr-2', well: 'h-7 w-7', figure: 'text-[13px]', art: 'h-6 w-6' },
  lg: {
    frame: 'gap-2 py-1.5 pl-1.5 pr-2.5',
    well: 'h-10 w-10',
    figure: 'text-[16px]',
    art: 'h-8 w-8',
  },
};

/** One quantity of one thing: the art in a lit well, the figure beside it. */
export function GoodChip({
  amount,
  children,
  tone = 'plain',
  size = 'md',
  className,
}: {
  amount: number;
  /** The art. A `ResourceIcon` or an `ItemGlyph`, already sized. */
  children: ReactNode;
  /** `give` reads as leaving, `take` as arriving. `plain` is neither, for a total. */
  tone?: 'plain' | 'give' | 'take';
  size?: ChipSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'edge-lit inline-flex shrink-0 items-center rounded-md border bg-surface-950/50',
        CHIP_SIZE[size].frame,
        tone === 'give' && 'border-oxblood-500/40',
        tone === 'take' && 'border-verdigris-300/40',
        tone === 'plain' && 'border-surface-600/70',
        className,
      )}
    >
      <span
        className={cn(
          'resource-well flex items-center justify-center rounded-md',
          CHIP_SIZE[size].well,
        )}
      >
        {children}
      </span>
      <span
        className={cn(
          'font-display font-bold leading-none tabular-nums text-ink-100',
          CHIP_SIZE[size].figure,
        )}
      >
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
  size = 'md',
  empty = 'nothing',
}: {
  bundle: TradeBundle;
  tone?: 'plain' | 'give' | 'take';
  size?: ChipSize;
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
          <GoodChip amount={bundle.resources[key] ?? 0} tone={tone} size={size}>
            <ResourceIcon kind={key} className={CHIP_SIZE[size].art} />
          </GoodChip>
        </span>
      ))}
      {items.map(([id, count]) => (
        <span key={id} data-tip={ITEM_CATALOG[id as ItemId].name}>
          <GoodChip amount={count ?? 0} tone={tone} size={size}>
            <ItemGlyph id={id as ItemId} className={CHIP_SIZE[size].art} />
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
