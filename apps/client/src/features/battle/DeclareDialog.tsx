import {
  MAX_DECLARE_LEAD_HOURS,
  MIN_DECLARE_LEAD_HOURS,
  type BattleTarget,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';

/**
 * Calling a fight for a time (GDD §A4, battle rework).
 *
 * The marks are handed down by the server rather than generated here, and that is deliberate:
 * "which half hours are legal right now" is a rule, the rule lives in `battle/schedule.ts`, and a
 * client that worked it out for itself would be a second copy of it drifting a minute at a time.
 * The picker's whole job is to make the list pressable.
 *
 * Grouped by day and shown in the reader's own locale, because a list of thirty-three ISO strings
 * is not a decision anybody can make.
 */

interface DeclareDialogProps {
  target: BattleTarget;
  targetName: string;
  slots: readonly string[];
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (scheduledFor: string, holdAfterCapture: boolean) => void;
}

const dayLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

const timeLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function DeclareDialog({
  target,
  targetName,
  slots,
  pending,
  error,
  onClose,
  onConfirm,
}: DeclareDialogProps) {
  const [chosen, setChosen] = useState<string | null>(slots[0] ?? null);
  // Off by default. Holding is the bigger commitment of the two. It takes the survivors off the
  // roster until somebody goes and gets them, so it is the one a player has to reach for.
  const [hold, setHold] = useState(false);
  // Only a location can be occupied. A gate is a hole in a wall for a few hours, not a position, so
  // offering the choice there would be offering something that cannot happen.
  const holdable = target.kind === 'location';

  const days = slots.reduce<{ day: string; slots: string[] }[]>((groups, slot) => {
    const day = dayLabel(slot);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.slots.push(slot);
    else groups.push({ day, slots: [slot] });
    return groups;
  }, []);

  return (
    <Modal onClose={onClose} labelledBy="declare-title" className="border-oxblood-500/30">
      <div className="flex shrink-0 flex-col gap-1 border-b border-oxblood-500/15 px-5 py-4">
        <p className="font-display text-[10px] uppercase tracking-[0.22em] text-oxblood-300">
          {target.kind === 'gate' ? 'Break the way in' : 'Call a fight'}
        </p>
        <h2
          id="declare-title"
          className="font-display text-lg font-bold tracking-[0.1em] text-ink-100"
        >
          {targetName}
        </h2>
        <p className="font-body text-xs leading-relaxed text-ink-300">
          Everybody sees it coming. The soonest you may call it is {MIN_DECLARE_LEAD_HOURS} hours
          out, the latest {MAX_DECLARE_LEAD_HOURS}. Nobody is sent yet: you move people up between
          now and the mark.
        </p>
      </div>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5" data-testid="declare-slots">
        {days.map((group) => (
          <section key={group.day} className="flex flex-col gap-2">
            <h3 className="font-display text-[11px] uppercase tracking-[0.18em] text-brass-300">
              {group.day}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {group.slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  data-testid={`slot-${slot}`}
                  onClick={() => setChosen(slot)}
                  className={cn(
                    'border px-2.5 py-1 font-display text-[12px] tabular-nums transition-colors',
                    slot === chosen
                      ? 'border-brass-300 bg-brass-300/15 text-brass-100'
                      : 'border-surface-600 text-ink-300 hover:border-iris-300/70 hover:text-ink-100',
                  )}
                >
                  {timeLabel(slot)}
                </button>
              ))}
            </div>
          </section>
        ))}

        {/* §A4: what the fight is *for*, asked before anybody is committed. Two different fights
            are being spelled the same way otherwise: take it and come home, or take it and stay. */}
        {holdable && (
          <label
            className="rivets flex cursor-pointer items-start gap-3 rounded-sm border border-surface-600 bg-surface-800/50 px-3.5 py-3"
            data-testid="declare-hold"
          >
            <input
              type="checkbox"
              checked={hold}
              onChange={(event) => setHold(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brass-500"
            />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="font-display text-[12px] uppercase tracking-[0.14em] text-ink-100">
                Have the units stay after a successful capture
              </span>
              <span className="font-body text-[11px] leading-relaxed text-ink-300">
                Whoever is left standing garrisons the location and defends it. They are off your
                roster until you pull them out. Leave it clear and everybody marches home.
              </span>
            </span>
          </label>
        )}

        {error !== null && error !== undefined && (
          <p role="alert" className="font-body text-xs leading-relaxed text-oxblood-300">
            {error instanceof ApiRequestError ? error.message : 'That did not go through'}
          </p>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-surface-700 px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={chosen === null || pending}
          data-testid="declare-confirm"
          onClick={() => chosen && onConfirm(chosen, holdable && hold)}
        >
          {pending ? 'Working…' : 'Call it'}
        </Button>
      </footer>
    </Modal>
  );
}
