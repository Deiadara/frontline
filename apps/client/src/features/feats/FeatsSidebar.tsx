import { cn } from '../../lib/cn';
import { ladderState, ladderTitle, type FeatBlock } from './featsList';

/**
 * The list of ladders, down the left of the board (maintainer, 2026-09-17).
 *
 * The board used to be every ladder drawn at once, two columns of cards, seventy of them. That was
 * workable at three rungs a chain and stopped being workable the moment the catalogue grew ladders
 * of ten: four hundred rungs is a page nobody reaches the bottom of, and the fold that hid most of
 * them was a way of making a too-long page shorter rather than a way of finding anything.
 *
 * So the ladders are an index and one of them is open. This is the index: a title, how far up it
 * the crew is, and nothing else, because the whole point is that a player can run their eye down
 * seventy of them.
 *
 * ## The brass ones are the ones to press
 *
 * A row with a rung waiting is drawn in brass and carries the count, which is the interface's
 * colour for "this is a decision" everywhere else. Everything else on this list is information; a
 * ladder with something to collect is the one row that is asking. A collected ladder is struck in
 * verdigris, the same spent-ink green the `Collected` stamp uses, so finished work reads as
 * finished at a glance rather than as another row of numbers to compare.
 *
 * The scroller is the game's own: `index.css` draws every scrollbar in the app in brass on ink, so
 * this needs no styling of its own beyond being a thing that scrolls.
 */

/** What a row is painted in, by where its ladder stands. See the note above. */
const ROW_TONE = {
  unclaimed: 'border-brass-300/60 bg-brass-500/15 text-brass-100 hover:bg-brass-500/25',
  claimed:
    'border-verdigris-300/40 bg-verdigris-500/8 text-verdigris-100/90 hover:bg-verdigris-500/15',
  shut: 'border-surface-600/60 bg-surface-900/40 text-ink-200 hover:bg-surface-800/60',
} as const;

const SELECTED_TONE = {
  unclaimed: 'border-brass-300 bg-brass-500/30 text-brass-100',
  claimed: 'border-verdigris-300/70 bg-verdigris-500/20 text-verdigris-100',
  shut: 'border-brass-500/70 bg-surface-800/80 text-ink-100',
} as const;

export function FeatsSidebar({
  blocks,
  selected,
  onSelect,
}: {
  blocks: readonly FeatBlock[];
  /** The open ladder's key, or null when the filter left nothing to open. */
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <nav
      className="ink-frame card-paper washed grain flex min-h-0 flex-col rounded-sm shadow-panel"
      aria-label="Ladders"
      data-testid="feats-sidebar"
    >
      {/* The list scrolls, the frame does not: a card-paper frame with a scrollbar drawn over its
          own edge reads as a tear rather than as a scroller, so the padding holds the bar inside. */}
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
        {blocks.map((block) => {
          const state = ladderState(block);
          const open = block.key === selected;
          const title = ladderTitle(block.rungs[0]!.spec);
          return (
            <li key={block.key}>
              <button
                type="button"
                onClick={() => onSelect(block.key)}
                aria-current={open ? 'true' : undefined}
                data-testid={`feats-tab-${block.key}`}
                data-state={state}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm border px-2.5 py-1.5 text-left transition-colors',
                  open ? SELECTED_TONE[state] : ROW_TONE[state],
                )}
              >
                <span className="min-w-0 flex-1 truncate font-stamp text-[14px] leading-tight">
                  {title}
                </span>
                {/* The one number on the row that is asking for something, and it is only drawn
                    when there is something to ask. */}
                {block.ready > 0 && (
                  <span
                    className="shrink-0 rounded-sm bg-brass-300/30 px-1 py-px font-display text-[10px] font-bold tabular-nums text-brass-100"
                    data-testid={`feats-tab-ready-${block.key}`}
                  >
                    {block.ready}
                  </span>
                )}
                <span
                  className="shrink-0 font-display text-[10px] font-bold tabular-nums opacity-70"
                  data-testid={`feats-tab-done-${block.key}`}
                >
                  {block.claimed}/{block.steps}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
