import type { AllyArmy, FactionMember } from '@frontline/shared';
import { Modal } from '../../components/ui/Modal';
import { MemberFace } from './MemberFace';
import { ArmyTags, EmptyPlate, Figure, WindowHead } from './parts';

/**
 * Everything the table can put on a road, in one window, your own crew included.
 *
 * A member's own file answers "what can *they* field"; this answers "what do we have", which is
 * the same data read the other way round and the question somebody opens this screen with the
 * night before a fight. Behind a door rather than on the page: it is a list of unit counts, which
 * is the least picture-like thing this screen has.
 */
export function Armies({
  armies,
  members,
  myUserId,
  onClose,
}: {
  armies: readonly AllyArmy[];
  /** The table, for each row's face: the Overseer's painting, as the members window draws it. */
  members: readonly FactionMember[];
  myUserId: string;
  onClose: () => void;
}) {
  const byUser = new Map(members.map((member) => [member.userId, member]));
  return (
    <Modal
      onClose={onClose}
      labelledBy="armies-title"
      size="wide"
      data-testid="faction-armies-window"
    >
      <WindowHead id="armies-title" title="What we field" onClose={onClose} />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
        {armies.length === 0 ? (
          <EmptyPlate icon="units">
            Nothing to field yet. Everything anybody at this table can put on a road shows up here.
          </EmptyPlate>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="faction-armies">
            {armies.map((ally) => (
              <li
                key={ally.memberUserId}
                className="card-paper washed flex min-w-0 gap-3 rounded-sm border border-surface-600/80 p-3"
              >
                {/* Their own face (maintainer, 2026-10-15), the same painting the members window
                    and their file draw, rather than a sigil hashed off the account. A row whose
                    member the table no longer lists keeps the drawn fallback. */}
                <span className="h-14 w-12 shrink-0">
                  <MemberFace
                    member={
                      byUser.get(ally.memberUserId) ?? {
                        userId: ally.memberUserId,
                        username: ally.memberName,
                        portraitId: null,
                      }
                    }
                    size="sm"
                  />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate font-stamp text-[15px] text-ink-100">
                      {ally.memberName}
                      {ally.memberUserId === myUserId && (
                        <span className="ml-1.5 font-display text-[10px] uppercase tracking-[0.14em] text-brass-300">
                          you
                        </span>
                      )}
                    </span>
                    <Figure icon="units" value={ally.size.toLocaleString('en-US')} title="Units" />
                  </div>
                  <ArmyTags army={ally.army} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
