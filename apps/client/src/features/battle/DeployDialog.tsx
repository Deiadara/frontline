import { findUnit, infamyToField, type Army, type BattleView } from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';

/**
 * Moving people to a fight that has not happened yet (GDD §A4).
 *
 * Two columns per unit, and the split is the whole decision: **the line** is the battle army, and
 * **the ring** is the perimeter — bodies that stand outside the fight and take down whoever tries to
 * leave it. A body can be in one or the other and the ring never fights, so every unit put on it is
 * a unit not helping you win. That is the trade, and putting the two counts side by side is the
 * only honest way to present it.
 *
 * Everything here is a **delta**, so the same dialog sends people and pulls them back. A negative
 * number is a withdrawal, and a withdrawal past a ring the other side has already set costs bodies
 * — which is why the numbers already on the ground are shown rather than assumed to be zero.
 */

interface DeployDialogProps {
  view: BattleView;
  army: Army;
  infamy: number;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (changes: Record<string, number>, perimeterChanges: Record<string, number>) => void;
}

export function DeployDialog({
  view,
  army,
  infamy,
  pending,
  error,
  onClose,
  onConfirm,
}: DeployDialogProps) {
  const [line, setLine] = useState<Record<string, number>>({});
  const [ring, setRing] = useState<Record<string, number>>({});

  const onGround = view.muster?.army ?? {};
  const onRing = view.muster?.perimeter ?? {};

  // Every unit the crew can put anywhere: at home, already in the line, or already on the ring.
  const ids = [
    ...new Set([...Object.keys(army), ...Object.keys(onGround), ...Object.keys(onRing)]),
  ];
  const rows = ids
    .flatMap((unitId) => {
      const unit = findUnit(unitId);
      return unit ? [unit] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const moved =
    Object.values(line).reduce((total, delta) => total + Math.abs(delta), 0) +
    Object.values(ring).reduce((total, delta) => total + Math.abs(delta), 0);

  return (
    <Modal onClose={onClose} labelledBy="deploy-title" size="wide" className="border-brass-500/30">
      <div className="flex shrink-0 flex-col gap-1 border-b border-surface-700 px-5 py-4">
        <h2
          id="deploy-title"
          className="font-display text-lg font-bold tracking-[0.1em] text-ink-100"
        >
          {view.targetName}
        </h2>
        <p className="font-body text-xs leading-relaxed text-ink-300">
          A positive number sends units out; a negative one calls them home. Nothing is locked in
          until the mark. The ring is the cordon you throw around the fight: it never takes part, it
          only stops the losing side walking away afterwards.
        </p>
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5" data-testid="deploy-rows">
        {/* Two identical number fields side by side are unreadable without saying which is which,
            and the whole decision this dialog exists for is the difference between them. */}
        {rows.length > 0 && (
          <div className="flex items-center justify-end gap-3 pr-2">
            <span className="w-16 text-center font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
              Line
            </span>
            <span className="w-16 text-center font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
              Ring
            </span>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="font-body text-xs leading-relaxed text-ink-300">
            You have nobody to send. Train units at the Gauntlet first.
          </p>
        ) : (
          rows.map((unit) => {
            const atHome = army[unit.id] ?? 0;
            const gate = infamyToField(unit.id);
            const locked = gate > infamy;
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
                  <span className="block font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                    {unit.name}
                  </span>
                  <span className="block font-body text-[11px] text-ink-300">
                    {locked
                      ? `Needs ${gate} infamy before they will sign`
                      : `${atHome} at home · ${onGround[unit.id] ?? 0} in the line · ${onRing[unit.id] ?? 0} on the ring`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <Stepper
                    label={`${unit.name} into the line`}
                    testId={`line-${unit.id}`}
                    value={line[unit.id] ?? 0}
                    min={-(onGround[unit.id] ?? 0)}
                    max={atHome}
                    disabled={locked}
                    onChange={(value) => setLine((current) => ({ ...current, [unit.id]: value }))}
                  />
                  <Stepper
                    label={`${unit.name} onto the ring`}
                    testId={`ring-${unit.id}`}
                    value={ring[unit.id] ?? 0}
                    min={-(onRing[unit.id] ?? 0)}
                    max={atHome}
                    disabled={locked}
                    onChange={(value) => setRing((current) => ({ ...current, [unit.id]: value }))}
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
            onClick={() => onConfirm(line, ring)}
            data-testid="deploy-confirm"
          >
            {pending ? 'Working…' : 'Move them'}
          </Button>
        </span>
      </footer>
    </Modal>
  );
}

function Stepper({
  label,
  testId,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  testId: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={1}
      inputMode="numeric"
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      value={value}
      onChange={(event) =>
        onChange(Math.max(min, Math.min(max, Math.trunc(Number(event.target.value) || 0))))
      }
      className="w-16 border border-surface-600 bg-surface-950 px-2 py-1 font-display text-[12px] tabular-nums text-ink-200 disabled:opacity-40"
    />
  );
}
