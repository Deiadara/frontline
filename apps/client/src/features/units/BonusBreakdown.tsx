import type { BonusLine } from '@frontline/shared';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { cn } from '../../lib/cn';

/**
 * Where a figure on the roster's head came from, as a page somebody wrote out (maintainer,
 * 2026-09-17).
 *
 * "In units where it says -24% cost, -70% training time etc, when you hover over these make a hand
 * drawn page come up that breaks down where they are from (e.g. 20% from X officer, 10% from
 * gauntlet)."
 *
 * The chips were three numbers with nothing behind them, and a number a player cannot account for
 * is one they cannot plan against: a crew wondering how to train faster has a completely different
 * next move depending on whether the seventy points are mostly the Gauntlet (build it up) or mostly
 * one drillmaster (do not lose them).
 *
 * ## Why it is a sheet rather than a tooltip
 *
 * The same reason the rest of these screens are paper now. This is a working note, not chrome: a
 * ruled list with a hand-inked box round it, the figures in the same pen as the feats board, and a
 * rule above the total because that is what a person totalling a column draws.
 *
 * The lines come from the server (`units/breakdown.ts`), summed there and pinned to the figure they
 * explain by a test, so this component adds nothing up and cannot disagree with the chip it hangs
 * off: it prints what it was handed and totals it for the reader's benefit.
 */
export function BonusBreakdown({
  title,
  lines,
  total,
  /** What one point of this is worth in words: "off the bill", "off the clock". */
  meaning,
}: {
  title: string;
  lines: readonly BonusLine[];
  total: number;
  meaning: string;
}) {
  return (
    <div
      className="ink-frame card-paper washed grain relative flex w-[23rem] max-w-full flex-col gap-2 rounded-sm p-3.5"
      data-testid="bonus-breakdown"
    >
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-stamp text-[17px] leading-tight text-ink-100">{title}</span>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {meaning}
        </span>
      </header>

      {lines.length === 0 ? (
        /* Not an empty box. A crew with nothing on a channel is a crew that has not built the thing
           yet, and saying so is the whole use of opening this. */
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          Nothing is paying into this yet. Officers, the blocks you hold, the Lab and the structures
          that drill and feed your people all push it.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lines.map((line, index) => (
            <li
              // The list is a fixed ordering off one payload, and two officers can genuinely share
              // a name: the position is the only honest key here.
              key={`${line.source}-${index}`}
              className="flex items-baseline gap-2"
            >
              <span className="min-w-0 flex-1">
                <span className="font-stamp text-[14px] leading-tight text-ink-100">
                  {line.source}
                </span>
                {line.note !== undefined && (
                  <span className="ml-1.5 font-body text-[11px] text-ink-300">{line.note}</span>
                )}
              </span>
              <span
                className={cn(
                  'shrink-0 font-display text-[13px] font-bold tabular-nums',
                  // A minus on this page is something being taken back off the player: a raid, or a
                  // district refusing to carry any more. It should not read like the savings above.
                  line.percent < 0 ? 'text-oxblood-300' : 'text-verdigris-300',
                )}
              >
                {line.percent < 0 ? '' : '+'}
                {round(line.percent)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The rule above a total, drawn rather than ruled. */}
      <span aria-hidden className="block h-2 text-ink-300/70">
        <DrawnRule />
      </span>

      <p className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-ink-300">
          All together
        </span>
        <span
          className="font-display text-[18px] font-bold tabular-nums text-brass-100"
          data-testid="bonus-breakdown-total"
        >
          {round(total)}%
        </span>
      </p>
    </div>
  );
}

/**
 * One decimal, and only when there is one to show.
 *
 * A raid's cut is a quarter of a sum that was never a round number, so the lines can carry long
 * tails. `24.5` is worth reading and `24.499999999999996` is the floating point showing through.
 */
function round(percent: number): string {
  const one = Math.round(percent * 10) / 10;
  return Number.isInteger(one) ? String(one) : one.toFixed(1);
}
