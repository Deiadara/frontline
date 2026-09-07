import {
  FACTION_CARD_SPECS,
  describeCardBonus,
  describeCardReads,
  FACTION_RANK_LABELS,
  canKick,
  canSetRank,
  type FactionMember,
  type FactionResponse,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Confirm } from '../../components/ui/Confirm';
import { Modal } from '../../components/ui/Modal';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { CardGlyph } from './CardGlyph';
import { MemberSigil } from './MemberSigil';
import { RankStamp } from './RankStamp';
import { ArmyTags, Heading, WindowHead } from './parts';

/**
 * One person's file, opened from their seat at the table.
 *
 * Everything that used to sit on a roster row is in here: the full reading, what they can field,
 * and the four things a rank above theirs can do about them. Off the row on purpose. Remove and
 * Hand over were buttons at the end of a list, a pointer's width from the row above and the row
 * below, and the two of them are the most expensive presses on the screen.
 *
 * Both still ask before they act, and Promote and Demote still do not: those two are one press to
 * undo, and a confirmation on a reversible act teaches players to click through confirmations.
 */
export function MemberWindow({
  member,
  data,
  isSelf,
  pending,
  onAction,
  onClose,
}: {
  member: FactionMember;
  data: FactionResponse;
  isSelf: boolean;
  pending: boolean;
  onAction: (action: 'kick' | 'promote' | 'demote' | 'hand_over') => void;
  onClose: () => void;
}) {
  // Both questions are asked of the domain rather than re-derived here, so a greyed-out button and
  // the refusal behind it can never disagree about who may do what.
  const rank = data.rank;
  const mayKick = rank !== null && !isSelf && canKick(rank, member.rank);
  const mayRank = rank !== null && !isSelf && canSetRank(rank) && member.rank !== 'leader';
  const [asking, setAsking] = useState<'kick' | 'hand_over' | null>(null);
  const theirArmy = data.armies.find((entry) => entry.memberUserId === member.userId);

  const readings: readonly [label: string, value: string][] = [
    ['Level', String(member.level)],
    ['Bodies', member.armySize.toLocaleString()],
    ['Supply', member.supplyUsed.toLocaleString()],
    ['Infamy', Math.round(member.infamy).toLocaleString()],
    ['Earned here', Math.round(member.infamyEarned).toLocaleString()],
    ['At the table since', member.joinedAt.slice(0, 10)],
  ];

  return (
    <Modal
      onClose={onClose}
      labelledBy="member-window-title"
      size="wide"
      data-testid={`member-window-${member.username}`}
    >
      <WindowHead id="member-window-title" title={member.username} onClose={onClose}>
        <span className="icon-plate flex h-11 w-10 shrink-0 items-center justify-center rounded-sm text-brass-300">
          <MemberSigil
            seed={member.userId}
            name={`${member.username}, drawn`}
            className="h-8 w-8"
          />
        </span>
      </WindowHead>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="icon-plate relative flex h-[8.5rem] w-[7rem] shrink-0 items-center justify-center rounded-sm text-brass-300">
            <MemberSigil
              seed={member.userId}
              name={`${member.username}, drawn`}
              className="h-[7rem] w-[7rem]"
            />
            {/* Across the foot of the portrait, never off its right corner: hung there, `Leader`
                is wide enough to land on the readings beside it. */}
            <RankStamp rank={member.rank} className="absolute -bottom-2 left-0 right-0 block h-7" />
          </span>

          <div className="flex min-w-[14rem] flex-1 flex-col gap-2">
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
              {FACTION_RANK_LABELS[member.rank]}
              {member.isBot && ' · does not play'}
            </p>
            <p className="font-body text-[13px] text-ink-200">
              Holds <span className="text-ink-100">{member.districtName}</span>.
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-body text-[12px] text-ink-200 sm:grid-cols-3">
              {readings.map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col">
                  <dt className="truncate font-display text-[10px] uppercase tracking-[0.14em] text-ink-400">
                    {label}
                  </dt>
                  <dd className="truncate font-display text-[14px] font-bold tabular-nums text-ink-100">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <section className="flex flex-col gap-2" data-testid="member-card">
          <Heading>Their card</Heading>
          <div className="flex items-start gap-3">
            <CardGlyph card={member.card} className="h-16 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-stamp text-[15px] text-ink-100">
                {FACTION_CARD_SPECS[member.card].name}
                <span className="ml-2 font-display text-[10px] uppercase tracking-[0.14em] text-brass-300">
                  {FACTION_CARD_SPECS[member.card].aspect}
                </span>
              </p>
              <p className="font-body text-[12.5px] leading-snug text-ink-200">
                {FACTION_CARD_SPECS[member.card].blurb}
              </p>
              <p className="font-body text-[12px] text-ink-300">
                Reads {describeCardReads(member.card)}. At their {member.cardMark}:{' '}
                <span className="text-ink-100">
                  {describeCardBonus(member.card, member.cardMark)}
                </span>{' '}
                for everybody at the table.
              </p>
            </div>
            <span className="relative h-12 w-12 shrink-0">
              <MarkStamp
                mark={member.cardMark}
                className="inset-0 text-oxblood-300/90"
                title={`${FACTION_CARD_SPECS[member.card].aspect}: ${member.cardMark}`}
              />
            </span>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Heading>What they can field</Heading>
          {theirArmy ? (
            <ArmyTags army={theirArmy.army} />
          ) : (
            <p className="font-body text-[12px] italic text-ink-400">
              {isSelf
                ? 'Your own roster is on the Units screen.'
                : 'Nothing of theirs has reached this screen.'}
            </p>
          )}
        </section>

        {(mayRank || mayKick) && (
          <section className="flex flex-col gap-2">
            <Heading>What your rank carries here</Heading>
            <div className="flex flex-wrap gap-2">
              {mayRank && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  data-testid={`rank-${member.username}`}
                  onClick={() => onAction(member.rank === 'chief' ? 'demote' : 'promote')}
                >
                  {member.rank === 'chief' ? 'Demote' : 'Make chief'}
                </Button>
              )}
              {mayRank && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  data-testid={`hand-over-${member.username}`}
                  onClick={() => setAsking('hand_over')}
                >
                  Hand the faction over
                </Button>
              )}
              {mayKick && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  data-testid={`kick-${member.username}`}
                  onClick={() => setAsking('kick')}
                >
                  Remove them
                </Button>
              )}
            </div>
          </section>
        )}
      </div>

      {asking === 'kick' && (
        <Confirm
          title={`Remove ${member.username}?`}
          body="They leave the table and everything of theirs goes with them. Getting back in takes a fresh invitation."
          confirm="Remove them"
          testId="confirm-kick"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null);
            onAction('kick');
          }}
        />
      )}

      {asking === 'hand_over' && (
        <Confirm
          title={`Hand the faction to ${member.username}?`}
          body="They become the leader and you step down to chief. Only they can hand it back, and only if they choose to."
          confirm="Hand it over"
          testId="confirm-hand-over"
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null);
            onAction('hand_over');
          }}
        />
      )}
    </Modal>
  );
}
