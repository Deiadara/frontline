import {
  BUILDING_CATALOG,
  TRAINING_MAX_BATCH,
  UNIT_HEADLINE_KEYS,
  UNIT_RATING_KEYS,
  UNIT_STAT_EXPLAINERS,
  UNIT_STAT_LABELS,
  UNIT_TIER_LABELS,
  findUnit,
  maxTrainable,
  type BuiltUpgrade,
  type StatKey,
  type UnitOption,
} from '@frontline/shared';
import { useState } from 'react';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { NumberField } from '../../components/ui/NumberField';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
import { cn } from '../../lib/cn';
import { RATING_FILL, RATING_TEXT, ratingBand, ratingPercent } from '../../lib/rating';
import { formatDuration } from '../base/format';
import { UnitPortrait } from './UnitPortrait';
import { UpgradeSlots } from './UpgradeSlots';

export interface UnitCardProps {
  unit: UnitOption;
  /** The crew's whole stock, so a bracket's menu opens without going and asking for it. */
  built: BuiltUpgrade[];
  garrisoned: number;
  /** §A4: at a fight or walking to one. Away like a garrison, and counted in the same beds. */
  abroad: number;
  /**
   * The price box at the foot of the card, and the Train control in it.
   *
   * Optional, and its absence is what the battle screen's hover card uses: the deploy dialog shows
   * this same card to answer "who am I about to send", where a price and a Train button are a
   * second decision made in the wrong window. Nothing above the box changes, so the two callers
   * still read one card rather than two that drift.
   */
  training?: UnitCardTraining;
}

/** Everything the price box needs, and nothing anything above it does. */
export interface UnitCardTraining {
  resources: Parameters<typeof CostLine>[0]['stock'];
  /** Beds left in the district, so **Max** can only offer a batch that will fit in them. */
  spare: number;
  /** §F2, folded in for the same reason: the price Max works against is the price charged. */
  discountPercent: number;
  /**
   * §B5: the Greenhouse's cut, which comes off the supplies line and nothing else.
   *
   * Separate from `discountPercent` because the two are not the same discount and adding them
   * would quote scrap and oil too cheap. The route already charged this; the page did not know
   * about it, so **Max** was computed against a supplies price nobody was paying and the roster
   * quoted a figure the server disagreed with. A screen that disagrees with the server about a
   * price is the bug that makes a player think they were overcharged.
   */
  suppliesPercent: number;
  pending: boolean;
  onTrain: (count: number) => void;
}

/**
 * A roster card, and every card is the same card.
 *
 * The board's complaint, and it was right: the cards used to be as tall as their own content, so a
 * unit with four ground affinities pushed its price box eighty pixels below its neighbour's and the
 * eye had to re-find the Train button on every entry. A roster is a list of comparable things, and
 * a list you cannot scan across is a list.
 *
 * So the card is a **fixed frame**: three rows that are always the same height, in the same order,
 * whatever the unit is.
 *
 *   1. The header. One line of name, one of tier and trade. Never wraps.
 *   2. The sheet. Twelve stats, always twelve, in two columns.
 *   3. The action. Price and Train, or the padlock and what is in the way. Same box, same place,
 *      whichever it is.
 *
 * The portrait fills the left column at whatever height the rest settles on, cropping rather than
 * setting it. The prose, the modifiers and the ground affinities are *not* on the card at all any
 * more: they are hover cards on the name and on a single row of marks under the header, which is
 * where a player looks for detail once they have already decided which unit they are reading.
 */
