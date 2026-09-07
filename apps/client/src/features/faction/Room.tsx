import {
  FACTION_CARD_SPECS,
  FACTION_RANK_LABELS,
  describeCardBonus,
  plateAspect,
  type FactionMember,
  type FactionRank,
} from '@frontline/shared';
import { HoverCard } from '../../components/ui/HoverCard';
import { cn } from '../../lib/cn';
import { OnPlate, PlateRoom } from '../game/PlateRoom';
import { CARD_BY_SLOT, CardGlyph } from './CardGlyph';
import { SEAT_PLACES, seated } from './seats';
import { releaseHover } from './parts';

/**
 * The back room, with the five of you at the table.
 *
 * The room's own plate (`plate-faction-room`) drawn `whole`, and the five seats as a row of plates
 * along its foot, the leader in the middle: the seat's card (`CardGlyph`), a name and a rank, or a
 * marked spare chair. The painted people stay the picture; nothing hangs on a face (`seats.ts`).
 *
 * Nothing on this screen touches `features/bar`; the room borrowed the Bar's plate until the board
 * delivered this one.
 */

/** Read off `plate-faction-room`'s delivery rather than restated, for the reason `BarPage` gives. */
const ROOM_ASPECT = plateAspect('faction-room');

/** One size at every viewport: a name is a name. `seats.ts` pins the same number for its test. */
const PLATE = 'w-[10.75rem] xl:w-[11.25rem]';

export function Room({
  members,
  myUserId,
  canAsk,
  onOpenMember,
  onInvite,
}: {
  members: readonly FactionMember[];
  myUserId: string;
  /** Whether this rank can fill an empty place, which is what an empty place offers. */
  canAsk: boolean;
  onOpenMember: (member: FactionMember) => void;
  onInvite: () => void;
}) {
  const places = seated(members);

  return (
    <PlateRoom plate="faction-room" aspect={ROOM_ASPECT} fit="whole" testId="faction-room">
      {SEAT_PLACES.map((place, at) => {
        const member = places[at] ?? null;
        return (
          <OnPlate key={at} at={place} anchor="bottom">
            {member === null ? (
              <EmptySeat at={at} canAsk={canAsk} onInvite={onInvite} />
            ) : (
              <Seat
                at={at}
                member={member}
                isSelf={member.userId === myUserId}
                onOpen={() => onOpenMember(member)}
              />
            )}
          </OnPlate>
        );
      })}
    </PlateRoom>
  );
}

/** Three colours, the same ones the roster uses, so a rank reads the same wherever it is drawn. */
const RANK_TONE: Record<FactionRank, string> = {
  leader: 'text-oxblood-300',
  chief: 'text-brass-300',
  member: 'text-ink-400',
};

/**
 * One person at the table.
 *
 * A `HoverCard` rather than a plain button, and for the reason the roster card was one: the four
 * numbers an ally decides on do not fit on a plate the width of a name, and printing them there
 * would turn five plates into five spreadsheets. Hovering gives the full reading, pressing opens
 * their file.
 */
function Seat({
  at,
  member,
  isSelf,
  onOpen,
}: {
  /** Which slot of the row this is: the card on the plate is the slot's, not the person's. */
  at: number;
  member: FactionMember;
  isSelf: boolean;
  onOpen: () => void;
}) {
  return (
    <HoverCard
      className={PLATE}
      label={`${member.username}: open their file`}
      onActivate={() => {
        releaseHover();
        onOpen();
      }}
      data-testid={`faction-seat-${member.username}`}
      card={
        <>
          <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
            {FACTION_RANK_LABELS[member.rank]}
            {member.isBot && ' · does not play'}
          </p>
          <p className="mt-1.5 font-body text-[12px] leading-snug text-ink-200">
            {FACTION_CARD_SPECS[member.card].aspect} at {member.cardMark}:{' '}
            {describeCardBonus(member.card, member.cardMark)} for the table.
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-body text-[12px] text-ink-200">
            <dt className="text-ink-400">District</dt>
            <dd className="truncate">{member.districtName}</dd>
            <dt className="text-ink-400">Level</dt>
            <dd className="tabular-nums">{member.level}</dd>
            <dt className="text-ink-400">Bodies</dt>
            <dd className="tabular-nums">{member.armySize.toLocaleString()}</dd>
            <dt className="text-ink-400">Earned here</dt>
            <dd className="tabular-nums">{Math.round(member.infamyEarned).toLocaleString()}</dd>
          </dl>
          <p className="mt-2 font-body text-[11px] italic text-ink-400">
            Press for their file, and what you may do about them.
          </p>
        </>
      }
    >
      <span
        className={cn(
          'glass-strong flex w-full items-center gap-2.5 rounded-sm border px-2 py-1.5 text-left',
          isSelf ? 'border-brass-300/80' : 'border-surface-500/70',
        )}
      >
        <CardGlyph card={CARD_BY_SLOT[at] ?? 'joker'} className="h-11" />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span
            className={cn(
              'truncate font-stamp text-[14px] xl:text-[15px]',
              isSelf ? 'text-brass-100' : 'text-ink-100',
            )}
          >
            {member.username}
          </span>
          <span
            className={cn(
              'truncate font-display text-[11px] uppercase tracking-[0.14em]',
              RANK_TONE[member.rank],
            )}
          >
            {FACTION_RANK_LABELS[member.rank]}
          </span>
        </span>
      </span>
    </HoverCard>
  );
}

/**
 * A place nobody is in.
 *
 * It is a control for a rank that can fill it and a plain plate for one that cannot, because a
 * button that refuses everybody who presses it is worse than no button.
 */
function EmptySeat({
  at,
  canAsk,
  onInvite,
}: {
  /** Which of the five places this is, so three empty ones are three addressable things. */
  at: number;
  canAsk: boolean;
  onInvite: () => void;
}) {
  const plate = (
    <span className="glass-strong flex w-full items-center gap-2.5 rounded-sm border border-dashed border-surface-500/70 px-2 py-1.5 text-left">
      <CardGlyph card={CARD_BY_SLOT[at] ?? 'joker'} className="h-11 opacity-70" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate font-display text-[12px] uppercase tracking-[0.14em] text-ink-300">
          Empty seat
        </span>
        <span className="truncate font-body text-[12px] text-ink-400">
          {canAsk ? 'Ask somebody in' : 'A chief fills it'}
        </span>
      </span>
    </span>
  );

  if (!canAsk) {
    return (
      <span className={cn(PLATE, 'block')} data-testid={`faction-empty-seat-${at}`}>
        {plate}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onInvite}
      data-testid={`faction-empty-seat-${at}`}
      aria-label="Ask somebody to take this seat"
      className={cn(PLATE, 'block transition-opacity hover:opacity-90')}
    >
      {plate}
    </button>
  );
}
