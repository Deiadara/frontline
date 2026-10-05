import {
  MIN_ATTACK_UNIT_SLOTS,
  callPriceOf,
  DECLARE_UNAFFORDABLE_MESSAGE,
  formatClock,
  type BattleTarget,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useBattles } from '../../lib/queries';
import { ErrorNote } from '../../components/ui/ErrorNote';
import { usePlayerZone } from '../settings/usePlayerZone';

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
  /**
   * The district's front door, as the board reads it (`BattlesResponse.gates`).
   *
   * A raid, or a location in a shut district, is only legal while the gate is down, and the route
   * refuses a mark at or after the breach closes (`breach_closes`, maintainer 2026-09-27). The
   * board's `slots` run a day out whatever the gate is doing, so without this the picker offered
   * marks the route turned away.
   */
  gate?: { shut: boolean; brokenUntil: string | null } | undefined;
  /** What the crew's name is worth right now, which is what the call is paid out of (§D7). */
  infamy: number;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  /** Winners hold what they take (maintainer, 2026-09-28): the mark is the only choice. */
  onConfirm: (scheduledFor: string) => void;
  /**
   * Read the door before calling a fight at it (maintainer, 2026-09-29): a third button, beside
   * Call it, that swaps this window for the spy one. Given only where the gate can be spied, so
   * the button is never a door the route turns away.
   */
  onSpy?: (() => void) | undefined;
}

// On the player's own clock face, as the board, the Fights tab and the bells print the same mark
// (bug pass, 2026-10-02): the browser's zone put "14:00" here on a fight the board called 16:00.
const dayLabel = (iso: string, zone: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  });

const timeLabel = (iso: string, zone: string): string => formatClock(new Date(iso), zone);

export function DeclareDialog({
  target,
  placeName,
  slots: offered,
  gate,
  infamy,
  pending,
  error,
  onClose,
  onConfirm,
  onSpy,
}: DeclareDialogProps) {
  const [picked, setPicked] = useState<string | null>(null);
  // The marks inside the breach, for a call that is only legal through one (`throughBreach` in
  // the server's `battle/declare.ts`). Every other call takes the board's list as it comes.
  const throughBreach = target.kind === 'district' || (target.kind === 'location' && gate?.shut);
  const closesAt = throughBreach && gate?.brokenUntil != null ? Date.parse(gate.brokenUntil) : null;
  const slots = closesAt === null ? offered : offered.filter((slot) => Date.parse(slot) < closesAt);
  /*
   * Derived, not seeded. `slots` is re-read every few seconds and the first mark drops off the list
   * the minute it passes; a choice seeded once from `slots[0]` outlived the slot and the dialog
   * posted a mark the board no longer offered. `Fights.tsx` documents the same trap.
   */
  const chosen = picked !== null && slots.includes(picked) ? picked : (slots[0] ?? null);
  // Winners stay and hold what they took (maintainer, 2026-09-22 and 2026-09-28): not a choice,
  // and not sent. The note says so on a location; a gate or a raid is nothing to stand on.
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
  const zone = usePlayerZone();
  const cost = board.data ? callPriceOf(target, board.data.callPrices) : null;
  const charged = cost !== null && cost > 0;
  const affordable = cost !== null && infamy >= cost;

  const days = slots.reduce<{ day: string; slots: string[] }[]>((groups, slot) => {
    const day = dayLabel(slot, zone);
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
        {/* Wholly in caps (maintainer, 2026-09-22). The heading used to set the place in caps
            inside a sentence in sentence case; every other title on these windows shouts, and a
            fight is the loudest thing a player does. */}
        <h2
          id="declare-title"
          className="font-display text-lg font-bold uppercase tracking-[0.1em] text-ink-100"
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
        {/* What it costs, and nothing else (maintainer, 2026-09-22). The rules of the window
            (eight hours out, nobody sent yet) were three lines of standing prose over a grid of
            marks that says the first two on its own. The price is news. */}
        {charged && (
          <p className="font-body text-xs leading-relaxed text-ink-300">
            Calling it on another player&apos;s crew costs {cost} infamy, taken the moment it lands.
          </p>
        )}
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
                  {timeLabel(slot, zone)}
                </button>
              ))}
            </div>
          </section>
        ))}

        {slots.length === 0 && offered.length > 0 && (
          <p
            className="font-body text-xs leading-relaxed text-ink-300"
            data-testid="declare-breach-closes"
          >
            The gate is back up before the earliest mark a fight can be called for.
          </p>
        )}

        {holdable && (
          <p
            className="font-body text-[11px] leading-relaxed text-ink-300"
            data-testid="declare-hold"
          >
            Whoever is left standing garrisons the location and holds it. They are off your roster
            until you walk them somewhere else.
          </p>
        )}

        {/* The least commitment (maintainer, 2026-10-05): said before the call, because the cost of
            getting it wrong is the call itself. */}
        <p
          className="font-body text-[11px] leading-relaxed text-ink-300"
          data-testid="declare-minimum"
        >
          The attack needs {MIN_ATTACK_UNIT_SLOTS} unit slots committed, yours and your
          allies&apos;, an hour before it starts, or it is called off and what it cost stays spent.
        </p>

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
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t border-surface-700 px-5 py-4">
        {/* Cancel on the far left, away from the two that do something (maintainer, 2026-09-29). */}
        <Button variant="ghost" size="sm" onClick={onClose} data-testid="declare-cancel">
          Cancel
        </Button>
        {/* Why it cannot go, on the button row and to its left (maintainer, 2026-09-25). */}
        {((charged && !affordable) || (error !== null && error !== undefined)) && (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {charged && !affordable && (
              <ErrorNote data-testid="declare-unaffordable">
                {DECLARE_UNAFFORDABLE_MESSAGE}
              </ErrorNote>
            )}
            {error !== null && error !== undefined && (
              <ErrorNote>
                {error instanceof ApiRequestError ? error.message : 'That did not go through'}
              </ErrorNote>
            )}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {onSpy && (
            <Button variant="ghost" size="sm" onClick={onSpy} data-testid="declare-spy">
              Spy
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            disabled={chosen === null || pending || !affordable}
            data-testid="declare-confirm"
            // Not the confirm every other primary button gets. Calling a fight is the loudest thing
            // a player does in this game: everybody in the city sees it, and it cannot be taken back.
            data-sound="call"
            onClick={() => chosen && affordable && onConfirm(chosen)}
          >
            {pending ? 'Working…' : 'Call it'}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
