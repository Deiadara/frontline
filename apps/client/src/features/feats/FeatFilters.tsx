import { FEAT_ERA_BLURBS, FEAT_ERA_LABELS, FEAT_ERAS } from '@frontline/shared';
import { tabSkin } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import type { DoneFilter, EraFilter, FeatFilter } from './featsList';

/**
 * The two filters the maintainer asked for: which part of the game, and whether it is done.
 *
 * ## Chips rather than the painted picker
 *
 * The standings screen picks its sort from a `Dropdown` and that is right there: eight sorts, one
 * of which is wanted, and a menu costs one press to open. These are different. Four eras and three
 * states is seven controls in all, both filters are the only navigation two hundred feats
 * have, and a player narrowing a long list wants to *see* what the other settings are and what
 * each would leave, which is exactly what a menu hides. So both rows are chips wearing `tabSkin`,
 * the skin the battle board, the roster and the market already pick with.
 *
 * Each chip carries the figure it would leave, counted against the *other* filter as it currently
 * stands. That is the number a player is actually choosing on: "Late" saying 50 when nothing else
 * is set and 3 when Completed is on is the screen answering "is there anything for me over there"
 * before the press rather than after it.
 */

const SHOW_LABELS: Readonly<Record<DoneFilter, string>> = {
  all: 'Everything',
  done: 'Completed',
  todo: 'Not completed',
};

/** Why each setting shows what it shows, on hover. `done` is the one that needs saying. */
const SHOW_TIPS: Readonly<Record<DoneFilter, string>> = {
  all: 'Every feat, finished or not',
  done: 'Finished, whether or not you have collected it',
  todo: 'Still to do, and the ones still shut',
};

function Chip({
  label,
  count,
  tip,
  active,
  onPress,
  testId,
}: {
  label: string;
  count: number;
  tip: string;
  active: boolean;
  onPress: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      data-tip={tip}
      data-testid={testId}
      className={tabSkin({ active, className: 'gap-1.5 px-2.5 py-1.5' })}
    >
      {label}
      <span
        className={cn(
          'rounded-sm px-1 py-px font-display text-[10px] font-bold tabular-nums',
          active ? 'bg-brass-300/25 text-brass-100' : 'bg-surface-900/70 text-ink-400',
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function FeatFilters({
  filter,
  onChange,
  countFor,
}: {
  filter: FeatFilter;
  onChange: (next: FeatFilter) => void;
  /** How many rungs a setting would leave, counted against whatever the other filter is on. */
  countFor: (probe: FeatFilter) => number;
}) {
  const eras: readonly EraFilter[] = ['all', ...FEAT_ERAS];

  return (
    // The same sheet the ledger beside it is drawn on (`ink-frame card-paper washed grain`), and
    // not the painted metal the rest of the chrome uses: the two share a row, and a panel in a
    // different material beside a framed one reads as a control bar bolted onto a document.
    <div
      className="ink-frame card-paper washed grain flex flex-col justify-center gap-2.5 rounded-sm px-3 py-2.5 shadow-panel"
      data-testid="feats-filters"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Era">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-ink-400">
          Era
        </span>
        {eras.map((era) => (
          <Chip
            key={era}
            label={era === 'all' ? 'All' : FEAT_ERA_LABELS[era]}
            count={countFor({ ...filter, era })}
            tip={era === 'all' ? 'Every part of the game' : FEAT_ERA_BLURBS[era]}
            active={filter.era === era}
            onPress={() => onChange({ ...filter, era })}
            testId={`feats-era-${era}`}
          />
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Show">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-ink-400">
          Show
        </span>
        {(['all', 'done', 'todo'] as const).map((done) => (
          <Chip
            key={done}
            label={SHOW_LABELS[done]}
            count={countFor({ ...filter, done })}
            tip={SHOW_TIPS[done]}
            active={filter.done === done}
            onPress={() => onChange({ ...filter, done })}
            testId={`feats-show-${done}`}
          />
        ))}
      </div>

      <span aria-hidden className="ink-rule block w-full" />
      {/* What the current pair of settings actually means, spelled out. The hover tips say the
          same thing one control at a time; this is the sentence for the state the board is in,
          and it is the copy the era blurbs in `@frontline/shared` were written for. */}
      <p
        className="font-body text-[12.5px] leading-snug text-ink-300"
        data-testid="feats-filter-note"
      >
        {filter.era === 'all' ? 'Every part of the game.' : FEAT_ERA_BLURBS[filter.era]}{' '}
        {SHOW_TIPS[filter.done]}.
      </p>
    </div>
  );
}
