import {
  FACTION_BLURB_MAX,
  FACTION_NAME_MAX,
  FACTION_RANK_BLURBS,
  FACTION_RANK_LABELS,
  FACTION_RANKS,
  MAX_FACTION_MEMBERS,
  UNIT_CATALOG,
  canEditDescription,
  canEditIdentity,
  canInvite,
  canKick,
  canSetRank,
  findUnit,
  leavingDisbands,
  type AllyBattle,
  type FactionBadge as Badge,
  type FactionMember,
  type FactionRank,
  type FactionResponse,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Confirm } from '../../components/ui/Confirm';
import { HoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { Modal } from '../../components/ui/Modal';
import { NumberField } from '../../components/ui/NumberField';
import { cn } from '../../lib/cn';
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
  useUnits,
} from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { BadgeBuilder } from './BadgeBuilder';
import { FactionBadge } from './FactionBadge';
import { FoundFaction } from './FoundFaction';
import { refusalText } from './refusal';

/**
 * The faction (board request): the up-to-five people you fight beside.
 *
 * Laid out as separate drawn sheets with air between them rather than one wall of rows: an
 * identity plate, a strip of readings, a rail of internal screens, and whichever screen is open.
 * The board asked for exactly that, and it is also what makes the page legible: five different
 * kinds of thing inside one bordered box read as one long list, and the same five as separate
 * sheets read as a desk with papers on it.
 *
 * The four internal screens are genuinely different questions, which is what makes them doors
 * rather than sections:
 *
 *   * **The table.** Who is here, what rank, and how big they are.
 *   * **Fights.** What has been called that you could put units into. The reason the screen exists.
 *   * **What is fielded.** Every ally's army, so "who could help me" has an answer.
 *   * **The book.** The name, the badge, what the ranks carry, and the way out.
 *
 * The copy is in the first person plural throughout: it is *your* faction once you are in it, so
 * nothing here says "their fights" or "what they field". That was the board's note and it is right;
 * a screen that talks about your own team in the third person reads like a scouting report.
 */

