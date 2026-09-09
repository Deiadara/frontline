import { MAX_FACTION_MEMBERS, canInvite, type FactionResponse } from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { Modal } from '../../components/ui/Modal';
import {
  useDisbandFaction,
  useEditFactionDescription,
  useEditFactionIdentity,
  useFaction,
  useFactionMemberAction,
  useInviteToFaction,
  useLeaveFaction,
  useMe,
  useReinforceAlly,
} from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { Armies } from './Armies';
import { Book } from './Book';
import { Crest } from './Crest';
import { Doors, LedgerWindow, MembersWindow } from './Doors';
import { FightWindow } from './Fights';
import { FoundFaction } from './FoundFaction';
import { MemberWindow } from './MemberWindow';
import { Readings } from './Readings';
import { Room } from './Room';
import { WindowHead } from './parts';
import { refusalText } from './refusal';

/**
 * The faction (§L): the back room, with the five of you at the table.
 *
 * The room is a painting of five people round a table, and the screen is built to leave them
 * visible. The five name plates hang on the painted people (`seats.ts`); the crest is pinned to the
 * wall at the top left, over the pinboard; the readings and the coming fights sit at the top right,
 * over the hall behind the table; the doors stand at the crest's shoulder; and the empty seats
 * are a row along the foot of the room. Nothing sits over a face.
 *
 * Everything that is a list or a form is behind a door: the members as rows, the ledger, the book,
 * what the table can field, a person's file, the send-help form a fight chip opens. There is no
 * conversation here: the faction's messages are the mailbox's, and a second place to read them was
 * a second place for them to be out of date.
 *
 * No `PageShell`, deliberately, and the same reasoning as the Bar's: a sheet with a header on it is
 * a document about a place, and this is the place. Founding a faction keeps its shell, because that
 * screen really is a form.
 */

type DoorId = 'book' | 'armies' | 'invite' | 'members' | 'ledger';

/** Which fights window is open: one fight, opened by its chip, or all of them. */
interface FightsDoor {
  readonly only: string | null;
}

