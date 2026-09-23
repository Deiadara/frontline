import {
  findMissionTemplate,
  formatCountdown,
  formatDuration,
  missionCompletesAt,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  missionTimings,
  offerOfMission,
  recallWindowMs,
  type LevelUp,
  type Mission,
  type MissionLeader,
  type MissionPhase,
} from '@frontline/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LevelUpBanner } from '../../components/LevelUp';
import { RewardLine } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { cn } from '../../lib/cn';
import {
  useCrewStanding,
  useUnits,
  useLaunchMission,
  useMe,
  useAutomations,
  useMissions,
  useRecallMission,
} from '../../lib/queries';
import { MissionBoard } from './MissionBoard';
import { boardIsAutomated } from '@frontline/shared';
import { MissionReportWindow } from './MissionReportWindow';
import { ledBy } from './missionLines';
import { useServerClock } from './useServerClock';
import { PageShell } from '../game/PageShell';
import { Tutorial } from '../tutorial/Tutorial';

const PHASE_LABEL: Record<MissionPhase, string> = {
  outbound: 'Outbound',
  onSite: 'On site',
  returning: 'Returning',
  returned: 'At the gate',
};

/**
 * What a row on the rail is painted in, and why there are four of them.
 *
 * The rail is the feats index in another room: a list you run your eye down, where the colour says
 * what the row is *for* before you read a word of it. Brass is the one asking to be dealt with (a
 * crew at the gate), verdigris is work that came off, oxblood is what it cost, and a crew still on
 * the road is the quiet surface the other three are read against.
 *
 * Every row is a box with its own edge rather than a band between two hairlines. That is the
 * "clearer separations" the maintainer asked for: a drawn frame round a group and a bordered box
 * per entry separate at a glance, where a 1px divider only separates once you are already reading.
 */
const RAIL_TONE = {
  travelling: 'border-surface-600/60 bg-surface-900/40',
  home: 'border-brass-300/60 bg-brass-500/15',
  won: 'border-verdigris-300/40 bg-verdigris-500/10',
  lost: 'border-oxblood-500/40 bg-oxblood-500/10',
} as const;

/**
 * The lift under the pointer, one value for all four tones.
 *
 * Bone at five per cent rather than a tint per tone: it is the paper catching the light, so it
 * reads the same over brass, verdigris and oxblood without four more classes to keep in step.
 */
const RAIL_HOVER = 'transition-colors hover:bg-ink-100/5';

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

