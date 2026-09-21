import {
  findMissionTemplate,
  findVehicle,
  formatCountdown,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  movementCancelWindowMs,
  recallWindowMs,
  scoutRecallWindowMs,
  type BattleView,
  type Mission,
  type MissionPhase,
  type MovementView,
  type ScoutingRunView,
  type SleeperCellView,
  type Fleet,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { CancelMark } from '../../components/ui/CancelMark';
import { DrawnFace } from '../../components/ui/DrawnMarks';
import { Icon, type IconName } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import {
  useActions,
  useBattles,
  useMissions,
  useRecallColumn,
  useRecallMission,
  useRecallScout,
  useRecallSleepers,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { PageShell } from '../game/PageShell';
import { FileSection } from '../overseer/FileSection';
import { UnitChip } from '../units/UnitChip';
import { Census } from './Census';
import { HomeMark, OutMark } from './CensusMarks';
import { fightPhase, onTheRoad, roadCounts, roadIsEmpty, type Road } from './road';

/**
 * Actions (§A4): everybody who is not where they started, live.
 *
 * The board answers "what is coming and what came back". This answers "where is everybody right
 * now": columns walking to a fight, crews out on a job, forces standing at a fight they have
 * reached or fighting it, and the scout on the road. It listed only the first, so a player whose
 * whole army was out on missions was told nobody was out. Four reads, one clock (`useServerClock`
 * off the road's own `serverNow`), and every countdown on the page ticks.
 *
 * Anything on the road can be turned round in the first tenth of its walk out (maintainer request,
 * 2026-09-12), and every row wears the same X for it. A column's units go straight back onto the
 * roster: they have not reached anybody's ring, so unlike a withdrawal from ground already held,
 * nothing is owed for leaving. A crew on a job and the scout walk home the distance covered.
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
];

type MonitorPage = (typeof MONITOR_PAGES)[number]['id'];

/**
 * How many things the road tab is listing, for the badge on it.
 *
 * Rows rather than `roadCounts().unitSlots`: the badge sits beside the word "on the road", and a
 * player reads it as "how many entries am I about to look at". The slot figure is the header's
 * job on the page itself, where it has the room to say which currency it is in.
 */
function roadRows(road: Road): number {
  const counts = roadCounts(road);
  return (
    counts.columns + counts.jobs + counts.fights + counts.scouts + counts.cells + counts.stationed
  );
}

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
  const recallScout = useRecallScout(road.scout?.districtId);
  const recallCell = useRecallSleepers();
  const { pathname } = useLocation();
  const page: MonitorPage = pathname.endsWith('/units') ? 'census' : 'road';

  return (
    /*
     * The same sheet Battles and Notifications get: `wide` and `fills`.
     *
     * This opened on the narrow default, so a page that lists every column on the road, every fight
     * in flight and the scout, sat in a column about half the width of the screen beside a field of
     * empty backdrop, while the two screens it is most like ran the full sheet. `wide` gives it the
     * width, and `fills` makes the list do its own scrolling instead of the whole sheet growing,
     * which is what a live board of things in flight wants (maintainer request, 2026-09-14).
     */
    <PageShell
      title="The Monitor"
      icon="actions"
      action={page === 'road' && data ? <Counts road={road} /> : null}
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
      <div
        className="flex shrink-0 flex-wrap items-center gap-2"
        role="tablist"
        aria-label="The Monitor"
        data-testid="monitor-tabs"
      >
        {MONITOR_PAGES.map((entry) => (
          <MonitorTab
            key={entry.id}
            page={entry}
            active={page === entry.id}
            count={entry.id === 'road' && data ? roadRows(road) : null}
          />
        ))}
      </div>

      {page === 'census' ? (
        <Census />
      ) : !data ? (
        <ScreenLoad
          what="The road"
          loading="Counting heads…"
          isError={query.isError}
          onRetry={() => void query.refetch()}
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
          {[recall, recallJob, recallScout, recallCell].map(
            (write, index) =>
              write.error && (
                <p key={index} role="alert" className="font-body text-[13px] text-oxblood-300">
                  {write.error.message}
                </p>
              ),
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
                    pending={recall.isPending}
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
                    pending={recallCell.isPending}
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
            <Section
              icon="missions"
              title="Out on a job"
              note="Crews on the mission board's work. Inside the first tenth of the road out they can still be called back."
              count={road.jobs.length}
            >
              <ul className="flex flex-col gap-2.5" data-testid="jobs">
                {road.jobs.map((mission) => (
                  <Job
                    key={mission.id}
                    mission={mission}
                    now={now}
                    pending={recallJob.isPending}
                    onRecall={() => recallJob.mutate({ missionId: mission.id })}
                  />
                ))}
              </ul>
            </Section>
          )}

          {road.scout !== null && (
            <Section
              icon="eye"
              title="Looking"
              note="The one scout out. The ground opens the moment they are home, unless they were turned round in the first tenth of the way."
              count={1}
            >
              <ul className="flex flex-col gap-2.5">
                <Scout
                  run={road.scout}
                  now={now}
                  pending={recallScout.isPending}
                  onRecall={() => recallScout.mutate({})}
                />
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
    counts.scouts > 0 && 'a scout out',
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
function Section({
  icon,
  title,
  note,
  count,
  children,
}: {
  icon: IconName;
  title: string;
  note: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <FileSection
      icon={icon}
      title={title}
      note={note}
      action={
        <span className="rounded-sm border border-brass-500/50 bg-brass-300/10 px-2 py-0.5 font-display text-[11px] font-bold tabular-nums tracking-[0.12em] text-brass-100">
          {count}
        </span>
      }
    >
      {children}
    </FileSection>
  );
}

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
      {cell.phase !== 'returning' && (
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

function Row({
  testId,
  name,
  status,
  tone = 'plain',
  children,
}: {
  testId: string;
  name: string;
  status: string;
  tone?: 'plain' | 'hot' | 'done';
  children: ReactNode;
}) {
  return (
    <li
      data-testid={testId}
      className="flex flex-col gap-2.5 rounded-sm border border-surface-700 bg-surface-950/40 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-stamp text-[16px] leading-tight text-ink-100">
          {name}
        </h3>
        <span
          className={cn(
            'shrink-0 rounded-sm border px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em]',
            tone === 'hot'
              ? 'border-oxblood-500/60 text-oxblood-300'
              : tone === 'done'
                ? 'border-verdigris-300/60 text-verdigris-100'
                : 'border-surface-600 text-ink-300',
          )}
        >
          {status}
        </span>
      </div>
      {children}
    </li>
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
      {view.muster && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Force army={view.muster.army} perimeter={view.muster.perimeter} testPrefix="posted" />
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
}: {
  mission: Mission;
  now: Date;
  pending: boolean;
  onRecall: () => void;
}) {
  const template = findMissionTemplate(mission.templateId);
  const name = template?.name ?? mission.templateId;
  const phase = missionPhaseAt(mission, now);
  const remaining = missionRemainingMs(mission, now);
  const window = recallWindowMs(mission, now);
  return (
    <Row
      testId={`job-${mission.id}`}
      name={name}
      tone={remaining === 0 ? 'done' : 'plain'}
      status={mission.recalledAt !== null ? 'Turned around' : PHASE_LABEL[phase]}
    >
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

/** The scout on the road: one person, one mark, home and the ground open at the same moment. */
function Scout({
  run,
  now,
  pending,
  onRecall,
}: {
  run: ScoutingRunView;
  now: Date;
  pending: boolean;
  onRecall: () => void;
}) {
  const left = Math.max(0, Date.parse(run.returnsAt) - now.getTime());
  const total = Math.max(1, Date.parse(run.returnsAt) - Date.parse(run.departedAt));
  const window = scoutRecallWindowMs(run, now);
  const turned = run.recalledAt !== null;
  return (
    <Row testId="scout-run" name={run.officerName} status={turned ? 'Turned round' : 'Scouting'}>
      <Route from="Home" to={run.districtName} remaining={formatRemaining(left)} />
      <ProgressBar
        progress={Math.min(1, Math.max(0, 1 - left / total))}
        label={run.districtName}
        tone="brass"
      />
      <p className="font-body text-[12px] text-ink-300">
        {turned
          ? `Walking home, in ${formatRemaining(left)}. The ground stays shut.`
          : `Back with the ground open in ${formatRemaining(left)}.`}
      </p>
      {window > 0 && (
        <div className="border-t border-surface-700/70 pt-2.5">
          <CancelMark
            windowMs={window}
            label={`Turn ${run.officerName} round`}
            pending={pending}
            onCancel={onRecall}
            data-testid="recall-scout"
          />
        </div>
      )}
    </Row>
  );
}
