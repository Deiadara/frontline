import {
  findMissionTemplate,
  formatCountdown,
  formatDuration,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  missionTimings,
  type AssigneeOfficer,
  type LevelUp,
  type Mission,
  type MissionPhase,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';
import { RewardLine } from '../../components/Resources';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { useAssignees, useLaunchMission, useMissions } from '../../lib/queries';
import { MissionBoard } from './MissionBoard';
import { useServerClock } from './useServerClock';
import { PageShell } from '../game/PageShell';

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
type Roster =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; officers: readonly AssigneeOfficer[] };

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
        {missionsQuery.isLoading ? (
          <EmptyRow text="Reading the board…" />
        ) : (
          <MissionBoard
            areas={data?.areas ?? []}
            army={data?.army ?? {}}
            roster={roster}
            atCapacity={atCapacity}
            pendingTemplateId={launch.isPending ? (launch.variables?.templateId ?? null) : null}
            refusal={
              launch.error && launch.variables
                ? { templateId: launch.variables.templateId, message: launch.error.message }
                : null
            }
            onLaunch={(areaId, templateId, force, officerId) =>
              launch.mutate(
                { areaId, templateId, force, ...(officerId ? { officerId } : {}) },
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
        )}
      </Panel>

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
    </PageShell>
  );
}
