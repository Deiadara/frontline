import {
  CARD_BY_SLOT,
  FACTION_CARD_SPECS,
  canAdminister,
  describeCardBonus,
  describeCardReads,
  FACTION_RANK_LABELS,
  canKick,
  canSetRank,
  leavingDisbands,
  type FactionCard,
  type FactionMember,
  type FactionResponse,
  memberName,
  dayInZone,
} from '@frontline/shared';
import { useState } from 'react';
import { LeaveDialog } from '../../components/LeaveDialog';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Confirm } from '../../components/ui/Confirm';
import { Modal } from '../../components/ui/Modal';
import { PressError } from '../../components/ui/PressError';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { CardGlyph } from './CardGlyph';
import { MemberFace } from './MemberFace';
import { RankStamp } from './RankStamp';
import { ArmyTags, Heading, WindowHead } from './parts';
import { usePlayerZone } from '../settings/usePlayerZone';

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
 *
 * Your own file carries the door. Leaving is something you do to yourself, so it sits with your
 * own name and your own reading rather than in the book beside the badge swatches.
 */
export function MemberWindow({
  member,
  data,
  isSelf,
  pending,
  onAction,
  onSeat,
  onLeave,
  onClose,
  refusal = null,
}: {
  member: FactionMember;
  data: FactionResponse;
  isSelf: boolean;
  pending: boolean;
  onAction: (action: 'kick' | 'promote' | 'demote' | 'hand_over') => void;
  /** The leader seats this member at a card (P3-C, 2026-10-02). */
  onSeat: (card: FactionCard) => void;
  /** Leaving, with the member a leader named to lead after them, if they named one. */
  onLeave: (successorId: string | undefined) => void;
  onClose: () => void;
  /**
   * The refusal of the last write made here, drawn in the window (bug pass, 2026-10-06): the page
   * drew it under the backdrop, so the player heard the refusal and could not read it.
   */
  refusal?: string | null;
}) {
  // Both questions are asked of the domain rather than re-derived here, so a greyed-out button and
  // the refusal behind it can never disagree about who may do what.
  const rank = data.rank;
  const zone = usePlayerZone();
  const mayKick = rank !== null && !isSelf && canKick(rank, member.rank);
  const mayRank = rank !== null && !isSelf && canSetRank(rank) && member.rank !== 'leader';
  // The leader seats everybody at the table, themselves included (P3-C, 2026-10-02).
  const maySeat = rank !== null && canAdminister(rank);
  const [asking, setAsking] = useState<'kick' | 'hand_over' | 'leave' | null>(null);
  const theirArmy = data.armies.find((entry) => entry.memberUserId === member.userId);
  const takesItWithYou = isSelf && rank !== null && leavingDisbands(rank, data.members.length);
  const factionName = data.faction?.name ?? 'the faction';

  const readings: readonly [label: string, value: string][] = [
    ['Level', String(member.level)],
    ['Units', member.armySize.toLocaleString('en-US')],
    ['Unit Slots', member.unitSlotsUsed.toLocaleString('en-US')],
    ['Infamy', Math.round(member.infamy).toLocaleString('en-US')],
    ['Earned here', Math.round(member.infamyEarned).toLocaleString('en-US')],
    ['At the table since', dayInZone(new Date(member.joinedAt), zone)],
  ];

  return (
    <Modal
      onClose={onClose}
      labelledBy="member-window-title"
      size="wide"
      data-testid={`member-window-${member.username}`}
    >
      <WindowHead id="member-window-title" title={memberName(member)} onClose={onClose}>
        <div className="h-10 w-10 shrink-0">
          <MemberFace member={member} size="sm" />
        </div>
      </WindowHead>

      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="relative aspect-[3/4] w-[7rem] shrink-0">
            <MemberFace member={member} size="lg" />
            {/* Across the foot of the portrait, never off its right corner: hung there, `Leader`
                is wide enough to land on the readings beside it. */}
            {/* Same four-pixel lift as the faction file's roster, for the same reason: the
                lettering was sitting on the edge of the picture. */}
            <RankStamp rank={member.rank} className="absolute -bottom-1 left-0 right-0 block h-7" />
          </div>

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
                tip={`${FACTION_CARD_SPECS[member.card].aspect}: ${member.cardMark}`}
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

        {maySeat && (
          <section className="flex flex-col gap-2" data-testid="member-seat">
            <Heading>Their seat</Heading>
            <Dropdown
              label={`Which card ${memberName(member)} sits at`}
              value={member.card}
              disabled={pending}
              onChange={(value) => {
                if (value !== member.card) onSeat(value);
              }}
              options={CARD_BY_SLOT.map((card) => ({
                value: card,
                label: FACTION_CARD_SPECS[card].name,
                hint: FACTION_CARD_SPECS[card].aspect,
              }))}
              data-testid={`seat-${member.username}`}
            />
            <p className="font-body text-[12px] leading-snug text-ink-400">
              Whoever holds that card now takes this seat&rsquo;s card instead.
            </p>
          </section>
        )}

        {(mayRank || mayKick) && (
          <section className="flex flex-col gap-2" data-testid="member-rank-actions">
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

        {isSelf && (
          <section className="flex flex-col gap-2">
            <Heading>The door</Heading>
            <p className="font-body text-[13px] leading-relaxed text-ink-300">
              {takesItWithYou
                ? data.members.length > 1
                  ? 'You lead this faction, so leaving ends it for everybody at the table, unless you name somebody to lead it on your way out.'
                  : 'You are the only one here, so leaving ends it.'
                : 'You can walk out whenever you like. Units you sent to a table-mate\u2019s fight will not fight for them once you have gone: they sit it out and walk home. Units posted on their ground start for home at once.'}
            </p>
            <Button
              variant="danger"
              className="self-start"
              disabled={pending}
              data-testid="leave-faction"
              onClick={() => setAsking('leave')}
            >
              Leave the faction
            </Button>
          </section>
        )}
      </div>

      {refusal !== null && <PressError>{refusal}</PressError>}

      {asking === 'leave' && (
        <LeaveDialog
          faction={data}
          selfId={member.userId}
          title={takesItWithYou ? 'This ends the faction' : 'Leave the faction?'}
          body={
            takesItWithYou
              ? data.members.length > 1
                ? `${factionName} is disbanded the moment you go, for all ${data.members.length} of you, unless you name somebody to lead it. A disbanding cannot be undone.`
                : `You are the only one at ${factionName}, so it ends when you go. This cannot be undone.`
              : `You leave ${factionName}. Its fights stop showing up on your screen.`
          }
          confirm={(heir) =>
            heir
              ? `Leave it to ${memberName(heir)}`
              : takesItWithYou
                ? 'Leave and disband it'
                : 'Leave'
          }
          testId="confirm-leave"
          onCancel={() => setAsking(null)}
          onConfirm={(successorId) => {
            setAsking(null);
            onLeave(successorId);
          }}
        />
      )}

      {asking === 'kick' && (
        <Confirm
          title={`Remove ${memberName(member)}?`}
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
          title={`Hand the faction to ${memberName(member)}?`}
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
