import {
  findUnit,
  meetsNotoriety,
  notorietyTier,
  notorietyToField,
  type Army,
  type BattleView,
  type UnitOption,
  type UnitsResponse,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { ApiRequestError } from '../../lib/api';
import { NumberField } from '../../components/ui/NumberField';
import { cn } from '../../lib/cn';
import { useUnits } from '../../lib/queries';
import { UnitCard } from '../units/UnitCard';

/**
 * Moving people to a fight that has not happened yet (GDD §A4).
 *
 * One column, and which one is the button's question rather than this dialog's: **the line** is the
 * battle army, **the ring** is the cordon outside it. They used to be two steppers on one row,
 * which put the whole decision in front of a player who had pressed a button that already said
 * where they were going, and gave every unit two identical fields to tell apart.
 *
 * Everything here is a **delta**, so the same dialog sends people and pulls them back. A negative
 * number is a withdrawal, and a withdrawal past a ring the other side has already set costs bodies,
 * which is why the numbers already on the ground are shown rather than assumed to be zero.
 */

/** Which of the two places outside the district this dialog moves people to. */
export type DeployMode = 'line' | 'ring';

interface ModeCopy {
  /** What this window is, over the name of the fight. */
  eyebrow: string;
  intro: string;
  /** How the row says where a unit already is. */
  where: string;
  confirm: string;
  /** What the field is called, for anyone who cannot see the row it sits in. */
  field: (unitName: string) => string;
  testId: (unitId: string) => string;
}

const COPY: Record<DeployMode, ModeCopy> = {
  line: {
    eyebrow: 'The line',
    intro:
      'A positive number sends units out; a negative one calls them home. Nothing is locked in until the mark.',
    where: 'in the line',
    confirm: 'Move them',
    field: (unitName) => `${unitName} into the line`,
    testId: (unitId) => `line-${unitId}`,
  },
  ring: {
    eyebrow: 'The ring',
    intro:
      'The ring is the cordon thrown around the fight. It never takes part, it only stops the losing side walking away afterwards, so every body on it is a body not helping you win. A withdrawal past a ring the other side has already set costs bodies. Positive sends them out, negative calls them home.',
    where: 'on the ring',
    confirm: 'Station them',
    field: (unitName) => `${unitName} onto the ring`,
    testId: (unitId) => `ring-${unitId}`,
  },
};

interface DeployDialogProps {
  view: BattleView;
  army: Army;
  /** §D7: the crew's rank, which is what decides who will take a contract. */
  notoriety: number;
  mode: DeployMode;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (changes: Record<string, number>, perimeterChanges: Record<string, number>) => void;
}

export function DeployDialog({
  view,
  army,
  notoriety,
  mode,
  pending,
  error,
  onClose,
  onConfirm,
}: DeployDialogProps) {
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const copy = COPY[mode];

  /*
   * The roster, for the card a name opens.
   *
   * `BattleView` carries counts and nothing else: the stats, marks and portrait a player wants
   * before committing anybody live on `UnitOption`, which only `/units` returns. It is a warm
   * cache by the time anybody reaches a fight (`usePrefetchScreens` reads it at login), and where
   * it is not, the name is drawn without a card rather than the dialog waiting on it.
   */
  const roster = useUnits();
  const options = new Map((roster.data?.units ?? []).map((option) => [option.id, option]));

  const alreadyThere = (mode === 'line' ? view.muster?.army : view.muster?.perimeter) ?? {};
  const onGround = view.muster?.army ?? {};
  const onRing = view.muster?.perimeter ?? {};

  // Every unit the crew can put anywhere: at home, already in the line, or already on the ring.
  // Both places, in both modes: a unit standing on the ring is one this crew owns and can pull
  // back into the line, so hiding it from the line's dialog would hide the move.
  const ids = [
    ...new Set([...Object.keys(army), ...Object.keys(onGround), ...Object.keys(onRing)]),
  ];
  const rows = ids
    .flatMap((unitId) => {
      const unit = findUnit(unitId);
      return unit ? [unit] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const moved = Object.values(deltas).reduce((total, delta) => total + Math.abs(delta), 0);

  return (
    <Modal
      onClose={onClose}
      labelledBy="deploy-title"
      size="wide"
      className="border-brass-500/30"
      data-testid={mode === 'line' ? 'deploy-dialog' : 'perimeter-dialog'}
    >
      <div className="flex shrink-0 flex-col gap-1 border-b border-surface-700 px-5 py-4">
        <span className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
          {copy.eyebrow}
        </span>
        <h2
          id="deploy-title"
          className="font-display text-lg font-bold tracking-[0.1em] text-ink-100"
        >
          {view.targetName}
        </h2>
        <p className="font-body text-xs leading-relaxed text-ink-300">{copy.intro}</p>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5" data-testid="deploy-rows">
        {rows.length === 0 ? (
          <p className="font-body text-xs leading-relaxed text-ink-300">
            You have nobody to send. Train units at the Gauntlet first.
          </p>
        ) : (
          rows.map((unit) => {
            const atHome = army[unit.id] ?? 0;
            const gate = notorietyToField(unit.id);
            const locked = !meetsNotoriety(notoriety, gate);
            const min = -(alreadyThere[unit.id] ?? 0);
            const value = deltas[unit.id] ?? 0;
            const set = (next: number) =>
              setDeltas((current) => ({ ...current, [unit.id]: clamp(next, min, atHome) }));
            return (
              <div
                key={unit.id}
                data-testid={`deploy-${unit.id}`}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 border p-2',
                  locked ? 'border-oxblood-500/40 bg-oxblood-300/5' : 'border-surface-700',
                )}
              >
                <span className="min-w-0 flex-1">
                  <UnitName unit={unit.name} option={options.get(unit.id)} roster={roster.data} />
                  <span className="block font-body text-[11px] text-ink-300">
                    {locked
                      ? `Will not sign for a crew under ${notorietyTier(gate)}`
                      : `${atHome} at home · ${alreadyThere[unit.id] ?? 0} ${copy.where}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {/* Half and all, because the stepper is one body a press and a crew that has
                      forty Razors at home is not going to press it forty times. Half rounds down
                      and never lands on nothing: with anybody at home at all, half of them is at
                      least one. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked || atHome < 1}
                    onClick={() => set(halfOf(atHome))}
                    data-testid={`deploy-half-${unit.id}`}
                    title={`Half of what is at home: ${halfOf(atHome)}`}
                  >
                    Half
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked || atHome < 1}
                    onClick={() => set(atHome)}
                    data-testid={`deploy-max-${unit.id}`}
                    title={`Everybody at home: ${atHome}`}
                  >
                    Max
                  </Button>
                  <NumberField
                    label={copy.field(unit.name)}
                    min={min}
                    max={atHome}
                    value={value}
                    disabled={locked}
                    onChange={set}
                    data-testid={copy.testId(unit.id)}
                  />
                </span>
              </div>
            );
          })
        )}

        {error !== null && error !== undefined && (
          <p role="alert" className="font-body text-xs leading-relaxed text-oxblood-300">
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-surface-700 px-5 py-4">
        <span className="flex gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={moved === 0 || pending}
            onClick={() => onConfirm(mode === 'line' ? deltas : {}, mode === 'line' ? {} : deltas)}
            data-testid="deploy-confirm"
          >
            {pending ? 'Working…' : copy.confirm}
          </Button>
        </span>
      </footer>
    </Modal>
  );
}

/** Half of what is at home, rounded down, and never nothing while anybody is there to send. */
function halfOf(atHome: number): number {
  return atHome > 0 ? Math.max(1, Math.floor(atHome / 2)) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The unit's name, and the whole roster card behind it.
 *
 * Deciding who to send is the one moment a player needs a unit's sheet most, and until now this
 * dialog was a list of names with two number fields against each: nothing on the screen said which
 * of them shoot through cover or which of them die to it. The card is the roster's own card, the
 * component rather than a redrawing of it, so the two cannot say different things.
 *
 * Without a roster in the cache the name is plain text. A trigger that opens an empty card is worse
 * than no trigger, and this window's own job does not depend on the read.
 */
function UnitName({
  unit,
  option,
  roster,
}: {
  unit: string;
  option: UnitOption | undefined;
  roster: UnitsResponse | undefined;
}) {
  const name = (
    <span className="block truncate font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
      {unit}
    </span>
  );
  if (!option || !roster) return name;
  return (
    <HoverCard
      label={unit}
      size="card"
      className="w-full min-w-0"
      card={
        <UnitCard
          unit={option}
          built={roster.built}
          garrisoned={roster.garrisoned[option.id] ?? 0}
          abroad={roster.abroad[option.id] ?? 0}
        />
      }
    >
      {name}
    </HoverCard>
  );
}
