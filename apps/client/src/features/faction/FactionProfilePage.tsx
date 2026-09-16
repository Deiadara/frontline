import {
  FACTION_RANK_LABELS,
  MAX_FACTION_MEMBERS,
  type FactionProfileMember,
} from '@frontline/shared';
import { Link, useParams } from 'react-router-dom';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { useFactionProfile } from '../../lib/queries';
import { crewFileHref } from '../city/LocationSheet';
import { PageShell } from '../game/PageShell';
import { FileSection } from '../overseer/FileSection';
import { usePlayerZone } from '../settings/usePlayerZone';
import { FactionBadge } from './FactionBadge';
import { MemberFace } from './MemberFace';
import { RankStamp } from './RankStamp';
import { seatTicks } from './geometry';

/**
 * A faction's file, readable by anybody (maintainer request, 2026-09-12).
 *
 * The faction answer to a crew's file, and built to the same template on purpose: the badge and
 * the identity down a left rail, the facts in framed sections on the right, so somebody who has
 * read a crew's file can read a faction's without learning a second page.
 *
 * The one thing the reader changes is the door at the foot of the rail. Everything else is the
 * same page whether you are at this table or scouting it: the schema decides what is public (see
 * `FactionProfileResponseSchema`), not the component, which is what keeps a rival from being able
 * to tell they are being shown less.
 */

/** The way to a faction's file. One string, because the standings and this page both link there. */
export function factionProfileHref(factionId: string): string {
  return `/game/factions/${encodeURIComponent(factionId)}`;
}

/**
 * The seal the badge is pressed into, drawn at file size.
 *
 * The room's crest has a small one of these over the pinboard. This is the same grammar at four
 * times the size, which is what the maintainer asked for: two open rings that do not quite close, a
 * ring of ticks between them, and a pen that wobbles. The ticks are `seatTicks`, the same helper
 * that lays the chairs out around the table, so the seal and the room are drawn off one geometry.
 */
function Seal() {
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <filter id="faction-file-ink" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" seed="11" />
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g
        className="text-brass-500"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        filter="url(#faction-file-ink)"
      >
        <path d="M50 2 A48 48 0 1 1 49.4 2" strokeWidth="1.8" opacity="0.85" />
        <path d="M50 9 A41 41 0 1 1 49.5 9" strokeWidth="1" opacity="0.4" />
        {seatTicks(24, 47, 5).map((tick, index) => (
          <path key={index} d={tick} strokeWidth="1.4" opacity="0.45" />
        ))}
      </g>
    </svg>
  );
}

