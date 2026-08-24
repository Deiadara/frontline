import {
  BUILDING_CATALOG,
  MAX_TRAINING_QUEUE,
  UNIT_STAT_KEYS,
  UNIT_STAT_EXPLAINERS,
  UNIT_STAT_LABELS,
  UNIT_TIERS,
  UNIT_TIER_LABELS,
  findUnit,
  trainingProgressAt,
  trainingRemainingMs,
  type UnitOption,
  type UnitTier,
} from '@frontline/shared';
import { useState } from 'react';
import { CostLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { InfoWindow, WindowSection } from '../../components/ui/InfoWindow';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { useMe, useTrainUnits, useUnits } from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { UnitPortrait } from './UnitPortrait';
import { InfoNote, PageShell } from '../game/PageShell';

/**
 * The roster (GDD §A5): what this crew can field, what it has, and what is on the bench.
 *
 * The whole catalogue is shown, locked entries included, with the clauses each one is still
 * waiting on. A list that hid what you cannot build yet would hide the campaign — the point of a
 * Colossus needing a war machine graveyard is that you can see it needs one.
 */
export function UnitsPage() {
  const me = useMe();
  const query = useUnits();
  const train = useTrainUnits(me.data?.base?.id);
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
      <InfoNote tone="warn">
        Supply is a hard ceiling. Go over it and nothing new trains. The Quarters is what raises it.
        Units are also gated by the structures that authorise them, so a locked card is telling you
        what to build, not what to buy.
      </InfoNote>

      <div>
        <p className="font-display text-[11px] tracking-[0.24em] text-brass-300">
          // THE GAUNTLET //
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            data-testid="supply"
            className={cn(
              'border px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.16em] tabular-nums',
              overSupply
                ? 'border-oxblood-500/50 text-oxblood-300'
                : 'border-surface-600 text-ink-200',
            )}
          >
            Supply {data.supplyUsed} / {data.supplyCap}
          </span>
          {data.trainingCostReduction > 0 && <Tag label={`-${data.trainingCostReduction}% cost`} />}
          {data.trainingSpeedBonus > 0 && (
            <Tag label={`-${data.trainingSpeedBonus}% training time`} />
          )}
        </div>
      </div>

      {/* The roster gets the room; the bench sits beside it in its own rail. Above the fold and
          out of the way: what is being trained right now is a thing you glance at between clicks,
          and a strip across the top pushes the actual roster down the page to say it. */}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
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

          <div className="grid gap-4 lg:grid-cols-2" data-testid="unit-catalogue">
            {shown.map((unit) => (
              <UnitCard
                key={unit.id}
                unit={unit}
                resources={data.resources}
                garrisoned={data.garrisoned[unit.id] ?? 0}
                pending={train.isPending}
                onTrain={(count) => train.mutate({ unitId: unit.id, count })}
              />
            ))}
          </div>
        </div>

        <div className="xl:sticky xl:top-0">
          <Panel title={`On the bench (${data.queue.length} / ${MAX_TRAINING_QUEUE})`}>
            {data.queue.length === 0 ? (
              <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
                Nobody on the bench. Pick somebody from the roster.
              </p>
            ) : (
              <ol
                className="flex flex-col divide-y divide-surface-700"
                data-testid="training-queue"
              >
                {data.queue.map((order, index) => (
                  <li key={order.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <span className="truncate font-display text-[12px] uppercase tracking-[0.16em] text-ink-200">
                      {index + 1}. {order.count}× {findUnit(order.unitId)?.name ?? order.unitId}
                    </span>
                    {/* Only the head of the bench is actually running; the rest are queued behind
                        it, which the tone says without a second label. */}
                    <ProgressBar
                      progress={trainingProgressAt(order, now)}
                      label={`${order.count}× ${findUnit(order.unitId)?.name ?? order.unitId}`}
                      remaining={formatRemaining(trainingRemainingMs(order, now))}
                      tone={index === 0 ? 'brass' : 'iris'}
                    />
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}

interface UnitCardProps {
  unit: UnitOption;
  resources: Parameters<typeof CostLine>[0]['stock'];
  garrisoned: number;
  pending: boolean;
  onTrain: (count: number) => void;
}

/**
 * A roster card, laid out the way a player reads one.
 *
 * Three columns. The portrait takes the left one outright and runs the full height of the block, so
 * the art is big enough to actually see: at the old 56px it was a thumbnail beside a heading, which
 * is the least useful size a character portrait can be. Stats take the right two, in taller columns
 * rather than wider ones, because a stat line is a label and a number and reads better stacked than
 * strung out. The modifiers, the price and the Train control sit under the stats, still in the right
 * two thirds, so everything you *do* to a unit is in one place. The blurb runs along the bottom
 * across all three, where prose has room for a full measure.
 */
function UnitCard({ unit, resources, garrisoned, pending, onTrain }: UnitCardProps) {
  const [count, setCount] = useState(1);

  return (
    <section
      data-testid={`unit-${unit.id}`}
      className={cn(
        'painted washed rivets edge-lit relative flex flex-col gap-3 rounded-sm border p-4',
        unit.unlocked
          ? 'border-surface-600/70 bg-surface-800/60'
          : 'border-surface-700 bg-surface-900/70 opacity-70',
      )}
    >
      <div className="grid grid-cols-3 gap-4">
        {/* Left third: the portrait, and under it the things that are true about this unit
            wherever you send it. Stacked rather than wrapped in a row beside the stats — one per
            line reads as a list of properties, and a wrapping row of two-word chips reads as
            leftovers. */}
        <div className="col-span-1 flex min-w-0 flex-col gap-2">
          <UnitPortrait
            unitId={unit.id}
            tier={unit.tier}
            className="w-full rounded-sm border-2 border-surface-600/80 shadow-lifted"
          />
          {unit.modifiers.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {unit.modifiers.map((modifier) => (
                <li key={modifier.label}>
                  <ModifierTag modifier={modifier} unit={unit.name} />
                </li>
              ))}
            </ul>
          )}
          {/* §A4 — the ground this one is unusually good or bad in.
              
              Only where the sheet does not already say it: a Juggernaut's misery in the heat is
              legible from its armour, and the line worth printing is the one that is a surprise —
              Anodics fighting *better* in a room full of noise. Coloured for direction, so the
              card answers "where do I send these" before a word is read. */}
          {unit.affinities.length > 0 && (
            <ul className="flex flex-wrap gap-1" data-testid={`affinities-${unit.id}`}>
              {unit.affinities.map((affinity) => (
                <li key={affinity.id}>
                  <span
                    title={`${affinity.label}: ${affinity.note}`}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm border px-1.5 py-px',
                      'font-display text-[10px] uppercase tracking-[0.1em]',
                      affinity.good
                        ? 'border-verdigris-500/60 bg-verdigris-700/20 text-verdigris-100'
                        : 'border-oxblood-500/60 bg-oxblood-500/10 text-oxblood-300',
                    )}
                  >
                    {affinity.label}
                    <span className="tabular-nums opacity-80">{affinity.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right two thirds: who they are, what they do, and what it costs to field them. */}
        <div className="col-span-2 flex min-w-0 flex-col gap-3">
          <header className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-lg font-bold tracking-[0.06em] text-ink-100">
                {unit.name}
              </h3>
              <p className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-300">
                {UNIT_TIER_LABELS[unit.tier]} · {BUILDING_CATALOG[unit.trainedAt].name} ·{' '}
                {unit.supply} supply
              </p>
            </div>
            <span className="shrink-0 rounded-sm border border-surface-600 bg-surface-900/70 px-2.5 py-1 font-display text-[13px] font-bold uppercase tracking-[0.12em] tabular-nums text-ink-100">
              {unit.owned}
              {garrisoned > 0 && ` +${garrisoned} out`}
            </span>
          </header>

          {/* Two columns, not three: a stat is a short label and a short number, and the pair reads
              as a pair when it is not stretched across a third of the card. */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-y border-surface-600/60 py-3">
            {UNIT_STAT_KEYS.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-2">
                {/* Hover explains the stat, not the value: eleven one-word labels are a spec sheet
                    until somebody says what Evasion is for. */}
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
                    <span className="truncate font-display text-[12px] uppercase tracking-[0.08em] text-ink-200 underline decoration-surface-600 decoration-dotted underline-offset-4">
                      {UNIT_STAT_LABELS[key]}
                    </span>
                  </HoverCard>
                </dt>
                <dd className="font-display text-[15px] font-bold tabular-nums text-ink-100">
                  {unit.stats[key]}
                </dd>
              </div>
            ))}
          </dl>

          {unit.unlocked ? (
            /* Centred under the stat table rather than left-aligned under its first column: the
               price and the button are about the whole unit, not about the left half of it, and
               the board asked for them square in the middle of the two columns. */
            <div className="mt-auto flex flex-col items-center gap-2.5 self-center rounded-sm border border-brass-500/35 bg-surface-900/55 px-4 py-3">
              <CostLine cost={unit.cost} stock={resources} />
              <div className="flex items-center gap-2.5">
                <label className="sr-only" htmlFor={`count-${unit.id}`}>
                  How many {unit.name}
                </label>
                <input
                  id={`count-${unit.id}`}
                  type="number"
                  min={1}
                  max={unit.unique ? 1 : 50}
                  inputMode="numeric"
                  value={count}
                  onChange={(event) =>
                    setCount(Math.max(1, Math.trunc(Number(event.target.value))))
                  }
                  className="w-16 rounded-sm border border-surface-600 bg-surface-950 px-2 py-1.5 text-center font-display text-[14px] font-bold tabular-nums text-ink-100"
                />
                <Button size="sm" disabled={pending} onClick={() => onTrain(count)}>
                  {pending ? 'Working…' : 'Train'}
                </Button>
                <span className="font-display text-[12px] tabular-nums text-ink-200">
                  {formatDuration(unit.trainSeconds)} each
                </span>
              </div>
            </div>
          ) : (
            /* Same slot, same shape, same place on the card as the Train block above.
               A locked unit used to put its clauses in a differently-sized box that floated
               wherever the shorter content left it, so two cards side by side had their controls on
               different lines and the eye had to re-find the row on every card. What changes when
               a unit is locked is the *content* of the block, not where the block is. */
            <div className="mt-auto flex flex-col items-center gap-2 self-center rounded-sm border border-oxblood-500/40 bg-oxblood-500/10 px-4 py-3">
              <p className="font-display text-[11px] font-bold uppercase tracking-[0.2em] text-oxblood-300">
                Still waiting on
              </p>
              <ul className="flex flex-col items-center gap-1">
                {unit.missing.map((clause) => (
                  <li
                    key={clause}
                    className="text-center font-display text-[12px] uppercase tracking-[0.12em] text-oxblood-300"
                  >
                    {clause}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Full measure, along the bottom, in its own box. The prose is the one thing on the card
          that is not a number, so it is given a surface of its own rather than being left to float
          under the table as an afterthought. */}
      <p className="rounded-sm border-l-2 border-iris-300/60 bg-iris-500/10 px-3.5 py-2.5 font-body text-[14px] leading-relaxed text-ink-100">
        {unit.blurb}
      </p>
    </section>
  );
}

/**
 * A unit modifier — AMBUSH, BREACHER, whatever this one does — opened as a window.
 *
 * It was a `DescribedTag`, which is the small tooltip: a heading, two lines and out. That is the
 * right shape for a trait on a recruit card and the wrong one here, because a modifier is a *rule*
 * — a condition and an effect — and the board asked for these specifically. The window gives the
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
      className="w-full"
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
      <span className="inline-flex w-full items-center justify-center border border-verdigris-500/60 bg-verdigris-700/25 px-2 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-verdigris-100">
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
