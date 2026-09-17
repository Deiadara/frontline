import type { BonusLine, TrainingBreakdown, UnitOption } from '@frontline/shared';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { cn } from '../../lib/cn';

/**
 * Everything working on one unit's training, on one page (maintainer, 2026-09-17).
 *
 * "A little info tag on each unit called Bonuses that analyzes what is given for that particular
 * unit, including the global ones and its private ones."
 *
 * The two halves come from different places on the wire and that is the mechanic rather than an
 * accident. The crew-wide figures are one answer about the district, sent once on the response; a
 * unit's own ground is §A4, per row, and is the reason this page had to exist at all: the Doghouse
 * makes Cyberhounds cheaper and does nothing for a Razor, so a Cyberhound's card was showing a
 * bigger discount than the chips at the top of the screen could account for.
 *
 * Both sums are the server's. This concatenates two lists it was handed and totals them for the
 * reader; `units/breakdown.ts` and `units/roster.ts` are pinned to their own figures by tests, so
 * there is no arithmetic here that can disagree with a bill.
 */
export function UnitBonuses({
  unit,
  crew,
}: {
  unit: UnitOption;
  /** The crew-wide lines, or undefined from a server that does not send them. */
  crew: TrainingBreakdown | undefined;
}) {
  /*
   * Named for what they come off, in the player's words (maintainer, 2026-09-17: "what do you mean
   * off the bill, off the clock, off the supplies line?").
   *
   * They were metaphors, and a label somebody has to ask about is a label that failed. The one
   * that actually needed explaining is the middle one, and the note says it rather than implying
   * it: there are two discounts on a price because they are different discounts. `trainingCost`
   * takes the cost cut off every material and then takes the supplies cut off supplies as well, so
   * a Greenhouse is worth something to a crew that already has the price down.
   */
  const sections = [
    {
      key: 'cost',
      testId: 'unit-bonuses-total-cost',
      title: 'Training cost',
      note: 'Off every material in the price',
      lines: [...(crew?.cost ?? []), ...(unit.homeBonus?.cost ?? [])],
    },
    {
      key: 'supplies',
      testId: 'unit-bonuses-total-supplies',
      title: 'Supplies',
      note: 'Off the supplies only, on top of the cost cut',
      // §B5 is structures and nothing else, so no unit has a private half of it.
      lines: crew?.supplies ?? [],
    },
    {
      key: 'speed',
      testId: 'unit-bonuses-total-speed',
      title: 'Training time',
      note: 'Off the clock for every unit you train',
      lines: [...(crew?.speed ?? []), ...(unit.homeBonus?.speed ?? [])],
    },
  ];

  return (
    <div
      className="ink-frame card-paper washed grain flex w-[24rem] max-w-full flex-col gap-2.5 rounded-sm p-3.5"
      data-testid={`unit-bonuses-${unit.id}`}
    >
      <header className="flex items-baseline justify-between gap-3">
        <span className="font-stamp text-[17px] leading-tight text-ink-100">{unit.name}</span>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          What you get
        </span>
      </header>

      {sections.map((section) => (
        <Section
          key={section.key}
          testId={section.testId}
          title={section.title}
          note={section.note}
          lines={section.lines}
        />
      ))}
    </div>
  );
}

function Section({
  testId,
  title,
  note,
  lines,
}: {
  /** Written out rather than derived from the title: a copy edit should not move a test's handle. */
  testId: string;
  title: string;
  /** One line saying what this figure comes off. The middle one is why this exists. */
  note: string;
  lines: readonly BonusLine[];
}) {
  const total = lines.reduce((sum, line) => sum + line.percent, 0);

  return (
    <section>
      <h4 className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
          {title}
        </span>
        <span
          className="font-display text-[14px] font-bold tabular-nums text-brass-100"
          data-testid={testId}
        >
          {round(total)}%
        </span>
      </h4>
      <p className="font-body text-[11px] leading-snug text-ink-300">{note}</p>
      <span aria-hidden className="mb-1 mt-0.5 block h-1.5 text-ink-300/60">
        <DrawnRule />
      </span>
      {lines.length === 0 ? (
        /* Said rather than left blank: a zero here is a thing the player has not built yet, and
           which thing it is differs per section, so the sentence is worth the two lines. */
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          Nothing is paying into this one yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {lines.map((line, index) => (
            // Position is the only honest key: the list is a fixed ordering off one payload and two
            // officers can share a name.
            <li key={`${line.source}-${index}`} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1">
                <span className="font-stamp text-[13px] leading-tight text-ink-100">
                  {line.source}
                </span>
                {line.note !== undefined && (
                  <span className="ml-1.5 font-body text-[10px] text-ink-300">{line.note}</span>
                )}
              </span>
              <span
                className={cn(
                  'shrink-0 font-display text-[12px] font-bold tabular-nums',
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
    </section>
  );
}

/** One decimal, and only when there is one: a raid's cut leaves long tails on these sums. */
function round(percent: number): string {
  const one = Math.round(percent * 10) / 10;
  return Number.isInteger(one) ? String(one) : one.toFixed(1);
}
