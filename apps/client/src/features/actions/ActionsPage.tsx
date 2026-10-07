import {
  findMissionTemplate,
  findVehicle,
  formatCountdown,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  movementCancelWindowMs,
  recallWindowMs,
  SPY_TIER_SPECS,
  spyRecallWindowMs,
  moveRecallWindowMs,
  offerOfMission,
  type SpyRunView,
  type UnitMoveView,
  type BattleView,
  type Mission,
  type MissionPhase,
  type MovementView,
  type SleeperCellView,
  type Fleet,
  CELL_LOCKED_TEXT,
} from '@frontline/shared';
import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { RewardLine } from '../../components/Resources';
import { CancelMark } from '../../components/ui/CancelMark';
import { HoverCard } from '../../components/ui/HoverCard';
import { Modal } from '../../components/ui/Modal';
import { DrawnFace } from '../../components/ui/DrawnMarks';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import {
  useActions,
  useBattles,
  useMissions,
  useRecallColumn,
  useRecallMission,
  useRecallSpy,
  useRecallMove,
  useRecallSleepers,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { PageShell } from '../game/PageShell';
import { FileSection } from '../overseer/FileSection';
import { UnitChip } from '../units/UnitChip';
import { OfferCard } from '../missions/MissionBoard';
import { Census } from './Census';
import { InProgressPage } from './InProgressPage';
import { Row, Section } from './rows';
import { AutomationsPage } from './AutomationsPage';
import { HomeMark, OutMark, OrdersMark, WorkMark } from './CensusMarks';
import { fightPhase, onTheRoad, ownAt, roadCounts, roadIsEmpty, roadRows, type Road } from './road';
import { PressError } from '../../components/ui/PressError';

/**
 * Actions (§A4): everybody who is not where they started, live.
 *
 * The board answers "what is coming and what came back". This answers "where is everybody right
 * now": columns walking to a fight, crews out on a job, forces standing at a fight they have
 * reached or fighting it, and the runners on a spy job. It listed only the first, so a player whose
 * whole army was out on missions was told nobody was out. Four reads, one clock (`useServerClock`
 * off the road's own `serverNow`), and every countdown on the page ticks.
 *
 * Anything on the road can be turned round in the first tenth of its walk out (maintainer request,
 * 2026-09-12), and every row wears the same X for it. A column's units go straight back onto the
 * roster: they have not reached anybody's ring, so unlike a withdrawal from ground already held,
 * nothing is owed for leaving. A crew on a job and a spy job walk home the distance covered.
 */
/**
 * The two pages the Monitor is, and the drawn strip that switches between them (maintainer,
 * 2026-09-19).
 *
 * "Make the total units page be a second page in the Monitor section. Still keep the two pages in
 * monitor with nice graphiced buttons to switch between them on top."
 *
 * The section follows the URL rather than a piece of state, which is the archive's pattern
 * (`ResearchPage`) and is what makes a bookmark, the browser's Back button and the roster's own
 * Total Units door all land where they say they will. `/game/actions` is the road and
 * `/game/actions/units` is the census.
 */
const MONITOR_PAGES = [
  {
    id: 'road' as const,
    path: '/game/actions',
    label: 'On the road',
    /** Everybody who is somewhere they did not start. */
    Mark: OutMark,
  },
  {
    id: 'census' as const,
    path: '/game/actions/units',
    label: 'Total units',
    /** ...and how many of them there are in the first place. */
    Mark: HomeMark,
  },
  {
    id: 'progress' as const,
    path: '/game/actions/progress',
    label: 'In progress',
    /** Every clock running at home: builds, the Archive, the bench, the floor, the ground. */
    Mark: WorkMark,
  },
  {
    id: 'automations' as const,
    path: '/game/actions/automations',
    label: 'Automations',
    /** §C2b: the standing orders the Right Hand carries out while you are away. */
    Mark: OrdersMark,
  },
];

type MonitorPage = (typeof MONITOR_PAGES)[number]['id'];

/**
 * One tab, drawn rather than struck.
 *
 * The same `DrawnFace` box the archive's sections and the yard's benches wear, so the three
 * tabbed screens in the game are visibly one idea. The mark inside it is the page's own
 * (`CensusMarks`): a boot print for the people who are out, a roof for the count of everybody.
 */
function MonitorTab({
  page,
  active,
  count,
}: {
  page: (typeof MONITOR_PAGES)[number];
  active: boolean;
  /** What the tab badges, or null for a page with no one number to put on it. */
  count: number | null;
}) {
  return (
    <NavLink
      to={page.path}
      end
      data-testid={`monitor-tab-${page.id}`}
      data-sound="click"
      className={cn(
        'group/tab relative flex items-center gap-2 px-4 py-2 transition-all duration-150',
        'font-display text-[12px] font-bold uppercase tracking-[0.16em]',
        'hover:-translate-y-px active:translate-y-px',
        active ? 'text-brass-100' : 'text-ink-300 hover:text-brass-100',
      )}
    >
      <DrawnFace
        face={cn(
          'transition-all duration-150',
          active
            ? 'fill-brass-500/30 group-hover/tab:fill-brass-500/40'
            : 'fill-surface-900/50 group-hover/tab:fill-brass-500/15',
        )}
      />
      <page.Mark
        className={cn(
          'relative h-4 w-4 shrink-0 transition-colors duration-150',
          active ? 'text-brass-300' : 'text-ink-400 group-hover/tab:text-brass-300',
        )}
      />
      <span className="relative">{page.label}</span>
      {count !== null && <span className="relative tabular-nums opacity-80">{count}</span>}
    </NavLink>
  );
}

export function ActionsPage() {
  const query = useActions();
  const missions = useMissions();
  const battles = useBattles();
  const recall = useRecallColumn();
  const recallJob = useRecallMission();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const data = query.data;
  const road = onTheRoad(data, missions.data, battles.data);
  const recallSpy = useRecallSpy();
  const recallMove = useRecallMove();
  const recallCell = useRecallSleepers();
  /*
   * The road is three reads, and it is only known when all three are in (bug pass, 2026-10-06).
   * Gated on the first alone, a cold open said "Nobody is out" until the jobs and the fights
   * arrived, and a failed read of either kept saying it while crews were out.
   */
  const loaded = data !== undefined && missions.data !== undefined && battles.data !== undefined;
  const failed =
    (query.isError && !data) ||
    (missions.isError && !missions.data) ||
    (battles.isError && !battles.data);
  /*
   * A refusal stands while the row it was about is on the road, and goes with it (bug pass,
   * 2026-10-06): it used to stay above the list after the row had gone.
   */
  const recallErrors = [
    recall.error && road.columns.some((one) => one.id === recall.variables?.movementId)
      ? recall.error
      : null,
    recallJob.error && road.jobs.some((one) => one.id === recallJob.variables?.missionId)
      ? recallJob.error
      : null,
    recallSpy.error && road.spies.some((one) => one.id === recallSpy.variables?.runId)
      ? recallSpy.error
      : null,
    recallMove.error && road.moves.some((one) => one.id === recallMove.variables?.moveId)
      ? recallMove.error
      : null,
    recallCell.error && road.cells.some((one) => one.cellId === recallCell.variables?.cellId)
      ? recallCell.error
      : null,
  ];
  const { pathname } = useLocation();
  const page: MonitorPage = pathname.endsWith('/units')
    ? 'census'
    : pathname.endsWith('/progress')
      ? 'progress'
      : pathname.endsWith('/automations')
        ? 'automations'
        : 'road';

  return (
    /*
     * The same sheet Battles and Notifications get: `wide` and `fills`.
     *
     * This opened on the narrow default, so a page that lists every column on the road, every fight
     * in flight and the spy job, sat in a column about half the width of the screen beside a field of
     * empty backdrop, while the two screens it is most like ran the full sheet. `wide` gives it the
     * width, and `fills` makes the list do its own scrolling instead of the whole sheet growing,
     * which is what a live board of things in flight wants (maintainer request, 2026-09-14).
     */
    <PageShell
      title="The Monitor"
      action={page === 'road' && loaded ? <Counts road={road} /> : null}
      wide
      fills
    >
      {/*
       * The strip, over both pages and outside either one's scroller.
       *
       * Outside on purpose: a switch that scrolled away with the list under it is a switch a
       * player has to go back up for, and the whole reason these two are one section is that
       * moving between them should cost nothing.
       */}
      {/* Navigation, not a tab list: these are links between pages, and a `tablist` with no tabs
          in it told a reader there were controls that do not exist (bug pass, 2026-10-06). */}
      <nav
        className="flex shrink-0 flex-wrap items-center gap-2"
        aria-label="The Monitor"
        data-testid="monitor-tabs"
      >
        {MONITOR_PAGES.map((entry) => (
          <MonitorTab
            key={entry.id}
            page={entry}
            active={page === entry.id}
            count={entry.id === 'road' && loaded ? roadRows(road) : null}
          />
        ))}
      </nav>

      {page === 'census' ? (
        <Census />
      ) : page === 'progress' ? (
        <InProgressPage />
      ) : page === 'automations' ? (
        <AutomationsPage />
      ) : !loaded ? (
        <ScreenLoad
          what="The road"
          loading="Counting heads…"
          isError={failed}
          onRetry={() => {
            void query.refetch();
            void missions.refetch();
            void battles.refetch();
          }}
          detail="Nothing has been lost. Every column still gets where it was going."
        />
      ) : roadIsEmpty(road) ? (
        <FileSection icon="actions" title="Nobody is out">
          <p className="font-body text-[13px] leading-relaxed text-ink-300">
            Every unit you have is standing in your own district, which is the only place they are
            no use at all.
          </p>
        </FileSection>
      ) : (
        /*
         * The one region that moves, and it has to say so twice.
         *
         * `fills` hands the page a unit that is `overflow-hidden` and expects the page to name its
         * own scroller. This list never did, so a player with more than about four columns out was
         * simply shown the first four: the rest were clipped by the shell with no scrollbar and no
         * way to reach them. `overflow-y-auto` alone is not enough either, because a flex child's
         * default `min-height: auto` lets this box grow to the height of its content, so there is
         * never any overflow to scroll. `min-h-0` is what bounds it to the sheet.
         */
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="road">
          {/* A recall the server refuses. `movement.recallable` is computed when the response is
              built and `/actions` polls at 5s, while the row's own `canRecall` is recomputed every
              second: for up to five seconds after the window shuts the row reads "0s left to
              decide" beside a live button. `DeclareDialog` renders this same mutation's error. */}
          {recallErrors.map(
            (error, index) => error && <PressError key={index}>{error.message}</PressError>,
          )}

          {road.columns.length > 0 && (
            <Section
              icon="battles"
              title="Walking to a fight"
              note="Columns on the road to a called fight. Inside the first tenth of the walk they can still be turned around."
              count={road.columns.length}
            >
              <ul className="flex flex-col gap-2.5" data-testid="movements">
                {road.columns.map((movement) => (
                  <Column
                    key={movement.id}
                    movement={movement}
                    now={now}
                    // This row's own press only (bug pass, 2026-10-06): one recall greyed every row,
                    // and the windows are a tenth of the walk.
                    pending={recall.isPending && recall.variables.movementId === movement.id}
                    onRecall={() => recall.mutate({ movementId: movement.id })}
                  />
                ))}
              </ul>
            </Section>
          )}

          {road.cells.length > 0 && (
            <Section
              icon="eye"
              title="Gone to ground"
              note="Sleepers planted on ground you do not hold. Nothing finds them. Call a fight on that place and they are already standing in it."
              count={road.cells.length}
            >
              <ul className="flex flex-col gap-2.5" data-testid="cells">
                {road.cells.map((cell) => (
                  <Cell
                    key={cell.cellId}
                    cell={cell}
                    now={now}
                    pending={recallCell.isPending && recallCell.variables.cellId === cell.cellId}
                    onRecall={() => recallCell.mutate({ cellId: cell.cellId })}
                  />
                ))}
              </ul>
            </Section>
          )}

          {road.stationed.length > 0 && (
            <Section
              icon="shield"
              title="Standing on your ground"
              note="Posted on places you hold. They are not going anywhere, and they defend where they stand."
              count={road.stationed.length}
            >
              <ul className="flex flex-col gap-2.5" data-testid="stationed">
                {road.stationed.map((post) => (
                  <Row
                    key={post.locationId}
                    testId={`stationed-${post.locationId}`}
                    name={post.locationName}
                    status="Posted"
                  >
                    <p className="font-display text-[11px] uppercase tracking-[0.12em] text-ink-400">
                      {post.districtName}
                    </p>
                    <Force army={post.army} testPrefix={`stationed-${post.locationId}`} />
                  </Row>
                ))}
              </ul>
            </Section>
          )}

          {road.fights.length > 0 && (
            <Section
              icon="sword"
              title="At a fight"
              note="Forces that have reached the ground: waiting for the mark, or in it."
              count={road.fights.length}
            >
              <ul className="flex flex-col gap-2.5" data-testid="fights">
                {road.fights.map((view) => (
                  <Fight key={view.battle.id} view={view} now={now} />
                ))}
              </ul>
            </Section>
          )}

          {road.jobs.length > 0 && (
            <Section icon="missions" title="Out on a job" count={road.jobs.length}>
              <ul className="flex flex-col gap-2.5" data-testid="jobs">
                {road.jobs.map((mission) => (
                  <Job
                    key={mission.id}
                    mission={mission}
                    now={now}
                    pending={recallJob.isPending && recallJob.variables.missionId === mission.id}
                    onRecall={() => recallJob.mutate({ missionId: mission.id })}
                    xpBonusPercent={missions.data?.xpBonusPercent ?? 0}
                  />
                ))}
              </ul>
            </Section>
          )}

          {road.moves.length > 0 && (
            <Section
              icon="actions"
              title="Moving"
              note="Columns walking between your own places: the district, the gate, ground you hold and ground the faction holds. Turned round in the first tenth, they walk back where they came from."
              count={road.moves.length}
            >
              <ul className="flex flex-col gap-2.5" data-testid="moves">
                {road.moves.map((move) => (
                  <Moving
                    key={move.id}
                    move={move}
                    now={now}
                    pending={recallMove.isPending && recallMove.variables.moveId === move.id}
                    onRecall={() => recallMove.mutate({ moveId: move.id })}
                  />
                ))}
              </ul>
            </Section>
          )}

          {road.spies.length > 0 && (
            <Section icon="eye" title="Spying" count={road.spies.length}>
              <ul className="flex flex-col gap-2.5">
                {road.spies.map((run) => (
                  <SpyJob
                    key={run.id}
                    run={run}
                    now={now}
                    pending={recallSpy.isPending && recallSpy.variables.runId === run.id}
                    onRecall={() => recallSpy.mutate({ runId: run.id, districtId: run.districtId })}
                  />
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Counts({ road }: { road: Road }) {
  const counts = roadCounts(road);
  const parts = [
    counts.columns > 0 && `${counts.columns} walking`,
    counts.fights > 0 && `${counts.fights} at a fight`,
    counts.jobs > 0 && `${counts.jobs} on a job`,
    counts.spies > 0 && 'runners on a job',
    counts.moves > 0 && `${counts.moves} moving`,
    // §A4: the two the header used to leave out, so the summary adds up to the page under it.
    counts.cells > 0 && `${counts.cells} planted`,
    counts.stationed > 0 && `${counts.stationed} posted`,
  ].filter((part): part is string => typeof part === 'string');
  return (
    <span
      className="font-display text-[12px] uppercase tracking-[0.14em] tabular-nums text-ink-300"
      data-testid="road-counts"
    >
      {parts.length === 0
        ? 'Nobody out'
        : `${parts.join(' · ')} · ${counts.unitSlots} ${counts.unitSlots === 1 ? 'unit slot' : 'unit slots'}`}
    </span>
  );
}

/**
 * One kind of away, framed and counted, so the page reads as four short lists rather than one.
 *
 * The same drawn sheet a crew's file and the district sheets use (maintainer request, 2026-09-11): a
 * plated mark, the name, a ruled line, and the count pinned to the right of the name. It was a
 * bare small-caps heading over a stack of panels, which on this screen read as a list somebody had
 * not finished laying out.
 */
/**
 * One party on the road: who, where they are going, and how far along.
 *
 * Every row on this screen is the same card whatever the errand is, the way every location's
 * window is the same sheet: the name in the stamped face, what they are doing on a plate at the
 * right, the route and its clock, the bar, and the units. A row that is about to change (a
 * column still inside its recall window, a fight settling) says so in colour on that plate.
 */
/**
 * §A4: one Sleeper cell, in whichever of its three states it is in (`sleepers.ts`).
 *
 * The one row on this page with **no countdown in the middle state**, and that is the mechanic
 * rather than a gap: a planted cell has no clock on it at all. It says how long it has been
 * there instead, because "planted two days ago" is the fact a player is deciding on.
 *
 * Recall is a plain button rather than a `CancelMark`, which is the control for calling
 * something off inside a short window. Pulling a cell out is allowed at any time and costs the
 * walk home, so it is an ordinary decision and not a last chance.
 */
function Cell({
  cell,
  now,
  pending,
  onRecall,
}: {
  cell: SleeperCellView;
  now: Date;
  pending: boolean;
  onRecall: () => void;
}) {
  const mark = Date.parse(cell.arrivesAt);
  const waiting = cell.phase === 'waiting';
  const left = Math.max(0, mark - now.getTime());

  return (
    <Row
      testId={`cell-${cell.cellId}`}
      name={cell.locationName}
      status={waiting ? 'In place' : cell.phase === 'outbound' ? 'Walking in' : 'Coming home'}
      tone={waiting ? 'done' : 'plain'}
    >
      <p className="font-display text-[11px] uppercase tracking-[0.12em] text-ink-400">
        {cell.districtName}
        {' · '}
        {waiting
          ? `in place for ${formatRemaining(Math.max(0, now.getTime() - mark))}`
          : `${formatRemaining(left)} to go`}
      </p>
      <Force army={cell.army} testPrefix={`cell-${cell.cellId}`} />
      {cell.phase !== 'returning' && cell.locked === true && (
        <p
          className="border-t border-surface-700/70 pt-2.5 font-body text-[12px] text-ink-300"
          data-testid={`cell-locked-${cell.cellId}`}
        >
          {CELL_LOCKED_TEXT}.
        </p>
      )}
      {cell.phase !== 'returning' && cell.locked !== true && (
        <div className="border-t border-surface-700/70 pt-2.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={onRecall}
            data-testid={`recall-cell-${cell.cellId}`}
          >
            Pull them out
          </Button>
        </div>
      )}
    </Row>
  );
}

/** From where to what, with the clock: the same line on every row. */
function Route({ from, to, remaining }: { from: string; to: string; remaining: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-display text-[12px] uppercase tracking-[0.12em] text-ink-200">
      <span>{from}</span>
      <Icon name="actions" aria-hidden className="h-4 w-4 text-brass-300" />
      <span>{to}</span>
      <span className="ml-auto font-bold tabular-nums text-brass-300">{remaining}</span>
    </div>
  );
}

/** A force as chips: the line, and the ring drawn quieter. */
function Force({
  army,
  perimeter,
  testPrefix,
}: {
  army: Readonly<Record<string, number>>;
  perimeter?: Readonly<Record<string, number>>;
  testPrefix: string;
}) {
  const line = Object.entries(army).filter(([, count]) => count > 0);
  const ring = Object.entries(perimeter ?? {}).filter(([, count]) => count > 0);
  return (
    <ul className="flex flex-wrap gap-1.5">
      {line.map(([unitId, count]) => (
        <li key={unitId}>
          <UnitChip unitId={unitId} count={count} data-testid={`${testPrefix}-${unitId}`} />
        </li>
      ))}
      {ring.map(([unitId, count]) => (
        <li key={`ring-${unitId}`}>
          <UnitChip unitId={unitId} count={count} muted />
        </li>
      ))}
    </ul>
  );
}

/**
 * §C3: the machines under a force, beside the units.
 *
 * On every leg the same way: a column walking to a fight, a force standing at one, a crew out on
 * a job. The screen listed what was moving and not what it rode in, so the yard the player had
 * just emptied onto a battle was invisible between the picker and the settle.
 */
function Rides({ fleet, testPrefix }: { fleet: Readonly<Fleet>; testPrefix: string }) {
  const rides = Object.entries(fleet).filter(([, count]) => (count ?? 0) > 0);
  if (rides.length === 0) return null;
  return (
    <>
      {rides.map(([vehicleId, count]) => (
        <span
          key={vehicleId}
          data-testid={`${testPrefix}-ride-${vehicleId}`}
          className="rounded-sm border border-surface-600 bg-surface-950/40 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.1em] text-ink-200"
        >
          {findVehicle(vehicleId)?.name ?? vehicleId}{' '}
          <span className="tabular-nums text-brass-300">{count}</span>
        </span>
      ))}
    </>
  );
}

function Column({
  movement,
  now,
  pending,
  onRecall,
}: {
  movement: MovementView;
  now: Date;
  pending: boolean;
  onRecall: () => void;
}) {
  const left = Math.max(0, Date.parse(movement.arrivesAt) - now.getTime());
  const total = Math.max(1, Date.parse(movement.arrivesAt) - Date.parse(movement.departedAt));
  const progress = Math.min(1, Math.max(0, 1 - left / total));
  const canRecall = movementCancelWindowMs(
    { ...movement, baseId: '', fromDistrictId: '', toDistrictId: '' },
    now,
  );

  return (
    <Row
      testId={`column-${movement.id}`}
      name={movement.targetName}
      status={movement.side === 'attacker' ? 'Going in' : 'Holding'}
    >
      <Route from={movement.fromName} to={movement.toName} remaining={formatRemaining(left)} />
      <ProgressBar progress={progress} label={movement.targetName} tone="brass" />
      <div className="flex flex-wrap items-center gap-1.5">
        <Force army={movement.army} perimeter={movement.perimeter} testPrefix="walking" />
        <Rides fleet={movement.vehicles} testPrefix="walking" />
      </div>
      {/* The server's word on whether the window is open *and* the row's own clock: `recallable`
          is computed when the response is built and `/actions` polls at 5s, so for up to five
          seconds after the window shut the row used to read "0s left" beside a live button. */}
      {movement.recallable && canRecall > 0 && (
        <div className="border-t border-surface-700/70 pt-2.5">
          <CancelMark
            windowMs={canRecall}
            label={`Turn the column to ${movement.targetName} around`}
            pending={pending}
            onCancel={onRecall}
            data-testid={`recall-${movement.id}`}
          />
        </div>
      )}
    </Row>
  );
}

/** A force that has reached a fight: waiting for the mark, or in it. */
function Fight({ view, now }: { view: BattleView; now: Date }) {
  const phase = fightPhase(view, now);
  const left = Math.max(0, Date.parse(view.battle.scheduledFor) - now.getTime());
  const mine = ownAt(view);
  return (
    <Row
      testId={`fight-${view.battle.id}`}
      name={view.targetName}
      tone={phase === 'fighting' ? 'hot' : 'plain'}
      status={
        phase === 'fighting'
          ? 'Fighting now'
          : view.side === 'attacker'
            ? 'Attacking at the mark'
            : 'Holding at the mark'
      }
    >
      <Route
        from={view.districtName}
        to={view.opponentName}
        remaining={phase === 'fighting' ? 'settling' : formatRemaining(left)}
      />
      {/* Your own row: an ally's reinforcement is on the battle page, not on your road. */}
      {mine && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Force army={mine.army} perimeter={mine.perimeter} testPrefix="posted" />
          <Rides fleet={view.vehicles} testPrefix="posted" />
        </div>
      )}
    </Row>
  );
}

const PHASE_LABEL: Record<MissionPhase, string> = {
  outbound: 'On the road out',
  onSite: 'On the job',
  returning: 'Heading home',
  returned: 'At the gate',
};

/** A crew out on a job, with the leg it is on, and the X while the road out is still young. */
function Job({
  mission,
  now,
  pending,
  onRecall,
  xpBonusPercent,
}: {
  mission: Mission;
  now: Date;
  pending: boolean;
  onRecall: () => void;
  /** What the return adds to the frozen XP, so the card says what it will pay. */
  xpBonusPercent: number;
}) {
  const template = findMissionTemplate(mission.templateId);
  const name = template?.name ?? mission.templateId;
  const phase = missionPhaseAt(mission, now);
  const remaining = missionRemainingMs(mission, now);
  const window = recallWindowMs(mission, now);
  /*
   * The card the job was taken off (maintainer, 2026-09-23): on the name's hover, and pinned open
   * on a click so the things on it can be hovered in turn. Rebuilt from what the row froze
   * (`offerOfMission`), with no crew to send, which is the one thing the board's card has that
   * this one must not.
   */
  const card = template ? offerOfMission(mission, template, xpBonusPercent) : null;
  const [pinned, setPinned] = useState(false);
  return (
    <Row
      testId={`job-${mission.id}`}
      name={name}
      heading={
        card === null ? undefined : (
          <HoverCard
            label={`${name}: the card this job was taken off`}
            size="window"
            interactive
            onActivate={() => setPinned(true)}
            card={
              <div className="w-[19rem]">
                <OfferCard offer={card} readOnly />
              </div>
            }
            data-testid={`job-card-${mission.id}`}
          >
            <span className="font-stamp text-[16px] leading-tight text-ink-100 underline decoration-brass-300/50 decoration-dotted underline-offset-4 hover:text-brass-100">
              {name}
            </span>
          </HoverCard>
        )
      }
      tone={remaining === 0 ? 'done' : 'plain'}
      status={mission.recalledAt !== null ? 'Turned around' : PHASE_LABEL[phase]}
    >
      {pinned && card !== null && (
        <Modal
          onClose={() => setPinned(false)}
          labelledBy={`job-card-title-${mission.id}`}
          className="max-w-sm"
          data-testid={`job-card-open-${mission.id}`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-surface-600/60 px-4 py-3">
            <h2
              id={`job-card-title-${mission.id}`}
              className="font-display text-[11px] uppercase tracking-[0.2em] text-brass-300"
            >
              The card this job was taken off
            </h2>
            <Button size="sm" onClick={() => setPinned(false)} data-testid="job-card-close">
              Close
            </Button>
          </div>
          <div className="p-4">
            <OfferCard offer={card} readOnly />
          </div>
        </Modal>
      )}
      {card !== null && (
        <div className="flex flex-col gap-1" data-testid={`job-worth-${mission.id}`}>
          {/* The job's whole pay, before what the party can carry and, on a fight, what survives
              to carry it: a ceiling (maintainer, 2026-10-02). */}
          <span className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            If it comes off, at most
          </span>
          <RewardLine rewards={card.rewards} />
          <span className="font-display text-[11px] font-bold tabular-nums text-hextech-100">
            +{card.xp.toLocaleString('en-US')} XP
          </span>
        </div>
      )}
      <Route
        from="Home"
        to={name}
        remaining={remaining === 0 ? 'at the gate' : formatCountdown(remaining)}
      />
      <ProgressBar
        progress={missionProgressAt(mission, now)}
        label={name}
        tone={remaining === 0 ? 'verdigris' : 'brass'}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Force army={mission.force} testPrefix="working" />
        <Rides fleet={mission.vehicles} testPrefix="working" />
      </div>
      {window > 0 && (
        <div className="border-t border-surface-700/70 pt-2.5">
          <CancelMark
            windowMs={window}
            label={`Call the ${name} crew back`}
            pending={pending}
            onCancel={onRecall}
            data-testid={`recall-job-${mission.id}`}
          />
        </div>
      )}
    </Row>
  );
}

/** A column between two of the crew's own places (2026-09-22). */
function Moving({
  move,
  now,
  pending,
  onRecall,
}: {
  move: UnitMoveView;
  now: Date;
  pending: boolean;
  onRecall: () => void;
}) {
  const left = Math.max(0, Date.parse(move.arrivesAt) - now.getTime());
  const total = Math.max(1, Date.parse(move.arrivesAt) - Date.parse(move.departedAt));
  const window = moveRecallWindowMs(move, now);
  // Nobody aboard: the machines driving themselves home after a drop (`moves/moves.ts`). They
  // carry the same mark a turned-round column does, so the two are told apart by the load.
  const empty = move.size === 0;
  const turned = move.recalledAt !== null && !empty;
  return (
    <Row
      testId={`move-${move.id}`}
      name={turned ? move.fromName : move.toName}
      status={empty ? 'Driving home' : turned ? 'Turned round' : 'Moving'}
    >
      <Route
        from={turned ? move.toName : move.fromName}
        to={turned ? move.fromName : move.toName}
        remaining={formatRemaining(left)}
      />
      <ProgressBar
        progress={Math.min(1, Math.max(0, 1 - left / total))}
        label={move.toName}
        tone="brass"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {empty && (
          <span className="font-body text-[12px] text-ink-300">
            The machines, driving back empty.
          </span>
        )}
        <Force army={move.army} testPrefix={`moving-${move.id}`} />
        <Rides fleet={move.vehicles} testPrefix={`moving-${move.id}`} />
      </div>
      {window > 0 && (
        <div className="border-t border-surface-700/70 pt-2.5">
          <CancelMark
            windowMs={window}
            label={`Turn the column to ${move.toName} round`}
            pending={pending}
            onCancel={onRecall}
            data-testid={`recall-move-${move.id}`}
          />
        </div>
      )}
    </Row>
  );
}

/** The runners on a job (2026-09-22): where, at what tier, and when the report is in. */
function SpyJob({
  run,
  now,
  pending,
  onRecall,
}: {
  run: SpyRunView;
  now: Date;
  pending: boolean;
  onRecall: () => void;
}) {
  const left = Math.max(0, Date.parse(run.returnsAt) - now.getTime());
  const total = Math.max(1, Date.parse(run.returnsAt) - Date.parse(run.departedAt));
  const window = spyRecallWindowMs(run, now);
  const turned = run.recalledAt !== null;
  return (
    <Row
      testId={`spy-run-${run.id}`}
      name={`${SPY_TIER_SPECS[run.tier].label} · ${run.capsPaid.toLocaleString('en-US')} caps`}
      status={turned ? 'Turned round' : 'Spying'}
    >
      <Route
        from="Home"
        to={`${run.placeName}, ${run.districtName}`}
        remaining={formatRemaining(left)}
      />
      <ProgressBar
        progress={Math.min(1, Math.max(0, 1 - left / total))}
        label={run.placeName}
        tone="brass"
      />
      <p className="font-body text-[12px] text-ink-300">
        {turned
          ? `Walking home, in ${formatRemaining(left)}. No report; the caps are spent.`
          : `The report is in, in ${formatRemaining(left)}.`}
      </p>
      {window > 0 && (
        <div className="border-t border-surface-700/70 pt-2.5">
          <CancelMark
            windowMs={window}
            label="Turn the runners round"
            pending={pending}
            onCancel={onRecall}
            data-testid={`recall-spy-${run.id}`}
          />
        </div>
      )}
    </Row>
  );
}