/** One crew currently away, with its live countdown (§E3). */
function InFlightRow({
  mission,
  now,
  leaders,
  overseerName,
  level,
  pending,
  onRecall,
}: {
  mission: Mission;
  now: Date;
  leaders: readonly MissionLeader[];
  overseerName: string;
  /** The crew's level, which the card the run was taken off read its odds at. */
  level: number;
  pending: boolean;
  onRecall: () => void;
}) {
  const template = findMissionTemplate(mission.templateId);
  const name = template?.name ?? mission.templateId;
  // What it is worth if it comes off (maintainer, 2026-09-23): the card's haul and XP, rebuilt
  // from what the row froze, so a crew that is out is quoted the terms it left under.
  const worth = template ? offerOfMission(mission, template, level) : null;
  const phase = missionPhaseAt(mission, now);
  const progress = missionProgressAt(mission, now);
  const remaining = missionRemainingMs(mission, now);
  const done = remaining === 0;
  const recallLeft = recallWindowMs(mission, now);

  return (
    <li
      className={cn(
        'flex min-w-0 flex-col rounded-sm border',
        RAIL_TONE[done ? 'home' : 'travelling'],
      )}
    >
      {/*
       * The row is a door to the Actions tab (maintainer, 2026-09-12), where the live column positions
       * are drawn: this panel says a crew is two hours out and that screen says where on the road.
       *
       * A `Link` around the readout only, with the recall control as its sibling rather than
       * inside it. An anchor with a button in it is invalid, and `stopPropagation` on the button
       * does not save it: stopping the synthetic event before it reaches the anchor's handler
       * means react-router never calls `preventDefault`, so the browser follows the href for real
       * and reloads the app. Two siblings cannot have that argument.
       */}
      <Link
        to="/game/actions"
        aria-label={`${name}: where this crew is on the road`}
        data-testid={`mission-track-${mission.id}`}
        className={cn(
          'flex min-w-0 flex-col gap-2 rounded-sm px-2.5 py-2',
          'focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-brass-300',
          RAIL_HOVER,
        )}
      >
        <div className="flex min-w-0 items-baseline justify-between gap-3">
          <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.14em] text-ink-100">
            {name}
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
        <ProgressBar progress={progress} label={name} tone={done ? 'verdigris' : 'brass'} />

        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate font-display text-[10px] uppercase tracking-[0.18em] text-ink-300">
            {PHASE_LABEL[phase]}
          </span>
          <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            {formatDuration(missionTimings(mission).totalMinutes)} round trip
          </span>
        </div>

        {/* Who took them out. A run is somebody's now, and which of your people is unavailable for
            the next job is read off this line rather than guessed at from the picker. */}
        <span
          className="truncate font-display text-[10px] uppercase tracking-[0.16em] text-brass-300"
          data-testid={`mission-leader-${mission.id}`}
        >
          {ledBy(mission, leaders, overseerName)}
        </span>

        {worth !== null && (
          <div
            className="flex flex-col gap-1 border-t border-surface-700/70 pt-1.5"
            data-testid={`mission-worth-${mission.id}`}
          >
            <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              If it comes off
            </span>
            <RewardLine rewards={worth.rewards} />
            <span className="font-display text-[11px] font-bold tabular-nums text-hextech-100">
              +{worth.xp.toLocaleString()} XP
            </span>
          </div>
        )}
      </Link>

      {/* The first tenth of the road out (maintainer request, 2026-09-12): call them back and they
          walk home the distance covered, arriving with nothing. Gone once the window shuts, and
          the padding goes with it so a shut window leaves no empty band under the row. */}
      {recallLeft > 0 && (
        <div className="px-2.5 pb-2">
          <CancelMark
            windowMs={recallLeft}
            label={`Call the ${name} crew back`}
            pending={pending}
            onCancel={onRecall}
            data-testid={`recall-mission-${mission.id}`}
          />
        </div>
      )}
    </li>
  );
}

