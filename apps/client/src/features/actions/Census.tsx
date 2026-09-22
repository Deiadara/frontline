import {
  PLAYER_UNITS,
  UNIT_TIERS,
  UNIT_TIER_LABELS,
  unitSlotsUsed,
  type Army,
  type UnitsResponse,
  type UnitTier,
} from '@frontline/shared';
import { DrawnRule } from '../../components/ui/DrawnMarks';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import { useActions, useMissions, useUnits } from '../../lib/queries';
import { UnitCard } from '../units/UnitCard';
import { UnitTrigger } from '../units/UnitWindow';
import { UnitPortrait } from '../units/UnitPortrait';
import {
  GateMark,
  HeldMark,
  HomeMark,
  OutMark,
  PlantedMark,
  SplitBar,
  type Slice,
} from './CensusMarks';
import { MoveDialog } from './MoveDialog';
import { DrawnButton } from '../../components/ui/DrawnButton';
import { useState, type ReactNode } from 'react';

/**
 * The census: every unit this crew owns, and where each one is (maintainer, 2026-09-18).
 *
 * "A page that lists all of your units in numbers in a nicely graphiced list in one scrollable
 * page." Then, on 2026-09-19: "make it nicer, more hand drawn with custom graphics to match
 * theme, and make it be a second page in the Monitor section."
 *
 * The second half is why this file sits under `features/actions/` rather than under the roster it
 * counts. The Monitor answers "where is everybody right now" and this answers "how many of
 * everybody is there", which are the same question asked from either end: one lists the journeys,
 * the other totals the people making them. They are two tabs of one screen now, and the roster's
 * own door still opens on this one.
 *
 * ## Where the numbers come from
 *
 * Four buckets, and they are the four the server already keeps apart, so this page cannot
 * disagree with the ceiling:
 *
 * - **home** is `army`, the roster proper.
 * - **held** is `garrisoned`, posted on ground the crew holds.
 * - **planted** is `sleeping`, cells on ground it does not (§A4, `sleepers.ts`).
 * - **out** is everything else in `abroad`: at a fight, walking to one, or on a job. `abroad`
 *   already contains the planted, so the two are separated here rather than added, and the
 *   subtraction is done per unit id so a sheet that is both planted and at a fight reads right.
 */

/** One row's worth: a unit, a total, and the four places the total is made of. */
interface Census {
  unitId: string;
  name: string;
  tier: UnitTier;
  total: number;
  home: number;
  /** At the district's door (2026-09-22): the units a call on the gate is met by. */
  gate: number;
  held: number;
  planted: number;
  out: number;
}

const count = (army: Army | undefined, unitId: string): number => army?.[unitId] ?? 0;

/**
 * Where a place's figure is drawn, what it is called, and the mark that stands for it.
 *
 * One table for the lot, because the row's figures, the strip's colours and the legend under the
 * totals all have to name the same four places in the same order and the same ink. They were
 * three literals and the strip did not exist; adding a fifth place should be a row here.
 */
const PLACES: readonly {
  key: keyof Census;
  label: string;
  ink: string;
  fill: string;
  tip: string;
  Mark: (props: { className?: string }) => JSX.Element;
}[] = [
  {
    key: 'home',
    label: 'Home',
    ink: 'text-ink-100',
    fill: 'fill-ink-200/85',
    tip: 'Standing in your own district',
    Mark: HomeMark,
  },
  {
    key: 'gate',
    label: 'Gate',
    ink: 'text-ink-200',
    fill: 'fill-ink-300/85',
    tip: 'Standing at your gate',
    Mark: GateMark,
  },
  {
    key: 'held',
    label: 'Held',
    ink: 'text-brass-300',
    fill: 'fill-brass-300/85',
    tip: 'Posted on ground you hold',
    Mark: HeldMark,
  },
  {
    key: 'planted',
    label: 'Planted',
    ink: 'text-verdigris-300',
    fill: 'fill-verdigris-300/85',
    tip: 'Gone to ground on somebody else’s place, waiting',
    Mark: PlantedMark,
  },
  {
    key: 'out',
    label: 'Out',
    ink: 'text-tangerine-300',
    fill: 'fill-tangerine-300/85',
    tip: 'At a fight, walking to one, or on a job',
    Mark: OutMark,
  },
];

