import {
  MAX_TRAINING_QUEUE,
  UNIT_TIERS,
  UNIT_TIER_LABELS,
  TRAINING_CANCEL_REFUND,
  findUnit,
  splitDueTraining,
  trainingBatchProgress,
  trainingCancelWindowMs,
  trainingCancellable,
  type TrainingOrder,
  type UnitTier,
} from '@frontline/shared';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { InfoWindow } from '../../components/ui/InfoWindow';
import { cn } from '../../lib/cn';
import { useDeltaMarks } from '../../lib/deltas';
import { useCancelTraining, useMe, useTrainUnits, useUnits } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { UnitCard } from './UnitCard';
import { PageShell } from '../game/PageShell';
import { VehicleCatalogue } from '../garage/VehicleCatalogue';

/**
 * The tabs across the roster: the six tiers, then the machines (board request, 2026-09-08).
 *
 * The Garage's catalogue is a tab here rather than a page of its own because a machine is chosen
 * against the legs of the people who will ride it, and `speed` on a vehicle card is the same 0 to
 * 100 a unit's sheet carries. `vehicles` is not a `UnitTier`: nothing in the domain calls a
 * machine a unit, so the tab is a fact about this screen and stays in it.
 */
type RosterTab = UnitTier | 'vehicles';
const ROSTER_TABS: readonly RosterTab[] = [...UNIT_TIERS, 'vehicles'];
const ROSTER_TAB_LABELS: Record<RosterTab, string> = { ...UNIT_TIER_LABELS, vehicles: 'Vehicles' };

