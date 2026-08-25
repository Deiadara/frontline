import {
  BUILDING_CATALOG,
  MAX_TRAINING_QUEUE,
  UNIT_STAT_KEYS,
  UNIT_STAT_EXPLAINERS,
  UNIT_STAT_LABELS,
  UNIT_TIERS,
  UNIT_TIER_LABELS,
  TRAINING_CANCEL_REFUND,
  TRAINING_MAX_BATCH,
  findUnit,
  maxTrainable,
  trainingBatchProgress,
  trainingCancelWindowMs,
  trainingCancellable,
  type TrainingOrder,
  type UnitOption,
  type UnitTier,
} from '@frontline/shared';
import { useState } from 'react';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { NumberField } from '../../components/ui/NumberField';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
import { cn } from '../../lib/cn';
import { useCancelTraining, useMe, useTrainUnits, useUnits } from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { UnitPortrait } from './UnitPortrait';
import { PageShell } from '../game/PageShell';

/**
 * The roster (GDD §A5): what this crew can field, what it has, and what is on the bench.
 *
 * The whole catalogue is shown, locked entries included, with the clauses each one is still
 * waiting on. A list that hid what you cannot build yet would hide the campaign: the point of a
 * Colossus needing a war machine graveyard is that you can see it needs one.
 */
