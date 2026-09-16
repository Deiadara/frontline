import {
  OFFICER_ROLES,
  OFFICER_ROLE_LABELS,
  RESEARCH_TRACK_BLURBS,
  RESEARCH_TRACK_STEPS,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  findResearchItem,
  formatCountdown,
  formatDuration,
  researchCancelWindowMs,
  researchProgressAt,
  researchRemainingMs,
  type ActiveResearch,
  type LabTech,
  type OfficerRole,
  type ResearchResponse,
  type ResearchTrackStatus,
} from '@frontline/shared';
import { NavLink, useLocation, useSearchParams } from 'react-router-dom';
import { CancelMark } from '../../components/ui/CancelMark';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import { useCancelResearch, useMe, useResearch, useStartTech } from '../../lib/queries';
import { announceWaived } from '../../lib/deltas';
import { PageShell } from '../game/PageShell';
import { useServerClock } from '../missions/useServerClock';
import { MarkStamp } from '../../components/ui/MarkStamp';
import { TrackSigil } from './TrackSigil';
import { BlueprintsSection } from './BlueprintsSection';
import { ReimaginingSection } from './ReimaginingSection';

/**
 * The research page (GDD §C, §D, §G2, §I1): three tabs and one workspace.
 *
 * **Programmes** is §C, the nineteen officer tracks. **Blueprints** is §D, the documents the crew
 * is assembling out of mission pages. **Reimagining** is §G2, the machine that eats three of those
 * pages and hands back a fourth. They are one screen because they are one question, what the Lab
 * can open next, asked from three directions: time and two chairs, paper, and the bench.
 *
 * Nothing on this page derives a rule. Every rung arrives with its price, its clock and the reason
 * it is shut already worded by `GET /research`, and the blueprint side reads the inventory it is
 * drawn from. Which tab is open is the URL, so a link into a document lands on the document.
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
  const cancel = useCancelResearch();

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
      {/* The first tenth of the project's clock: call it off and ninety percent comes back. */}
      <CancelMark
        windowMs={researchCancelWindowMs(active, at)}
        label={`Call off ${titleOf(active.project)}`}
        pending={cancel.isPending}
        onCancel={() => cancel.mutate({})}
        data-testid="cancel-research"
      />
      {cancel.error && (
        <p role="alert" className="font-body text-[13px] leading-relaxed text-oxblood-300">
          {cancel.error.message}
        </p>
      )}
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
                'brushed relative shrink-0 rounded-sm border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]',
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

