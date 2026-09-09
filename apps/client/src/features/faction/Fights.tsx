import { UNIT_CATALOG, findUnit, type AllyBattle, type Army } from '@frontline/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { cn } from '../../lib/cn';
import { useUnits } from '../../lib/queries';
import { fightOrder } from './order';
import { EmptyPlate, Figure, WindowHead } from './parts';

/**
 * What the table has called, and the form that sends bodies to it.
 *
 * A window rather than a panel on the screen, because the room is the screen now and a fight is
 * something a player *acts on* rather than something they read. The chips over the room carry the
 * four facts the decision needs (what it is against, whose it is, when the mark is, how long is
 * left); this is what opens when one is pressed.
 *
 * `only` is the whole difference between the two ways in. Pressing a chip is a decision already
 * made, so that fight opens with its send controls unfolded and nothing else in the way; "+N more"
 * is a player looking for something, so it lists them all with the controls folded away. A
 * dropdown, a stepper and a send button drawn on every card is a form five times over.
 */
export function FightWindow({
  battles,
  only,
  pending,
  onReinforce,
  onClose,
}: {
  battles: readonly AllyBattle[];
  /** The one fight this window was opened for, or null for the whole list. */
  only: string | null;
  pending: boolean;
  onReinforce: (battleId: string, unitId: string, count: number) => void;
  onClose: () => void;
}) {
  const units = useUnits();
  const army: Army = units.data?.army ?? {};
  // Carriers hold ground rather than take it, so they are not a thing to send to somebody else's.
  const fieldable = Object.entries(army).filter(([unitId, count]) => {
    const unit = findUnit(unitId);
    return count > 0 && unit !== undefined && unit.tier !== 'carrier';
  });
  const shown =
    only === null ? fightOrder(battles) : battles.filter((battle) => battle.battleId === only);

  return (
    <Modal
      onClose={onClose}
      labelledBy="fights-title"
      /* One fight is one card, and a card left-aligned in a 52rem window with half of it empty
         reads as a window that failed to fill. The list wants the room; a single fight does not. */
      size={only === null ? 'wide' : 'default'}
      data-testid="faction-fights-window"
    >
      <WindowHead
        id="fights-title"
        title={only === null ? 'Fights called' : 'Send help'}
        onClose={onClose}
      />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
        {shown.length === 0 ? (
          <EmptyPlate icon="battles">
            Nobody at this table has a fight called. When one is, it shows up over the room and you
            can put units into it.
          </EmptyPlate>
        ) : (
          <ul
            className="flex min-w-0 flex-wrap content-start gap-3 [&>li]:max-w-full"
            data-testid="faction-battles"
          >
            {shown.map((battle) => (
              <FightCard
                key={battle.battleId}
                battle={battle}
                army={army}
                fieldable={fieldable}
                reading={units.isPending}
                pending={pending}
                unfolded={only !== null}
                onReinforce={onReinforce}
              />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function FightCard({
  battle,
  army,
  fieldable,
  reading,
  pending,
  unfolded,
  onReinforce,
}: {
  battle: AllyBattle;
  army: Army;
  fieldable: readonly [string, number][];
  /** True while `/units` is still in flight, which is not the same as holding nothing. */
  reading: boolean;
  pending: boolean;
  /** Opened straight onto the send controls, for a window opened by pressing this fight's chip. */
  unfolded: boolean;
  onReinforce: (battleId: string, unitId: string, count: number) => void;
}) {
  const [sending, setSending] = useState(unfolded);
  /*
   * The drawer is scrolled to once it is open.
   *
   * The strip is a scroller of its own from `xl`, and a card that grows by 90px when its drawer
   * unfolds pushes its own Send button under the panel's bottom edge: at 1280x720 the two controls
   * were off screen the moment they were asked for. `block: 'nearest'` moves the panel only as far
   * as it has to, so a drawer that already fits does not jump.
   */
  const drawer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Optional call: jsdom has no `scrollIntoView` at all, and the unit test that drives this
    // drawer would otherwise fail on the scroll rather than on anything it is about.
    if (sending) drawer.current?.scrollIntoView?.({ block: 'nearest' });
  }, [sending]);
  /*
   * The choice is *derived*, not seeded, because the roster arrives after the first render.
   *
   * `useState(fieldable[0]?.[0] ?? '')` runs once, and on that render `units.data` is undefined:
   * `fieldable` is empty and the id is `''`. The query resolving re-renders with a full list and
   * nothing resets the id, so `held` stayed 0 and the button stayed dead over a `<select>` with
   * nothing selected. The units query really is cold here: the shell's `QueueRail` subscribes to
   * `/me`, `/missions` and `/research`, not to `/units`, so a player who follows a notification
   * straight to this page has never fetched an army.
   */
  const [picked, setPicked] = useState<string | null>(null);
  const unitId = picked !== null && (army[picked] ?? 0) > 0 ? picked : (fieldable[0]?.[0] ?? '');
  const held = army[unitId] ?? 0;
  /*
   * ...and the count follows the unit rather than outliving it.
   *
   * `NumberField` clamps inside its own handlers and renders whatever `value` it is given, so
   * setting 40 of something the crew holds 40 of and then switching to one they hold 2 of left
   * **40** in the field over a live button, and sent it.
   */
  const [wanted, setWanted] = useState(1);
  const count = Math.max(1, Math.min(wanted, Math.max(1, held)));
  const attacking = battle.side === 'attacker';

  return (
    <li className="flex min-w-[16rem] max-w-[30rem] flex-1 basis-[21rem]">
      <div className="card-paper washed rivets edge-lit flex w-full min-w-0 flex-col gap-2.5 rounded-sm border border-surface-600/80 p-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            className={cn(
              'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm',
              attacking ? 'text-oxblood-300' : 'text-verdigris-300',
            )}
            data-tip={attacking ? 'Called by one of us' : 'One of us is being come for'}
            aria-label={attacking ? 'Called by one of us' : 'One of us is being come for'}
          >
            <Icon name={attacking ? 'sword' : 'shield'} className="h-5 w-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="break-words font-stamp text-[16px] leading-tight text-ink-100">
              {battle.targetName}
            </span>
            <span className="truncate font-body text-[11px] leading-tight text-ink-400">
              {battle.memberName} · {attacking ? 'attacking' : 'holding'}
            </span>
          </span>
        </div>

        {/* The mark, drawn as a reading rather than said in a sentence: it is the fact that decides
            whether any of this is still possible. */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex min-w-0 items-center gap-2 rounded-sm border border-surface-600/80 bg-surface-950/50 px-2 py-1">
            <Icon name="clock" aria-hidden className="h-3.5 w-3.5 shrink-0 text-brass-300" />
            <span className="font-display text-[15px] font-bold tabular-nums leading-none text-ink-100">
              {battle.scheduledFor.slice(11, 16)}
            </span>
            <span className="font-body text-[11px] tabular-nums text-ink-400">
              {battle.scheduledFor.slice(0, 10)}
            </span>
          </span>
          <Figure
            icon="units"
            value={battle.committed.toLocaleString()}
            title="Already committed"
          />
          {battle.yourContribution > 0 && (
            <span className="flex items-center gap-1 rounded-sm border border-brass-500/60 bg-brass-300/10 px-1.5 py-0.5 font-display text-[11px] text-brass-100">
              you sent <span className="font-bold tabular-nums">{battle.yourContribution}</span>
            </span>
          )}
        </div>

        {/*
          The button is drawn on the strength of the fight rather than of the roster, and that is
          deliberate. `/units` is usually still in flight when this page arrives (the shell
          subscribes to `/me`, `/missions` and `/research`, never to `/units`), so a card gated on
          the roster spends the first moment saying "nothing to send" about an army it has not read
          yet. What the roster decides is what is *inside* the drawer.
        */}
        {!battle.canReinforce ? (
          <p className="font-body text-[12px] italic text-ink-400">
            The mark has passed. Nobody is moving now.
          </p>
        ) : !sending ? (
          <button
            type="button"
            data-testid={`open-reinforce-${battle.battleId}`}
            onClick={() => setSending(true)}
            className="ink-box mt-auto inline-flex items-center justify-center gap-1.5 self-stretch px-3.5 py-1.5 font-stamp text-[14px] leading-none text-brass-300 transition-colors hover:text-brass-100"
          >
            <Icon name="units" aria-hidden className="h-4 w-4" />
            Send help
          </button>
        ) : (
          <div
            ref={drawer}
            className="mt-auto flex min-w-0 flex-col gap-2 border-t border-surface-700/70 pt-2.5"
          >
            {fieldable.length === 0 ? (
              <p className="font-body text-[12px] italic text-ink-400">
                {reading ? 'Reading your roster…' : 'Nothing on your roster to send.'}
              </p>
            ) : (
              <div className="flex min-w-0 flex-wrap items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                    Send
                  </span>
                  {/* The painted picker, not the browser's: this was the last native `<select>`
                      on a game screen, grey and system-fonted in a hand-inked drawer. */}
                  <Dropdown
                    label="Send"
                    value={unitId}
                    onChange={setPicked}
                    data-testid={`reinforce-unit-${battle.battleId}`}
                    options={fieldable.map(([id, have]) => ({
                      value: id,
                      label: `${UNIT_CATALOG.find((unit) => unit.id === id)?.name ?? id} (${have})`,
                    }))}
                  />
                </div>
                <NumberField
                  label="How many"
                  value={count}
                  min={1}
                  max={Math.max(1, held)}
                  onChange={setWanted}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending || held < 1}
                data-testid={`reinforce-${battle.battleId}`}
                onClick={() => onReinforce(battle.battleId, unitId, count)}
              >
                Send help
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSending(false)}>
                Never mind
              </Button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}
