import {
  UNIT_MODIFIERS,
  describeCost,
  describeOdds,
  estimatedForce,
  findUnit,
  forecast,
  lootCapacityOf,
  type Army,
  type Battlefield,
} from '@frontline/shared';
import { useMemo, useState } from 'react';
import { ApiRequestError } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';

/**
 * Choosing who goes (GDD §A5).
 *
 * One control per unit type the crew actually has, and a running total of what the selection can
 * carry home — because loot capacity is the one stat that decides a raid before it starts, and a
 * player who has to work it out on paper will not work it out at all.
 *
 * When the ground has been scouted it also **forecasts the fight**, by running the real engine
 * sixty times against what the player knows is there. Two things about that are deliberate: it is
 * the same code the server will run, so the estimate cannot drift from the result; and it is only
 * as good as the scouting, so on ground nobody has looked at there is simply no forecast rather
 * than a confident number built on nothing.
 */

interface ForcePickerProps {
  title: string;
  blurb: string;
  army: Army;
  pending: boolean;
  error: unknown;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (force: Army) => void;
  /** How many are on the ground, if anybody has looked. Absent means unscouted. */
  facingSize?: number;
  /** The ground, if it is known. Absent falls back to open ground.  */
  battlefield?: Battlefield;
}

export function ForcePicker({
  title,
  blurb,
  army,
  pending,
  error,
  confirmLabel,
  onClose,
  onConfirm,
  facingSize,
  battlefield,
}: ForcePickerProps) {
  const [force, setForce] = useState<Army>({});

  const available = Object.entries(army)
    .flatMap(([unitId, count]) => {
      const unit = findUnit(unitId);
      return unit && count > 0 ? [{ unit, count }] : [];
    })
    .sort((a, b) => a.unit.name.localeCompare(b.unit.name));

  const chosen = Object.values(force).reduce((total, count) => total + count, 0);
  const capacity = Math.round(lootCapacityOf(force));

  const set = (unitId: string, value: number, max: number) => {
    const clamped = Math.max(0, Math.min(max, Math.trunc(value)));
    setForce((current) => {
      const next = { ...current };
      if (clamped === 0) delete next[unitId];
      else next[unitId] = clamped;
      return next;
    });
  };

  return (
    <Modal onClose={onClose} labelledBy="force-picker-title" className="border-neon-magenta/30">
      <div className="flex shrink-0 flex-col gap-1 border-b border-neon-magenta/15 px-5 py-4">
        <h2
          id="force-picker-title"
          className="font-display text-lg font-bold tracking-[0.1em] text-steel-100"
        >
          {title}
        </h2>
        <p className="font-body text-xs leading-relaxed text-steel-400">{blurb}</p>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
        {available.length === 0 ? (
          <p className="font-body text-xs leading-relaxed text-steel-500">
            You have nobody to send. Train units at the Gauntlet first.
          </p>
        ) : (
          available.map(({ unit, count }) => (
            <label
              key={unit.id}
              className="flex items-center justify-between gap-3 border border-steel-800 p-2"
            >
              <span className="min-w-0">
                <span className="block font-display text-[11px] uppercase tracking-[0.14em] text-steel-200">
                  {unit.name}
                </span>
                <span className="block font-body text-[11px] text-steel-500">
                  {unit.stats.lootCapacity} kg each ·{' '}
                  {unit.modifiers.map((id) => UNIT_MODIFIERS[id].label).join(', ') ||
                    'no modifiers'}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={count}
                  inputMode="numeric"
                  aria-label={`How many ${unit.name}`}
                  value={force[unit.id] ?? 0}
                  onChange={(event) => set(unit.id, Number(event.target.value), count)}
                  className="w-16 border border-steel-700 bg-night px-2 py-1 font-display text-[11px] tabular-nums text-steel-200"
                />
                <span className="font-display text-[10px] tabular-nums text-steel-500">
                  / {count}
                </span>
              </span>
            </label>
          ))
        )}

        <dl className="flex flex-col divide-y divide-steel-800 border-t border-steel-800 pt-1">
          <Row label="Sending" value={String(chosen)} />
          <Row label="Can carry" value={`${capacity} kg`} />
        </dl>

        <Odds force={force} facingSize={facingSize} battlefield={battlefield} />

        {error !== null && error !== undefined && (
          <p role="alert" className="font-body text-xs leading-relaxed text-neon-magenta">
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-steel-800 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={chosen === 0 || pending}
          onClick={() => onConfirm(force)}
        >
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </footer>
    </Modal>
  );
}

/**
 * The read on the fight, in words rather than percentages.
 *
 * Banded on purpose (`describeOdds`): a player told "62%" treats it as a promise and is angry at
 * the 38%, and the engine hides its multipliers for the same reason. What is shown as a figure is
 * only the sample size, so nobody mistakes the reading for a guarantee.
 */
function Odds({
  force,
  facingSize,
  battlefield,
}: {
  force: Army;
  facingSize: number | undefined;
  battlefield: Battlefield | undefined;
}) {
  const sending = Object.values(force).reduce((total, count) => total + count, 0);
  const read = useMemo(() => {
    if (facingSize === undefined || sending === 0) return null;
    const facing = estimatedForce(facingSize);
    return forecast({
      // Keyed off the plan, so the reading holds still while it is being read and changes only
      // when the player changes the plan.
      seed: JSON.stringify([force, facing]),
      ...(battlefield ? { battlefield } : {}),
      attacker: { name: 'you', army: force, defending: false },
      defender: { name: 'them', army: facing, defending: true },
    });
  }, [force, facingSize, battlefield, sending]);

  if (read === null) {
    return (
      <p
        data-testid="odds-unknown"
        className="border border-dashed border-steel-700 px-3 py-2 font-body text-xs leading-relaxed text-steel-500"
      >
        {facingSize === undefined
          ? 'Nobody has counted what is on this ground. You will find out when you get there.'
          : 'Pick who goes and this will tell you how it looks.'}
      </p>
    );
  }

  return (
    <div
      data-testid="odds"
      className="flex flex-col gap-1 border border-steel-700 bg-night px-3 py-2"
    >
      <p className="font-display text-xs font-semibold tracking-[0.08em] text-neon-cyan">
        {describeOdds(read.winChance)}
      </p>
      <p className="font-body text-xs leading-relaxed text-steel-400">
        {describeCost(read.attackerSurvival)}
      </p>
      <p className="font-display text-[9px] uppercase tracking-[0.16em] text-steel-600">
        {read.runs} runs against {facingSize} bodies. Nobody has seen *who* — this assumes ordinary
        troops.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-steel-500">
        {label}
      </dt>
      <dd className="font-display text-xs font-semibold tabular-nums text-neon-cyan">{value}</dd>
    </div>
  );
}
