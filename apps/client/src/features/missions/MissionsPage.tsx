import {
  MISSION_STANCE_SPECS,
  MISSION_TEMPLATES,
  OFFICER_ROLE_LABELS,
  findMissionTemplate,
  formatCountdown,
  formatDuration,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  missionRewards,
  missionTimings,
  requiresOfficer,
  templateTimings,
  type AssigneeOfficer,
  type LevelUp,
  type Mission,
  type MissionKind,
  type MissionPhase,
  type MissionStance,
  type MissionTemplate,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';
import { RewardLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { useAssignees, useLaunchMission, useMissions } from '../../lib/queries';
import { useServerClock } from './useServerClock';
import { PageShell } from '../game/PageShell';

const KIND_LABEL: Record<MissionKind, string> = {
  standard: 'Standard',
  battle: 'Battle',
};

/** Battles read hot, standard work reads cool: the §E5 risk difference at a glance. */
const KIND_STYLE: Record<MissionKind, string> = {
  standard: 'border-brass-300/50 text-brass-300',
  battle: 'border-oxblood-500/50 text-oxblood-300',
};

/**
 * §A3/§D8, which way the job points at the Combine, shown only when it points at all. A badge on
 * every card would be noise; a badge on the ones that move a reputation counter is the warning the
 * player needs before committing a crew.
 */
const STANCE_STYLE: Record<Exclude<MissionStance, 'unaligned'>, string> = {
  against_government: 'border-warning/50 text-warning',
  for_government: 'border-surface-500 text-ink-200',
};

const PHASE_LABEL: Record<MissionPhase, string> = {
  outbound: 'Outbound',
  onSite: 'On site',
  returning: 'Returning',
  returned: 'At the gate',
};

function Tag({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center border border-surface-600 px-2 py-1 font-display text-[10px] uppercase tracking-[0.18em] text-ink-300',
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * §E4: travel and mission time are shown as two separate figures, never rolled into one, with
 * the §E8 total spelled out underneath so the player can see where it came from.
 */
function TimingBreakdown({ template }: { template: MissionTemplate }) {
  const { travelMinutes, durationMinutes, totalMinutes } = templateTimings(template);
  return (
    <dl className="grid grid-cols-2 gap-px border border-surface-700 bg-surface-700">
      <TimingCell label="Travel" value={formatDuration(travelMinutes)} hint="each way, ×2" />
      <TimingCell label="On site" value={formatDuration(durationMinutes)} hint="the mission" />
      <div className="col-span-2 flex items-baseline justify-between gap-3 bg-surface-950 px-2.5 py-2">
        <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          Total round trip
        </dt>
        <dd className="font-display text-sm font-semibold tabular-nums text-brass-300">
          {formatDuration(totalMinutes)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Nothing here truncates. These cells are the narrowest text on the page and the copy is fixed,
 * so a clipped label would be a permanent defect rather than a fat-content edge case: the
 * §E4 figures wrap instead.
 */
function TimingCell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface-950 px-2.5 py-2">
      <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="font-display text-sm font-semibold tabular-nums text-ink-200">{value}</dd>
      <dd className="font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">{hint}</dd>
    </div>
  );
}

/**
 * The §G roster as this board knows it, who may lead a run here.
 *
 * Three states, not a list and a flag: an absent roster is not an empty one, and a roster the
 * server refused to hand over is neither. Collapsing any pair of them puts a false sentence in
 * front of the player: "Hire one at the Bar" is a lie to a fully staffed crew, and "Reading the
 * roster…" is a lie once the read has failed and (`retry: false`) will not be tried again.
 */
type Roster =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; officers: readonly AssigneeOfficer[] };

/** The officers a card may offer: nobody, until the roster has actually arrived. */
function rosterOfficers(roster: Roster): readonly AssigneeOfficer[] {
  return roster.status === 'ready' ? roster.officers : [];
}

interface MissionCardProps {
  template: MissionTemplate;
  roster: Roster;
  disabled: boolean;
  pending: boolean;
  /** Why this card's last launch was refused, if it was: the server's own words. */
  refusal: string | null;
  onLaunch: (templateId: string, officerId?: string) => void;
}

/**
 * §G6, who is leading this run.
 *
 * The gate is server-side (`MISSION_NEEDS_OFFICER`), so the card has to be able to *satisfy* it:
 * a hard run with no officer named is refused outright, which without this control made every
 * hard template a dead Deploy button. An easy run defaults to a delegation and only takes a
 * leader if the player asks, because that is the §G6 choice the player is entitled to make.
 */
function LeaderPicker({
  template,
  roster,
  leader,
  onPick,
}: {
  template: MissionTemplate;
  roster: Roster;
  leader: AssigneeOfficer | undefined;
  onPick: (officerId: string) => void;
}) {
  const needsOfficer = requiresOfficer(template.difficulty);
  const officers = rosterOfficers(roster);
  /** Easy work always has something to offer: §G6's delegation. Hard work needs a real name. */
  const canPick = !needsOfficer || officers.length > 0;
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
        Leading
      </span>
      {/*
       * A failed read is said out loud on *every* card, not just the ones it disables. An easy card
       * keeps its select, §G6 lets that work go out on a delegation, but the roster it should be
       * offering is missing from it, and an unexplained "Nobody" is the same absent-read-rendered-
       * as-empty-roster lie MOU-248 found on the hard cards, only quieter: a stocked player is
       * silently denied the officer they are entitled to put on an easy run for the §G5/§G7 bonus.
       *
       * The sentence names no remedy, matching the §G screen's own wording. Re-entering the page
       * refetches (`retryOnMount`), so "reload" would have been advice for a cheaper problem.
       */}
      {roster.status === 'error' && (
        <p className="text-[12px] leading-relaxed text-oxblood-300">
          Could not read your officers.
        </p>
      )}
      {/*
       * "You have nobody" is only true once the roster has actually answered. The officers arrive on
       * their own query, one round trip behind the board, which renders immediately off a static
       * template list, so treating "not loaded" as "empty" told every player with a full crew to go
       * hire an officer, on all four hard cards, on every visit to this page. A read that failed is
       * not a read that is still arriving either: this query never retries and is never polled, so
       * "Reading the roster…" would sit there for the life of the page.
       *
       * This one stays gated to hard cards while the error line above is not, deliberately: loading
       * ends in one round trip, so an easy card that flashed a line on every normal load would be
       * noise; a failed read never ends, which is what earns it a place on all eight.
       */}
      {needsOfficer && roster.status === 'loading' && (
        <p className="text-[12px] leading-relaxed text-ink-300">Reading the roster…</p>
      )}
      {needsOfficer && roster.status === 'ready' && officers.length === 0 && (
        <p className="text-[12px] leading-relaxed text-warning">
          Hard runs need an officer leading them. Hire one at the Bar.
        </p>
      )}
      {canPick && (
        /*
         * The name alone in the label, and the role as the hint underneath.
         *
         * A native `<select>` clipped the long ones without so much as an ellipsis: this control
         * is one column of a three-up card grid, and "The Ghost of Sector Nine" is not a short
         * name. The painted list draws itself at whatever width the names need, so the role can
         * come back as a second line: it earns nothing mechanically (§G5/§G7 pay for the assignees
         * standing under an officer, not for what they are called) but it is how a player tells
         * two similar names apart.
         */
        <Dropdown
          label="Who leads this run"
          value={leader?.officerId ?? ''}
          onChange={onPick}
          options={[
            // §G6's easy branch: an explicit choice, not the absence of one.
            ...(needsOfficer
              ? []
              : [{ value: '', label: 'Nobody', hint: 'Assignees alone, and slower for it' }]),
            ...officers.map((officer) => ({
              value: officer.officerId,
              label: officer.name,
              hint: OFFICER_ROLE_LABELS[officer.role],
            })),
          ]}
          data-testid={`mission-leader-${template.id}`}
        />
      )}
    </label>
  );
}

/** One entry on the board: the pre-commit screen for a single mission (§E4). */
function MissionCard({ template, roster, disabled, pending, refusal, onLaunch }: MissionCardProps) {
  const [pickedId, setPickedId] = useState('');
  const officers = rosterOfficers(roster);
  /*
   * A hard run cannot go out unled, so the first officer stands in until the player picks somebody:
   * deriving the leader instead of seeding state keeps this correct across the load: the officer
   * list arrives on its own query, and a `useState` default would have latched the empty roster.
   */
  const leader =
    officers.find((officer) => officer.officerId === pickedId) ??
    (requiresOfficer(template.difficulty) ? officers[0] : undefined);
  const unled = requiresOfficer(template.difficulty) && leader === undefined;

  return (
    <article className="flex min-w-0 flex-col gap-3 border border-surface-700 bg-surface-950 p-4">
      {/*
        `flex-wrap` is load-bearing now that a card can carry two tags. The tag group cannot shrink,
        so on a narrow column an un-wrapping header squeezes the heading down to a few characters
        and `break-words` then cuts it mid-word ("COURIE / R / CONTRA / CT"). Wrapping gives the
        heading the whole line and drops the tags underneath it instead.
      */}
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 className="min-w-0 break-words font-display text-sm font-semibold uppercase tracking-[0.14em] text-ink-100">
          {template.name}
        </h3>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {template.stance !== 'unaligned' && (
            <Tag
              label={MISSION_STANCE_SPECS[template.stance].label}
              className={STANCE_STYLE[template.stance]}
            />
          )}
          <Tag label={KIND_LABEL[template.kind]} className={KIND_STYLE[template.kind]} />
        </div>
      </header>

      <p className="min-w-0 break-words text-xs leading-relaxed text-ink-300">{template.brief}</p>

      <TimingBreakdown template={template} />

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
          Expected haul
        </span>
        <RewardLine rewards={missionRewards(template, 'success')} />
      </div>

      <LeaderPicker template={template} roster={roster} leader={leader} onPick={setPickedId} />

      {/*
       * The refusal sits in the card the player clicked, not at the foot of the board. The board is
       * eight cards in a scrolling grid, so a single message under the last one is off-screen for
       * anybody who deployed from the top: rendered, reported by a DOM assertion, and invisible to
       * the player, which is the same silent failure it exists to end.
       */}
      {refusal && (
        <p
          role="alert"
          className="min-w-0 break-words text-[12px] leading-relaxed text-oxblood-300"
        >
          {refusal}
        </p>
      )}

      <footer className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
          Success{' '}
          <span className="tabular-nums text-ink-200">
            {Math.round(template.successChance * 100)}%
          </span>
        </span>
        <Button
          size="sm"
          variant={template.kind === 'battle' ? 'danger' : 'primary'}
          disabled={disabled || pending || unled}
          onClick={() => onLaunch(template.id, leader?.officerId)}
        >
          {pending ? 'Sending…' : 'Deploy'}
        </Button>
      </footer>
    </article>
  );
}

/** One crew currently away, with its live countdown (§E3). */
function InFlightRow({ mission, now }: { mission: Mission; now: Date }) {
  const template = findMissionTemplate(mission.templateId);
  const phase = missionPhaseAt(mission, now);
  const progress = missionProgressAt(mission, now);
  const remaining = missionRemainingMs(mission, now);
  const done = remaining === 0;

  return (
    <li className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.14em] text-ink-100">
          {template?.name ?? mission.templateId}
        </span>
        <span
          className={cn(
            'shrink-0 font-display text-base font-semibold tabular-nums',
            done ? 'text-bile-300' : 'text-brass-300',
          )}
        >
          {done ? 'READY' : formatCountdown(remaining)}
        </span>
      </div>

      {/* The painted bar, so a crew in flight reads the same as a build, a batch and a project. */}
      <ProgressBar
        progress={progress}
        label={template?.name ?? mission.templateId}
        tone={done ? 'verdigris' : 'brass'}
      />

      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
          {PHASE_LABEL[phase]}
        </span>
        <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
          {formatDuration(missionTimings(mission).totalMinutes)} round trip
        </span>
      </div>
    </li>
  );
}

/** A crew that has come home, with what it actually banked. */
function ReturnedRow({ mission }: { mission: Mission }) {
  const template = findMissionTemplate(mission.templateId);
  const failed = mission.outcome === 'failure';
  return (
    <li className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.14em] text-ink-200">
          {template?.name ?? mission.templateId}
        </span>
        <Tag
          label={failed ? 'Lost' : 'Success'}
          className={
            failed ? 'border-oxblood-500/50 text-oxblood-300' : 'border-bile-300/50 text-bile-300'
          }
        />
      </div>
      <RewardLine rewards={mission.rewards} />
    </li>
  );
}

/** How many returned crews the page keeps on screen. */
const RETURNED_LIMIT = 6;

/**
 * The crews that came home most recently: by *return* time, not launch time.
 *
 * The server hands the board back in launch order, which is right for the in-flight list and
 * wrong for this one: a day-long expedition returns long after the short runs launched behind it,
 * so ordering by launch buries it under them and a bounded list drops it entirely: the player's
 * longest run is the one with no evidence it ever paid. Sorting is stable, so a batch that
 * settled on the same read keeps the server's launch order as its tiebreak.
 */
export function recentlyReturned(missions: readonly Mission[]): Mission[] {
  return missions
    .filter((mission) => mission.status === 'resolved')
    .sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
    .slice(0, RETURNED_LIMIT);
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-4 py-6 text-center font-display text-[11px] uppercase tracking-[0.2em] text-ink-300">
      {text}
    </p>
  );
}