/** A crew that has come home, with what it actually banked. */
function ReturnedRow({
  mission,
  leaders,
  overseerName,
}: {
  mission: Mission;
  leaders: readonly MissionLeader[];
  overseerName: string;
}) {
  // The crew's brackets, for the bag the report says the crew could lift; the settle read the
  // same map, so the two agree unless a card has moved since.
  const me = useMe();
  const template = findMissionTemplate(mission.templateId);
  const name = template?.name ?? mission.templateId;
  const failed = mission.outcome === 'failure';
  const [open, setOpen] = useState(false);

  /*
   * Nobody came back to tell it.
   *
   * A battle that loses the whole force sends no report: there is no outcome to print and no haul
   * to print, and printing "Lost" beside an empty reward line would be the game answering a
   * question nobody survived to ask. The row is one sentence, and the player learns the rest from
   * the gap in their army.
   */
  if (!mission.reported) {
    return (
      <li
        className={cn(
          'flex min-w-0 flex-col gap-1.5 rounded-sm border px-2.5 py-2',
          RAIL_TONE.lost,
        )}
      >
        <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.14em] text-ink-200">
          {name}
        </span>
        <span
          className="font-display text-[11px] uppercase tracking-[0.16em] text-oxblood-300"
          data-testid={`mission-silent-${mission.id}`}
        >
          Nobody came back
        </span>
      </li>
    );
  }

  /*
   * Three things and a door (maintainer, 2026-09-12): which job, what it paid, whether it worked.
   *
   * Who led it, what it cost in units and which sheet came home are all still recorded, in the
   * window this row opens. They were on the row itself, four lines deep, and six crews of it
   * filled the left column with small capitals that nobody read: the detail was there and
   * unreadable, which is the same as not being there.
   */
  return (
    <li
      className={cn('flex min-w-0 flex-col rounded-sm border', RAIL_TONE[failed ? 'lost' : 'won'])}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`${name}: what happened`}
        data-testid={`mission-open-${mission.id}`}
        className={cn(
          'flex min-w-0 flex-col gap-1.5 rounded-sm px-2.5 py-2 text-left',
          'focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-brass-300',
          RAIL_HOVER,
        )}
      >
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-[0.14em] text-ink-200">
            {name}
          </span>
          <Tag
            label={failed ? 'Lost' : 'Success'}
            className={
              failed ? 'border-oxblood-500/50 text-oxblood-300' : 'border-bile-300/50 text-bile-300'
            }
          />
        </div>
        <RewardLine rewards={mission.rewards} />
      </button>
      {open && (
        <MissionReportWindow
          mission={mission}
          leaders={leaders}
          overseerName={overseerName}
          loadouts={me.data?.base?.unitLoadouts ?? {}}
          onClose={() => setOpen(false)}
        />
      )}
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
  const automations = useAutomations();
  // §C3: the yard lives on the session snapshot, not on the missions payload: a machine is a fact
  // about the district rather than about the board.
  const me = useMe();
  // §A4: what the crew's holdings and perks add to a haul. Its own query because the fold is not
  // on the missions payload, and the send dialog has to quote the bag the settle will pay.
  const standing = useCrewStanding();
  /*
   * The two switches the board's dialog needs and `effects` cannot carry (`UnitsResponse`).
   *
   * `effects` is `Record<string, number>`, so neither of these could ever ride on it: whether the
   * crew's porters stand in a line (`carriers_fight`) and whether its machines seat anything
   * (`any_ride`). Both pay the settle, and without them the picker said "cannot fight" beside a
   * Scavenger that fights and "walks" beside a Colossus that rides.
   */
  const roster = useUnits();
  const launch = useLaunchMission();

  const data = missionsQuery.data;
  const now = useServerClock(data?.serverNow, missionsQuery.dataUpdatedAt);
  const recall = useRecallMission();
  /*
   * The leaders ride in on the board itself, not on a second read of the crew.
   *
   * They used to come from `GET /crew`, which put a §G6 gate behind a request this screen made
   * only for the picker, and made "the roster is still loading" and "you have nobody" two states
   * this page had to tell apart and once got wrong. The Overseer is not on that roster at all.
   * One payload answers who may lead, who is already out, and on what terms a crew may go unled.
   */
  const leaders = data?.leaders ?? [];
  /*
   * And the Overseer's name off that same payload, not off `/me`.
   *
   * `leadersFor` puts them first on the board with the name the player gave them, so the row that
   * says who led a run is reading the response that carried the run. `/me` is a separate query
   * with a 30s `staleTime` and no poll: on a cold load of this URL it can land after the board,
   * and every Overseer-led row in the list read `The Overseer` while the picker beside it was
   * already showing the real name. It stays as the fallback for a board old enough to have no
   * Overseer on it.
   */
  const overseerName =
    leaders.find((one) => one.kind === 'overseer')?.name ??
    me.data?.overseer?.name ??
    'The Overseer';

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
  // §C2b: any standing order on, and the board is the Right Hand's. The server refuses a launch
  // too; the screen says so before anybody presses anything.
  const automated = boardIsAutomated(automations.data?.slots ?? []);

  /*
   * Soonest home first. The server hands missions back in launch order, and a day-long expedition
   * launched first sat at the top of the stack for a day while three short runs landed underneath
   * it. What a player glancing at the left of this screen wants is "who is next through the gate".
   */
  const landing = [...active].sort(
    (a, b) => missionCompletesAt(a).getTime() - missionCompletesAt(b).getTime(),
  );

  return (
    <PageShell
      // A quotation, not a lede. It is the one line on this screen that is not telling anybody a
      // number, and it was set in the same grey help text as the travel-time explainer beside it.
      quote="The first death is in the heart. Get out there and show you are still alive."
      wide
      fills
    >
      {/* First visit to this screen raises its card, once. */}
      <Tutorial screen="missions" />
      {/* The crew screen's line (maintainer, 2026-09-21). The crews-out count moved here from the
          In flight panel's head: the same number a second time on one screen, and this is the
          line that is meant to carry it. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <span className="font-display text-[12px] uppercase tracking-[0.18em] text-ink-300">
          <span className="tabular-nums text-ink-200">{active.length}</span>
          {limit > 0 ? (
            <>
              {' '}
              of <span className="tabular-nums text-ink-200">{limit}</span>
            </>
          ) : null}{' '}
          crews out
        </span>
        <span aria-hidden className="ink-rule block min-w-0 flex-1" />
      </div>

      {levelUp && (
        <div className="flex flex-col gap-2">
          <LevelUpBanner levelUp={levelUp} />
          {/* Drawn, because it is the only way off this banner. Bare uppercase text at the far
              right of a full-width sheet reads as a caption on the notice above it, and a player
              who does not recognise it as a control is left with the banner for the rest of the
              session. `ghost` is the register the Close on every dialog in the game already
              wears. */}
          <div className="self-end">
            <Button variant="ghost" size="sm" onClick={() => setLevelUp(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/*
       * A rail and a workspace, the frame the Lab, the yard and the Training tab already use.
       *
       * The crews in flight used to be a horizontal strip of chips in the shell's chrome under the
       * board, and the strip wrapped: with two or three crews out the chips ran under the board's
       * own tab row and covered it. A column on the left has room for a stack, the stack scrolls
       * inside its own box when it is long, and nothing on this screen has to move to make room.
       *
       * The column opens at `xl`, not `lg`. The board is three cards across and each needs about
       * 300px for a six-resource haul to fit its band; at 1024 wide an 18rem column leaves them
       * 215px and the haul spills out of the box. Below `xl` the board keeps the width and the
       * stack follows it in the flow, which is under the board but never over it.
       *
       * Two different frames, then. Above `xl` the sheet fills the window and each column scrolls
       * inside itself, with the crews in flight taking at most half the column so a single crew out
       * is never clipped by the list under it. Below `xl` the sheet scrolls as a whole and every
       * panel is its natural height: a fixed frame shared three ways at 768px tall left the board
       * a strip too short to show its own cards.
       */}
      <div className="min-h-0 flex-1 overflow-y-auto xl:flex xl:flex-col xl:overflow-visible">
        <div className="grid gap-4 xl:min-h-0 xl:flex-1 xl:grid-cols-[18rem_minmax(0,1fr)] xl:items-stretch">
          <div className="order-2 flex min-w-0 flex-col gap-4 xl:order-1 xl:min-h-0">
            <Panel
              title="In flight"
              // The sheet the feats board is drawn on: a hand-inked frame round dark paper, with
              // the title's own drawn rule under it. That rule is the boundary between this group
              // and the one below, which is the separation the maintainer asked to see at a glance.
              tone="paper"
              className="flex flex-col xl:max-h-[50%] xl:shrink-0"
            >
              {missionsQuery.isLoading ? (
                <EmptyRow text="Reading the board…" />
              ) : landing.length === 0 ? (
                <EmptyRow text="Every crew is home" />
              ) : (
                <ul
                  aria-label="Crews in flight"
                  data-testid="crews-in-flight"
                  // Padded on every side, so the scrollbar is drawn inside the frame rather than
                  // over its edge: a drawn border with a bar running down it reads as a tear.
                  className="flex flex-col gap-1.5 p-2 xl:min-h-0 xl:overflow-y-auto"
                >
                  {landing.map((mission) => (
                    <InFlightRow
                      key={mission.id}
                      mission={mission}
                      now={now}
                      leaders={leaders}
                      overseerName={overseerName}
                      level={me.data?.base?.level ?? 1}
                      pending={recall.isPending}
                      onRecall={() => recall.mutate({ missionId: mission.id })}
                    />
                  ))}
                </ul>
              )}
              {recall.error && (
                <p role="alert" className="px-3 pb-2 font-body text-[13px] text-oxblood-300">
                  {recall.error.message}
                </p>
              )}
            </Panel>

            <Panel
              title="Recently returned"
              tone="paper"
              className="flex flex-col xl:min-h-0 xl:flex-1"
              // The bottom of this panel is the bottom of the left column, which `board-fill.spec`
              // measures the board against. Named, because the class it used to be found by
              // (`painted`) belongs to the brass tone this no longer wears.
              data-testid="crews-returned-panel"
            >
              {returned.length === 0 ? (
                <EmptyRow text="No crew has come back yet" />
              ) : (
                <ul
                  aria-label="Crews returned"
                  // The scroller stops inside the drawn frame rather than at the panel's outer edge
                  // (maintainer, 2026-09-10): a row half-scrolled off the bottom was cut at the frame's
                  // outside, so its last line showed under the line that is meant to be the edge.
                  className="flex flex-col gap-1.5 p-2 xl:min-h-0 xl:overflow-y-auto"
                >
                  {returned.map((mission) => (
                    <ReturnedRow
                      key={mission.id}
                      mission={mission}
                      leaders={leaders}
                      overseerName={overseerName}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="order-1 flex min-w-0 flex-col xl:order-2 xl:min-h-0 xl:overflow-y-auto">
            <Panel
              title="Mission Board"
              className="xl:min-h-0 xl:flex-1"
              action={
                automated ? (
                  <Link
                    to="/game/actions/automations"
                    className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-brass-300 hover:underline"
                    data-testid="board-automated"
                  >
                    The Right Hand has the board
                  </Link>
                ) : atCapacity ? (
                  <span className="shrink-0 font-display text-[10px] uppercase tracking-[0.16em] text-warning">
                    All crews deployed
                  </span>
                ) : null
              }
            >
              {missionsQuery.isLoading ? (
                <EmptyRow text="Reading the board…" />
              ) : data === undefined ? (
                /* A failed read used to fall through every `?? []` and print `MissionBoard`'s empty
             state, "Nowhere is hiring. Scout something.": a sentence about the game world in
             answer to a broken request. The roster beside it already modelled three states. */
                <LoadFailure
                  what="The board"
                  onRetry={() => void missionsQuery.refetch()}
                  detail="Nothing has been lost. Every crew you have out is still out."
                />
              ) : (
                <MissionBoard
                  areas={data?.areas ?? []}
                  army={data?.army ?? {}}
                  fleet={me.data?.base?.fleet ?? {}}
                  loadouts={me.data?.base?.unitLoadouts ?? {}}
                  leaders={leaders}
                  unledRule={data?.unledRule ?? 'forbidden'}
                  // What a battle job fields scales with the player's level, and the level lives
                  // on the base rather than on the board. One short of nothing is level 1, which
                  // is the gentlest reading of a tier and the safe fallback.
                  level={data.level}
                  now={now}
                  // §A4: the crew's own bag, so the dialog quotes the haul the settle will pay.
                  bagPercent={standing.data?.haulPercent ?? 0}
                  marks={standing.data?.marks ?? {}}
                  carriersFight={roster.data?.carriersFight ?? false}
                  anyRide={roster.data?.anyRide ?? false}
                  roster={roster.data}
                  atCapacity={atCapacity}
                  automated={automated}
                  pendingTemplateId={
                    launch.isPending ? (launch.variables?.templateId ?? null) : null
                  }
                  refusal={
                    launch.error && launch.variables
                      ? { templateId: launch.variables.templateId, message: launch.error.message }
                      : null
                  }
                  onLaunch={(areaId, templateId, force, leaderId, vehicles) =>
                    launch.mutate(
                      {
                        areaId,
                        templateId,
                        force,
                        vehicles: vehicles ?? {},
                        ...(leaderId ? { leaderId } : {}),
                      },
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
          </div>
        </div>
      </div>
    </PageShell>
  );
}
