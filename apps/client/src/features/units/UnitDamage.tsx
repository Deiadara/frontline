import {
  DAMAGE_TYPES,
  DAMAGE_TYPE_LABELS,
  effectiveResistance,
  type DamageType,
  type UnitOption,
} from '@frontline/shared';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { HoverCard } from '../../components/ui/HoverCard';
import { cn } from '../../lib/cn';

/** One row of a unit's damage table: a type, and how many points it is worth against them. */
export interface ResistLine {
  type: DamageType;
  /**
   * Always positive, and always what a fight will actually use: see the clamp in
   * {@link splitResistances}. Which side of zero it came from is the list it ends up in.
   */
  points: number;
}

/** The two halves of `UnitStats.resistances`, which is one table with a sign in it. */
export type Side = 'weakness' | 'resistance';

/**
 * A unit's resistance table, split by sign.
 *
 * The sheet writes both halves into one record (`{ blade: 25, explosive: -20 }`), because both are
 * the same number to the engine: `damageTypeMultiplier` subtracts it either way. A player reading
 * a card is not doing that subtraction, and "25" and "-20" in one list is a table you have to
 * decode before you can use it. So the sign is read once, here, and the two lists are named for
 * what they mean.
 *
 * Walked in `DAMAGE_TYPES` order rather than in the record's, so two units list the same two types
 * in the same order and the eye can compare one card to the next. A zero is in neither list: it is
 * a type this unit has nothing to say about, and printing it as a resistance of nothing would be
 * the four dead rows the partial record exists to avoid.
 *
 * **Held inside the engine's own band on the way out.** The sheet is allowed to say more than the
 * fight will use: the ceiling is 85 and the floor is -60, and two sheets are written past the
 * ceiling (the Abomination's `chemical: 100`, the Ash Walkers' 90). Printed raw, the card would
 * promise a player a reduction no exchange in the game can produce, which is the same class of
 * defect as a price box quoting a figure the route does not charge. The clamp is the engine's
 * `effectiveResistance`, called rather than reimplemented, so a retune moves this line with it.
 */
export function splitResistances(
  resistances: UnitOption['stats']['resistances'],
): Record<Side, ResistLine[]> {
  const split: Record<Side, ResistLine[]> = { weakness: [], resistance: [] };
  for (const type of DAMAGE_TYPES) {
    const written = resistances[type] ?? 0;
    if (written === 0) continue;
    // The engine's own clamp, not a second copy of it: see `effectiveResistance`.
    const lands = effectiveResistance(written);
    split[lands < 0 ? 'weakness' : 'resistance'].push({ type, points: Math.abs(lands) });
  }
  return split;
}

/** Everything that differs between the two halves, so the panel below is written once. */
const SIDE: Record<
  Side,
  {
    label: string;
    testId: string;
    /** What the list is, in one line, over the rule. */
    note: string;
    /**
     * What to say when the list is empty.
     *
     * No unit in the catalogue is any more: `battle/matchup.test.ts` now makes every sheet carry
     * a resistance and a weakness. The component still has to draw the empty table it is handed,
     * and a panel with a heading and nothing under it is worse than a sentence.
     */
    empty: string;
    /** The word after the figure: 20% *more*, 25% *less*. */
    word: string;
    ink: string;
    underline: string;
  }
> = {
  weakness: {
    label: 'Weaknesses',
    testId: 'weaknesses',
    note: 'What gets through. These types do them extra damage.',
    empty: 'Nothing lands on them harder than it should.',
    word: 'more',
    ink: 'text-oxblood-300',
    underline: 'border-oxblood-500/70',
  },
  resistance: {
    label: 'Resistances',
    testId: 'resistances',
    note: 'What comes off them. These types do them less damage.',
    empty: 'Nothing comes off them. Every type lands in full.',
    word: 'less',
    ink: 'text-verdigris-300',
    underline: 'border-verdigris-500/70',
  },
};

/**
 * What a unit hits with, and what hits it (maintainer, 2026-09-18).
 *
 * "Have the damage type be displayed on the unit, and have their weaknesses also be visible."
 *
 * Both were on the sheet and on no screen at all, which made the one decision the damage table is
 * for, who to send at what, unreadable off the roster: a player could send an explosive stack at
 * the sheet that dreads explosives or at the sheet that shrugs them off and read the same card
 * either way.
 *
 * Under the marks rather than among them, and set as text rather than as chips. A mark is a
 * keyword the unit carries into every fight; this line is a *matchup*, and a row of chips that
 * looked like the row above it would file the two as the same kind of fact. The numbers stay on
 * the hover, where the rest of the card's detail already is.
 *
 * One line whatever the unit is, so the band under the marks is the same height on every card.
 * A unit with nothing on one side of its table still prints the word and answers on the hover,
 * which is a real answer rather than a row that comes and goes between cards.
 */
