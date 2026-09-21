import {
  REIMAGINING_PAGES_SPENT,
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
import { ProgressBar } from '../../components/ui/ProgressBar';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import { DrawnDisc, DrawnFace } from '../../components/ui/DrawnMarks';
import { useCancelResearch, useMe, useResearch, useStartTech } from '../../lib/queries';
import { announceWaived } from '../../lib/deltas';
import { InfoNote, PageShell } from '../game/PageShell';
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
      /*
       * The same three tones the feats index uses (maintainer, 2026-09-17): verdigris for a trade
       * worked to the last rung, brass for the one open, and plain surface for the rest. A trade
       * with nobody in the chair keeps its oxblood line underneath, which is the one thing on the
       * row that is a refusal rather than a state.
       */
      className={cn(
        'flex w-full items-center gap-2.5 rounded-sm border px-2 py-1.5 text-left transition-colors',
        selected
          ? 'border-brass-300 bg-brass-500/30 text-brass-100'
          : status.done >= RESEARCH_TRACK_STEPS
            ? 'border-verdigris-300/40 bg-verdigris-500/10 text-verdigris-100/90 hover:bg-verdigris-500/15'
            : 'border-surface-600/60 bg-surface-900/40 text-ink-200 hover:bg-surface-800/60',
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
      {/*
       * The board's own type, to the pixel (maintainer, 2026-09-17).
       *
       * `font-stamp` at 14 with a truncation rather than 13 with `break-words`: the two lists sit
       * one door apart and read as one book, and the wrap was what put a double-barrelled name with
       * a nickname in it onto two lines and made one row of nineteen taller than the rest.
       */}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-stamp text-[14px] leading-tight">
          {OFFICER_ROLE_LABELS[status.role]}
        </span>
        {/*
         * The role truncates, the person does not.
         *
         * A role is one of nineteen strings this build ships and the rail is sized for the longest
         * of them, so cutting it is impossible. A name is whatever somebody was called: truncating
         * it cut `Wenqing "Compass" Adebayo-Lindqvist` by two pixels, which the sheet's own
         * no-cut-text gate refuses and is right to. It wraps, and the row is a little taller.
         */}
        <span
          className={cn(
            'block break-words font-body text-[11px] leading-snug',
            status.mark === null ? 'text-oxblood-300' : 'opacity-70',
          )}
        >
          {status.mark === null ? 'Chair empty' : `${status.officerName ?? ''} · ${status.mark}`}
        </span>
      </span>
      <span className="shrink-0 font-display text-[10px] font-bold tabular-nums opacity-70">
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
          ? 'border-verdigris-300/40 bg-verdigris-500/10'
          : running
            ? 'border-brass-300/70 bg-brass-500/15'
            : item.blocker === null
              ? 'border-surface-600/60 bg-surface-900/40'
              : 'border-surface-700/60 bg-surface-950/40 opacity-80',
      )}
    >
      {/* The hand-inked disc the feats board rings its rungs with, rather than a CSS circle: the
          two screens are the same book, and a stroked border beside a drawn one reads as a
          different hand. */}
      <span
        aria-hidden
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center font-display text-[13px] font-bold tabular-nums',
          item.known
            ? 'text-verdigris-300'
            : item.blocker === null
              ? 'text-brass-300'
              : 'text-surface-500',
        )}
      >
        <DrawnDisc />
        <span className="relative">{item.step}</span>
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
            <span className="rubber-stamp shrink-0 font-stamp text-[11px] uppercase tracking-[0.14em]">
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
                'group/start relative shrink-0 px-3 py-1.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]',
                'transition-all duration-150 ease-out',
                item.blocker === null
                  ? 'text-brass-300 hover:-translate-y-px hover:text-brass-100 active:translate-y-px'
                  : 'cursor-not-allowed text-ink-400',
              )}
            >
              <DrawnFace
                face={cn(
                  'transition-all duration-150',
                  item.blocker === null
                    ? 'fill-brass-500/25 group-hover/start:fill-brass-500/40'
                    : 'fill-surface-950/50',
                )}
              />
              <span className="relative">{item.blocker ?? 'Put them on it'}</span>
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
    <div className="grid h-full min-h-0 grid-rows-[14rem_minmax(0,1fr)] gap-4 lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-1">
      {/*
       * A scroller in each column rather than one around both (maintainer, 2026-09-17).
       *
       * The first version shared the workspace's, and a sticky rail with its own was tried and
       * reverted before that: pinned to the top of a scrolling workspace it sat 31px above the
       * sheet's visible edge, so its heading was clipped away. Neither problem applies now, because
       * the workspace holds still and both columns are plain flex children of a grid that fills it:
       * each frame keeps its head where it was put and scrolls its own list underneath, which is
       * the shape the feats board uses.
       *
       * 19rem for the rail rather than 15 (maintainer request, 2026-09-10): a double-barrelled name
       * with a nickname in it wrapped onto two lines at 15, and the sheet beside it had more
       * width than ten rungs know what to do with. The sheet gives up what the rail takes.
       */}
      <nav
        aria-label="Officers"
        className="ink-frame card-paper washed grain flex min-h-0 flex-col rounded-sm shadow-panel"
      >
        {/*
         * The title in its own leaf `<span>`, which is not cosmetic.
         *
         * `expectNothingClippedVertically` skips any element that has element children, and the
         * `ink-rule` span is the heading's child: with the words sitting directly in the `h3` a
         * title sliced by the fold was invisible to the sweep. Text in a leaf, rule as its
         * sibling. `StructureDialog` carries the same note for the same reason.
         */}
        <h3 className="relative shrink-0 px-3 pb-2 pt-2.5 font-stamp text-[15px] leading-none text-brass-300">
          <span>Officers</span>
          <span aria-hidden className="ink-rule absolute inset-x-3 -bottom-[1px]" />
        </h3>
        {/* `px-1.5`, not the board's `px-2`: the rail is a fixed 19rem and the longest name on it
            is a double-barrelled one with a nickname in it, which wrapped onto a second line at the
            wider padding. The board's index has the whole column to give. */}
        <ul
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1.5 py-2"
          data-testid="research-tracks"
        >
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
      </nav>

      <section
        data-testid={`tech-track-${status.role}`}
        className="ink-frame card-paper washed grain flex min-h-0 min-w-0 flex-col gap-3 rounded-sm p-4 shadow-panel"
      >
        <TrackHeader status={status} head={data.head} />
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
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
        'group/tab relative flex items-center gap-2 px-4 py-2 font-display text-[12px] font-bold uppercase tracking-[0.16em] transition-all duration-150',
        'hover:-translate-y-px active:translate-y-px',
        active ? 'text-brass-100' : 'text-ink-300 hover:text-brass-100',
      )}
    >
      {/* Drawn rather than struck (maintainer, 2026-09-17), the same box the feats board's controls
          wear: the archive is paper, and a pressed-metal tab on a sheet of paper reads as a control
          bar bolted onto a document. */}

      <DrawnFace
        face={cn(
          'transition-all duration-150',
          active
            ? 'fill-brass-500/30 group-hover/tab:fill-brass-500/40'
            : 'fill-surface-900/50 group-hover/tab:fill-brass-500/15',
        )}
      />
      {active && <CompassMark className="relative h-3.5 w-3.5 shrink-0 text-brass-300" />}
      <span className="relative">{label}</span>
      {count !== null && <span className="relative tabular-nums opacity-80">{count}</span>}
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
    <PageShell
      quote="Research is finding out which bastard lied."
      // How the bench works, top right on the quotation's line while the bench is open
      // (maintainer, 2026-09-21). It was a paragraph over the bench, read once and in the way of
      // the sockets after that.
      action={
        section === 'reimagining' ? (
          <InfoNote label="How Reimagining Works" drawn>
            If you look at {REIMAGINING_PAGES_SPENT} random pages hard enough, you are guaranteed to
            come up with some new research. That&rsquo;s how it usually works anyway.
          </InfoNote>
        ) : undefined
      }
      wide
      fills
    >
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
          {/* The crew screen's line, running on from the last tab (maintainer, 2026-09-21). */}
          <span aria-hidden className="ink-rule block min-w-0 flex-1" />
        </div>

        {/* The bench in flight, over whichever tab is open: a programme running is a fact about
            the whole archive, not about the page a player happens to be on. */}
        {data?.active && (
          <div className="ink-frame card-paper washed grain shrink-0 rounded-sm shadow-panel">
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

        {/*
         * One scroller for the other two tabs, none for this one.
         *
         * Programmes is two columns that each want their own bar (maintainer, 2026-09-17), and a
         * pane cannot scroll inside a parent that is already scrolling: the inner one never gets a
         * height to overflow. So the workspace holds still here and the rail and the sheet each
         * take their own. Blueprints and Reimagining are single columns of cards and still scroll
         * as one, which is what they were built for.
         */}
        <div
          className={cn(
            'min-h-0 flex-1',
            section === 'programmes' ? 'overflow-hidden' : 'overflow-y-auto',
          )}
          data-testid="research-workspace"
        >
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
