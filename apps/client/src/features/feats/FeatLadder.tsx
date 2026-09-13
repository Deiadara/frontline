import { FEAT_ERA_LABELS, FEAT_MEASURE_SPECS } from '@frontline/shared';
import { ProgressBar, type ProgressTone } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { ClaimButton } from './ClaimButton';
import { RewardTally } from './RewardTally';
import { RungMark, SPINE } from './marks';
import { ladderTitle, type FeatBlock, type FeatRung } from './featsList';

/**
 * One ladder, drawn as a ladder.
 *
 * The maintainer asked for feats, and a catalogue of a hundred and sixty of them laid out as a hundred
 * and sixty rows is a spreadsheet: the fourth step of a chain reads as an unrelated fourth entry
 * that happens to ask for a bigger number. Grouping the steps under one upright, numbering them,
 * and running the pen line between the marks is what turns "field 100 bodies / field 500 bodies /
 * field 2,000 bodies" back into the one idea it is.
 *
 * A feat with no chain is drawn by the same component with a single rung and no upright. One kind
 * of card, not two: the page has sixty-two of these on it and a second silhouette in the mix would
 * read as damage rather than as a distinction.
 */

/** What state a rung's progress stroke is painted in. `ProgressBar` owns the four pigments. */
const BAR_TONE: Readonly<Record<'open' | 'ready' | 'claimed', ProgressTone>> = {
  open: 'iris',
  ready: 'brass',
  claimed: 'verdigris',
};

function Rung({
  rung,
  first,
  claiming,
  onClaim,
}: {
  rung: FeatRung;
  /** The top rung of the card as it is currently drawn, which under a filter may not be step one. */
  first: boolean;
  /** This rung's claim is in flight. */
  claiming: boolean;
  onClaim: (featId: string) => void;
}) {
  const { spec, progress, step } = rung;
  const state = progress.state;
  const unit = FEAT_MEASURE_SPECS[spec.measure].unit;

  return (
    <li
      className={cn(
        'relative flex items-start gap-3 px-3 py-3',
        state === 'ready' && 'bg-brass-500/10',
        state === 'locked' && 'opacity-70',
      )}
      data-testid={`feat-${spec.id}`}
      data-state={state}
    >
      {/* The drawn rule between rungs, never under the last one: a line along the foot of the card
          would be a second edge inside its own frame. */}
      {!first && <span aria-hidden className="ink-rule absolute inset-x-3 top-0" />}
      <RungMark step={step} state={state} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h4
            className={cn(
              'min-w-0 font-stamp text-[15px] leading-tight',
              state === 'locked' ? 'text-ink-400' : 'text-ink-100',
            )}
          >
            {spec.name}
          </h4>
          <span className="shrink-0 rounded-sm border border-surface-600/80 px-1.5 py-px font-display text-[9px] font-bold uppercase tracking-[0.16em] text-ink-300">
            {FEAT_ERA_LABELS[spec.era]}
          </span>
        </div>

        {state === 'locked' ? (
          /*
           * A shut door, and nothing else on it.
           *
           * No bar, no figure, no reward. The server deliberately reports zeros for a locked feat
           * so that the rung's real target cannot leak out of a row nobody is being shown, and
           * drawing a full-width empty track under it would put that leak back as a picture: a
           * crew already past the next tier would read an empty bar as the game having lost their
           * progress. What the rung says instead is the one true thing about it.
           */
          <p className="font-body text-[12.5px] italic leading-snug text-ink-400">
            Shut. Take the step above it first.
          </p>
        ) : (
          <>
            <p className="font-body text-[12.5px] leading-snug text-ink-300">{spec.blurb}</p>
            <div className="flex min-w-0 items-center gap-2">
              <ProgressBar
                progress={progress.progress}
                label={spec.name}
                tone={BAR_TONE[state]}
                className="min-w-0 flex-1"
                data-testid={`feat-bar-${spec.id}`}
              />
              <span
                className="shrink-0 font-display text-[11px] font-bold tabular-nums text-ink-200"
                data-testid={`feat-count-${spec.id}`}
              >
                {/*
                  Floored, not rounded. Half the lifetime counters bank fractions (production
                  settles in fractional carry, see `feats/tally.ts`), so a crew at 2,999,999.6 of
                  3,000,000 rounded up to a line reading `3,000,000 / 3,000,000` on a rung with no
                  CLAIM button beside it. A figure may read short of a feat that is finished for
                  one more tick; it may never read finished on one that is not.
                */}
                {Math.floor(progress.value).toLocaleString()} /{' '}
                {Math.round(progress.target).toLocaleString()}{' '}
                <span className="font-normal uppercase tracking-[0.12em] text-ink-400">{unit}</span>
              </span>
            </div>
            <RewardTally reward={spec.reward} data-testid={`feat-pays-${spec.id}`} />
          </>
        )}
      </div>

      <div className="flex w-[6.5rem] shrink-0 flex-col items-end justify-center self-center">
        {state === 'ready' && (
          <ClaimButton
            onClick={() => onClaim(spec.id)}
            pending={claiming}
            data-testid={`feat-claim-${spec.id}`}
          />
        )}
        {state === 'claimed' && (
          <span
            className="rubber-stamp font-stamp text-[11px] uppercase tracking-[0.14em]"
            data-testid={`feat-collected-${spec.id}`}
          >
            Collected
          </span>
        )}
      </div>
    </li>
  );
}

export function FeatLadder({
  block,
  claimingId,
  onClaim,
}: {
  block: FeatBlock;
  /** Which feat's claim is in flight, if any. One at a time: the page runs one mutation. */
  claimingId: string | null;
  onClaim: (featId: string) => void;
}) {
  const first = block.rungs[0];
  if (first === undefined) return null;
  // Built from the measure rather than invented per chain. See `ladderTitle`.
  const title = ladderTitle(first.spec);
  const ladder = block.steps > 1;

  return (
    <article
      className="ink-frame card-paper washed grain relative flex break-inside-avoid flex-col rounded-sm shadow-panel"
      data-testid={`feat-block-${block.key}`}
      data-steps={block.steps}
    >
      <header className="relative flex items-center justify-between gap-2 px-3 pb-2 pt-2.5">
        <h3
          className="min-w-0 truncate font-stamp text-[15px] leading-none text-brass-300"
          data-testid={`feat-block-title-${block.key}`}
        >
          {title}
        </h3>
        <span className="shrink-0 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">
          {ladder ? `${block.steps} steps` : 'On its own'}
        </span>
        <span aria-hidden className="ink-rule absolute inset-x-3 -bottom-[1px]" />
      </header>

      <ol className="relative flex flex-col">
        {/*
         * The upright, behind the marks.
         *
         * Only on a real ladder: a single rung with a line running through it is a ladder with one
         * step, which says the wrong thing about a feat that stands alone. Inset to the centre of
         * the 36px mark, and stopped short of both ends so the line dies inside the card rather
         * than running into its frame.
         */}
        {ladder && (
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-7 left-[27.5px] top-7 w-[5px]"
            style={SPINE}
            data-testid={`feat-spine-${block.key}`}
          />
        )}
        {block.rungs.map((rung, index) => (
          <Rung
            key={rung.spec.id}
            rung={rung}
            first={index === 0}
            claiming={claimingId === rung.spec.id}
            onClaim={onClaim}
          />
        ))}
      </ol>
    </article>
  );
}