export function FactionProfilePage() {
  const { id } = useParams<{ id: string }>();
  const query = useFactionProfile(id);
  const zone = usePlayerZone();
  const data = query.data;

  if (!data) {
    return (
      <ScreenLoad
        what="This faction's file"
        loading="Pulling the file…"
        isError={query.isError}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { faction, members, averageLevel, rank, isYours } = data;
  /*
   * The founding date on the reader's own clock, the rule every other time in the game follows
   * (`usePlayerZone`). Written out rather than sliced off the ISO string: this is the one date on
   * the page and `2026-08-01` is a serial number, not a date somebody reads.
   */
  const founded = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: zone,
  }).format(new Date(faction.foundedAt));

  return (
    <PageShell
      wide
      title={faction.name}
      icon="faction"
      lede={`${members.length} of ${MAX_FACTION_MEMBERS} seats filled.`}
      action={
        isYours ? (
          <span className="rounded-sm border border-verdigris-300/60 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] text-verdigris-100">
            Your table
          </span>
        ) : undefined
      }
    >
      <div
        className="grid items-start gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]"
        data-testid="faction-profile"
        data-yours={isYours ? 'true' : 'false'}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <Panel className="flex flex-col border border-surface-500/70">
            <div
              data-testid="faction-profile-badge"
              className="painted washed edge-lit flex justify-center border-b border-surface-600/70 px-3 py-5"
            >
              {/* The badge is drawn 6:5, so the seal it sits in is square and a size larger than
                  the badge's own height: a ring tight to a banner's foot cuts the point off it. */}
              <span className="relative flex h-[13rem] w-[13rem] items-center justify-center">
                <Seal />
                <FactionBadge badge={faction.badge} size={128} title={`${faction.name}'s badge`} />
              </span>
            </div>
            <div className="flex flex-col gap-2.5 p-3.5">
              {/* The name is the page's heading, three inches above this, and printing it again
                  under the badge is the same word twice on one frame. What the rail adds is the
                  date, which nothing else on the page says. */}
              <p
                className="font-display text-[10px] uppercase tracking-[0.2em] text-brass-300"
                data-testid="faction-profile-founded"
              >
                Founded {founded}
              </p>
              <span aria-hidden className="ink-rule block w-full" />
              <p
                className="font-body text-[13px] italic leading-relaxed text-ink-200"
                data-testid="faction-profile-blurb"
              >
                {faction.blurb || 'Nothing written down about what this table is for.'}
              </p>
            </div>
          </Panel>

          {/* The doors, and which doors is the one thing the reader changes. */}
          <div className="flex flex-col gap-2" data-testid="faction-profile-doors">
            {isYours ? (
              <Door to="/game/faction" icon="faction" testId="faction-profile-room">
                Your table
              </Door>
            ) : (
              <Door to="/game/leaderboard" icon="standings" testId="faction-profile-board">
                The standings
              </Door>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <FileSection
            icon="infamy"
            title="What the table has won"
            note="Infamy earned under this badge, ever. Never a sum of what its members are holding."
          >
            <div className="flex flex-wrap items-end gap-4">
              <p
                className="font-display text-[38px] font-bold leading-none tabular-nums text-brass-100"
                data-testid="faction-profile-earned"
              >
                {Math.round(faction.infamyEarned).toLocaleString()}
              </p>
              <p className="min-w-0 flex-1 font-body text-[12px] leading-snug text-ink-300">
                Every fight won while wearing it, whoever won it and whether or not they are still
                at the table. Nothing takes any of it back.
              </p>
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="Average level"
                value={String(averageLevel)}
                testId="faction-profile-average"
              />
              <Stat label="Seats" value={`${members.length} of ${MAX_FACTION_MEMBERS}`} />
              {rank !== null && (
                <Stat label="On the board" value={`#${rank}`} testId="faction-profile-rank" />
              )}
            </dl>
          </FileSection>

          <FileSection
            icon="crew"
            title="At the table"
            note="Everybody standing under the badge, and what each of them is worth"
          >
            <ul className="flex flex-col gap-2" data-testid="faction-profile-members">
              {members.map((member) => (
                <Member key={member.userId} member={member} />
              ))}
            </ul>
          </FileSection>
        </div>
      </div>
    </PageShell>
  );
}

/** One person at the table: who they are, what they hold, and the two ways to reach them. */
function Member({ member }: { member: FactionProfileMember }) {
  return (
    <li
      data-testid={`faction-member-${member.username}`}
      className="card-paper washed flex min-w-0 items-center gap-3 rounded-sm border border-surface-600/80 p-2.5"
    >
      {/* Their own Overseer, the same face the member window and the crew file print. A roster of
          generated sigils is a roster of strangers, which is the opposite of what this page is
          for: the reader is deciding about these specific people. */}
      <span className="relative block h-14 w-12 shrink-0">
        <MemberFace member={member} size="sm" />
        {/* Lifted clear of the portrait's bottom edge.
            It sat at -bottom-1.5, which put the lettering straight across the edge of the
            picture, so the rank read as damage on the portrait rather than as a stamp under it.
            Four pixels up is enough for the text to clear the line; the ring around it still
            breaks the edge, which is what a stamp does (maintainer request, 2026-09-14). */}
        <RankStamp rank={member.rank} className="absolute -bottom-0.5 left-0 right-0 block h-5" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-stamp text-[15px] leading-tight text-ink-100">
          <Link
            to={crewFileHref(member.userId)}
            data-testid={`faction-member-link-${member.username}`}
            className="underline-offset-2 hover:underline"
          >
            {member.username}
          </Link>
          {member.isYou && <span className="ml-1.5 text-[11px] text-brass-300">you</span>}
          {member.isBot && <span className="ml-1.5 text-[11px] text-ink-500">house</span>}
        </span>
        <span className="truncate font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
          {FACTION_RANK_LABELS[member.rank]}
          <span className="text-ink-400"> · {member.districtName}</span>
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-3">
        <Figure label="Level" value={String(member.level)} />
        <Figure label="Infamy" value={Math.round(member.infamy).toLocaleString()} />
        {/* The mail, addressed. Not offered on your own row: a player writing to themselves is a
            control that can only be a mistake. */}
        {!member.isYou && (
          <Link
            // Addressed by the login handle, never by the name drawn on the row: the composer
            // hands whatever this carries to `POST /messages`, which resolves login names only.
            to={`/game/messages?to=${encodeURIComponent(member.handle)}`}
            aria-label={`Write to ${member.username}`}
            data-testid={`faction-member-message-${member.username}`}
            className="door-tile flex h-8 w-8 items-center justify-center rounded-sm border border-brass-500/60 text-brass-300 transition-colors hover:border-brass-300 hover:text-brass-100 [&_svg]:relative [&_svg]:z-[2] [&_svg]:h-4 [&_svg]:w-4"
          >
            <Icon name="messages" />
          </Link>
        )}
      </span>
    </li>
  );
}

/** A number on a member's row, labelled small above it so the row reads without a header. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex w-14 flex-col items-end">
      <span className="font-display text-[9px] uppercase tracking-[0.16em] text-ink-400">
        {label}
      </span>
      <span className="font-display text-[14px] font-bold leading-tight tabular-nums text-brass-100">
        {value}
      </span>
    </span>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-surface-700 bg-surface-950/40 px-2.5 py-2"
      data-testid={testId}
    >
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="break-words font-display text-[15px] font-bold leading-tight tabular-nums text-brass-100">
        {value}
      </dd>
    </div>
  );
}

function Door({
  to,
  icon,
  testId,
  children,
}: {
  to: string;
  icon: IconName;
  testId: string;
  children: string;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className="door-tile flex items-center justify-center gap-2 rounded-md border border-brass-500/60 px-3 py-2.5 font-display text-[12px] font-bold uppercase tracking-[0.16em] text-brass-300 transition-all duration-150 hover:-translate-y-0.5 hover:border-brass-300 hover:text-brass-100"
    >
      <span aria-hidden className="relative z-[2] [&_svg]:h-4 [&_svg]:w-4">
        <Icon name={icon} />
      </span>
      <span className="relative z-[2]">{children}</span>
    </Link>
  );
}
