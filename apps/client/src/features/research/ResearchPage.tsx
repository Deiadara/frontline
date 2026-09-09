import {
  OFFICER_ROLE_LABELS,
  RESEARCH_TRACK_BLURBS,
  RESEARCH_TRACK_STEPS,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  findResearchItem,
  formatCountdown,
  formatDuration,
  knownBlueprints,
  researchProgressAt,
  researchRemainingMs,
  type ActiveResearch,
  type LabTech,
  type OfficerRole,
  type ResearchResponse,
  type ResearchTrackStatus,
} from '@frontline/shared';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import { useMarket, useResearch, useStartTech } from '../../lib/queries';
import { PageShell } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { TrackSigil } from './TrackSigil';
import { BlueprintsSection } from './BlueprintsSection';

/**
 * The research page (GDD §C, §D, §I1): two doors and one workspace.
 *
 * **Programmes** is §C, the nineteen officer tracks. **Blueprints** is §D, the documents the crew
 * is assembling out of mission pages. They are one screen because they are one question, what the
 * Lab can open next, asked from two directions: one is time and two chairs, the other is paper.
 *
 * Nothing on this page derives a rule. Every rung arrives with its price, its clock and the reason
 * it is shut already worded by `GET /research`, and the blueprint side reads the satchel it is
 * drawn from. Which door is open is the URL, so a link into a document lands on the document.
 */

function EmptyRow({ text }: { text: string }) {
  return <p className="px-4 py-6 text-center text-xs text-ink-300">{text}</p>;
}

/** What the crew is on, in one line. */
function titleOf(project: ActiveResearch['project']): string {
  const spec = findResearchItem(project.techId);
  return spec ? `${OFFICER_ROLE_LABELS[spec.track]}: ${spec.name}` : 'A research programme';
}

function ActiveProject({ active, at }: { active: ActiveResearch; at: Date }) {
  const remaining = researchRemainingMs(active, at);

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* One painted bar, the same one a mission and a training batch draw, so every running clock
          in the game reads as the same kind of thing. */}
      <ProgressBar
        progress={researchProgressAt(active, at)}
        label={titleOf(active.project)}
        remaining={remaining === 0 ? 'Landing…' : formatCountdown(remaining)}
        size="md"
        data-testid="research-progress"
      />
    </div>
  );
}

/**
 * §C: the nineteen tracks, and what standing on one costs.
 *
 * A track is an officer's trade. It only moves while that officer is in their chair (§C1b) and
 * while somebody holds the Head of Research post (§C1c), and each rung wants the track's officer at
 * a mark (§C2a). What is not a threshold is a *number*: the Head of Research's own sheet takes a
 * percentage off every clock and the track officer's takes a percentage off every price, and both
 * read the points behind the letter rather than the letter (§C3b), so an afternoon of training
 * moves them.
 */

/** One row on the track rail: the sigil, the trade, how far up it the crew is. */
function TrackRow({
  status,
  selected,
  onSelect,
}: {
  status: ResearchTrackStatus;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`research-track-${status.role}`}
      className={cn(
        'flex w-full items-center gap-2.5 border-l-[3px] py-2 pl-2 pr-2.5 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm',
          selected ? 'text-brass-300' : status.mark === null ? 'text-ink-400' : 'text-ink-200',
        )}
      >
        <TrackSigil role={status.role} className="h-6 w-6" ringed={false} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[13px] leading-[1.15] text-ink-100">
          {OFFICER_ROLE_LABELS[status.role]}
        </span>
        <span
          className={cn(
            'block break-words font-body text-[11px] leading-snug',
            status.mark === null ? 'text-oxblood-300' : 'text-ink-300',
          )}
        >
          {status.mark === null ? 'Chair empty' : `${status.officerName ?? ''} · ${status.mark}`}
        </span>
      </span>
      <span className="shrink-0 font-display text-[11px] tabular-nums text-ink-200">
        {status.done}/{RESEARCH_TRACK_STEPS}
      </span>
    </button>
  );
}