const SECTIONS = [
  { id: 'table', label: 'The table', icon: 'faction', blurb: 'Who is at it' },
  { id: 'fights', label: 'Fights', icon: 'battles', blurb: 'Where to send help' },
  { id: 'armies', label: 'What is fielded', icon: 'units', blurb: 'Who can send it' },
  { id: 'book', label: 'The book', icon: 'archive', blurb: 'Name, ranks and the door' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export function FactionPage() {
  const query = useFaction();
  const me = useMe();
  const [section, setSection] = useState<SectionId>('table');
  const [inviting, setInviting] = useState(false);
  const [username, setUsername] = useState('');

  const invite = useInviteToFaction();
  const leave = useLeaveFaction();
  const disband = useDisbandFaction();
  const memberAction = useFactionMemberAction();
  const reinforce = useReinforceAlly();
  const identity = useEditFactionIdentity();
  const describe = useEditFactionDescription();

  const data = query.data;
  if (!data) return null;

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
  const counts: Record<SectionId, ReactNode> = {
    table: `${data.members.length}/${MAX_FACTION_MEMBERS}`,
    fights: data.battles.length > 0 ? String(data.battles.length) : '',
    armies: data.armies.length > 0 ? String(data.armies.length) : '',
    book: '',
  };

  const bodies = data.members.reduce((total, member) => total + member.armySize, 0);
  const infamy = data.members.reduce((total, member) => total + member.infamy, 0);
  const topLevel = data.members.reduce((best, member) => Math.max(best, member.level), 0);

  return (
    <PageShell title={faction.name} fills wide>
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          <Identity faction={faction} rank={data.rank} seats={data.members.length} />
          <div className="ink-frame flex min-h-0 flex-col overflow-hidden">
            <Rail section={section} onSelect={setSection} counts={counts} />
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          {/* The readings, as separate plates. Four numbers about the faction as a whole, which is
              the thing no single member's row can tell you. */}
          <div
            className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4"
            data-testid="faction-tally"
          >
            <Tally
              label="Seats"
              value={`${data.members.length}/${MAX_FACTION_MEMBERS}`}
              icon="faction"
            />
            <Tally label="Bodies" value={bodies.toLocaleString()} icon="units" />
            <Tally label="Infamy" value={Math.round(infamy).toLocaleString()} icon="infamy" />
            <Tally label="Top level" value={String(topLevel)} icon="level" />
          </div>

          {error && (
            <p role="alert" className="shrink-0 font-body text-[13px] text-oxblood-300">
              {refusalText(error.message)}
            </p>
          )}

          <div className="ink-frame min-h-0 flex-1 overflow-y-auto" data-testid="faction-workspace">
            {section === 'table' && (
              <Table
                data={data}
                faction={faction}
                myUserId={myUserId}
                pending={pending}
                onInvite={() => setInviting(true)}
                onAction={(userId, action) => memberAction.mutate({ userId, action })}
              />
            )}

            {section === 'fights' &&
              (data.battles.length === 0 ? (
                <Empty>
                  Nobody at this table has a fight called. When one is, it shows up here and you can
                  put units into it.
                </Empty>
              ) : (
                <ul data-testid="faction-battles">
                  {data.battles.map((battle) => (
                    <FightRow
                      key={battle.battleId}
                      battle={battle}
                      pending={pending}
                      onReinforce={(battleId, unitId, count) =>
                        reinforce.mutate({ battleId, army: { [unitId]: count } })
                      }
                    />
                  ))}
                </ul>
              ))}

            {section === 'armies' &&
              (data.armies.length === 0 ? (
                <Empty>Nobody else is at the table yet.</Empty>
              ) : (
                <ul data-testid="faction-armies">
                  {data.armies.map((ally) => (
                    <li
                      key={ally.memberUserId}
                      className="border-b border-surface-700/70 px-4 py-3 last:border-b-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-stamp text-[15px] text-ink-100">
                          {ally.memberName}
                        </span>
                        <span className="font-display text-[12px] tabular-nums text-ink-300">
                          {ally.size} bodies
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {Object.entries(ally.army).map(([unitId, count]) => (
                          <span
                            key={unitId}
                            className="rounded-sm border border-surface-600 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.1em] text-ink-200"
                          >
                            {findUnit(unitId)?.name ?? unitId}{' '}
                            <span className="tabular-nums text-brass-300">{count}</span>
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              ))}

            {section === 'book' && (
              <Book
                data={data}
                faction={faction}
                onIdentity={(name, badge) => identity.mutate({ name, badge })}
                onDescription={(blurb) => describe.mutate({ blurb })}
                onLeave={() => leave.mutate(undefined)}
                onDisband={() => disband.mutate(undefined)}
                busy={identity.isPending || describe.isPending || leave.isPending}
              />
            )}
          </div>
        </div>
      </div>

      {inviting && (
        <Modal onClose={() => setInviting(false)} labelledBy="invite-title" size="default">
          <div className="flex flex-col gap-3 p-5">
            <h2 id="invite-title" className="font-stamp text-xl text-ink-100">
              Ask somebody to join
            </h2>
            <p className="font-body text-[13px] leading-relaxed text-ink-300">
              The invitation lands in their messages with a button on it. They decide from there.
            </p>
            <label className="flex flex-col gap-1">
              <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
                Their name in the city
              </span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                data-testid="invite-username"
                className="rounded-sm border border-surface-500 bg-surface-900 px-2.5 py-2 font-body text-[14px] text-ink-100"
              />
            </label>
            {invite.error && (
              <p role="alert" className="font-body text-[12px] text-oxblood-300">
                {refusalText(invite.error.message)}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                disabled={invite.isPending || username.trim().length === 0}
                data-testid="send-invite"
                onClick={() =>
                  invite.mutate(
                    { username: username.trim() },
                    {
                      onSuccess: () => {
                        setUsername('');
                        setInviting(false);
                      },
                    },
                  )
                }
              >
                Send it
              </Button>
              <Button variant="ghost" onClick={() => setInviting(false)}>
                Never mind
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}

/**
 * The plate at the top of the rail: the badge, big, and where you stand under it.
 *
 * Deliberately does *not* repeat the faction's name. The page is already titled with it, and a
 * heading directly under a heading saying the same words reads as a rendering bug rather than as
 * emphasis. What goes here instead is the thing the title cannot say: which of the three ranks you
 * hold, how full the table is, and how long it has been standing.
 */
function Identity({
  faction,
  rank,
  seats,
}: {
  faction: NonNullable<FactionResponse['faction']>;
  rank: FactionRank | null;
  seats: number;
}) {
  return (
    <section
      className="ink-frame flex shrink-0 items-center gap-3 p-3.5"
      data-testid="faction-identity"
    >
      <FactionBadge badge={faction.badge} size={60} title={`${faction.name}'s badge`} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-display text-[13px] font-bold uppercase tracking-[0.16em] text-brass-300">
          {rank ? FACTION_RANK_LABELS[rank] : 'Guest'}
        </span>
        <span aria-hidden className="ink-rule h-1 w-full" />
        <p className="font-body text-[11px] leading-tight text-ink-400">
          {seats} of {MAX_FACTION_MEMBERS} seats · since{' '}
          <span className="tabular-nums">{faction.foundedAt.slice(0, 10)}</span>
        </p>
      </div>
    </section>
  );
}

/** One reading about the faction as a whole. */
function Tally({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: 'faction' | 'units' | 'infamy' | 'level';
}) {
  return (
    <div className="ink-frame flex items-center gap-2.5 px-3 py-2.5">
      <span
        aria-hidden
        className="icon-plate flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-4 [&_svg]:w-4"
      >
        <Icon name={icon} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
          {label}
        </span>
        <span className="truncate font-display text-[15px] font-bold tabular-nums text-ink-100">
          {value}
        </span>
      </span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="p-4 font-body text-[13px] italic leading-relaxed text-ink-400">{children}</p>
  );
}

function Rail({
  section,
  onSelect,
  counts,
}: {
  section: SectionId;
  onSelect: (id: SectionId) => void;
  counts: Record<SectionId, ReactNode>;
}) {
  return (
    <ul
      className="min-h-0 flex-1 divide-y divide-surface-700/70 overflow-y-auto"
      data-testid="faction-sections"
    >
      {SECTIONS.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onSelect(entry.id)}
            aria-pressed={section === entry.id}
            data-testid={`faction-section-${entry.id}`}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-3 text-left transition-colors',
              section === entry.id
                ? 'bg-brass-300/10 text-brass-100'
                : 'text-ink-200 hover:bg-surface-700/50',
            )}
          >
            <span
              aria-hidden
              className="icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
            >
              <Icon name={entry.icon} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-display text-[12px] font-bold uppercase tracking-[0.14em]">
                {entry.label}
              </span>
              <span className="truncate font-body text-[11px] leading-tight text-ink-400">
                {entry.blurb}
              </span>
            </span>
            <span className="shrink-0 font-display text-[11px] tabular-nums text-ink-300">
              {counts[entry.id]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Table({
  data,
  faction,
  myUserId,
  pending,
  onInvite,
  onAction,
}: {
  data: FactionResponse;
  faction: NonNullable<FactionResponse['faction']>;
  myUserId: string;
  pending: boolean;
  onInvite: () => void;
  onAction: (userId: string, action: 'kick' | 'promote' | 'demote' | 'hand_over') => void;
}) {
  const canAsk = data.rank !== null && canInvite(data.rank);
  const vacancies = Math.max(0, MAX_FACTION_MEMBERS - data.members.length);
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-surface-700/70 px-4 py-2.5">
        <h2 className="font-display text-[12px] font-bold uppercase tracking-[0.18em] text-brass-300">
          {data.members.length} of {MAX_FACTION_MEMBERS}
        </h2>
        {canAsk && (
          <Button size="sm" data-testid="open-invite" onClick={onInvite}>
            Invite somebody
          </Button>
        )}
      </div>
      <ul data-testid="faction-members">
        {data.members.map((member) => (
          <MemberRow
            key={member.userId}
            member={member}
            badge={faction.badge}
            rank={data.rank}
            isSelf={member.userId === myUserId}
            pending={pending}
            onAction={(action) => onAction(member.userId, action)}
          />
        ))}
      </ul>
      {/* The seats nobody is in yet, drawn.
          A table of five with two people at it was a short list and then a wall of nothing, which
          reads as a screen that failed to load. The same empty chair the crew screen uses
          (`.ink-chair`) says the other three seats exist and are open, which is the actual state,
          and it gives the panel something to be. */}
      {vacancies > 0 && (
        <ul data-testid="faction-vacancies">
          {Array.from({ length: vacancies }, (_, index) => (
            <li
              key={index}
              className="flex min-w-0 items-center gap-3 border-b border-surface-700/70 px-4 py-2.5 last:border-b-0"
            >
              <span
                aria-hidden
                className="ink-chair h-9 w-8 shrink-0 opacity-35"
                style={{ aspectRatio: '96 / 112' }}
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-stamp text-[15px] leading-tight text-ink-400">
                  An empty seat
                </span>
                <span className="font-body text-[11px] leading-tight text-ink-500">
                  {canAsk
                    ? 'Somebody you invite could take it'
                    : 'A chief or the leader can fill it'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.pending.length > 0 && (
        <div className="border-t border-surface-700/70 px-4 py-2.5">
          <h3 className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
            Asked, not answered
          </h3>
          <p className="mt-1 font-body text-[12px] text-ink-300">
            {data.pending.length} invitation{data.pending.length === 1 ? '' : 's'} still open.
          </p>
        </div>
      )}
    </>
  );
}

/** One member. The hover is where the detail lives, which is what keeps the rows scannable. */
function MemberRow({
  member,
  badge,
  rank,
  isSelf,
  pending,
  onAction,
}: {
  member: FactionMember;
  badge: Badge;
  rank: FactionRank | null;
  isSelf: boolean;
  pending: boolean;
  onAction: (action: 'kick' | 'promote' | 'demote' | 'hand_over') => void;
}) {
  // Both questions are asked of the domain rather than re-derived here, so the greyed-out button
  // and the refusal behind it can never disagree about who may do what.
  const mayKick = rank !== null && !isSelf && canKick(rank, member.rank);
  const mayRank = rank !== null && !isSelf && canSetRank(rank) && member.rank !== 'leader';

  return (
    <li
      className="flex min-w-0 items-center gap-3 border-b border-surface-700/70 px-4 py-2.5 last:border-b-0"
      data-testid={`faction-member-${member.username}`}
    >
      <HoverCard
        label={`${member.username}: what they bring to the table`}
        card={
          <>
            <p className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
              {FACTION_RANK_LABELS[member.rank]}
              {member.isBot && ' · does not play'}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-body text-[12px] text-ink-200">
              <dt className="text-ink-400">Level</dt>
              <dd className="tabular-nums">{member.level}</dd>
              <dt className="text-ink-400">Infamy</dt>
              <dd className="tabular-nums">{Math.round(member.infamy).toLocaleString()}</dd>
              <dt className="text-ink-400">Bodies</dt>
              <dd className="tabular-nums">{member.armySize.toLocaleString()}</dd>
              <dt className="text-ink-400">Supply</dt>
              <dd className="tabular-nums">{member.supplyUsed.toLocaleString()}</dd>
              <dt className="text-ink-400">District</dt>
              <dd className="truncate">{member.districtName}</dd>
            </dl>
          </>
        }
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <FactionBadge badge={badge} size={30} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-stamp text-[15px] leading-tight text-ink-100">
              {member.username}
              {isSelf && <span className="ml-1.5 text-[11px] text-brass-300">you</span>}
            </span>
            <span className="truncate font-body text-[11px] leading-tight text-ink-400">
              {member.districtName}
            </span>
          </span>
        </span>
      </HoverCard>

      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span
          className={cn(
            'hidden font-display text-[10px] uppercase tracking-[0.14em] sm:block',
            member.rank === 'leader' ? 'text-brass-300' : 'text-ink-400',
          )}
        >
          {FACTION_RANK_LABELS[member.rank]}
        </span>
        <span className="font-display text-[13px] font-bold tabular-nums text-ink-100">
          {member.armySize}
          <span className="ml-1 text-[10px] font-normal text-ink-400">bodies</span>
        </span>
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
            onClick={() => onAction('hand_over')}
          >
            Hand over
          </Button>
        )}
        {mayKick && (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            data-testid={`kick-${member.username}`}
            onClick={() => onAction('kick')}
          >
            Remove
          </Button>
        )}
      </span>
    </li>
  );
}

/** One fight somebody at the table has called, and the control that puts units into it. */
function FightRow({
  battle,
  pending,
  onReinforce,
}: {
  battle: AllyBattle;
  pending: boolean;
  onReinforce: (battleId: string, unitId: string, count: number) => void;
}) {
  const units = useUnits();
  const army = units.data?.army ?? {};
  const fieldable = Object.entries(army).filter(([unitId, count]) => {
    const unit = findUnit(unitId);
    return count > 0 && unit !== undefined && unit.tier !== 'carrier';
  });
  const [unitId, setUnitId] = useState<string>(fieldable[0]?.[0] ?? '');
  const [count, setCount] = useState(1);
  const held = army[unitId] ?? 0;

  return (
    <li className="flex min-w-0 flex-col gap-2 border-b border-surface-700/70 px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 font-stamp text-[15px] leading-tight text-ink-100">
          {battle.targetName}
        </span>
        <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
          {battle.memberName} · {battle.side === 'attacker' ? 'attacking' : 'holding'}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 font-body text-[12px] text-ink-300">
        <span>
          Mark{' '}
          <span className="tabular-nums text-ink-100">{battle.scheduledFor.slice(11, 16)}</span> on{' '}
          <span className="tabular-nums text-ink-100">{battle.scheduledFor.slice(0, 10)}</span>
        </span>
        <span>
          <span className="tabular-nums text-ink-100">{battle.committed}</span> already committed
        </span>
        {battle.yourContribution > 0 && (
          <span className="text-brass-300">
            you sent <span className="tabular-nums">{battle.yourContribution}</span>
          </span>
        )}
      </div>

      {battle.canReinforce && fieldable.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-400">
              Send
            </span>
            <select
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
              data-testid={`reinforce-unit-${battle.battleId}`}
              className="min-w-0 rounded-sm border border-surface-500 bg-surface-900 px-2 py-1.5 font-body text-[13px] text-ink-100"
            >
              {fieldable.map(([id, have]) => (
                <option key={id} value={id}>
                  {UNIT_CATALOG.find((unit) => unit.id === id)?.name ?? id} ({have})
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label="How many"
            value={count}
            min={1}
            max={Math.max(1, held)}
            onChange={setCount}
          />
          <Button
            size="sm"
            disabled={pending || held < 1}
            data-testid={`reinforce-${battle.battleId}`}
            onClick={() => onReinforce(battle.battleId, unitId, count)}
          >
            Send help
          </Button>
        </div>
      ) : (
        <p className="font-body text-[12px] italic text-ink-400">
          {battle.canReinforce
            ? 'Nothing on your roster to send.'
            : 'The mark has passed. Nobody is moving now.'}
        </p>
      )}
    </li>
  );
}

/**
 * The book: what the faction is called, what each rank carries, and the way out.
 *
 * The three are on one screen because they are the three things you come here to *change* rather
 * than to read, and each is gated differently: the leader owns the name and the badge, a chief
 * keeps the description, and leaving is everybody's.
 */
function Book({
  data,
  faction,
  onIdentity,
  onDescription,
  onLeave,
  onDisband,
  busy,
}: {
  data: FactionResponse;
  faction: NonNullable<FactionResponse['faction']>;
  onIdentity: (name: string, badge: Badge) => void;
  onDescription: (blurb: string) => void;
  onLeave: () => void;
  onDisband: () => void;
  busy: boolean;
}) {
  const rank = data.rank;
  const [name, setName] = useState(faction.name);
  const [badge, setBadge] = useState<Badge>(faction.badge);
  const [blurb, setBlurb] = useState(faction.blurb);
  const [leaving, setLeaving] = useState(false);
  const [disbanding, setDisbanding] = useState(false);

  const mayIdentity = rank !== null && canEditIdentity(rank);
  const mayDescribe = rank !== null && canEditDescription(rank);
  const takesItWithYou = rank !== null && leavingDisbands(rank, data.members.length);

  return (
    <div className="flex flex-col gap-5 p-4">
      <section className="flex flex-col gap-3">
        <Heading>Name and badge</Heading>
        {mayIdentity ? (
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={FACTION_NAME_MAX}
              data-testid="edit-name"
              className="rounded-sm border border-surface-500 bg-surface-900 px-3 py-2 font-stamp text-[16px] text-ink-100"
            />
            <BadgeBuilder badge={badge} onChange={setBadge} />
            <Button
              className="self-start"
              disabled={busy || name.trim().length < 3}
              data-testid="save-identity"
              onClick={() => onIdentity(name.trim(), badge)}
            >
              Save name and badge
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-3">
            <FactionBadge badge={faction.badge} size={64} title={`${faction.name}'s badge`} />
            <div className="flex flex-col gap-1">
              <span className="font-stamp text-[17px] text-ink-100">{faction.name}</span>
              <span className="font-body text-[12px] text-ink-400">
                Only the leader changes these.
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <Heading>Description</Heading>
        {mayDescribe ? (
          <>
            <textarea
              value={blurb}
              onChange={(event) => setBlurb(event.target.value)}
              maxLength={FACTION_BLURB_MAX}
              rows={2}
              data-testid="edit-blurb"
              className="rounded-sm border border-surface-500 bg-surface-900 px-3 py-2 font-body text-[13px] text-ink-100"
            />
            <Button
              className="self-start"
              size="sm"
              disabled={busy}
              data-testid="save-blurb"
              onClick={() => onDescription(blurb.trim())}
            >
              Save description
            </Button>
          </>
        ) : (
          <p className="font-body text-[13px] leading-relaxed text-ink-300">
            {faction.blurb || 'Nothing written down.'}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <Heading>What each rank carries</Heading>
        <ul className="flex flex-col gap-1.5" data-testid="rank-book">
          {FACTION_RANKS.map((entry) => (
            <li
              key={entry}
              className={cn(
                'flex min-w-0 flex-col rounded-sm border px-3 py-2',
                entry === rank ? 'border-brass-300/70 bg-brass-300/10' : 'border-surface-600/80',
              )}
            >
              <span className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
                {FACTION_RANK_LABELS[entry]}
                {entry === rank && <span className="ml-2 text-ink-300">you</span>}
              </span>
              <span className="font-body text-[12px] leading-snug text-ink-300">
                {FACTION_RANK_BLURBS[entry]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <Heading>The door</Heading>
        <p className="font-body text-[13px] leading-relaxed text-ink-300">
          {takesItWithYou
            ? data.members.length > 1
              ? 'You lead this faction, so leaving ends it for everybody at the table. Hand it to somebody first if you want it to carry on without you.'
              : 'You are the only one here, so leaving ends it.'
            : 'You can walk out whenever you like. What you have sent to a fight already in flight stays sent.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={busy}
            data-testid="leave-faction"
            onClick={() => setLeaving(true)}
          >
            Leave the faction
          </Button>
          {rank !== null && canEditIdentity(rank) && data.members.length > 1 && (
            <Button
              variant="danger"
              disabled={busy}
              data-testid="disband-faction"
              onClick={() => setDisbanding(true)}
            >
              Disband it
            </Button>
          )}
        </div>
      </section>

      {leaving && (
        <Confirm
          title={takesItWithYou ? 'This ends the faction' : 'Leave the faction?'}
          body={
            takesItWithYou
              ? `${faction.name} is disbanded the moment you go, for all ${data.members.length} of you. This cannot be undone.`
              : `You leave ${faction.name}. Its fights stop showing up on your screen.`
          }
          confirm={takesItWithYou ? 'Leave and disband it' : 'Leave'}
          testId="confirm-leave"
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            setLeaving(false);
            onLeave();
          }}
        />
      )}

      {disbanding && (
        <Confirm
          title="Disband the faction"
          body={`${faction.name} and everything at its table goes, for all ${data.members.length} of you. This cannot be undone.`}
          confirm="Disband it"
          testId="confirm-disband"
          onCancel={() => setDisbanding(false)}
          onConfirm={() => {
            setDisbanding(false);
            onDisband();
          }}
        />
      )}
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
        {children}
      </h3>
      <span aria-hidden className="ink-rule h-1 w-full" />
    </div>
  );
}
