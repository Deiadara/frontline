import type { FactionMember, FactionResponse } from '@frontline/shared';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { OnArt } from '../game/PlateRoom';
import { Roster } from './Roster';
import { ledger } from './ledger';
import { Door, WindowHead } from './parts';

/**
 * The doors along the foot of the room, and the two windows that have no other way in.
 *
 * Four tiles at the crest's shoulder, top left over the pinboard beside it. Everything that is a
 * list or a form is behind one of them: the room is the screen, and a panel of rows over a
 * painting of people is a panel over people.
 */
export function Doors({
  onMembers,
  onLedger,
  onBook,
  onArmies,
}: {
  onMembers: () => void;
  onLedger: () => void;
  onBook: () => void;
  onArmies: () => void;
}) {
  return (
    <OnArt className="pointer-events-auto flex gap-1.5 p-1.5" data-testid="faction-doors">
      <Door icon="crew" label="Members" testId="faction-door-members" onClick={onMembers} />
      <Door icon="archive" label="The log" testId="faction-door-log" onClick={onLedger} />
      <Door icon="edit" label="The book" testId="faction-door-book" onClick={onBook} />
      <Door icon="units" label="What we field" testId="faction-door-armies" onClick={onArmies} />
    </OnArt>
  );
}

/** The same people as rows, with what each of them brings, and anybody the room has no chair for. */
export function MembersWindow({
  members,
  myUserId,
  onOpenMember,
  onClose,
}: {
  members: readonly FactionMember[];
  myUserId: string;
  onOpenMember: (member: FactionMember) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      onClose={onClose}
      labelledBy="members-title"
      size="default"
      data-testid="faction-members-window"
    >
      <WindowHead id="members-title" title="Who is at this table" onClose={onClose} />
      <div className="min-h-0 overflow-y-auto p-5">
        <Roster members={members} myUserId={myUserId} onOpenMember={onOpenMember} />
      </div>
    </Modal>
  );
}

/** The log: what has happened at this table, newest first (`ledger.ts`). */
export function LedgerWindow({ data, onClose }: { data: FactionResponse; onClose: () => void }) {
  const entries = ledger(data);
  return (
    <Modal onClose={onClose} labelledBy="log-title" size="default" data-testid="faction-log-window">
      <WindowHead id="log-title" title="The log" onClose={onClose} />
      <ul className="flex min-h-0 flex-col gap-1.5 overflow-y-auto p-5" data-testid="faction-log">
        {entries.length === 0 ? (
          <li className="font-body text-[12px] italic text-ink-400">Nothing has happened yet.</li>
        ) : (
          entries.map((entry) => (
            <li key={entry.id} className="flex min-w-0 items-baseline gap-2">
              <Icon
                name={entry.icon}
                aria-hidden
                className="h-3 w-3 shrink-0 translate-y-0.5 text-brass-300"
              />
              <span className="min-w-0 flex-1 break-words font-body text-[12.5px] leading-snug text-ink-200">
                {entry.text}
              </span>
              <span className="shrink-0 font-display text-[10px] tabular-nums text-ink-500">
                {entry.at.slice(0, 10)}
              </span>
            </li>
          ))
        )}
      </ul>
    </Modal>
  );
}