function isRosterTab(value: string | null): value is RosterTab {
  return value !== null && (ROSTER_TABS as readonly string[]).includes(value);
}

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
  /*
   * Carriers first (board request).
   *
   * The tier a player opens this screen to look at is the one that decides whether a mission comes
   * home with the loot it earned, and it was four clicks down the list behind the fighting tiers.
   *
   * The open tab lives in the URL (`?tab=vehicles`), the way the Scrapyard's bench does, so the
   * Garage page can send a player to the machines with a plain link. `replace`, because picking
   * through the tabs is browsing rather than navigating: one press of Back leaves the roster.
   */
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: RosterTab = isRosterTab(requested) ? requested : 'carrier';
  const setTab = (next: RosterTab) => {
    setParams(next === 'carrier' ? {} : { tab: next }, { replace: true });
  };

  const data = query.data;

  /*
   * What the bench *is* right now, not what it was at the last poll.
   *
   * `data.queue` is a snapshot, and the roster only re-reads every `DISTRICT_POLL_MS`, so in
   * between a finished order sat on the bench at `1/1  0s` with a full bar while the next one
   * counted down beneath it. Two orders looked like they were running at once, which is the one
   * thing the queue is meant to say cannot happen.
   *
   * `splitDueTraining` is the function the *server* settles with, so deriving the display from it
   * means the bench shows exactly what the next read is going to leave, and a batch that is
   * part-way through shows its real delivered count instead of a stale one. Same rule in both
   * places, one implementation, which is why it cannot drift.
   */
  const bench = data ? splitDueTraining(data.queue, now).pending : [];
  const settled = data !== undefined && bench.length < data.queue.length;

  /*
   * Somebody walked off the bench since the last read, so their unit is not in the army yet.
   * Re-read now rather than waiting out the poll: without this the roster's count is the one
   * number on screen that is visibly behind, for up to a full interval.
   */
  /* `query.refetch` rather than `query`: the result object is new on every render, so the array
     never matched and the body ran after every one of them. `settled` is derived from a clock that
     ticks every second, so once it flipped true this refetched in a burst until the response
     shrank the bench. `refetch` is a stable reference in react-query v5. */
  const refetchUnits = query.refetch;
  useEffect(() => {
    if (settled) void refetchUnits();
  }, [settled, refetchUnits]);

  /*
   * What each count on the roster just did.
   *
   * Nothing trickles into a unit count, so there is no rate to write off: a body appearing was
   * trained and a body vanishing marched out or died. Above the early return below, because a hook
   * cannot be called conditionally; `useDeltaMarks` announces nothing until it has two readings,
   * so a page that has not loaded yet costs it nothing.
   */
  const owned = useMemo(
    () => Object.fromEntries((data?.units ?? []).map((unit) => [unit.id, unit.owned])),
    [data?.units],
  );
  const mustered = useDeltaMarks(owned);

  if (!data) {
    return (
      <ScreenLoad
        what="Your units"
        loading="Counting heads…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const shown = data.units.filter((unit) => unit.tier === tab);
  const overSupply = data.supplyUsed >= data.supplyCap;

  return (
    <PageShell quote="It's the suffering that brings us together." wide>
      {/* The standing rule about supply used to be a paragraph pinned above the roster, read once
          and then in the way forever. It is on the figure it describes now: the number is the thing
          a player looks at, and the explanation belongs where they are already looking. */}
      <div className="flex flex-wrap items-center gap-2">
        <HoverCard
          data-testid="supply"
          size="window"
          label={`Population: ${data.supplyUsed} of ${data.supplyCap}`}
          // The two figures, and nothing under them. What was here explained what the ceiling
          // counts and which structures raise it, which is a paragraph about a mechanic printed
          // over the number the card was opened to read.
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
            />
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
        {(data.trainingSuppliesReduction ?? 0) > 0 && (
          <Tag label={`-${Math.round(data.trainingSuppliesReduction ?? 0)}% supplies`} />
        )}
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
            {bench.length} / {MAX_TRAINING_QUEUE}
          </span>
        </header>

        {/* §A5: the cancel window is short and shuts the moment the first body walks out, so
            `window_closed` is the refusal a player is most likely to meet. It used to be silent:
            the button un-dimmed, the order stayed, and nothing said why. */}
        {cancel.error && (
          <p role="alert" className="font-body text-[12px] leading-snug text-oxblood-300">
            {cancel.error.message}
          </p>
        )}

        {bench.length === 0 ? (
          <p className="font-body text-[13px] leading-snug text-ink-300">
            Nobody on the bench. Pick somebody from the roster.
          </p>
        ) : (
          <ol
            className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="training-queue"
          >
            {bench.map((order, index) => (
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
          {ROSTER_TABS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTab(option)}
              // The one control on this page a test could not reach: every card, mark row and
              // action box carries a handle and the tier tabs did not, so a check that wanted to
              // look at the Heavy roster had to match the label text through its uppercase CSS.
              data-testid={`tier-${option}`}
              aria-pressed={option === tab}
              className={cn(
                'border px-3 py-1.5 font-display text-[11px] uppercase tracking-[0.18em] transition-colors',
                option === tab
                  ? 'border-brass-300 text-brass-300'
                  : 'border-surface-600 text-ink-300 hover:border-surface-500',
              )}
            >
              {ROSTER_TAB_LABELS[option]}
            </button>
          ))}
        </div>

        {/* Two cards to a row from 1280 up, one below it. The card is a fixed height and the
            portrait is that height at 3:4, so a *narrower* card is one where the picture takes a
            bigger share of it: at 1024 two-up the portrait was 54% of the card and the sheet beside
            it was being squeezed for the picture's sake. One card to a row there instead. */}
        {/* Two to a row only from 1440, which is where the card stops fighting for width.
            At 1280 two cards left each one 590px, and a 408px card with a full-height 3:4
            portrait puts 47% of that into the picture: the sheet beside it is then 271px, which
            is where `Penetration` started crossing its own bar. The roster's own layout gate
            already calls that ratio the defect, in those words. */}
        {/* The count field is bounded by `TRAINING_MAX_BATCH` rather than by what the crew can pay
            for and house (that figure is only the **Max** button's target), so a refused batch is
            an ordinary thing to do rather than an edge case. Named against the unit that was
            pressed, the way the mission board attributes a refused launch. */}
        {train.error && (
          <p role="alert" className="font-body text-[12px] leading-snug text-oxblood-300">
            {findUnit(train.variables?.unitId ?? '')?.name ?? 'That order'}: {train.error.message}
          </p>
        )}

        {tab === 'vehicles' ? (
          <VehicleCatalogue />
        ) : (
          <div
            className="grid gap-4 [@media(min-width:1440px)]:grid-cols-2"
            data-testid="unit-catalogue"
          >
            {shown.map((unit) => (
              <UnitCard
                key={unit.id}
                unit={unit}
                built={data.built}
                garrisoned={data.garrisoned[unit.id] ?? 0}
                abroad={data.abroad[unit.id] ?? 0}
                deltas={mustered[unit.id] ?? []}
                training={{
                  resources: data.resources,
                  spare: Math.max(0, data.supplyCap - data.supplyUsed),
                  // §A4: the crew-wide cut plus what this unit's own ground takes off it, which is
                  // the same sum the training route charges with. Quoting only the crew-wide figure
                  // would have **Max** offering a batch at a price the server does not charge.
                  discountPercent: data.trainingCostReduction + (unit.homeCostReduction ?? 0),
                  suppliesPercent: data.trainingSuppliesReduction ?? 0,
                  pending: train.isPending,
                  onTrain: (count) => train.mutate({ unitId: unit.id, count }),
                }}
              />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
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
          data-tip={`Call it off: ${Math.round(TRAINING_CANCEL_REFUND * 100)}% back, ${formatRemaining(trainingCancelWindowMs(order, now))} left to decide`}
        >
          Cancel
        </Button>
      )}
    </li>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="border border-surface-600 px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
      {label}
    </span>
  );
}
