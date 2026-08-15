import {
  BUILDING_CATALOG,
  MAX_TRAINING_QUEUE,
  UNIT_STAT_KEYS,
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
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useMe, useTrainUnits, useUnits } from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { UnitPortrait } from './UnitPortrait';

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
        <p className="font-display text-xs uppercase tracking-[0.2em] text-steel-500">
          Counting heads…
        </p>
      </div>
    );
  }

  const shown = data.units.filter((unit) => unit.tier === tier);
  const overSupply = data.supplyUsed >= data.supplyCap;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <div>
          <p className="font-display text-[10px] tracking-[0.4em] text-neon-cyan/70">
            // THE GAUNTLET //
          </p>
          <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
            Who you can send
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              data-testid="supply"
              className={cn(
                'border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] tabular-nums',
                overSupply
                  ? 'border-neon-magenta/50 text-neon-magenta'
                  : 'border-steel-700 text-steel-300',
              )}
            >
              Supply {data.supplyUsed} / {data.supplyCap}
            </span>
            {data.trainingCostReduction > 0 && (
              <Tag label={`-${data.trainingCostReduction}% cost`} />
            )}
            {data.trainingSpeedBonus > 0 && (
              <Tag label={`-${data.trainingSpeedBonus}% training time`} />
            )}
          </div>
        </div>

        <Panel title={`On the bench — ${data.queue.length} / ${MAX_TRAINING_QUEUE}`}>
          {data.queue.length === 0 ? (
            <p className="p-4 font-body text-xs leading-relaxed text-steel-500">
              Nothing being trained. Pick somebody below.
            </p>
          ) : (
            <ol className="flex flex-col divide-y divide-steel-800" data-testid="training-queue">
              {data.queue.map((order, index) => (
                <li key={order.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate font-display text-[11px] uppercase tracking-[0.16em] text-steel-200">
                      {index + 1}. {order.count}× {findUnit(order.unitId)?.name ?? order.unitId}
                    </span>
                    <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-neon-cyan">
                      {formatRemaining(trainingRemainingMs(order, now))}
                    </span>
                  </div>
                  <span className="block h-1.5 w-full bg-steel-800">
                    <span
                      className={cn('block h-full', index === 0 ? 'bg-neon-cyan' : 'bg-steel-600')}
                      style={{ width: `${trainingProgressAt(order, now) * 100}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="flex flex-wrap gap-2">
          {UNIT_TIERS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTier(option)}
              className={cn(
                'border px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.18em] transition-colors',
                option === tier
                  ? 'border-neon-cyan text-neon-cyan'
                  : 'border-steel-700 text-steel-400 hover:border-steel-500',
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
    </div>
  );
}

interface UnitCardProps {
  unit: UnitOption;
  resources: Parameters<typeof CostLine>[0]['stock'];
  garrisoned: number;
  pending: boolean;
  onTrain: (count: number) => void;
}

function UnitCard({ unit, resources, garrisoned, pending, onTrain }: UnitCardProps) {
  const [count, setCount] = useState(1);

  return (
    <section
      data-testid={`unit-${unit.id}`}
      className={cn(
        'flex flex-col gap-3 border p-4',
        unit.unlocked ? 'border-steel-800 bg-night-raised' : 'border-steel-900 bg-night opacity-70',
      )}
    >
      <header className="flex items-start gap-3">
        <UnitPortrait unitId={unit.id} tier={unit.tier} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-bold tracking-[0.08em] text-steel-100">
            {unit.name}
          </h3>
          <p className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
            {UNIT_TIER_LABELS[unit.tier]} · {BUILDING_CATALOG[unit.trainedAt].name} · {unit.supply}{' '}
            supply
          </p>
        </div>
        <span className="shrink-0 border border-steel-700 px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.16em] tabular-nums text-steel-300">
          {unit.owned}
          {garrisoned > 0 && ` +${garrisoned} out`}
        </span>
      </header>

      <p className="font-body text-xs leading-relaxed text-steel-400">{unit.blurb}</p>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-1 border-y border-steel-800 py-2">
        {UNIT_STAT_KEYS.map((key) => (
          <div key={key} className="flex items-baseline justify-between gap-1">
            <dt className="truncate font-display text-[9px] uppercase tracking-[0.1em] text-steel-600">
              {UNIT_STAT_LABELS[key]}
            </dt>
            <dd className="font-display text-[11px] tabular-nums text-steel-200">
              {unit.stats[key]}
            </dd>
          </div>
        ))}
      </dl>

      {unit.modifiers.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {unit.modifiers.map((modifier) => (
            <li
              key={modifier.label}
              title={`${modifier.description} (${modifier.when})`}
              className="border border-bile-500/40 px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.14em] text-bile-300"
            >
              {modifier.label}
            </li>
          ))}
        </ul>
      )}

      {unit.unlocked ? (
        <div className="flex flex-col gap-2">
          <CostLine cost={unit.cost} stock={resources} />
          <div className="flex items-center gap-2">
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
              onChange={(event) => setCount(Math.max(1, Math.trunc(Number(event.target.value))))}
              className="w-16 border border-steel-700 bg-night px-2 py-1 font-display text-[11px] tabular-nums text-steel-200"
            />
            <Button size="sm" disabled={pending} onClick={() => onTrain(count)}>
              {pending ? 'Working…' : 'Train'}
            </Button>
            <span className="font-display text-[10px] tabular-nums text-steel-500">
              {formatDuration(unit.trainSeconds)} each
            </span>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {unit.missing.map((clause) => (
            <li
              key={clause}
              className="font-display text-[10px] uppercase tracking-[0.14em] text-neon-magenta/80"
            >
              {clause}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="border border-steel-700 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] text-steel-400">
      {label}
    </span>
  );
}
