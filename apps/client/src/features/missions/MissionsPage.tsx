import {
  MISSION_STANCE_SPECS,
  MISSION_TEMPLATES,
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
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useAssignees, useLaunchMission, useMissions } from '../../lib/queries';
import { useServerClock } from './useServerClock';

const KIND_LABEL: Record<MissionKind, string> = {
  standard: 'Standard',
  battle: 'Battle',
};

/** Battles read hot, standard work reads cool — the §E5 risk difference at a glance. */
const KIND_STYLE: Record<MissionKind, string> = {
  standard: 'border-neon-cyan/50 text-neon-cyan',
  battle: 'border-neon-magenta/50 text-neon-magenta',
};

/**
 * §A3/§D8 — which way the job points at the Combine, shown only when it points at all. A badge on
 * every card would be noise; a badge on the ones that move a reputation counter is the warning the
 * player needs before committing a crew.
 */
const STANCE_STYLE: Record<Exclude<MissionStance, 'unaligned'>, string> = {
  against_government: 'border-warning/50 text-warning',
  for_government: 'border-steel-500 text-steel-300',
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
        'inline-flex shrink-0 items-center border border-steel-700 px-2 py-1 font-display text-[9px] uppercase tracking-[0.18em] text-steel-400',
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * §E4 — travel and mission time are shown as two separate figures, never rolled into one, with
 * the §E8 total spelled out underneath so the player can see where it came from.
 */
function TimingBreakdown({ template }: { template: MissionTemplate }) {
  const { travelMinutes, durationMinutes, totalMinutes } = templateTimings(template);
  return (
    <dl className="grid grid-cols-2 gap-px border border-steel-800 bg-steel-800">
      <TimingCell label="Travel" value={formatDuration(travelMinutes)} hint="each way, ×2" />
      <TimingCell label="On site" value={formatDuration(durationMinutes)} hint="the mission" />
      <div className="col-span-2 flex items-baseline justify-between gap-3 bg-night px-2.5 py-2">
        <dt className="font-display text-[9px] uppercase tracking-[0.16em] text-steel-500">
          Total round trip
        </dt>
        <dd className="font-display text-sm font-semibold tabular-nums text-neon-cyan">
          {formatDuration(totalMinutes)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Nothing here truncates. These cells are the narrowest text on the page and the copy is fixed,
 * so a clipped label would be a permanent defect rather than a fat-content edge case — the
 * §E4 figures wrap instead.
 */
function TimingCell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-night px-2.5 py-2">
      <dt className="font-display text-[9px] uppercase tracking-[0.16em] text-steel-500">
        {label}
      </dt>
      <dd className="font-display text-sm font-semibold tabular-nums text-steel-200">{value}</dd>
      <dd className="font-display text-[9px] uppercase tracking-[0.14em] text-steel-600">{hint}</dd>
    </div>
  );
}

interface MissionCardProps {
  template: MissionTemplate;
  /** The officers on the books, as the §G screen reports them — who may lead this run. */
  officers: readonly AssigneeOfficer[];
  /** Whether the officer list has actually answered — absent is not the same as empty. */
  rosterKnown: boolean;
  disabled: boolean;
  pending: boolean;
  /** Why this card's last launch was refused, if it was — the server's own words. */
  refusal: string | null;
  onLaunch: (templateId: string, officerId?: string) => void;
}

/**
 * §G6 — who is leading this run.
 *
 * The gate is server-side (`MISSION_NEEDS_OFFICER`), so the card has to be able to *satisfy* it:
 * a hard run with no officer named is refused outright, which without this control made every
 * hard template a dead Deploy button. An easy run defaults to a delegation and only takes a
 * leader if the player asks, because that is the §G6 choice the player is entitled to make.
 */
function LeaderPicker({
  template,
  officers,
  rosterKnown,
  leader,
  onPick,
}: {
  template: MissionTemplate;
  officers: readonly AssigneeOfficer[];
  rosterKnown: boolean;
  leader: AssigneeOfficer | undefined;
  onPick: (officerId: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
        Leading
      </span>
      {/*
       * "You have nobody" is only true once the roster has actually answered. The officers arrive on
       * their own query, one round trip behind the board — which renders immediately off a static
       * template list — so treating "not loaded" as "empty" told every player with a full crew to go
       * hire an officer, on all four hard cards, on every visit to this page.
       */}
      {requiresOfficer(template.difficulty) && !rosterKnown ? (
        <p className="text-[11px] leading-relaxed text-steel-600">Reading the roster…</p>
      ) : requiresOfficer(template.difficulty) && officers.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-warning">
          Hard runs need an officer leading them. Hire one at the Bar.
        </p>
      ) : (
        <select
          value={leader?.officerId ?? ''}
          onChange={(event) => onPick(event.target.value)}
          className="min-w-0 border border-steel-700 bg-night px-2 py-1.5 text-[11px] text-steel-200"
        >
          {/* §G6's easy branch — an explicit choice, not the absence of one. */}
          {!requiresOfficer(template.difficulty) && (
            <option value="">Nobody — assignees alone, slower</option>
          )}
          {/*
           * The name alone. A role label reads well on the §G screen, which has the width for it,
           * but this control is one column of a three-up card grid: "The Ghost of Sector Nine —
           * Instructor of the Young" is cut mid-word by the select's own edge, and a native select
           * clips without so much as an ellipsis. The role also earns nothing here — §G5/§G7 pay
           * for the assignees standing under an officer, not for what they are called.
           */}
          {officers.map((officer) => (
            <option key={officer.officerId} value={officer.officerId}>
              {officer.name}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

/** One entry on the board — the pre-commit screen for a single mission (§E4). */
function MissionCard({
  template,
  officers,
  rosterKnown,
  disabled,
  pending,
  refusal,
  onLaunch,
}: MissionCardProps) {
  const [pickedId, setPickedId] = useState('');
  /*
   * A hard run cannot go out unled, so the first officer stands in until the player picks somebody
   * — deriving the leader instead of seeding state keeps this correct across the load: the officer
   * list arrives on its own query, and a `useState` default would have latched the empty roster.
   */
  const leader =
    officers.find((officer) => officer.officerId === pickedId) ??
    (requiresOfficer(template.difficulty) ? officers[0] : undefined);
  const unled = requiresOfficer(template.difficulty) && leader === undefined;

  return (
    <article className="flex min-w-0 flex-col gap-3 border border-steel-800 bg-night p-4">
      {/*
        `flex-wrap` is load-bearing now that a card can carry two tags. The tag group cannot shrink,
        so on a narrow column an un-wrapping header squeezes the heading down to a few characters
        and `break-words` then cuts it mid-word ("COURIE / R / CONTRA / CT"). Wrapping gives the
        heading the whole line and drops the tags underneath it instead.
      */}
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h3 className="min-w-0 break-words font-display text-sm font-semibold uppercase tracking-[0.14em] text-steel-100">
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

      <p className="min-w-0 break-words text-xs leading-relaxed text-steel-400">{template.brief}</p>

      <TimingBreakdown template={template} />

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
          Expected haul
        </span>
        <RewardLine rewards={missionRewards(template, 'success')} />
      </div>

      <LeaderPicker
        template={template}
        officers={officers}
        rosterKnown={rosterKnown}
        leader={leader}
        onPick={setPickedId}
      />

      {/*
       * The refusal sits in the card the player clicked, not at the foot of the board. The board is
       * eight cards in a scrolling grid, so a single message under the last one is off-screen for
       * anybody who deployed from the top — rendered, reported by a DOM assertion, and invisible to
       * the player, which is the same silent failure it exists to end.
       */}
      {refusal && (
        <p
          role="alert"
          className="min-w-0 break-words text-[11px] leading-relaxed text-neon-magenta"
        >
          {refusal}
        </p>
      )}

      <footer className="mt-auto flex items-center justify-between gap-3 pt-1">
        <span className="font-display text-[10px] uppercase tracking-[0.16em] text-steel-500">
          Success{' '}
          <span className="tabular-nums text-steel-300">
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
        <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.14em] text-steel-100">
          {template?.name ?? mission.templateId}
        </span>
        <span
          className={cn(
            'shrink-0 font-display text-base font-semibold tabular-nums',
            done ? 'text-bile-300' : 'text-neon-cyan',
          )}
        >
          {done ? 'READY' : formatCountdown(remaining)}
        </span>
      </div>

      <div className="h-1 w-full overflow-hidden bg-steel-800">
        <div
          className={cn(
            'h-full transition-[width] duration-1000 ease-linear',
            done ? 'bg-bile-300' : 'bg-neon-cyan',
          )}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="truncate font-display text-[9px] uppercase tracking-[0.18em] text-steel-500">
          {PHASE_LABEL[phase]}
        </span>
        <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.16em] text-steel-600">
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
        <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.14em] text-steel-200">
          {template?.name ?? mission.templateId}
        </span>
        <Tag
          label={failed ? 'Lost' : 'Success'}
          className={
            failed ? 'border-neon-magenta/50 text-neon-magenta' : 'border-bile-300/50 text-bile-300'
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
 * The crews that came home most recently — by *return* time, not launch time.
 *
 * The server hands the board back in launch order, which is right for the in-flight list and
 * wrong for this one: a day-long expedition returns long after the short runs launched behind it,
 * so ordering by launch buries it under them and a bounded list drops it entirely — the player's
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
    <p className="px-4 py-6 text-center font-display text-[10px] uppercase tracking-[0.2em] text-steel-600">
      {text}
    </p>
  );
}

/**
 * The dedicated missions page (GDD §E3) — every crew that is away with its timer, the board they
 * were sent from (§E4), and what the last few brought back.
 */
export function MissionsPage() {
  const missionsQuery = useMissions();
  const assigneesQuery = useAssignees();
  const launch = useLaunchMission();

  const data = missionsQuery.data;
  const now = useServerClock(data?.serverNow, missionsQuery.dataUpdatedAt);

  /*
   * A crew can level the player up while this page is simply *open*, and the server announces that
   * on the settling response only — the next poll says nothing. So it is latched here rather than
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
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header>
          <p className="font-display text-[10px] tracking-[0.4em] text-neon-cyan/70">
            // OPERATIONS //
          </p>
          <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
            Missions
          </h1>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-steel-500">
            Crews are away for the whole round trip — out, on site, and back. Timers run on the
            server, so a mission lands on schedule whether or not this page is open.
          </p>
        </header>

        {levelUp && (
          <div className="flex flex-col gap-2">
            <LevelUpBanner levelUp={levelUp} />
            <button
              type="button"
              onClick={() => setLevelUp(null)}
              className="self-end font-display text-[10px] uppercase tracking-[0.18em] text-steel-500 hover:text-steel-300"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="In Flight"
            action={
              <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.18em] text-steel-500">
                <span className="tabular-nums text-steel-300">{active.length}</span>
                {limit > 0 ? <span className="tabular-nums"> / {limit}</span> : null} crews out
              </span>
            }
          >
            {missionsQuery.isLoading ? (
              <EmptyRow text="Reading the board…" />
            ) : active.length === 0 ? (
              <EmptyRow text="Every crew is home" />
            ) : (
              <ul aria-label="Crews in flight" className="flex flex-col divide-y divide-steel-800">
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
              <ul aria-label="Crews returned" className="flex flex-col divide-y divide-steel-800">
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
              <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.16em] text-warning">
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
                officers={assigneesQuery.data?.officers ?? []}
                rosterKnown={assigneesQuery.data !== undefined}
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
                    // that landed on it is ever reported.
                    { onSuccess: (result) => result.levelUp && setLevelUp(result.levelUp) },
                  )
                }
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
