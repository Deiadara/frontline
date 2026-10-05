import {
  FACTION_RANK_LABELS,
  canNameSuccessor,
  type FactionMember,
  type FactionResponse,
} from '@frontline/shared';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from './ui/Button';
import { Confirm } from './ui/Confirm';
import { Modal } from './ui/Modal';

/**
 * Walking out of a faction, for every door that does it: Leave on your own file and the Console's
 * Clean slate (maintainer, 2026-09-30).
 *
 * "If there are members there is a warning about disbanding, and it allows you to choose another
 * leader. You may still not do it though." So a leader with somebody else at the table gets the
 * warning and a list of who could lead after them, with disbanding still the choice the dialog
 * opens on. Anybody else, and a leader alone, gets the ordinary {@link Confirm}: there is nobody to
 * hand it to, and a picker with one option is a question with no choice in it.
 *
 * Whether the picker appears is `canNameSuccessor`, the same question the server asks before it
 * accepts a successor, so the dialog never offers a handover the route would refuse.
 */
export function LeaveDialog({
  faction,
  selfId,
  title,
  body,
  confirm,
  testId,
  onConfirm,
  onCancel,
}: {
  /** The table being left, or undefined when the screen has not read it. */
  faction: Pick<FactionResponse, 'faction' | 'members' | 'rank'> | undefined;
  selfId: string;
  title: string;
  body: string;
  /** The confirm button's words, for the heir picked or for nobody. */
  confirm: (heir: FactionMember | null) => string;
  testId: string;
  onConfirm: (successorId: string | undefined) => void;
  onCancel: () => void;
}) {
  const [heirId, setHeirId] = useState<string | null>(null);
  const heirs =
    faction?.rank && canNameSuccessor(faction.rank, faction.members.length)
      ? faction.members.filter((member) => member.userId !== selfId)
      : [];

  if (heirs.length === 0) {
    return (
      <Confirm
        title={title}
        body={body}
        confirm={confirm(null)}
        testId={testId}
        onCancel={onCancel}
        onConfirm={() => onConfirm(undefined)}
      />
    );
  }

  const heir = heirs.find((member) => member.userId === heirId) ?? null;
  const factionName = faction?.faction?.name ?? 'the faction';
  return (
    <Modal onClose={onCancel} labelledBy={`${testId}-title`} size="default">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5" data-testid={testId}>
        <h2 id={`${testId}-title`} className="font-stamp text-xl text-ink-100">
          {title}
        </h2>
        <span aria-hidden className="ink-rule h-1 w-full" />
        <p className="font-body text-[13px] leading-relaxed text-ink-300">{body}</p>

        <div className="flex flex-col gap-1.5">
          <p className="font-display text-[10px] font-bold uppercase tracking-[0.2em] text-brass-300">
            Who leads after you
          </p>
          <div
            role="radiogroup"
            aria-label="Who leads after you"
            className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
          >
            <HeirOption
              picked={heir === null}
              label="Nobody"
              note="Disband it"
              testId={`${testId}-heir-none`}
              onPick={() => setHeirId(null)}
            />
            {heirs.map((member) => (
              <HeirOption
                key={member.userId}
                picked={heir?.userId === member.userId}
                label={member.username}
                note={
                  member.isBot
                    ? `${FACTION_RANK_LABELS[member.rank]} · does not play`
                    : FACTION_RANK_LABELS[member.rank]
                }
                testId={`${testId}-heir-${member.username}`}
                onPick={() => setHeirId(member.userId)}
              />
            ))}
          </div>
          <p
            className="font-body text-[12px] leading-relaxed text-ink-300"
            data-testid={`${testId}-outcome`}
          >
            {heir === null
              ? `${factionName} ends when you go.`
              : `${heir.username} leads ${factionName} from the moment you go, and it carries on without you.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            data-testid={`${testId}-yes`}
            onClick={() => onConfirm(heir?.userId)}
          >
            {confirm(heir)}
          </Button>
          <Button variant="ghost" data-testid={`${testId}-no`} onClick={onCancel}>
            Never mind
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function HeirOption({
  picked,
  label,
  note,
  testId,
  onPick,
}: {
  picked: boolean;
  label: string;
  note: string;
  testId: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={picked}
      onClick={onPick}
      data-testid={testId}
      className={cn(
        'flex min-w-0 flex-col items-start gap-0.5 rounded-sm border px-2 py-1.5 text-left transition-colors',
        picked
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-surface-600 bg-surface-950/40 hover:border-brass-500/60',
      )}
    >
      <span
        className={cn(
          'block w-full break-words font-display text-[12px] uppercase leading-tight tracking-[0.1em]',
          picked ? 'text-brass-100' : 'text-ink-200',
        )}
      >
        {label}
      </span>
      <span className="block w-full font-body text-[11px] leading-snug text-ink-300">{note}</span>
    </button>
  );
}