/** Whether a `?track=` the player typed, or a stale bookmark carries, names a real trade. */
function isOfficerRole(value: string | null): value is OfficerRole {
  return value !== null && (OFFICER_ROLES as readonly string[]).includes(value);
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
  /*
   * The open trade lives in the URL (`?track=head_of_research`), the way the roster's tabs do.
   *
   * It was component state, which made the rail unreachable from anywhere else: the shut
   * Reimagining bench wants to send a player to the one rung that opens it, and a link that can
   * only say "the Programmes tab" lands them on the Head Spy with nineteen rows to read. `replace`,
   * because picking through the trades is browsing rather than navigating.
   */
  const [params, setParams] = useSearchParams();
  const requested = params.get('track');
  const track = isOfficerRole(requested) ? requested : null;
  const status = statuses.find((entry) => entry.role === track) ?? statuses[0];
  const running = data.active?.project.techId ?? null;

  if (!status) return <EmptyRow text="The archive has no tracks on file." />;

  return (
    <div className="grid min-h-0 items-start gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/*
       * One scroller for both columns, which is the workspace's own.
       *
       * A sticky rail with a scroller of its own was tried and reverted: pinned to the top of the
       * workspace it sat 31px above the sheet's visible edge, so its heading was clipped away and
       * the top row was cut in half. Two nested scrollers to save a page scroll is not worth a
       * heading that disappears.
       *
       * 19rem for the rail rather than 15 (maintainer request, 2026-09-10): a double-barrelled name
       * with a nickname in it wrapped onto two lines at 15, and the sheet beside it had more
       * width than ten rungs know what to do with. The sheet gives up what the rail takes.
       */}
      <Panel title="Trades" className="min-h-0 border border-surface-500/70">
        <ul className="min-h-0 divide-y divide-surface-700" data-testid="research-tracks">
          {statuses.map((entry) => (
            <li key={entry.role}>
              <TrackRow
                status={entry}
                selected={entry.role === track}
                onSelect={() => setParams({ track: entry.role }, { replace: true })}
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
 * The three tabs of the archive.
 *
 * `path` is the whole of the section state. A player who bookmarks a document, or follows a link
 * out of the inventory, lands on the document rather than on the tracks with a second click to make.
 *
 * A strip across the top rather than the rail of doors that stood here until the board's
 * 2026-09-10 call. The rail was 17rem of the frame spent on three rows, and the two screens that
 * needed the width most (eight page sheets on one line, a machine with four sockets in it) were the
 * two that had to give it up.
 *
 * Only Programmes carries a count. The doors used to print one on all three, and two of them were
 * measuring the wrong thing: a document count next to Blueprints reads as progress through the
 * catalogue when it is progress through an inventory, and a page count next to Reimagining is the size
 * of the pile the machine eats rather than anything a player is working towards. Rungs done out of
 * rungs there are is a real fraction, so it stayed.
 */
const SECTIONS = [
  { id: 'programmes', path: '/game/research', label: 'Programmes' },
  { id: 'blueprints', path: '/game/research/blueprints', label: 'Blueprints' },
  { id: 'reimagining', path: '/game/research/reimagining', label: 'Reimagining' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * The mark on the chosen tab: a pair of drafting compasses, open, with the pencil leg down.
 *
 * The archive's own, and the reason it is here rather than in `Icon`: every glyph in that set is a
 * nav mark used on several screens, and this one is furniture for one room (see the research
 * section at the foot of `index.css`).
 */
function CompassMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="8" cy="3" r="1.4" />
      <path d="M7.4 4.2L4 13M8.6 4.2L12 13" />
      <path d="M5.6 9.2h4.8" strokeWidth="1" opacity="0.7" />
    </svg>
  );
}

/** One tab: what it is, and on Programmes how far up the rungs the crew is. */
function SectionTab({
  path,
  label,
  count,
  active,
}: {
  path: string;
  label: string;
  count: string | null;
  active: boolean;
}) {
  return (
    <NavLink
      to={path}
      end
      data-testid={`research-tab-${label.toLowerCase()}`}
      className={cn(
        'flex items-center gap-2 rounded-sm border px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition-colors',
        active
          ? 'border-brass-300/80 bg-brass-300/15 text-brass-100'
          : 'border-surface-600 bg-surface-800/60 text-ink-300 hover:border-iris-300/60 hover:text-iris-100',
      )}
    >
      {active && <CompassMark className="h-3.5 w-3.5 shrink-0 text-brass-300" />}
      {label}
      {count !== null && <span className="tabular-nums opacity-80">{count}</span>}
    </NavLink>
  );
}

export function ResearchPage() {
  const researchQuery = useResearch();
  const startTechMutation = useStartTech();
  const me = useMe();
  const data = researchQuery.data;
  /*
   * The server's clock, corrected, not the browser's. The bar ticks every second and so looks
   * authoritative, and on a machine five minutes fast it read "Landing…" with a full bar for five
   * minutes while `GET /research` kept answering that the programme was still running. The
   * response carries `serverNow` for exactly this; every other countdown in the game reads it.
   */
  const now = useServerClock(data?.serverNow, researchQuery.dataUpdatedAt);
  const { pathname } = useLocation();

  const section: SectionId = pathname.endsWith('/blueprints')
    ? 'blueprints'
    : pathname.endsWith('/reimagining')
      ? 'reimagining'
      : 'programmes';

  const technologies = data?.technologies ?? [];
  const finished = technologies.filter((tech) => tech.known).length;

  const countOf = (id: SectionId): string | null =>
    id === 'programmes' ? `${finished}/${technologies.length}` : null;

  return (
    <PageShell quote="Research is finding out which bastard lied." wide fills>
      {/*
       * A fixed frame, a strip of tabs, and one workspace under them, which is the market's shape.
       * Stacked in a scrolling column, the tracks and the documents are each tall enough to push
       * the other below the fold, so whichever tab is chosen gets the whole of the frame.
       */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" data-testid="research-tabs">
          {SECTIONS.map((entry) => (
            <SectionTab
              key={entry.id}
              path={entry.path}
              label={entry.label}
              count={countOf(entry.id)}
              active={section === entry.id}
            />
          ))}
        </div>

        {/* The bench in flight, over whichever tab is open: a programme running is a fact about
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
          ) : section === 'reimagining' ? (
            <ReimaginingSection />
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
              onStart={(techId) =>
                startTechMutation.mutate(
                  { techId },
                  {
                    // The testing build waives the rung's bill: say what it was. See `announceWaived`.
                    onSuccess: () => {
                      const rung = data.technologies.find((item) => item.id === techId);
                      if (me.data?.admin === true && rung !== undefined) announceWaived(rung.cost);
                    },
                  },
                )
              }
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
