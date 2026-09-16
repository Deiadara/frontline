import {
  MAX_FACTION_MEMBERS,
  averageLevel,
  formatCountdown,
  type AllyBattle,
  type FactionResponse,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { OnArt } from '../game/PlateRoom';
import { fightOrder } from './order';

/**
 * The readings, top right of the room: four numbers, the way in, and what is coming.
 *
 * Over the hall behind the table, where the painting has screens and a gantry and nobody anybody
 * is looking at. Right-aligned and stacked, so at 1024 the stack grows downward over that hall
 * and never leftward over the man standing at the table. The fight chips are the only thing on
 * this screen with a clock on them, which is why they are up here rather than behind a door.
 */

/** How many fights fit over the room before the rest go behind one control. */
const CHIPS = 3;

export function Readings({
  data,
  now,
  canAsk,
  onInvite,
  onOpenFight,
  onOpenFights,
}: {
  data: FactionResponse;
  /** The server's clock, so a countdown ticks against the one that enforces the mark. */
  now: Date;
  canAsk: boolean;
  onInvite: () => void;
  onOpenFight: (battleId: string) => void;
  onOpenFights: () => void;
}) {
  const seats = data.members.length;
  const vacancies = Math.max(0, MAX_FACTION_MEMBERS - seats);
  /*
   * §J8: what the table has earned, off the faction itself.
   *
   * Not the sum of what the people at it are holding, which falls the moment somebody buys
   * notoriety and jumps when a rich stranger sits down. And not the sum of the members' *earned*
   * rows either, which is what this used to add up: that figure drops when somebody leaves, and
   * the faction's own total never does, so the screen and the standings quoted two different
   * numbers for one thing. This is the field the standings rank factions by, read off the same
   * place they read it (maintainer request, 2026-09-12).
   */
  const earned = data.faction?.infamyEarned ?? 0;
  /*
   * The mean level at the table, as a whole number (maintainer request, 2026-09-12).
   *
   * Computed off the roster on every render rather than stored, which is the whole of what makes
   * it move when a seat changes hands. `averageLevel` is shared with the standings and the public
   * faction file so the three cannot round it differently.
   */
  const meanLevel = averageLevel(data.members.map((member) => member.level));
  /* The unit slots the table's battle units take up, not a head count: every fighting unit
     counts against the beds in somebody's district (`unitSlotsUsed`), and a Juggernaut takes more of
     them than a Razor. The hover says so. */
  const units = data.members.reduce((total, member) => total + member.unitSlotsUsed, 0);
  const ordered = fightOrder(data.battles);
  const shown = ordered.slice(0, CHIPS);
  const rest = ordered.length - shown.length;

  return (
    <div
      className="pointer-events-none flex w-[22rem] flex-col items-end gap-2 xl:w-[26rem]"
      data-testid="faction-readings"
    >
      <OnArt className="pointer-events-auto w-full p-1.5">
        <ul className="grid grid-cols-5 gap-1" data-testid="faction-tally">
          <Reading
            testId="dial-seats"
            icon="faction"
            label="Seats"
            value={`${seats}/${MAX_FACTION_MEMBERS}`}
            note={`A faction holds ${MAX_FACTION_MEMBERS} districts. An invitation from a chief or the leader is the only way into one of them.`}
          />
          <Reading
            testId="dial-units"
            icon="units"
            label="Unit Slots"
            value={units.toLocaleString()}
            note="The unit slots taken up by battle units across the whole table: every fighting unit everybody here has trained, at home, garrisoned or on the road, counted against the slots in their districts. It moves as people train and as fights are paid for."
          />
          <Reading
            testId="dial-earned"
            icon="infamy"
            label="Earned"
            value={Math.round(earned).toLocaleString()}
            note="Infamy won in battle by the people at this table. It is what the standings rank factions by, and it is not the same as what anybody is holding in their pocket."
          />
          <Reading
            testId="dial-level"
            icon="crew"
            label="Av. level"
            value={String(meanLevel)}
            note="The average level of everybody at this table, rounded to a whole number. It moves the moment somebody joins or leaves, and it is what a rival reads to know what walking into this faction costs."
          />
          <Reading
            testId="dial-fights"
            icon="battles"
            label="Fights"
            value={String(data.battles.length)}
            note="Fights somebody at this table has called or been called into. Anything with a mark still on it is one you can send units to."
          />
        </ul>
        {vacancies > 0 && (
          <Vacancies
            count={vacancies}
            canAsk={canAsk}
            pending={data.pending.length}
            onInvite={onInvite}
          />
        )}
      </OnArt>

      {shown.length > 0 && (
        <div
          className="flex w-full flex-wrap items-stretch justify-end gap-1.5"
          data-testid="faction-fights"
        >
          {shown.map((battle) => (
            <FightChip
              key={battle.battleId}
              battle={battle}
              now={now}
              onOpen={() => onOpenFight(battle.battleId)}
            />
          ))}
          {rest > 0 && (
            <OnArt className="pointer-events-auto">
              <button
                type="button"
                data-testid="faction-more-fights"
                onClick={onOpenFights}
                className="flex h-full items-center px-3 py-2 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-brass-300 transition-colors hover:text-brass-100"
              >
                +{rest} more
              </button>
            </OnArt>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One number about the faction, as a tile.
 *
 * The sentence explaining what a reading *is* stays behind the hover: it is reference material,
 * read once and looked past forever if it is left on the screen.
 */
function Reading({
  icon,
  label,
  value,
  note,
  testId,
}: {
  icon: IconName;
  label: string;
  value: string;
  note: ReactNode;
  testId: string;
}) {
  return (
    <li className="min-w-0">
      <HoverCard
        className="w-full"
        label={`${label}: what this reading means`}
        card={
          <>
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
              {label}
            </p>
            <p className="mt-1.5 font-body text-[13px] leading-relaxed text-ink-200">{note}</p>
          </>
        }
      >
        <span
          data-testid={testId}
          className="flex w-full flex-col items-center gap-0.5 rounded-sm border border-surface-600/70 bg-surface-950/40 px-1 py-1.5 transition-colors hover:border-brass-300/50"
        >
          <span className="flex items-center gap-1">
            <Icon name={icon} aria-hidden className="h-3 w-3 shrink-0 text-brass-300" />
            {/* Wraps rather than truncates: five dials share 22rem below `xl`, which is about 66px
                each, and "UNIT SLOTS" letterspaced at 9px is 78px. Cut, it read "UNIT SLO"; on two
                lines it reads whole, and the grid gives every dial the taller row. */}
            <span className="text-center font-display text-[9px] font-bold uppercase leading-tight tracking-[0.12em] text-ink-300">
              {label}
            </span>
          </span>
          <span className="font-display text-[14px] font-bold tabular-nums leading-none text-ink-100">
            {value}
          </span>
        </span>
      </HoverCard>
    </li>
  );
}

/**
 * The room left at the table.
 *
 * A control for a rank that can fill it and a line for one that cannot, and it says the same thing
 * either way: this is what "Looking for members" means when the reader is the one doing the looking.
 */
function Vacancies({
  count,
  canAsk,
  pending,
  onInvite,
}: {
  count: number;
  canAsk: boolean;
  /** Invitations already out and unanswered, which is the other half of "looking". */
  pending: number;
  onInvite: () => void;
}) {
  const seats = `${count} ${count === 1 ? 'seat' : 'seats'} open`;
  const waiting = pending > 0 ? `, ${pending} asked` : '';
  const body = (
    <>
      <Icon name="crew" aria-hidden className="h-3.5 w-3.5 shrink-0 text-brass-300" />
      <span className="truncate font-stamp text-[12px] text-ink-100">
        {canAsk ? 'Looking for members' : 'Room at the table'}
      </span>
      <span className="ml-auto truncate font-body text-[10.5px] text-ink-400">
        {canAsk ? `${seats}${waiting}` : `${seats}. A chief or the leader fills them.`}
      </span>
    </>
  );
  const skin = 'mt-1 flex w-full items-center gap-2 rounded-sm border border-dashed px-2 py-1';

  if (!canAsk) {
    return (
      <div className={cn(skin, 'border-surface-600/70')} data-testid="faction-vacancies">
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onInvite}
      data-testid="faction-vacancies"
      className={cn(skin, 'border-brass-500/50 text-left transition-colors hover:bg-brass-300/10')}
    >
      {body}
    </button>
  );
}

/**
 * One coming fight: what it is against, whose it is, and how long is left.
 *
 * The countdown is the whole point of the chip. `scheduledFor` printed as a date is a fact a player
 * has to do arithmetic on; the same fact counted down is one they can act on, and it is the
 * difference between noticing a fight in time and reading about it afterwards.
 */
function FightChip({ battle, now, onOpen }: { battle: AllyBattle; now: Date; onOpen: () => void }) {
  const remaining = Date.parse(battle.scheduledFor) - now.getTime();
  const attacking = battle.side === 'attacker';

  return (
    <OnArt className="pointer-events-auto w-[11.5rem] xl:w-[13rem]">
      <button
        type="button"
        data-testid={`fight-chip-${battle.battleId}`}
        onClick={onOpen}
        className="flex w-full items-center gap-1.5 px-1.5 py-1.5 text-left transition-colors hover:bg-brass-300/10"
      >
        <span
          aria-hidden
          className={cn(
            'icon-plate flex h-6 w-6 shrink-0 items-center justify-center rounded-sm',
            attacking ? 'text-oxblood-300' : 'text-verdigris-300',
          )}
        >
          <Icon name={attacking ? 'sword' : 'shield'} className="h-3.5 w-3.5" />
        </span>
        {/* Two lines rather than three columns: a target, a name and a clock side by side need
            about 240px and the chip has 184 at 1024. The mark's wall-clock time is on the card the
            chip opens. */}
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-stamp text-[12.5px] text-ink-100">
            {battle.targetName}
          </span>
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate font-body text-[10px] text-ink-400">{battle.memberName}</span>
            <span
              className={cn(
                'ml-auto shrink-0 font-display text-[10.5px] font-bold tabular-nums',
                remaining > 0 ? 'text-brass-100' : 'text-ink-400',
              )}
            >
              {remaining > 0 ? formatCountdown(remaining) : 'the mark has passed'}
            </span>
          </span>
        </span>
      </button>
    </OnArt>
  );
}
