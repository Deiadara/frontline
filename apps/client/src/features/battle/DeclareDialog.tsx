import {
  callPriceOf,
  DECLARE_UNAFFORDABLE_MESSAGE,
  MAX_DECLARE_LEAD_HOURS,
  MIN_DECLARE_LEAD_HOURS,
  type BattleTarget,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useBattles } from '../../lib/queries';

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
  /**
   * The **place**, bare: `Chrome Row`, `Annexe Uplink`. Not a sentence.
   *
   * The sentence around it is written here (maintainer, 2026-09-20: put the place in caps, "same
   * for all other such instances"). It used to be composed at each of the three call sites, so
   * `the gate at ...` was written out three times and the caps rule would have had to be applied
   * three times and kept in step for ever. One place name in, one heading out.
   */
  placeName: string;
  slots: readonly string[];
  /** What the crew's name is worth right now, which is what the call is paid out of (§D7). */
  infamy: number;
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
  placeName,
  slots,
  infamy,
  pending,
  error,
  onClose,
  onConfirm,
}: DeclareDialogProps) {
  const [picked, setPicked] = useState<string | null>(null);
  /*
   * Derived, not seeded. `slots` is re-read every few seconds and the first mark drops off the list
   * the minute it passes; a choice seeded once from `slots[0]` outlived the slot and the dialog
   * posted a mark the board no longer offered. `Fights.tsx` documents the same trap.
   */
  const chosen = picked !== null && slots.includes(picked) ? picked : (slots[0] ?? null);
  // Off by default. Holding is the bigger commitment of the two. It takes the survivors off the
  // roster until somebody goes and gets them, so it is the one a player has to reach for.
  const [hold, setHold] = useState(false);
  // Only a location can be occupied. A gate is a hole in a wall for a few hours, not a position, so
  // offering the choice there would be offering something that cannot happen.
  const holdable = target.kind === 'location';
  /*
   * §D7: the call's price, quoted off the board rather than worked out here.
   *
   * Only ground a player's crew holds is charged; the Combine, the looters, the AI rival and empty
   * ground are free to call. The board lists what every visible target costs (`callPrices`),
   * priced by the server through the same function the route charges with, so this is the same
   * number read twice rather than a second copy of the rule. What it buys is a player who finds
   * out before they have picked a mark and pressed the loudest button in the game, rather than
   * after. Null until the board has answered, and the button waits with it: `slots` comes off the
   * same read, so there is nothing to press yet anyway.
   */
  const board = useBattles();
  const cost = board.data ? callPriceOf(target, board.data.callPrices) : null;
  const charged = cost !== null && cost > 0;
  const affordable = cost !== null && infamy >= cost;

  const days = slots.reduce<{ day: string; slots: string[] }[]>((groups, slot) => {
    const day = dayLabel(slot);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.slots.push(slot);
    else groups.push({ day, slots: [slot] });
    return groups;
  }, []);

  return (
    <Modal
      onClose={onClose}
      labelledBy="declare-title"
      className="border-oxblood-500/30"
      data-testid="declare-dialog"
    >
      <div className="flex shrink-0 flex-col gap-1 border-b border-oxblood-500/15 px-5 py-4">
        <p className="font-display text-[10px] uppercase tracking-[0.22em] text-oxblood-300">
          {target.kind === 'gate' ? 'Break the way in' : 'Call a fight'}
        </p>
        {/* The place in caps and the words around it as written: a heading set wholly in caps
            loses the difference between the thing being named and the sentence naming it, and one
            set wholly in title case buries the name in the middle of a line. */}
        <h2
          id="declare-title"
          className="font-display text-lg font-bold tracking-[0.1em] text-ink-100"
        >
          {target.kind === 'gate' ? (
            <>
              the gate at <span className="uppercase">{placeName}</span>
            </>
          ) : target.kind === 'location' ? (
            // A location target is the heading and nothing else, so there is no sentence to set
            // it apart from and nothing to gain by shouting it. The rule is the place inside a
            // sentence, which is the pair either side of this.
            <span>{placeName}</span>
          ) : (
            <>
              a raid on <span className="uppercase">{placeName}</span>
            </>
          )}
        </h2>
        <p className="font-body text-xs leading-relaxed text-ink-300">
          Everybody sees it coming. The soonest you may call it is {MIN_DECLARE_LEAD_HOURS} hours
          out, the latest {MAX_DECLARE_LEAD_HOURS}. Nobody is sent yet: you move people up between
          now and the mark.
          {charged &&
            ` Calling it on another player's crew costs ${cost} infamy, taken the moment it lands.`}
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
                  onClick={() => setPicked(slot)}
                  className={cn(
                    'brushed relative rounded-sm border px-2.5 py-1 font-display text-[12px] tabular-nums transition-colors',
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

        {/* The price against the wallet, so the two numbers a player is weighing are on one line
            rather than one in the copy above and one on the HUD behind the dialog. Only for a
            charged call: free ground has no price to weigh. */}
        {charged && (
          <p
            data-testid="declare-price"
            className={cn(
              'rivets flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-sm border px-3.5 py-2.5 font-display text-[12px] uppercase tracking-[0.14em]',
              affordable
                ? 'border-surface-600 bg-surface-800/50 text-ink-200'
                : 'border-oxblood-500/40 bg-oxblood-500/10 text-oxblood-100',
            )}
          >
            <span>Cost to call: {cost} infamy</span>
            <span className="tabular-nums text-ink-300">Your name: {Math.round(infamy)}</span>
          </p>
        )}

        {charged && !affordable && (
          <p
            role="alert"
            data-testid="declare-unaffordable"
            className="font-body text-xs leading-relaxed text-oxblood-300"
          >
            {DECLARE_UNAFFORDABLE_MESSAGE}
          </p>
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
          disabled={chosen === null || pending || !affordable}
          data-testid="declare-confirm"
          // Not the confirm every other primary button gets. Calling a fight is the loudest thing
          // a player does in this game: everybody in the city sees it, and it cannot be taken back.
          data-sound="call"
          onClick={() => chosen && affordable && onConfirm(chosen, holdable && hold)}
        >
          {pending ? 'Working…' : 'Call it'}
        </Button>
      </footer>
    </Modal>
  );
}
