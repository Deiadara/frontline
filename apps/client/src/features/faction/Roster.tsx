import {
  FACTION_CARD_SPECS,
  FACTION_RANK_LABELS,
  describeCardBonus,
  describeCardReads,
  type FactionMember,
} from '@frontline/shared';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { cn } from '../../lib/cn';
import { CardGlyph } from './CardGlyph';
import { seatOrder } from './order';
import { releaseHover } from './parts';

/**
 * The table as a list, behind the Members door.
 *
 * The room is the picture of who is here; this is the same people as rows you can read down. Both
 * are needed and neither replaces the other: a picture answers "who is at this table" at a glance
 * and cannot carry a district name, a level and a body count per person without turning into five
 * spreadsheets standing at a bar.
 *
 * The rows are in `seatOrder`, the same order the seats are filled in, so the third row and the
 * third figure are the same person. Each row carries the seat's card, what the card is for, what
 * it reads off its holder, and the holder's mark on it: the same grammar the crew screen uses for
 * an officer in a chair, because a seat at this table is a chair with a job.
 */
export function Roster({
  members,
  myUserId,
  onOpenMember,
}: {
  members: readonly FactionMember[];
  myUserId: string;
  onOpenMember: (member: FactionMember) => void;
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-1.5" data-testid="faction-members">
      {seatOrder(members).map((member) => (
        <li key={member.userId} data-testid={`faction-member-${member.username}`}>
          <MemberRow
            member={member}
            isSelf={member.userId === myUserId}
            onOpen={() => onOpenMember(member)}
          />
        </li>
      ))}
    </ul>
  );
}

function MemberRow({
  member,
  isSelf,
  onOpen,
}: {
  member: FactionMember;
  /** Your own row, in brass, so you can find yourself without reading the names. */
  isSelf: boolean;
  onOpen: () => void;
}) {
  const spec = FACTION_CARD_SPECS[member.card];
  return (
    <HoverCard
      className="w-full"
      label={`${member.username}: open their file`}
      onActivate={() => {
        releaseHover();
        onOpen();
      }}
      card={
        <>
          <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
            {FACTION_RANK_LABELS[member.rank]}
            {member.isBot && ' · does not play'}
          </p>
          <p className="mt-1.5 font-body text-[12px] leading-snug text-ink-200">
            {spec.name}: {spec.blurb} Reads {describeCardReads(member.card)}. At their{' '}
            {member.cardMark}, {describeCardBonus(member.card, member.cardMark)} for the table.
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-body text-[12px] text-ink-200">
            <dt className="text-ink-400">Infamy</dt>
            <dd className="tabular-nums">{Math.round(member.infamy).toLocaleString()}</dd>
            <dt className="text-ink-400">Earned here</dt>
            <dd className="tabular-nums">{Math.round(member.infamyEarned).toLocaleString()}</dd>
            <dt className="text-ink-400">Supply</dt>
            <dd className="tabular-nums">{member.supplyUsed.toLocaleString()}</dd>
            <dt className="text-ink-400">Since</dt>
            <dd className="tabular-nums">{member.joinedAt.slice(0, 10)}</dd>
          </dl>
          <p className="mt-2 font-body text-[11px] italic text-ink-400">
            Press for their file, and what you may do about them.
          </p>
        </>
      }
    >
      <span
        className={cn(
          'flex w-full items-center gap-2 rounded-sm border px-2 py-1.5 transition-colors',
          isSelf
            ? 'border-brass-300/70 bg-brass-300/[0.07]'
            : 'border-surface-600/70 hover:border-brass-300/50',
        )}
      >
        <CardGlyph card={member.card} className="h-11 shrink-0" />

        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-stamp text-[13px] text-ink-100">
            {member.username}
            {isSelf && <span className="ml-1 text-[10px] text-brass-300">you</span>}
            <span className="ml-1.5 font-display text-[9.5px] uppercase tracking-[0.14em] text-ink-400">
              {FACTION_RANK_LABELS[member.rank]}
            </span>
          </span>
          {/* What the seat is for and what it asks of them: the two things a member trains to. */}
          <span
            className="truncate font-body text-[10.5px] text-ink-300"
            data-testid={`faction-card-${member.username}`}
          >
            <span className="font-display uppercase tracking-[0.12em] text-brass-300">
              {spec.aspect}
            </span>
            {' · '}
            {describeCardReads(member.card)}
          </span>
        </span>

        {/* The mark, the way an officer's is stamped: the grade the seat is being held at. In a
            box of its own, because the stamp positions itself absolutely inside whatever holds it. */}
        <span className="relative h-9 w-9 shrink-0">
          <MarkStamp
            mark={member.cardMark}
            className="inset-0 text-oxblood-300/90"
            tip={`${spec.aspect}: ${member.cardMark}`}
          />
        </span>

        <span className="flex shrink-0 flex-col items-end leading-tight">
          <span className="flex items-center gap-1 font-display text-[11px] font-bold tabular-nums text-ink-100">
            <Icon name="units" aria-hidden className="h-3 w-3 text-brass-300" />
            {member.armySize.toLocaleString()}
          </span>
          <span className="flex items-center gap-1 font-display text-[10px] tabular-nums text-ink-300">
            <Icon name="level" aria-hidden className="h-2.5 w-2.5 text-brass-300" />
            {member.level}
          </span>
        </span>
      </span>
    </HoverCard>
  );
}