/** The head of the chosen track: whose trade it is, who is on it, and what the two chairs buy. */
function TrackHeader({
  status,
  head,
}: {
  status: ResearchTrackStatus;
  head: ResearchResponse['head'];
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-surface-600/70 pb-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="icon-plate relative flex h-14 w-14 shrink-0 items-center justify-center rounded-sm text-brass-300"
        >
          <TrackSigil role={status.role} className="h-11 w-11" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-stamp text-[19px] leading-tight text-ink-100">
            {OFFICER_ROLE_LABELS[status.role]}
          </h3>
          <p className="break-words font-body text-[13px] leading-relaxed text-ink-300">
            {RESEARCH_TRACK_BLURBS[status.role]}
          </p>
        </div>
        {status.mark !== null && (
          <span className="relative h-14 w-14 shrink-0 text-oxblood-300">
            <MarkStamp
              mark={status.mark}
              className="inset-0 h-full w-full"
              tip={`${status.officerName ?? 'Your officer'} in this chair: ${status.mark}`}
            />
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <ChairNote
          label={OFFICER_ROLE_LABELS[status.role]}
          who={status.officerName}
          note={
            status.officerName === null
              ? 'Nothing on this track moves until somebody is in the chair.'
              : `${status.costCutPercent.toFixed(1)}% off every price on this track.`
          }
        />
        <ChairNote
          label={OFFICER_ROLE_LABELS.head_of_research}
          who={head?.name ?? null}
          note={
            head === null
              ? 'Every track on every trade is shut without one.'
              : `${head.timeCutPercent.toFixed(1)}% off every research clock.`
          }
        />
      </div>
    </header>
  );
}

/** One of the two chairs a track is standing on, and what that person's sheet is worth. */
function ChairNote({ label, who, note }: { label: string; who: string | null; note: string }) {
  return (
    <span
      className={cn(
        'flex min-w-0 flex-1 basis-64 flex-col gap-0.5 rounded-sm border px-2.5 py-1.5',
        who === null ? 'border-oxblood-500/50 bg-oxblood-700/15' : 'border-surface-600/70',
      )}
    >
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
        {label}
      </span>
      <span className="break-words font-display text-[12px] text-ink-100">{who ?? 'Nobody'}</span>
      <span
        className={cn(
          'break-words font-body text-[11px] leading-snug',
          who === null ? 'text-oxblood-100' : 'text-brass-300',
        )}
      >
        {note}
      </span>
    </span>
  );
}

/** One rung: what it does, what the two chairs have to be, what it costs, and why it is shut. */
function RungCard({
  item,
  running,
  pending,
  onStart,
}: {
  item: LabTech;
  /** True while this very rung is the project on the bench. */
  running: boolean;
  pending: boolean;
  onStart: () => void;
}) {
  return (
    <li
      data-testid={`tech-${item.id}`}
      className={cn(
        'relative flex min-w-0 gap-3 rounded-sm border p-3 transition-colors',
        item.known
          ? 'border-bile-300/50 bg-bile-300/10'
          : running
            ? 'border-brass-300/70 bg-brass-300/10'
            : item.blocker === null
              ? 'border-surface-600 bg-surface-800/60'
              : 'border-surface-700 bg-surface-900/50 opacity-80',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-display text-[13px] font-bold tabular-nums',
          item.known
            ? 'border-bile-300/60 text-bile-300'
            : item.blocker === null
              ? 'border-brass-300/70 text-brass-300'
              : 'border-surface-600 text-ink-400',
        )}
      >
        {item.step}
      </span>

      {/*
       * Three lines, not six. Every rung carries a name, two marks, a sentence, a payout, a price
       * and a control, and stacked one per line that is a 150px card on a 1200px column: ten of
       * them and the tenth rung is three screens down. The price rides the title line and the
       * control rides the payout line, both pushed right, so the width does the work.
       */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h4 className="min-w-0 break-words font-display text-[13px] font-bold text-ink-100">
            {item.name}
          </h4>
          <span className="shrink-0 rounded-sm border border-oxblood-300/50 px-1.5 py-0.5 font-display text-[10px] font-bold tabular-nums text-oxblood-100">
            {item.requiresMark}
          </span>
          {item.requiresHeadMark !== null && (
            <span className="shrink-0 rounded-sm border border-iris-300/50 px-1.5 py-0.5 font-display text-[10px] tabular-nums text-iris-100">
              Head {item.requiresHeadMark}
            </span>
          )}
          {!item.known && !running && (
            <span className="ml-auto break-words text-right font-display text-[12px] tabular-nums text-ink-300">
              {RESOURCE_ORDER.filter((key) => (item.cost[key] ?? 0) > 0)
                .map(
                  (key) =>
                    `${(item.cost[key] ?? 0).toLocaleString()} ${RESOURCE_LABELS[key].toLowerCase()}`,
                )
                .join(' · ')}
              {' · '}
              {formatDuration(item.minutes)}
            </span>
          )}
        </div>
        <p className="break-words font-body text-[12px] leading-snug text-ink-200">
          {item.description}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="min-w-0 flex-1 break-words font-display text-[12px] uppercase tracking-[0.08em] text-brass-300">
            {item.effect}
          </p>
          {item.known ? (
            <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-bile-300">
              Done
            </span>
          ) : running ? (
            <span className="shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-brass-300">
              On the bench
            </span>
          ) : (
            <button
              type="button"
              disabled={item.blocker !== null || pending}
              data-sound="confirm"
              onClick={onStart}
              className={cn(
                'shrink-0 rounded-sm border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]',
                item.blocker === null
                  ? 'border-brass-300/70 text-brass-300 hover:bg-brass-300/10'
                  : 'cursor-not-allowed border-surface-700 text-ink-400',
              )}
            >
              {item.blocker ?? 'Put them on it'}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** The whole §C section: the rail of nineteen trades, and the ten rungs of the one chosen. */
function TracksSection({
  data,
  pending,
  onStart,
}: {
  data: ResearchResponse;
  pending: boolean;
  onStart: (techId: string) => void;
}) {
  const statuses = data.tracks;
  const [track, setTrack] = useState<OfficerRole | null>(null);
  const status = statuses.find((entry) => entry.role === track) ?? statuses[0];
  const running = data.active?.project.techId ?? null;

  if (!status) return <EmptyRow text="The archive has no tracks on file." />;

  return (
    <div className="grid min-h-0 items-start gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/*
       * One scroller for both columns, which is the workspace's own.
       *
       * A sticky rail with a scroller of its own was tried and reverted: pinned to the top of the
       * workspace it sat 31px above the sheet's visible edge, so its heading was clipped away and
       * the top row was cut in half. Two nested scrollers to save a page scroll is not worth a
       * heading that disappears.
       */}
      <Panel title="Trades" className="min-h-0 border border-surface-500/70">
        <ul className="min-h-0 divide-y divide-surface-700" data-testid="research-tracks">
          {statuses.map((entry) => (
            <li key={entry.role}>
              <TrackRow
                status={entry}
                selected={entry.role === track}
                onSelect={() => setTrack(entry.role)}
              />
            </li>
          ))}
        </ul>
      </Panel>

      <section
        data-testid={`tech-track-${status.role}`}
        className="card-paper washed rivets edge-lit flex min-w-0 flex-col gap-3 rounded-sm border border-surface-500/70 p-4 shadow-panel"
      >
        <TrackHeader status={status} head={data.head} />
        <ul className="flex flex-col gap-2">
          {data.technologies
            .filter((item) => item.track === status.role)
            .map((item) => (
              <RungCard
                key={item.id}
                item={item}
                running={running === item.id}
                pending={pending}
                onStart={() => onStart(item.id)}
              />
            ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * The two doors of the archive.
 *
 * `path` is the whole of the section state. A player who bookmarks a document, or follows a link
 * out of the satchel, lands on the document rather than on the tracks with a second click to make.
 */
const SECTIONS = [
  {
    id: 'programmes',
    path: '/game/research',
    label: 'Programmes',
    icon: 'flask',
    blurb: 'One track per trade, ten deep',
  },
  {
    id: 'blueprints',
    path: '/game/research/blueprints',
    label: 'Blueprints',
    icon: 'archive',
    blurb: 'Documents you are still short of',
  },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** One door on the rail: a plated mark, what it is, and what is happening behind it. */
function SectionButton({
  icon,
  label,
  blurb,
  state,
  selected,
  onSelect,
}: {
  icon: IconName;
  label: string;
  blurb: string;
  state: ReactNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`research-section-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      className={cn(
        // A lit left edge on the chosen one, the same signal the training rail uses.
        'flex w-full items-center gap-3 border-l-[3px] py-2.5 pl-2.5 pr-3 text-left transition-all duration-150',
        selected
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'icon-plate flex h-9 w-9 shrink-0 items-center justify-center rounded-sm [&_svg]:h-5 [&_svg]:w-5',
          selected ? 'text-brass-300' : 'text-ink-300',
        )}
      >
        <Icon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[14px] leading-[1.15] text-ink-100">
          {label}
        </span>
        <span className="block break-words font-body text-[11px] leading-snug text-ink-300">
          {blurb}
        </span>
      </span>
      <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.12em]">{state}</span>
    </button>
  );
}

export function ResearchPage() {
  const researchQuery = useResearch();
  const startTechMutation = useStartTech();
  // The satchel, for the door's count only. `BlueprintsSection` reads the same cached payload, so
  // opening the door costs nothing.
  const marketQuery = useMarket();
  const data = researchQuery.data;
  /*
   * The server's clock, corrected, not the browser's. The bar ticks every second and so looks
   * authoritative, and on a machine five minutes fast it read "Landing…" with a full bar for five
   * minutes while `GET /research` kept answering that the programme was still running. The
   * response carries `serverNow` for exactly this; every other countdown in the game reads it.
   */
  const now = useServerClock(data?.serverNow, researchQuery.dataUpdatedAt);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const section: SectionId = pathname.endsWith('/blueprints') ? 'blueprints' : 'programmes';

  const technologies = data?.technologies ?? [];
  const finished = technologies.filter((tech) => tech.known).length;
  const documents = marketQuery.data ? knownBlueprints(marketQuery.data.inventory).length : null;

  const stateOf = (id: SectionId): ReactNode =>
    id === 'programmes' ? (
      <span className="tabular-nums text-ink-200">
        {finished}/{technologies.length}
      </span>
    ) : (
      <span className="tabular-nums text-ink-200">{documents ?? ''}</span>
    );

  return (
    <PageShell
      quote="Nobody wrote down how any of it works. Somebody sits here until they have."
      wide
      fills
    >
      {/*
       * A fixed frame, a rail of doors, and one workspace: the same shape the Training tab uses,
       * and for the same reason. Stacked in a scrolling column, the tracks and the documents are
       * each tall enough to push the other below the fold.
       */}
      <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* Hugging, not filling. Two doors is the whole list and it can never grow, so a
              stretched panel would be a framed sheet of empty tin under them. The training rail
              fills because its roster does grow; this one does not. */}
          <Panel title="The archive" className="min-h-0 border border-surface-500/70">
            <ul
              className="min-h-0 flex-1 divide-y divide-surface-700 overflow-y-auto"
              data-testid="research-sections"
            >
              {SECTIONS.map((entry) => (
                <li key={entry.id}>
                  <SectionButton
                    icon={entry.icon}
                    label={entry.label}
                    blurb={entry.blurb}
                    state={stateOf(entry.id)}
                    selected={section === entry.id}
                    onSelect={() => void navigate(entry.path)}
                  />
                </li>
              ))}
            </ul>
          </Panel>
          {/* No caps readout at the foot of the rail (board request, 2026-09-09): the standing bar
              prints the same figure on every screen. */}
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* The bench in flight, over whichever door is open: a programme running is a fact about
              the whole archive, not about the page a player happens to be on. */}
          {data?.active && (
            <div className="card-paper washed rivets edge-lit shrink-0 rounded-sm border border-brass-500/40 shadow-panel">
              <ActiveProject active={data.active} at={now} />
            </div>
          )}

          {startTechMutation.error && (
            <p
              role="alert"
              className="shrink-0 font-body text-[13px] leading-relaxed text-oxblood-300"
            >
              {startTechMutation.error.message}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="research-workspace">
            {section === 'blueprints' ? (
              <BlueprintsSection />
            ) : researchQuery.isLoading ? (
              <EmptyRow text="Opening the archive…" />
            ) : !data ? (
              /* Not the same state as "still opening". This drew the loading line for a spent
                 retry too, so a 500 looked like a slow network and looked like it for ever. */
              <LoadFailure
                what="The archive"
                onRetry={() => void researchQuery.refetch()}
                detail="Nothing has been lost. Whatever is on the bench is still on it."
              />
            ) : (
              <TracksSection
                data={data}
                pending={startTechMutation.isPending}
                onStart={(techId) => startTechMutation.mutate({ techId })}
              />
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