/**
 * The dedicated missions page (GDD §E3): every crew that is away with its timer, the board they
 * were sent from (§E4), and what the last few brought back.
 */
export function MissionsPage() {
  const missionsQuery = useMissions();
  const assigneesQuery = useAssignees();
  const launch = useLaunchMission();

  const data = missionsQuery.data;
  const now = useServerClock(data?.serverNow, missionsQuery.dataUpdatedAt);
  const roster: Roster = assigneesQuery.data
    ? { status: 'ready', officers: assigneesQuery.data.officers }
    : assigneesQuery.isError
      ? { status: 'error' }
      : { status: 'loading' };

  /*
   * A crew can level the player up while this page is simply *open*, and the server announces that
   * on the settling response only: the next poll says nothing. So it is latched here rather than
   * read straight from `data`, or it would flash for one poll interval and vanish.
   *
   * Keyed on the value, which is safe precisely because `level` strictly increases: two separate
   * announcements can never be the deep-equal object react-query's structural sharing would hold
   * identity on, so this fires exactly once per level-up.
   */
  const [levelUp, setLevelUp] = useState<LevelUp | null>(null);
  const polledLevelUp = data?.levelUp;
  useEffect(() => {
    if (polledLevelUp) setLevelUp(polledLevelUp);
  }, [polledLevelUp]);

  const missions = data?.missions ?? [];
  const active = missions.filter((mission) => mission.status === 'active');
  const returned = recentlyReturned(missions);
  const limit = data?.activeLimit ?? 0;
  const atCapacity = limit > 0 && active.length >= limit;

  return (
    <PageShell
      title="Missions"
      icon="missions"
      // A quotation, not a lede. It is the one line on this screen that is not telling anybody a
      // number, and it was set in the same grey help text as the travel-time explainer beside it.
      quote="The first death is in the heart. Get out there and show you are still alive."
    >
      {levelUp && (
        <div className="flex flex-col gap-2">
          <LevelUpBanner levelUp={levelUp} />
          <button
            type="button"
            onClick={() => setLevelUp(null)}
            className="self-end font-display text-[11px] uppercase tracking-[0.18em] text-ink-300 hover:text-ink-200"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="In Flight"
          action={
            <span className="shrink-0 font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
              <span className="tabular-nums text-ink-200">{active.length}</span>
              {limit > 0 ? <span className="tabular-nums"> / {limit}</span> : null} crews out
            </span>
          }
        >
          {missionsQuery.isLoading ? (
            <EmptyRow text="Reading the board…" />
          ) : active.length === 0 ? (
            <EmptyRow text="Every crew is home" />
          ) : (
            <ul aria-label="Crews in flight" className="flex flex-col divide-y divide-surface-700">
              {active.map((mission) => (
                <InFlightRow key={mission.id} mission={mission} now={now} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recently Returned">
          {returned.length === 0 ? (
            <EmptyRow text="No crew has come back yet" />
          ) : (
            <ul aria-label="Crews returned" className="flex flex-col divide-y divide-surface-700">
              {returned.map((mission) => (
                <ReturnedRow key={mission.id} mission={mission} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="Mission Board"
        action={
          atCapacity ? (
            <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-warning">
              All crews deployed
            </span>
          ) : null
        }
      >
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {MISSION_TEMPLATES.map((template) => (
            <MissionCard
              key={template.id}
              template={template}
              roster={roster}
              disabled={atCapacity}
              pending={launch.isPending && launch.variables?.templateId === template.id}
              refusal={
                launch.error && launch.variables?.templateId === template.id
                  ? launch.error.message
                  : null
              }
              onLaunch={(templateId, officerId) =>
                launch.mutate(
                  { templateId, ...(officerId ? { officerId } : {}) },
                  // A launch settles the board first, so this response is the only place a crew
                  // that landed on it is ever reported: including when the launch is then
                  // refused, since the settle is not rolled back (MOU-280).
                  {
                    onSuccess: (result) => result.levelUp && setLevelUp(result.levelUp),
                    onError: (error) => error.levelUp && setLevelUp(error.levelUp),
                  },
                )
              }
            />
          ))}
        </div>
      </Panel>
    </PageShell>
  );
}