export function UnitsPage() {
  const me = useMe();
  const query = useUnits();
  const train = useTrainUnits(me.data?.base?.id);
  const cancel = useCancelTraining(me.data?.base?.id);
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const [tier, setTier] = useState<UnitTier>('rabble');

  const data = query.data;
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Counting heads…
        </p>
      </div>
    );
  }

  const shown = data.units.filter((unit) => unit.tier === tier);
  const overSupply = data.supplyUsed >= data.supplyCap;

  return (
    <PageShell title="It's the suffering that brings us together." icon="units" wide>
      {/* The standing rule about supply used to be a paragraph pinned above the roster, read once
          and then in the way forever. It is on the figure it describes now: the number is the thing
          a player looks at, and the explanation belongs where they are already looking. */}
      <div className="flex flex-wrap items-center gap-2">
        <HoverCard
          data-testid="supply"
          size="window"
          label={`Population: ${data.supplyUsed} of ${data.supplyCap}`}
          card={
            <InfoWindow
              eyebrow="The district"
              title="Population"
              tone={overSupply ? 'oxblood' : 'brass'}
              icon={<Icon name="population" className="h-full w-full text-brass-300" />}
              figure={
                <span className="font-display text-2xl font-bold tabular-nums text-ink-100">
                  {data.supplyUsed} / {data.supplyCap}
                </span>
              }
            >
              <p className="font-body text-[14px] leading-relaxed text-ink-100">
                A hard ceiling, and it is the whole district: officers and assignees sleep in the
                same beds your soldiers do. Go over it and nothing new trains.
              </p>
              <WindowSection label="What raises it">
                <p className="font-body text-[13px] leading-snug text-ink-100">
                  The Quarters, the Cistern, and every location you hold out in the city.
                </p>
              </WindowSection>
            </InfoWindow>
          }
        >
          <span
            className={cn(
              'flex items-center gap-2 rounded-sm border px-2.5 py-1',
              'font-display text-[12px] uppercase tracking-[0.14em] tabular-nums',
              overSupply
                ? 'border-oxblood-500/60 bg-oxblood-500/10 text-oxblood-300'
                : 'border-surface-600 bg-surface-800/70 text-ink-200',
            )}
          >
            <Icon name="population" aria-hidden className="h-4 w-4" />
            {data.supplyUsed} / {data.supplyCap}
          </span>
        </HoverCard>
        {data.trainingCostReduction > 0 && <Tag label={`-${data.trainingCostReduction}% cost`} />}
        {data.trainingSpeedBonus > 0 && (
          <Tag label={`-${data.trainingSpeedBonus}% training time`} />
        )}
      </div>

      {/* The bench, across the top, under a rule of its own.

          It used to be a 20rem rail down the right-hand side, which is a fifth of the screen spent
          permanently on two progress bars and, worse, a fifth taken off the roster: the cards had
          to carry a portrait, a twelve-row sheet and a price in what was left, at every width. A
          strip costs one row of height when there is something on it, and gives the roster the
          whole frame. */}
      <section data-testid="bench" className="flex min-w-0 flex-col gap-2">
        <header className="flex items-baseline gap-3">
          <h2 className="font-stamp text-[17px] leading-none text-brass-100">On the bench</h2>
          <span className="font-display text-[12px] uppercase tracking-[0.16em] tabular-nums text-ink-300">
            {data.queue.length} / {MAX_TRAINING_QUEUE}
          </span>
        </header>

        {data.queue.length === 0 ? (
          <p className="font-body text-[13px] leading-snug text-ink-300">
            Nobody on the bench. Pick somebody from the roster.
          </p>
        ) : (
          <ol
            className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="training-queue"
          >
            {data.queue.map((order, index) => (
              <BenchRow
                key={order.id}
                order={order}
                now={now}
                head={index === 0}
                pending={cancel.isPending}
                onCancel={() => cancel.mutate({ orderId: order.id })}
              />
            ))}
          </ol>
        )}
      </section>

      {/* The second rule the board asked for: the bench is a different kind of thing from the
          roster under it, and a hand-drawn line is what the rest of this interface uses to say so. */}
      <span aria-hidden className="ink-rule -my-1" />

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {UNIT_TIERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTier(option)}
              className={cn(
                'border px-3 py-1.5 font-display text-[11px] uppercase tracking-[0.18em] transition-colors',
                option === tier
                  ? 'border-brass-300 text-brass-300'
                  : 'border-surface-600 text-ink-300 hover:border-surface-500',
              )}
            >
              {UNIT_TIER_LABELS[option]}
            </button>
          ))}
        </div>

        {/* Two cards to a row from 1280 up, one below it. The card is a fixed height and the
            portrait is that height at 3:4, so a *narrower* card is one where the picture takes a
            bigger share of it: at 1024 two-up the portrait was 54% of the card and the sheet beside
            it was being squeezed for the picture's sake. One card to a row there instead. */}
        <div className="grid gap-4 xl:grid-cols-2" data-testid="unit-catalogue">
          {shown.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              resources={data.resources}
              garrisoned={data.garrisoned[unit.id] ?? 0}
              abroad={data.abroad[unit.id] ?? 0}
              spare={Math.max(0, data.supplyCap - data.supplyUsed)}
              discountPercent={data.trainingCostReduction}
              pending={train.isPending}
              onTrain={(count) => train.mutate({ unitId: unit.id, count })}
            />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

interface UnitCardProps {
  unit: UnitOption;
  resources: Parameters<typeof CostLine>[0]['stock'];
  garrisoned: number;
  /** §A4: at a fight or walking to one. Away like a garrison, and counted in the same beds. */
  abroad: number;
  /** Beds left in the district, so **Max** can only offer a batch that will fit in them. */
  spare: number;
  /** §F2, folded in for the same reason: the price Max works against is the price charged. */
  discountPercent: number;
  pending: boolean;
  onTrain: (count: number) => void;
}

/**
 * One batch on the bench.
 *
 * Smaller than the bar it replaced, and about a different thing. A bar across the whole order was
 * right while a batch landed in a lump; they arrive one at a time now, so what a player wants is
 * how many are already theirs and how long until the next one. The bar tracks the *next body*, not
 * the order, which is why it fills and resets rather than creeping once across seven minutes.
 */
function BenchRow({
  order,
  now,
  head,
  pending,
  onCancel,
}: {
  order: TrainingOrder;
  now: Date;
  /** The only order actually running; the rest are queued behind it. */
  head: boolean;
  pending: boolean;
  onCancel: () => void;
}) {
  const unit = findUnit(order.unitId);
  const { done, total, nextMs, nextProgress } = trainingBatchProgress(order, now);
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate font-display text-[11px] uppercase tracking-[0.1em] text-ink-200">
            {unit?.name ?? order.unitId}
          </span>
          <span className="shrink-0 font-display text-[11px] tabular-nums text-ink-300">
            {done} / {total}
            <span className="ml-1.5 text-brass-300">{formatRemaining(nextMs)}</span>
          </span>
        </span>
        <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-sm bg-surface-800">
          <span
            className={cn('block h-full rounded-sm', head ? 'bg-brass-300' : 'bg-iris-300')}
            style={{ width: `${Math.round(nextProgress * 100)}%` }}
          />
        </span>
      </span>
      {/* §A5: the window is a tenth of the batch's own clock and shuts the moment the first body
          walks out, so it is there and gone. Drawn only while it is open rather than disabled: a
          control that is dead almost all the time is a control a player stops looking at. */}
      {trainingCancellable(order, now) && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={onCancel}
          data-testid={`cancel-${order.id}`}
          title={`Call it off: ${Math.round(TRAINING_CANCEL_REFUND * 100)}% back, ${formatRemaining(trainingCancelWindowMs(order, now))} left to decide`}
        >
          Cancel
        </Button>
      )}
    </li>
  );
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
function UnitCard({
  unit,
  resources,
  garrisoned,
  abroad,
  spare,
  discountPercent,
  pending,
  onTrain,
}: UnitCardProps) {
  const [count, setCount] = useState(1);
  const spec = findUnit(unit.id);
  const most = spec ? maxTrainable(spec, resources, spare, discountPercent) : 0;

  return (
    <section
      data-testid={`unit-${unit.id}`}
      className={cn(
        // The frame, and its height is the whole mechanism: see the portrait below. A step
        // shorter until 1440, where two cards to a row leaves each one narrow enough that a
        // 23rem picture would be nearly half of it.
        'card-paper washed rivets edge-lit relative flex h-[19rem] gap-3 rounded-sm border p-3',
        '[@media(min-width:1440px)]:h-[23rem]',
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
            <span className="text-brass-300" title={`${garrisoned} on held ground`}>
              {' '}
              +{garrisoned}
            </span>
          )}
          {abroad > 0 && (
            <span className="text-tangerine-300" title={`${abroad} at a fight`}>
              {' '}
              +{abroad}
            </span>
          )}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        {/* Row 1. The name is the door to everything that used to be printed on the card. */}
        <header className="min-w-0">
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
        </header>

        {/* Row 2. Always twelve rows, so the box under it never moves. */}
        <dl className="grid grid-cols-2 gap-x-5 gap-y-1 border-y border-surface-600/50 py-2.5">
          {UNIT_STAT_KEYS.map((key) => (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <dt className="min-w-0">
                <HoverCard
                  label={UNIT_STAT_LABELS[key]}
                  card={
                    <div className="flex flex-col gap-1.5">
                      <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
                        {UNIT_STAT_LABELS[key]}
                      </p>
                      <p className="font-body text-[13px] leading-relaxed text-ink-100">
                        {UNIT_STAT_EXPLAINERS[key]}
                      </p>
                    </div>
                  }
                >
                  <span className="truncate font-display text-[11px] uppercase tracking-[0.08em] text-ink-300">
                    {UNIT_STAT_LABELS[key]}
                  </span>
                </HoverCard>
              </dt>
              <dd className="font-display text-[14px] font-bold tabular-nums text-ink-100">
                {unit.stats[key]}
              </dd>
            </div>
          ))}
        </dl>

        {/* Row 3, and the reason the card can promise a fixed height: one line of marks, always
            reserved, never wrapped. What each one means is a hover away. */}
        <Marks unit={unit} />

        {/* Row 4, and a *fixed* height, which is the last thing standing between this grid and the
            cards it used to be. A price line wraps to two lines for a unit that costs three
            materials and stays on one for a unit that costs two, and a locked unit's clause list is
            one line or two depending on how many things are in the way. Any of those makes the
            neighbouring card taller. The box is the same size whatever goes in it and its contents
            are centred in it. */}
        <div className="mt-auto flex h-24 items-stretch" data-testid={`action-${unit.id}`}>
          {unit.unlocked ? (
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
                {/* What the crew can actually pay for and house, worked out by the same function
                    the route's own gates read, so Max can never offer a batch that is then
                    refused. Off entirely for a one-of-a-kind, where the answer is always one. */}
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
          ) : (
            /* The same slot, the same height, the same place on the card. What changes when a unit
               is locked is the content of the box, not where the box is: two clauses at most on the
               face of it and the whole list on hover, so a unit gated on four things is not a card
               eighty pixels taller than its neighbour. */
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
      </div>
    </section>
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

function Marks({ unit }: { unit: UnitOption }) {
  const modifiers = unit.modifiers.slice(0, MARKS_SHOWN);
  const room = MARKS_SHOWN - modifiers.length;
  const affinities = unit.affinities.slice(0, room);
  const hidden =
    unit.modifiers.length - modifiers.length + (unit.affinities.length - affinities.length);

  return (
    <ul
      className="flex h-6 flex-nowrap items-center gap-1 whitespace-nowrap"
      data-testid={`marks-${unit.id}`}
    >
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
      icon={<UnitPortrait unitId={unit.id} tier={unit.tier} fill className="border-0 !bg-none" />}
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

function Tag({ label }: { label: string }) {
  return (
    <span className="border border-surface-600 px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
      {label}
    </span>
  );
}