export function DamageLine({ unit }: { unit: UnitOption }) {
  const split = splitResistances(unit.stats.resistances);
  const dealt = DAMAGE_TYPE_LABELS[unit.stats.damageType];

  return (
    <div
      className="flex min-h-4 flex-wrap items-center gap-x-2 font-display text-[10px] uppercase tracking-[0.08em]"
      data-testid={`damage-line-${unit.id}`}
    >
      {/*
       * The damage type says itself, so it opens nothing (maintainer, 2026-09-20).
       *
       * It carried a card explaining that a defender resists the type rather than the unit. The
       * two triggers beside it are that same fact as a list of who: Weaknesses and Resistances
       * name the sheets this lands harder and softer on, which is the half a player is actually
       * reading the line for. A pointer that stops on `Blade damage` and is told in a paragraph
       * what the next two words are about to show is a pointer interrupted for nothing.
       *
       * The dashed underline goes with the card. It is the game's mark for "there is more here",
       * and leaving it on something that no longer opens is a promise the line cannot keep.
       */}
      <span
        className="flex h-4 items-center gap-1 whitespace-nowrap"
        data-testid={`damage-type-${unit.id}`}
      >
        <span className="font-bold text-brass-300">{dealt}</span>
        <span className="text-ink-300">damage</span>
      </span>

      {(['weakness', 'resistance'] as const).map((side) => (
        <SideTrigger key={side} unit={unit} side={side} lines={split[side]} />
      ))}
    </div>
  );
}

/**
 * One of the two words, and the table behind it.
 *
 * Coloured only when there is something to read: an oxblood **Weaknesses** on a unit nothing is
 * strong against is the card telling a player to go and look at an empty page. Greyed, the line
 * still says the question was asked and answered, which is what the empty panel says at length.
 */
function SideTrigger({
  unit,
  side,
  lines,
}: {
  unit: UnitOption;
  side: Side;
  lines: readonly ResistLine[];
}) {
  const copy = SIDE[side];
  const any = lines.length > 0;

  return (
    <HoverCard
      size="window"
      label={`${unit.name}: ${copy.label.toLowerCase()}`}
      data-testid={`${copy.testId}-${unit.id}`}
      card={<ResistanceSheet unit={unit} side={side} lines={lines} />}
    >
      <span
        className={cn(
          'flex h-4 items-center whitespace-nowrap border-b border-dashed font-semibold',
          any ? cn(copy.ink, copy.underline) : 'border-surface-600 text-ink-400',
        )}
      >
        {copy.label}
      </span>
    </HoverCard>
  );
}

/**
 * The table itself, on the same paper the training Bonuses page is drawn on.
 *
 * The figures are what a fight will use rather than what the sheet says, which is the same thing
 * for every unit but two: see the clamp in {@link splitResistances}.
 */
function ResistanceSheet({
  unit,
  side,
  lines,
}: {
  unit: UnitOption;
  side: Side;
  lines: readonly ResistLine[];
}) {
  const copy = SIDE[side];

  return (
    <div
      className="ink-frame card-paper washed grain flex w-[20rem] max-w-full flex-col gap-2 rounded-sm p-3.5"
      data-testid={`${copy.testId}-sheet-${unit.id}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-stamp text-[17px] leading-tight text-ink-100">{unit.name}</span>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          {copy.label}
        </span>
      </header>
      <p className="font-body text-[11px] leading-snug text-ink-300">{copy.note}</p>
      <span aria-hidden className="block h-1.5 text-ink-300/60">
        <DrawnRule />
      </span>
      {lines.length === 0 ? (
        <p className="font-body text-[12px] leading-relaxed text-ink-300">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {lines.map((line) => (
            <li key={line.type} className="flex items-baseline gap-2">
              {/*
               * Brass, because a damage type is brass everywhere else on this screen (maintainer,
               * 2026-09-18). It was `text-ink-100` here and `text-brass-300` on the card, so the
               * word "Explosive" was off-white in the table and gold two inches above it, reading
               * as two different kinds of fact. One colour for the type, whichever type it is and
               * wherever it is printed; the coloured half of the row is the figure beside it,
               * which is the part that differs between the two tables.
               */}
              <span className="min-w-0 flex-1 font-stamp text-[13px] leading-tight text-brass-300">
                {DAMAGE_TYPE_LABELS[line.type]}
              </span>
              <span
                className={cn(
                  'shrink-0 font-display text-[12px] font-bold uppercase tracking-[0.06em]',
                  copy.ink,
                )}
              >
                <span className="tabular-nums">{line.points}%</span> {copy.word}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