export function UnitCard({ unit, built, garrisoned, abroad, training }: UnitCardProps) {
  return (
    <section
      data-testid={`unit-${unit.id}`}
      className={cn(
        // The frame, and its height is the whole mechanism: see the portrait below.
        //
        // One height at every width, which the card did not used to have: it was 4rem shorter
        // below 1440 so that two narrow cards to a row would not each be half picture. What that
        // actually bought was 60px of price box hanging out of the bottom of every card on a
        // 1280px screen, because the sheet beside the portrait is the same twelve rows whatever
        // the card is wide, and the shorter frame had nowhere to put the last of them. The
        // picture is the part that can afford to give: it narrows with the frame and stays whole.
        'card-paper washed rivets edge-lit relative flex gap-3 rounded-sm border p-3',
        // Definite, because the portrait beside the sheet is `h-full` at its own 3:4 and a frame
        // with no height gives it nothing to be full of. Without the price box the frame is that
        // box shorter and nothing else moves, so the card a hover shows is the card the roster
        // shows with its last row taken off.
        training ? 'h-[25.5rem]' : 'h-[19.5rem]',
        // And a ceiling on the width while it is one to a row, so a single card does not become a
        // 1200px band with a stat table stretched across it. 52rem is about what two of them
        // measure at 1440, so a card is the same object at every width: it just stops sharing.
        'w-full max-w-[52rem] [@media(min-width:1440px)]:max-w-none',
        unit.unlocked ? 'border-surface-600/70' : 'border-surface-700 opacity-75',
      )}
    >
      {/*
        The picture, whole, and filling the frame it is in.

        The card has a **fixed height**, which is what makes this resolvable in CSS at all: with a
        definite height the portrait can be `h-full` at its own 3:4 and let the width follow, so the
        frame is exactly the shape of the painting. Nothing is cropped, and there are no bands of
        card showing above and below it, which is what the previous two attempts each got wrong in
        turn (cover cropped the chin off; contain left a mat).

        The height is a constant rather than a measurement because the sheet beside it is one: a
        header, twelve stats, a row of marks and the price box are the same rows on every card in
        the game.
      */}
      <div className="relative h-full shrink-0">
        <UnitPortrait
          unitId={unit.id}
          tier={unit.tier}
          fill
          className="h-full w-auto rounded-sm border-2 border-surface-600/80 shadow-lifted"
        />
        {/*
          Owned, over the picture's corner, where a strategy game puts a count.

          Three numbers, not one: at home, on held ground, and at a fight. All three are in the
          population chip at the top of the page (§A1 feeds them all), so a card that showed only
          the first would leave a player counting beds they cannot see. Brass is ground, tangerine
          is a fight, matching the colour each of those screens already uses.
        */}
        <span className="absolute right-1.5 top-1.5 rounded-sm border border-surface-600 bg-surface-950/85 px-2 py-0.5 font-display text-[13px] font-bold leading-none tabular-nums text-ink-100">
          {unit.owned}
          {garrisoned > 0 && (
            <span className="text-brass-300" data-tip={`${garrisoned} on held ground`}>
              {' '}
              +{garrisoned}
            </span>
          )}
          {abroad > 0 && (
            <span className="text-tangerine-300" data-tip={`${abroad} at a fight`}>
              {' '}
              +{abroad}
            </span>
          )}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {/* Row 1. The name is the door to everything that used to be printed on the card, and the
            carry sits opposite it: one figure, top right, where a card puts a capacity. */}
        <header className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0 flex-1">
            <HoverCard
              label={unit.name}
              size="window"
              className="w-full"
              card={<UnitDossier unit={unit} />}
            >
              <span className="block truncate text-left font-display text-lg font-bold leading-tight tracking-[0.06em] text-ink-100">
                {unit.name}
              </span>
              <span className="block truncate text-left font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                {UNIT_TIER_LABELS[unit.tier]} · {BUILDING_CATALOG[unit.trainedAt].name} ·{' '}
                {unit.supply} pop
              </span>
            </HoverCard>
          </span>
          {/* The name is on the hover rather than printed: at this size a word beside the figure
              costs more room than the figure itself, and `Loot` is one word nobody needs twice. */}
          <span
            className="flex shrink-0 items-center gap-1 rounded-sm border border-surface-600/60 bg-surface-950/40 px-2 py-1"
            data-tip="Loot"
          >
            <Icon name="loot" className="h-4 w-4 text-ink-300" />
            <span className="font-display text-[13px] font-bold leading-none tabular-nums text-ink-100">
              {unit.stats.lootCapacity}
            </span>
          </span>
        </header>

        {/*
          Row 2, in two halves: the two open figures, then the ratings as bars.

          Attack and hit points are quantities, not scores. A Colossus has twenty times a Razor's
          vitality and hits four times as hard, and a bar out of 100 cannot say either once
          anything reaches the top of the track. So those two are printed large, side by side,
          where the eye lands first. Everything under them genuinely is a rating out of 100, which
          is what makes a bar honest: the track *is* the maximum, so length is comparable down the
          column without reading a single number.

          The row count is fixed either way, which is what lets the card promise a height: two
          figures, four rows of paired bars, one line for the load.
        */}
        <div className="border-y border-surface-600/50 py-2.5">
          <dl className="grid grid-cols-2 gap-2">
            {UNIT_HEADLINE_KEYS.map((key) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-2 rounded-sm border border-surface-600/60 bg-surface-950/40 px-2.5 py-1.5"
              >
                <dt className="min-w-0 flex-1">
                  <StatLabel statKey={key} />
                </dt>
                <dd className="shrink-0 font-display text-[19px] font-bold leading-none tabular-nums text-brass-300">
                  {unit.stats[key]}
                </dd>
              </div>
            ))}
          </dl>

          {/* Tight on the fixed costs, because the label is what has to survive them. Two cards to
              a row at 1280 leaves the sheet 271px, so a column is ~130px, and a 40px track with a
              20px gutter left `Penetration` 61px to be drawn in at 73px wide: it either crossed
              its own bar or got cut, and both are forbidden. 24px of track and a 12px gutter give
              the word 73px, which is what `Penetration` measures at 11px condensed and the
              widest label on the sheet. */}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {UNIT_RATING_KEYS.map((key) => {
              // The same four bands every other rating out of a hundred is read on: see
              // `lib/rating.ts`. These were a flat cyan at every value, which made the bar a
              // second drawing of the number's *existence* rather than of the number.
              const band = ratingBand(unit.stats[key]);
              return (
                <div key={key} className="flex items-center gap-1">
                  <dt className="min-w-0 flex-1">
                    <StatLabel statKey={key} />
                  </dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    <span
                      className="relative h-1.5 w-6 overflow-hidden rounded-full bg-black/40"
                      aria-hidden
                    >
                      <span
                        className={cn('block h-full rounded-full opacity-90', RATING_FILL[band])}
                        style={{ width: `${ratingPercent(unit.stats[key])}%` }}
                      />
                    </span>
                    <span
                      className={cn(
                        'w-6 text-right font-display text-[12px] font-bold tabular-nums',
                        RATING_TEXT[band],
                      )}
                    >
                      {unit.stats[key]}
                    </span>
                  </dd>
                </div>
              );
            })}
          </dl>

          {/* The keywords take the line the carry used to have: one row, side by side, still a
              fixed height so the box under it never moves. */}
          <div className="mt-1.5 border-t border-surface-700/70 pt-1.5">
            <Marks unit={unit} />
          </div>
        </div>

        {/* The three brackets (§A5). Under the sheet rather than in it, because what is bolted on
            is a decision the player makes and everything above is a number they read. */}
        <div className="mt-2">
          <UpgradeSlots unit={unit} built={built} />
        </div>

        {/* Row 4, and a *fixed* height, which is the last thing standing between this grid and the
            cards it used to be. A price line wraps to two lines for a unit that costs three
            materials and stays on one for a unit that costs two, and a locked unit's clause list is
            one line or two depending on how many things are in the way. Any of those makes the
            neighbouring card taller. The box is the same size whatever goes in it and its contents
            are centred in it. */}
        {training && (
          <div className="mt-auto flex h-24 items-stretch" data-testid={`action-${unit.id}`}>
            {unit.unlocked ? (
              <TrainBox unit={unit} training={training} />
            ) : (
              /* The same slot, the same height, the same place on the card. What changes when a
                 unit is locked is the content of the box, not where the box is: two clauses at most
                 on the face of it and the whole list on hover, so a unit gated on four things is
                 not a card eighty pixels taller than its neighbour. */
              <HoverCard
                label={`${unit.name} is locked`}
                size="window"
                className="h-full w-full"
                card={<UnitDossier unit={unit} />}
              >
                <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm border border-oxblood-500/40 bg-oxblood-500/10 px-3 py-2">
                  <span className="flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-oxblood-300">
                    <Icon name="lock" aria-hidden className="h-3.5 w-3.5" />
                    Locked
                  </span>
                  <span className="line-clamp-2 text-center font-display text-[11px] uppercase leading-snug tracking-[0.1em] text-oxblood-300">
                    {unit.missing.join(' · ')}
                  </span>
                </span>
              </HoverCard>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * What a batch of these costs, how many of them, and the order.
 *
 * Its own component because the count is state: the card renders this box only where there is a
 * roster behind it to train from, and a hook cannot sit behind that condition.
 */
function TrainBox({ unit, training }: { unit: UnitOption; training: UnitCardTraining }) {
  const { resources, spare, discountPercent, suppliesPercent, pending, onTrain } = training;
  const [count, setCount] = useState(1);
  const spec = findUnit(unit.id);
  const most = spec ? maxTrainable(spec, resources, spare, discountPercent, suppliesPercent) : 0;

  return (
    <div className="flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-brass-500/35 bg-surface-950/45 px-3 py-2">
      <CostLine cost={unit.cost} stock={resources} />
      <div className="flex items-center gap-2">
        <NumberField
          label={`How many ${unit.name}`}
          min={1}
          max={unit.unique ? 1 : TRAINING_MAX_BATCH}
          value={count}
          onChange={setCount}
          data-testid={`count-${unit.id}`}
        />
        {/* What the crew can actually pay for and house, worked out by the same function the
            route's own gates read, so Max can never offer a batch that is then refused. Off
            entirely for a one-of-a-kind, where the answer is always one. */}
        {!unit.unique && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || most < 1}
            onClick={() => setCount(most)}
            data-testid={`max-${unit.id}`}
            title={`As many as you can afford and house: ${most}`}
          >
            Max
          </Button>
        )}
        <Button size="sm" disabled={pending} onClick={() => onTrain(count)}>
          {pending ? 'Working…' : 'Train'}
        </Button>
        <span className="font-display text-[11px] tabular-nums text-ink-300">
          {formatDuration(unit.trainSeconds)}
        </span>
      </div>
    </div>
  );
}

/**
 * One reserved line of marks: what this unit does, and where it is unusually good or bad.
 *
 * Always rendered, even when a unit has neither, because an empty line that holds its place is what
 * lets the price box below it land on the same pixel on every card.
 *
 * Two marks at most, and a `+N` for the rest rather than a row that runs off the edge: the widest
 * unit in the game carries two modifiers and four ground affinities, and letting those wrap is
 * exactly what made the cards different heights in the first place. Two, not three, because the
 * narrowest card the grid produces is about 270px of sheet at 1024 and a third chip pushed
 * `CLOSE QUARTERS` onto a second line, where the row's own fixed height then cut it in half.
 */
const MARKS_SHOWN = 2;

/** A stat's name, with its explainer one hover away. Shared by the figures and the bars. */
function StatLabel({ statKey }: { statKey: StatKey }) {
  return (
    <HoverCard
      label={UNIT_STAT_LABELS[statKey]}
      className="w-full min-w-0 shrink"
      // The trigger is `shrink-0` by default, which is right for a tag and wrong for a table
      // label: sized to its own text it grows past the column it was given and `Penetration`
      // draws straight over the bar beside it, with the `truncate` on the span below powerless
      // because the button never got narrower than the word. `min-w-0 w-full` puts the width
      // back under the column's control and lets the truncate do its job.
      card={
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
            {UNIT_STAT_LABELS[statKey]}
          </p>
          <p className="font-body text-[13px] leading-relaxed text-ink-100">
            {UNIT_STAT_EXPLAINERS[statKey]}
          </p>
        </div>
      }
    >
      {/* `block`, and it is not decoration: `truncate` is `overflow:hidden` plus `nowrap`, and an
          inline span ignores overflow entirely. Without it the word is drawn at its full width
          whatever the column is, which is how `Penetration` came to be printed across its own
          bar in a 115px column. */}
      <span className="block truncate font-display text-[11px] uppercase tracking-[0.08em] text-ink-300">
        {UNIT_STAT_LABELS[statKey]}
      </span>
    </HoverCard>
  );
}

function Marks({ unit }: { unit: UnitOption }) {
  // Rules first, then modifiers, then ground. A shield line is the most important thing anybody
  // can know about a unit and it must not be the mark that gets counted into the `+N`.
  const rules = unit.rules.slice(0, MARKS_SHOWN);
  const modifiers = unit.modifiers.slice(0, MARKS_SHOWN - rules.length);
  const room = MARKS_SHOWN - rules.length - modifiers.length;
  const affinities = unit.affinities.slice(0, room);
  const hidden =
    unit.rules.length -
    rules.length +
    (unit.modifiers.length - modifiers.length) +
    (unit.affinities.length - affinities.length);

  return (
    <ul
      className="flex h-6 flex-nowrap items-center gap-1 whitespace-nowrap"
      data-testid={`marks-${unit.id}`}
    >
      {rules.map((rule) => (
        <li key={rule.id} className="min-w-0">
          <RuleTag rule={rule} unit={unit.name} />
        </li>
      ))}
      {modifiers.map((modifier) => (
        <li key={modifier.label} className="min-w-0">
          <ModifierTag modifier={modifier} unit={unit.name} />
        </li>
      ))}
      {affinities.map((affinity) => (
        <li key={affinity.id} className="min-w-0">
          <HoverCard
            label={`${affinity.label}: ${affinity.note}`}
            card={
              <div className="flex flex-col gap-1">
                <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
                  {affinity.label}
                </p>
                <p className="font-body text-[13px] leading-relaxed text-ink-100">
                  {affinity.good
                    ? `${unit.name} fight better on this ground: ${affinity.note}.`
                    : `${unit.name} suffer on this ground: ${affinity.note}.`}
                </p>
              </div>
            }
          >
            <span
              className={cn(
                'flex h-5 items-center truncate rounded-sm border px-1.5',
                'font-display text-[10px] uppercase tracking-[0.08em]',
                affinity.good
                  ? 'border-verdigris-500/60 bg-verdigris-700/25 text-verdigris-100'
                  : 'border-oxblood-500/60 bg-oxblood-500/15 text-oxblood-300',
              )}
            >
              {affinity.label}
            </span>
          </HoverCard>
        </li>
      ))}
      {/* Counted, never clipped. A row that simply overflowed cut the last chip down its middle,
          which is a defect however small; a chip that says how many are left is an invitation to
          the dossier, which has all of them. */}
      {hidden > 0 && (
        <li className="shrink-0">
          <HoverCard label={`${hidden} more`} size="window" card={<UnitDossier unit={unit} />}>
            <span className="flex h-5 items-center rounded-sm border border-surface-600 bg-surface-800/80 px-1.5 font-display text-[10px] uppercase tracking-[0.08em] tabular-nums text-ink-300">
              +{hidden}
            </span>
          </HoverCard>
        </li>
      )}
    </ul>
  );
}

/**
 * Everything about a unit that is not a number, on hover.
 *
 * The blurb, what its modifiers actually do, the ground it likes, and, when it is locked, every
 * clause still in the way. All of it used to be printed on the card, which is what made the cards
 * different heights and the roster impossible to scan.
 */
function UnitDossier({ unit }: { unit: UnitOption }) {
  return (
    <InfoWindow
      eyebrow={`${UNIT_TIER_LABELS[unit.tier]} · ${unit.supply} population`}
      title={unit.name}
      tone={unit.unlocked ? 'brass' : 'oxblood'}
      // `plate="none"`: the portrait is a painting, not a glyph, so it keeps its own frame and
      // fills the box. It used to be stripped of its border and inset on the window's lilac tile,
      // which put a lavender ring round every face on the roster.
      plate="none"
      icon={<UnitPortrait unitId={unit.id} tier={unit.tier} fill />}
    >
      <p className="font-body text-[14px] leading-relaxed text-ink-100">{unit.blurb}</p>

      {unit.missing.length > 0 && (
        <WindowSection label="Still waiting on">
          <ul className="flex flex-col">
            {unit.missing.map((clause) => (
              <li
                key={clause}
                className="font-display text-[12px] uppercase leading-relaxed tracking-[0.1em] text-oxblood-300"
              >
                {clause}
              </li>
            ))}
          </ul>
        </WindowSection>
      )}

      {unit.rules.length > 0 && (
        <WindowSection label="How they fight">
          {/* Above "What they do", because a rule outranks a percentage: whether the enemy has to
              shoot this stack first is the first thing anybody needs to know about it. */}
          <ul className="flex flex-col gap-2">
            {unit.rules.map((rule) => (
              <li key={rule.id}>
                <span className="block font-display text-[11px] font-bold uppercase leading-snug tracking-[0.14em] text-brass-100">
                  {rule.label}
                </span>
                <span className="block font-body text-[13px] leading-snug text-ink-100">
                  {rule.description}
                </span>
              </li>
            ))}
          </ul>
        </WindowSection>
      )}

      {unit.modifiers.length > 0 && (
        <WindowSection label="What they do">
          {/* Label over sentence, not label *inside* sentence. Run together on one paragraph the
              tracked uppercase and the body face fight each other and every entry sets to a
              different number of lines; stacked, each rule is three lines at one leading and the
              list reads as a list. */}
          <ul className="flex flex-col gap-2">
            {unit.modifiers.map((modifier) => (
              <li key={modifier.label}>
                <span className="block font-display text-[11px] font-bold uppercase leading-snug tracking-[0.14em] text-verdigris-100">
                  {modifier.label}
                </span>
                <span className="block font-body text-[13px] leading-snug text-ink-100">
                  {modifier.description}
                </span>
                <span className="block font-display text-[11px] uppercase leading-snug tracking-[0.1em] text-ink-300">
                  {modifier.when}
                </span>
              </li>
            ))}
          </ul>
        </WindowSection>
      )}

      {unit.affinities.length > 0 && (
        <WindowSection label="Ground they notice">
          <ul className="flex flex-col">
            {unit.affinities.map((affinity) => (
              <li
                key={affinity.id}
                className={cn(
                  'font-display text-[12px] uppercase leading-relaxed tracking-[0.1em]',
                  affinity.good ? 'text-verdigris-100' : 'text-oxblood-300',
                )}
              >
                {affinity.label} <span className="tabular-nums opacity-80">{affinity.note}</span>
              </li>
            ))}
          </ul>
        </WindowSection>
      )}
    </InfoWindow>
  );
}

/**
 * A unit modifier, AMBUSH, BREACHER, whatever this one does, opened as a window.
 *
 * It was a `DescribedTag`, which is the small tooltip: a heading, two lines and out. That is the
 * right shape for a trait on a recruit card and the wrong one here, because a modifier is a *rule*,
 * a condition and an effect, and the board asked for these specifically. The window gives the
 * two halves their own labelled sections, so "when does this happen" and "what does it do" stop
 * being one run-on sentence a player has to parse.
 *
 * Same hover contract as everything else: `HoverCard` at `size="window"`, with the frame drawn by
 * `InfoWindow` rather than by the card.
 */
/**
 * A rule, which is not a modifier and must not look like one.
 *
 * `taunts` and `mends` change what *happens* rather than what a number is, and a player who reads
 * `SHIELD LINE` in the same verdigris chip as `CLOSE QUARTERS` will file it as another +25%. Brass,
 * which is the chrome the interface already uses for "this is a mechanism", and always first in the
 * row: a rule outranks a percentage when there is only room for two marks.
 */
function RuleTag({ rule, unit }: { rule: UnitOption['rules'][number]; unit: string }) {
  return (
    <HoverCard
      label={rule.label}
      size="window"
      card={
        <InfoWindow
          eyebrow={unit}
          title={rule.label}
          tone="brass"
          icon={<Icon name="spark" className="h-full w-full text-surface-950" />}
        >
          <WindowSection label="What it does">
            <p className="font-body text-[14px] leading-relaxed text-ink-100">{rule.description}</p>
          </WindowSection>
        </InfoWindow>
      }
    >
      <span className="flex h-5 items-center whitespace-nowrap rounded-sm border border-brass-300/70 bg-brass-300/20 px-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-brass-100">
        {rule.label}
      </span>
    </HoverCard>
  );
}

function ModifierTag({
  modifier,
  unit,
}: {
  modifier: UnitOption['modifiers'][number];
  unit: string;
}) {
  return (
    <HoverCard
      label={modifier.label}
      size="window"
      card={
        <InfoWindow
          eyebrow={unit}
          title={modifier.label}
          tone="verdigris"
          icon={<Icon name="spark" className="h-full w-full text-surface-950" />}
        >
          <WindowSection label="When it happens">
            <p className="font-body text-[14px] leading-relaxed text-ink-100">{modifier.when}</p>
          </WindowSection>
          <WindowSection label="What it does">
            <p className="font-body text-[14px] leading-relaxed text-ink-200">
              {modifier.description}
            </p>
          </WindowSection>
        </InfoWindow>
      }
    >
      <span className="flex h-5 items-center whitespace-nowrap rounded-sm border border-verdigris-500/60 bg-verdigris-700/25 px-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.08em] text-verdigris-100">
        {modifier.label}
      </span>
    </HoverCard>
  );
}