export function FactionPage() {
  const query = useFaction();
  const me = useMe();
  const [door, setDoor] = useState<DoorId | null>(null);
  const [fights, setFights] = useState<FightsDoor | null>(null);
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const [username, setUsername] = useState('');

  const invite = useInviteToFaction();
  const leave = useLeaveFaction();
  const disband = useDisbandFaction();
  const memberAction = useFactionMemberAction();
  const reinforce = useReinforceAlly();
  const identity = useEditFactionIdentity();
  const describe = useEditFactionDescription();

  const data = query.data;
  /*
   * The server's clock, and it has to tick: the chips over the room count down to a mark the
   * server enforces, so a machine whose clock is skewed must still be shown the real time left.
   */
  const serverNow = useServerClock(data?.serverNow, query.dataUpdatedAt);

  /*
   * A failure is said out loud rather than rendered as a blank sheet.
   *
   * `return null` here drew *nothing at all* on a failed read: no heading, no text, no way to tell
   * a broken request from an empty inbox. See `LoadFailure` for the bug that taught us.
   */
  if (!data) {
    if (!query.isError) return null;
    return (
      <PageShell title="Factions" wide>
        <LoadFailure what="Your faction" onRetry={() => void query.refetch()} />
      </PageShell>
    );
  }

  const error =
    invite.error ??
    leave.error ??
    disband.error ??
    memberAction.error ??
    reinforce.error ??
    identity.error ??
    describe.error ??
    null;
  const pending =
    invite.isPending || leave.isPending || memberAction.isPending || reinforce.isPending;

  if (!data.faction) {
    return (
      <PageShell title="Factions" fills wide>
        <FoundFaction data={data} />
      </PageShell>
    );
  }

  const faction = data.faction;
  const myUserId = me.data?.user.id ?? '';
  const canAsk = data.rank !== null && canInvite(data.rank);
  /*
   * Looked up live rather than held as the object that was clicked.
   *
   * Every faction write answers with the whole refreshed screen, so promoting somebody with their
   * file open replaces the array this came out of. Holding the row would leave the window drawing
   * the rank they had a moment ago over controls computed from it, and a member who is removed
   * while their file is open would leave the window standing over somebody who is no longer there.
   */
  const openMember = data.members.find((member) => member.userId === openMemberId) ?? null;
  const openMemberWindow = (member: { userId: string }) => setOpenMemberId(member.userId);

  return (
    <div className="relative h-full w-full">
      <Room
        members={data.members}
        myUserId={myUserId}
        canAsk={canAsk}
        onOpenMember={openMemberWindow}
        onInvite={() => setDoor('invite')}
      />

      {/* The chrome, over the room and inside the standing bar and the nav. `pointer-events-none`
          as a layer with each plate turning them back on, so the painting between them does not
          eat a press meant for a name plate standing behind it. The crest and the doors top left,
          the readings top right. */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col p-3"
        style={{
          paddingTop: 'calc(var(--hud-h, 0px) + 12px)',
          paddingBottom: 'calc(var(--nav-h, 0px) + 12px)',
        }}
        data-testid="faction-workspace"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Crest faction={faction} rank={data.rank} />
            <Doors
              onMembers={() => setDoor('members')}
              onLedger={() => setDoor('ledger')}
              onBook={() => setDoor('book')}
              onArmies={() => setDoor('armies')}
            />
          </div>
          <Readings
            data={data}
            now={serverNow}
            canAsk={canAsk}
            onInvite={() => setDoor('invite')}
            onOpenFight={(battleId) => setFights({ only: battleId })}
            onOpenFights={() => setFights({ only: null })}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="glass-strong pointer-events-auto mt-2 max-w-[34rem] self-center rounded-sm border border-oxblood-300/50 px-3 py-1.5 font-body text-[12.5px] text-oxblood-300"
          >
            {refusalText(error.message)}
          </p>
        )}
      </div>

      {openMember && (
        <MemberWindow
          member={openMember}
          data={data}
          isSelf={openMember.userId === myUserId}
          pending={pending}
          onAction={(action) => memberAction.mutate({ userId: openMember.userId, action })}
          onLeave={() => leave.mutate(undefined)}
          onClose={() => setOpenMemberId(null)}
        />
      )}

      {fights && (
        <FightWindow
          battles={data.battles}
          only={fights.only}
          pending={pending}
          onReinforce={(battleId, unitId, count) =>
            reinforce.mutate({ battleId, army: { [unitId]: count } })
          }
          onClose={() => setFights(null)}
        />
      )}

      {door === 'members' && (
        <MembersWindow
          members={data.members}
          myUserId={myUserId}
          onOpenMember={(member) => {
            setDoor(null);
            openMemberWindow(member);
          }}
          onClose={() => setDoor(null)}
        />
      )}

      {door === 'ledger' && <LedgerWindow data={data} onClose={() => setDoor(null)} />}

      {door === 'armies' && (
        <Armies armies={data.armies} myUserId={myUserId} onClose={() => setDoor(null)} />
      )}

      {door === 'book' && (
        <Book
          data={data}
          faction={faction}
          onIdentity={(name, badge) => identity.mutate({ name, badge })}
          onDescription={(blurb) => describe.mutate({ blurb })}
          onDisband={() => disband.mutate(undefined)}
          onClose={() => setDoor(null)}
          busy={identity.isPending || describe.isPending || disband.isPending}
        />
      )}

      {door === 'invite' && (
        <InviteWindow
          data={data}
          username={username}
          onUsername={setUsername}
          busy={invite.isPending}
          refusal={invite.error ? refusalText(invite.error.message) : null}
          onSend={() =>
            invite.mutate(
              { username: username.trim() },
              {
                onSuccess: () => {
                  setUsername('');
                  setDoor(null);
                },
              },
            )
          }
          onClose={() => setDoor(null)}
        />
      )}
    </div>
  );
}

/** Asking somebody in: a name, and the fact that the answer is theirs to give. */
function InviteWindow({
  data,
  username,
  onUsername,
  busy,
  refusal,
  onSend,
  onClose,
}: {
  data: FactionResponse;
  username: string;
  onUsername: (value: string) => void;
  busy: boolean;
  refusal: string | null;
  onSend: () => void;
  onClose: () => void;
}) {
  const room = Math.max(0, MAX_FACTION_MEMBERS - data.members.length);
  return (
    <Modal onClose={onClose} labelledBy="invite-title" size="default" data-testid="invite-window">
      <WindowHead id="invite-title" title="Ask somebody to join" onClose={onClose} />
      <div className="flex flex-col gap-3 p-5">
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          Anybody, in any city. The invitation lands in their messages with a button on it, and they
          decide from there.
          {room === 0 &&
            ' There is no room at the table right now, so this one will be turned down.'}
        </p>
        <label className="flex flex-col gap-1">
          <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
            Their name
          </span>
          <input
            value={username}
            onChange={(event) => onUsername(event.target.value)}
            data-testid="invite-username"
            className="rounded-sm border border-surface-500 bg-surface-900 px-2.5 py-2 font-body text-[14px] text-ink-100"
          />
        </label>
        {refusal !== null && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            {refusal}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            disabled={busy || username.trim().length === 0}
            data-testid="send-invite"
            onClick={onSend}
          >
            Send it
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Never mind
          </Button>
        </div>
      </div>
    </Modal>
  );
}