export function Census() {
  const units = useUnits();
  // Not read for numbers: the roster already carries all four. Loaded so the page shares the
  // cache the road tab warms, and so a recall landing anywhere refreshes this too.
  useActions();
  useMissions();
  // Which row's Move dialog is open. Declared before the early return below: a hook after it
  // is a hook that is not called on the loading render, and React refuses the next one.
  const [moving, setMoving] = useState<string | null>(null);

  const data = units.data;
  if (!data) {
    return (
      <ScreenLoad
        what="Your people"
        loading="Counting heads…"
        isError={units.isError}
        onRetry={() => void units.refetch()}
        detail="Nothing has been lost. Everybody is where you left them."
      />
    );
  }

  const census: Census[] = PLAYER_UNITS.map((spec) => {
    const home = count(data.army, spec.id);
    const gate = count(data.gateArmy, spec.id);
    const held = count(data.garrisoned, spec.id);
    const planted = count(data.sleeping, spec.id);
    // `abroad` already holds the planted, so what is left is the committed: at a fight, walking
    // to one, or on a job. Clamped at zero, because a payload from a build that does not send
    // `sleeping` would otherwise show a negative.
    const out = Math.max(0, count(data.abroad, spec.id) - planted);
    return {
      unitId: spec.id,
      name: spec.name,
      tier: spec.tier,
      total: home + gate + held + planted + out,
      home,
      gate,
      held,
      planted,
      out,
    };
  }).filter((row) => row.total > 0);

  const slots = unitSlotsUsed(Object.fromEntries(census.map((row) => [row.unitId, row.total])));

  if (census.length === 0) {
    return (
      <p className="font-body text-[13px] leading-relaxed text-ink-300" data-testid="census-none">
        You have nobody at all. The Gauntlet is where that changes.
      </p>
    );
  }

  return (
    /*
     * One scroller, named here rather than left to the shell.
     *
     * `fills` hands the Monitor an `overflow-hidden` box and expects the page inside it to say
     * which part moves. `min-h-0` is the other half: a flex child's default `min-height: auto`
     * lets this grow to its content's height, and a box that is never taller than its content
     * never overflows, so there would be nothing to scroll and the tail of a long roster would
     * simply be clipped.
     */
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-0.5" data-testid="census">
      <Ledger rows={census} slots={slots} />
      {moving !== null && (
        <MoveDialog roster={data} unitId={moving} onClose={() => setMoving(null)} />
      )}
      {UNIT_TIERS.map((tier) => {
        const rows = census.filter((row) => row.tier === tier);
        if (rows.length === 0) return null;
        return (
          <section key={tier} className="flex flex-col gap-2" data-testid={`census-${tier}`}>
            <header className="flex items-baseline gap-3">
              <h2 className="shrink-0 font-stamp text-[15px] leading-none text-brass-300">
                {UNIT_TIER_LABELS[tier]}
              </h2>
              {/* The rule runs from the end of the name to the count, which is what a ruled
                  ledger does and what a border-bottom on the heading cannot: the line belongs to
                  the gap rather than to either end of it. */}
              <span aria-hidden className="h-1.5 min-w-0 flex-1 text-ink-300/40">
                <DrawnRule />
              </span>
              <span className="shrink-0 font-display text-[12px] tabular-nums text-ink-300">
                {rows.reduce((sum, row) => sum + row.total, 0)}
              </span>
            </header>
            {/* Two and three across on a wide sheet. One column of 1850px-wide rows put the
                name at one end and the four figures at the other with a metre of nothing in
                between; at 600px a row is a card you can read in one go. */}
            <ul className="grid grid-cols-1 gap-1.5 lg:grid-cols-2 2xl:grid-cols-3">
              {rows.map((row) => (
                <CensusRow
                  key={row.unitId}
                  row={row}
                  roster={data}
                  onMove={() => setMoving(row.unitId)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The three figures a player came for, on the sheet the rest of the game's summaries are on.
 *
 * `ink-frame card-paper washed grain` is the drawn panel the archive's active project and the
 * crew file use. It was a plain bordered box with three numbers in it, which is the one thing on
 * a paper screen that still looked like a form.
 */
function Ledger({ rows, slots }: { rows: readonly Census[]; slots: number }) {
  const heads = rows.reduce((sum, row) => sum + row.total, 0);
  const places = PLACES.map((place) => ({
    ...place,
    total: rows.reduce((sum, row) => sum + (row[place.key] as number), 0),
  }));

  return (
    <div
      className="ink-frame card-paper washed grain flex shrink-0 flex-col gap-3 rounded-sm p-3.5 shadow-panel"
      data-testid="census-totals"
    >
      {/*
       * One band across the whole sheet: the three figures, then the crew's split, then the
       * legend that names its colours.
       *
       * Laid out as a row with the strip taking the slack rather than as three stacked blocks,
       * because this page runs the full width of a `wide` shell: stacked, the whole summary sat
       * in the left quarter with about fourteen hundred pixels of empty plate beside it. The
       * strip is the part that *wants* the width, so it is the part that gets it.
       */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        {[
          ['Units', heads],
          ['Kinds', rows.length],
          ['Unit slots', slots],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex shrink-0 flex-col gap-0.5">
            <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              {label}
            </span>
            <span className="font-stamp text-[26px] leading-none tabular-nums text-brass-300">
              {value}
            </span>
          </div>
        ))}

        {/* The whole crew's split. One strip at the top of the page answers "how much of my army
            is actually available" before a single row is read, and it is the same drawing every
            row below it wears. */}
        <SplitBar
          className="h-2.5 min-w-[12rem] flex-1 self-center text-ink-300"
          label={`Everybody: ${places.map((place) => `${place.total} ${place.label.toLowerCase()}`).join(', ')}`}
          total={heads}
          slices={places.map<Slice>((place) => ({
            key: place.key,
            count: place.total,
            fill: place.fill,
          }))}
        />

        <ul className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 self-center">
          {places.map((place) => (
            <li key={place.key} className="flex items-center gap-1.5" title={place.tip}>
              <place.Mark className={cn('h-4 w-4 shrink-0', place.ink)} />
              <span className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
                {place.label}
              </span>
              <span
                className={cn('font-display text-[12px] font-bold tabular-nums', place.ink)}
                data-testid={`census-all-${place.key}`}
              >
                {place.total}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CensusRow({
  row,
  roster,
  onMove,
}: {
  row: Census;
  roster: UnitsResponse;
  onMove: () => void;
}) {
  /*
   * §A5: the sheet, on hover, the way every other screen that lists units offers it.
   *
   * The census is the one page in the game whose whole job is "what do I own", and it was the
   * one place a unit's name opened nothing. The card is the same `UnitCard` the roster, the
   * deploy window and the mission picker put behind a name, so a player never has to learn a
   * second way of asking.
   *
   * The whole row is the trigger rather than just the name: this row is already a list item
   * about exactly one sheet, and a two-word hover target inside a 600px row is a target people
   * miss.
   *
   * The row inside the `<li>` rather than the other way round, which is what the trigger forces:
   * a `HoverCard` *is* a `<button>`, so wrapping the item put a `<button>` straight into the
   * `<ul>` with an `<li>` inside it. Neither is allowed, and the cost is not theoretical: a list
   * whose items are buried inside buttons is a list a screen reader counts as empty, on the one
   * page whose whole job is counting.
   */
  const option = roster.units.find((one) => one.id === row.unitId);
  const body = (
    <div
      data-testid={`census-${row.unitId}`}
      /* The drawn sheet the rest of the Monitor is printed on (maintainer, 2026-09-22), rather
         than a flat bordered box: this page sits beside the road's file sections and was the one
         thing on it that still read as a form. */
      className="flex min-w-0 flex-1 items-center gap-3"
    >
      {/*
       * `fill` inside a box with a definite height, which is the only way this component sizes.
       *
       * Without it `UnitPortrait` is `aspect-[3/4] w-full` and takes the whole row: a `w-10` on
       * the component loses to its own `w-full` on emission order, so the first cut of this drew
       * a 1300px-wide portrait with the name and every figure buried under it.
       */}
      <span className="h-11 w-[33px] shrink-0">
        <UnitPortrait
          unitId={row.unitId}
          tier={row.tier}
          fill
          className="rounded-sm border-surface-600/80"
        />
      </span>

      {/* The name over the strip, and the strip is why this column is `min-w-0`: it takes the
          width nothing else claims, which is what makes it comparable from row to row. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-display text-[14px] font-bold leading-none text-ink-100">
          {row.name}
        </span>
        <SplitBar
          className="h-2 w-full text-ink-400"
          label={`${row.name}: ${PLACES.filter((place) => (row[place.key] as number) > 0)
            .map((place) => `${row[place.key] as number} ${place.label.toLowerCase()}`)
            .join(', ')}`}
          total={row.total}
          slices={PLACES.map<Slice>((place) => ({
            key: place.key,
            count: row[place.key] as number,
            fill: place.fill,
          }))}
        />
      </span>

      <span
        className="shrink-0 font-stamp text-[19px] leading-none tabular-nums text-brass-300"
        data-testid={`census-total-${row.unitId}`}
      >
        {row.total}
      </span>

      {/* Zero is greyed rather than hidden: a column that comes and goes between rows is a column
          the eye cannot scan down. The mark sits over the figure so the four places read as four
          places at a glance rather than as four abbreviations to learn. */}
      <dl className="flex shrink-0 items-center gap-2.5">
        {PLACES.map((place) => {
          const value = row[place.key] as number;
          return (
            <div
              key={place.key}
              className="flex w-11 flex-col items-center gap-0.5"
              title={place.tip}
            >
              <dt className={cn('h-3.5 w-3.5', value > 0 ? place.ink : 'text-ink-500/50')}>
                <place.Mark className="h-full w-full" />
                <span className="sr-only">{place.label}</span>
              </dt>
              <dd
                className={cn(
                  'font-display text-[13px] font-bold leading-none tabular-nums',
                  value > 0 ? place.ink : 'text-ink-500/60',
                )}
                data-testid={`census-${place.key}-${row.unitId}`}
              >
                {value}
              </dd>
            </div>
          );
        })}
      </dl>

      {/*
       * Move, inside the row's own box (maintainer, 2026-09-22), drawn and in brass.
       *
       * It sat outside the card as a plate-metal ghost button, which made every row two objects
       * with a gap down the middle. It belongs to the unit, so it is printed on the unit's sheet;
       * `DrawnButton` is the hand's version of the same control and the one the rest of the paper
       * screens use.
       *
       * `stopPropagation` because the whole row is a `UnitTrigger`: without it a press opens the
       * dialog *and* the unit's card behind it. `preventDefault` for the same reason on the
       * keyboard path, which the trigger also listens to.
       */}
    </div>
  );

  /*
   * The box, and the two things in it.
   *
   * The sheet is the `<li>` rather than the trigger, because the trigger is a `<button>` and the
   * Move control is another one: nesting them is invalid markup and a press that fires both. So
   * the drawn panel holds a trigger that takes the slack and a control that does not.
   */
  const boxed = (inside: ReactNode) => (
    <li className="ink-frame card-paper washed grain flex min-w-0 items-center gap-2 rounded-sm p-2.5 shadow-panel">
      {inside}
      {/* Move (maintainer, 2026-09-22): part of the unit's own box, drawn, and in brass. It was
          a plate-metal ghost button floating outside the row. */}
      <DrawnButton
        size="sm"
        onClick={onMove}
        data-testid={`move-${row.unitId}`}
        className="shrink-0"
      >
        Move
      </DrawnButton>
    </li>
  );

  if (!option) return boxed(body);
  const card = (
    <UnitCard
      unit={option}
      garrisoned={roster.garrisoned[row.unitId] ?? 0}
      abroad={roster.abroad[row.unitId] ?? 0}
      carriersFight={roster.carriersFight ?? false}
    />
  );
  return boxed(
    <>
      {/*
       * Through `UnitTrigger` since 2026-09-20, so a row opens as well as explains itself.
       *
       * The same card either way, and it is this screen's own rather than the window's default:
       * the Census is the one place that holds all three counts (at home, on held ground, at a
       * fight), and a dialog drawing zeroes would be a worse answer than the hover it came from.
       */}
      <UnitTrigger
        unitId={row.unitId}
        label={row.name}
        className="flex min-w-0 flex-1 text-left"
        card={card}
        windowCard={card}
      >
        {body}
      </UnitTrigger>
    </>,
  );
}
