import { cn } from '../../lib/cn';
import { DrawnFace } from '../../components/ui/DrawnMarks';
import type { FeatFilter } from './featsList';

/**
 * The board's one filter row: which ladders to list (maintainer, 2026-09-17).
 *
 * ## What went, and why
 *
 * There were two rows here. The first was the **era**, Early / Mid / Late, and it is gone with the
 * rest of that mechanic: an era was a rough weight class the catalogue used for pricing, a player
 * could not aim at it, and on a board of ladders it split every chain across three chips because a
 * ladder's whole shape is that it starts early and finishes late. The second was how much of a
 * chain to draw, which the sidebar answers better by drawing one ladder at a time.
 *
 * What is left is the question a player actually arrives with: where do I stand on this thing.
 * Four settings over whole ladders, and the one that matters is `Unclaimed`, which is the only
 * state asking for a press.
 *
 * ## Drawn, rather than the painted picker
 *
 * The standings screen picks its sort from a `Dropdown`, and that is right there: eight sorts, one
 * of which is wanted, and a menu costs one press to open. This is different. Four settings is four
 * controls, they are the only navigation four hundred feats have besides the list itself, and a
 * player narrowing a long list wants to *see* what the other settings are and what each would
 * leave, which is exactly what a menu hides.
 *
 * They wear the same hand-inked box the Collect-all button does ({@link DrawnFace}), at the same
 * height and type size (maintainer, 2026-09-17). They sit on a sheet of paper in a row with that
 * button, and a struck-metal tab beside a drawn one reads as a control bar bolted onto a document.
 * The gap between them is twice what a tab row uses, because four drawn boxes at a tab's spacing
 * read as one long box with lines in it.
 *
 * Each chip carries the number of ladders it would leave, which is the figure a player is choosing
 * on: `Unclaimed 3` answers "is there anything waiting for me" before the press rather than after.
 */

const LABELS: Readonly<Record<FeatFilter, string>> = {
  all: 'All',
  claimed: 'Claimed',
  unclaimed: 'Unclaimed',
  shut: 'Shut',
};

/** What each setting shows, on hover. Said in ladders, because that is what it counts. */
const TIPS: Readonly<Record<FeatFilter, string>> = {
  all: 'Every ladder on the board',
  claimed: 'Ladders finished to the top and collected',
  unclaimed: 'Ladders with a rung waiting to be collected',
  shut: 'Ladders still in hand, with nothing to collect yet',
};

export const FEAT_FILTERS: readonly FeatFilter[] = ['all', 'claimed', 'unclaimed', 'shut'];

export function FeatFilters({
  filter,
  onChange,
  countFor,
}: {
  filter: FeatFilter;
  onChange: (next: FeatFilter) => void;
  /** How many ladders a setting would leave. */
  countFor: (probe: FeatFilter) => number;
}) {
  return (
    <div
      className="flex min-w-0 flex-wrap items-center justify-center gap-4"
      role="group"
      aria-label="Show"
      data-testid="feats-filters"
    >
      {FEAT_FILTERS.map((setting) => {
        const active = filter === setting;
        return (
          <button
            key={setting}
            type="button"
            onClick={() => onChange(setting)}
            aria-pressed={active}
            data-tip={TIPS[setting]}
            data-testid={`feats-show-${setting}`}
            className={cn(
              'group/filter relative inline-flex shrink-0 items-center justify-center gap-1.5',
              // The same box as the Collect-all button beside it, to the pixel: one type size, one
              // padding, so a row of five controls has one height rather than two.
              'px-3.5 py-[8.7px] font-stamp text-[15px] leading-none tracking-[0.08em]',
              'transition-all duration-150 ease-out hover:-translate-y-px active:translate-y-px',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brass-300',
              active ? 'text-brass-100' : 'text-ink-300 hover:text-brass-100',
            )}
          >
            <DrawnFace
              face={cn(
                'transition-all duration-150',
                active
                  ? 'fill-brass-500/30 group-hover/filter:fill-brass-500/40'
                  : 'fill-surface-900/50 group-hover/filter:fill-brass-500/15',
              )}
            />
            <span className="relative">{LABELS[setting]}</span>
            <span
              className={cn(
                'relative rounded-sm px-1 py-px font-display text-[10px] font-bold tabular-nums',
                active ? 'bg-brass-300/25 text-brass-100' : 'bg-surface-950/60 text-ink-400',
              )}
            >
              {countFor(setting)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
