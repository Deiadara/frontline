import type { MessageInvite } from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Confirm } from '../../components/ui/Confirm';
import { FactionBadge } from '../faction/FactionBadge';
import { refusalText } from '../faction/refusal';
import { useAnswerFactionInvite } from '../../lib/queries';

/**
 * The invitation a message carries, drawn inside the message.
 *
 * The board's flow: an invite arrives in the inbox, it has a button on it, and the button asks
 * whether you are sure before it puts your district at somebody else's table. The confirmation is
 * not ceremony. Joining is a one-way door that another player opened for you, and the thing worth
 * saying out loud is what it costs: your army becomes visible to four strangers, and you can only
 * be in one faction at a time.
 *
 * A spent invitation stays on the message rather than disappearing from it. "This one is closed" is
 * information; a card that vanishes leaves somebody wondering whether they imagined it.
 */
export function InviteCard({ invite }: { invite: MessageInvite }) {
  const answer = useAnswerFactionInvite();
  const [asking, setAsking] = useState(false);

  return (
    <section className="ink-frame mt-4 flex flex-col gap-3 p-4" data-testid="invite-card">
      <div className="flex min-w-0 items-center gap-3">
        <FactionBadge badge={invite.badge} size={52} title={`${invite.factionName}'s badge`} />
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-stamp text-[17px] leading-tight text-ink-100">
            {invite.factionName}
          </span>
          <span className="font-body text-[12px] text-ink-400">
            {invite.open ? 'Wants you at their table' : 'This invitation is closed'}
          </span>
        </div>
      </div>

      {answer.error && (
        <p role="alert" className="font-body text-[12px] text-oxblood-300">
          {refusalText(answer.error.message)}
        </p>
      )}

      {invite.open ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={answer.isPending}
            data-testid="invite-accept"
            onClick={() => setAsking(true)}
          >
            Join {invite.factionName}
          </Button>
          <Button
            variant="ghost"
            disabled={answer.isPending}
            data-testid="invite-decline"
            onClick={() => answer.mutate({ inviteId: invite.inviteId, accept: false })}
          >
            Decline
          </Button>
        </div>
      ) : (
        <p className="font-body text-[12px] italic text-ink-400">
          It has been answered, or the seat is gone.
        </p>
      )}

      {asking && (
        <Confirm
          title={`Join ${invite.factionName}?`}
          body={`Your district joins their table. Your army and your fights become visible to everybody in the faction, and you cannot be in a second one while you are in this.`}
          confirm="Yes, join them"
          testId="confirm-join"
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            answer.mutate({ inviteId: invite.inviteId, accept: true });
          }}
        />
      )}
    </section>
  );
}
