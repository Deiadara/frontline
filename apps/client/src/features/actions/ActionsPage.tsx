import {
  findMissionTemplate,
  findVehicle,
  formatCountdown,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  movementCancelWindowMs,
  type BattleView,
  type Mission,
  type MissionPhase,
  type MovementView,
  type ScoutingRunView,
} from '@frontline/shared';
import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { cn } from '../../lib/cn';
import { useActions, useBattles, useMissions, useRecallColumn } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { PageShell } from '../game/PageShell';
import { UnitChip } from '../units/UnitChip';
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
 * A column inside the first tenth of its walk can be turned around, and the units go straight
 * back onto the roster: they have not reached anybody's ring, so unlike a withdrawal from ground
 * already held, nothing is owed for leaving. A crew on a job is turned around from the board.
 */
export function ActionsPage() {
  const query = useActions();
  const missions = useMissions();
  const battles = useBattles();
  const recall = useRecallColumn();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const data = query.data;
  const road = onTheRoad(data, missions.data, battles.data);

  return (
    <PageShell title="On the road" icon="actions" action={data ? <Counts road={road} /> : null}>
      {!data ? (
        <ScreenLoad
          what="The road"
          loading="Counting heads…"
          isError={query.isError}
          onRetry={() => void query.refetch()}
          detail="Nothing has been lost. Every column still gets where it was going."
        />
      ) : roadIsEmpty(road) ? (
        <Panel>
          <p className="p-6 font-body text-[13px] leading-relaxed text-ink-300">
            Nobody is out. Every unit you have is standing in your own district, which is the only
            place they are no use at all.
          </p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-4" data-testid="road">
          {/* A recall the server refuses. `movement.recallable` is computed when the response is
              built and `/actions` polls at 5s, while the row's own `canRecall` is recomputed every
              second: for up to five seconds after the window shuts the row reads "0s left to
              decide" beside a live button. `DeclareDialog` renders this same mutation's error. */}
          {recall.error !== null && (
            <p role="alert" className="font-body text-[13px] text-oxblood-300">
              {recall.error.message}
            </p>
          )}

          {road.columns.length > 0 && (
            <Section title="Walking to a fight" count={road.columns.length}>
              <ul className="flex flex-col gap-3" data-testid="movements">
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

          {road.fights.length > 0 && (
            <Section title="At a fight" count={road.fights.length}>
              <ul className="flex flex-col gap-3" data-testid="fights">
                {road.fights.map((view) => (
                  <Fight key={view.battle.id} view={view} now={now} />
                ))}
              </ul>
            </Section>
          )}

          {road.jobs.length > 0 && (
            <Section title="Out on a job" count={road.jobs.length}>
              <ul className="flex flex-col gap-3" data-testid="jobs">
                {road.jobs.map((mission) => (
                  <Job key={mission.id} mission={mission} now={now} />
                ))}
              </ul>
            </Section>
          )}

          {road.scout !== null && (
            <Section title="Looking" count={1}>
              <Scout run={road.scout} now={now} />
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
  ].filter((part): part is string => typeof part === 'string');
  return (
    <span
      className="font-display text-[12px] uppercase tracking-[0.14em] tabular-nums text-ink-300"
      data-testid="road-counts"
    >
      {parts.length === 0 ? 'Nobody out' : `${parts.join(' · ')} · ${counts.bodies} bodies`}
    </span>
  );
}

/** One kind of away, headed and counted, so the page reads as four short lists rather than one. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-2 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-brass-300">
        {title}
        <span className="font-normal tabular-nums text-ink-400">{count}</span>
      </h2>
      {children}
    </section>
  );
}

/** From where to what, with the clock: the same line on every row. */
function Route({ from, to, remaining }: { from: string; to: string; remaining: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-display text-[12px] uppercase tracking-[0.12em] text-ink-200">
      <span>{from}</span>
      <Icon name="actions" aria-hidden className="h-4 w-4 text-brass-300" />
      <span>{to}</span>
      <span className="ml-auto tabular-nums text-brass-300">{remaining}</span>
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
    <li data-testid={`column-${movement.id}`}>
      <Panel
        title={movement.targetName}
        action={
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
            {movement.side === 'attacker' ? 'Going in' : 'Holding'}
          </span>
        }
      >
        <div className="flex flex-col gap-3 p-4">
          <Route from={movement.fromName} to={movement.toName} remaining={formatRemaining(left)} />
          <ProgressBar progress={progress} label={movement.targetName} tone="brass" />
          <Force army={movement.army} perimeter={movement.perimeter} testPrefix="walking" />
          {movement.recallable && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={onRecall}
                data-testid={`recall-${movement.id}`}
              >
                Turn them around
              </Button>
              <span
                className={cn('font-display text-[11px] uppercase tracking-[0.14em] text-ink-300')}
              >
                {formatRemaining(canRecall)} left to decide
              </span>
            </div>
          )}
        </div>
      </Panel>
    </li>
  );
}

/** A force that has reached a fight: waiting for the mark, or in it. */
function Fight({ view, now }: { view: BattleView; now: Date }) {
  const phase = fightPhase(view, now);
  const left = Math.max(0, Date.parse(view.battle.scheduledFor) - now.getTime());
  return (
    <li data-testid={`fight-${view.battle.id}`}>
      <Panel
        title={view.targetName}
        action={
          <span
            className={cn(
              'font-display text-[11px] uppercase tracking-[0.16em]',
              phase === 'fighting' ? 'text-oxblood-300' : 'text-ink-300',
            )}
          >
            {phase === 'fighting'
              ? 'Fighting now'
              : view.side === 'attacker'
                ? 'Attacking at the mark'
                : 'Holding at the mark'}
          </span>
        }
      >
        <div className="flex flex-col gap-3 p-4">
          <Route
            from={view.districtName}
            to={view.opponentName}
            remaining={phase === 'fighting' ? 'settling' : formatRemaining(left)}
          />
          {view.muster && (
            <Force army={view.muster.army} perimeter={view.muster.perimeter} testPrefix="posted" />
          )}
        </div>
      </Panel>
    </li>
  );
}

const PHASE_LABEL: Record<MissionPhase, string> = {
  outbound: 'On the road out',
  onSite: 'On the job',
  returning: 'Heading home',
  returned: 'At the gate',
};

/** A crew out on a job, with the leg it is on. */
function Job({ mission, now }: { mission: Mission; now: Date }) {
  const template = findMissionTemplate(mission.templateId);
  const name = template?.name ?? mission.templateId;
  const phase = missionPhaseAt(mission, now);
  const remaining = missionRemainingMs(mission, now);
  const rides = Object.entries(mission.vehicles).filter(([, count]) => count > 0);
  return (
    <li data-testid={`job-${mission.id}`}>
      <Panel
        title={name}
        action={
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
            {mission.recalledAt !== null ? 'Turned around' : PHASE_LABEL[phase]}
          </span>
        }
      >
        <div className="flex flex-col gap-3 p-4">
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
            {rides.map(([vehicleId, count]) => (
              <span
                key={vehicleId}
                className="rounded-sm border border-surface-600 bg-surface-950/40 px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.1em] text-ink-200"
              >
                {findVehicle(vehicleId)?.name ?? vehicleId}{' '}
                <span className="tabular-nums text-brass-300">{count}</span>
              </span>
            ))}
          </div>
        </div>
      </Panel>
    </li>
  );
}

/** The scout on the road: one person, one mark, home and the ground open at the same moment. */
function Scout({ run, now }: { run: ScoutingRunView; now: Date }) {
  const left = Math.max(0, Date.parse(run.returnsAt) - now.getTime());
  const total = Math.max(1, Date.parse(run.returnsAt) - Date.parse(run.departedAt));
  return (
    <div data-testid="scout-run">
      <Panel
        title={run.officerName}
        action={
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
            Scouting
          </span>
        }
      >
        <div className="flex flex-col gap-3 p-4">
          <Route from="Home" to={run.districtName} remaining={formatRemaining(left)} />
          <ProgressBar
            progress={Math.min(1, Math.max(0, 1 - left / total))}
            label={run.districtName}
            tone="brass"
          />
          <p className="font-body text-[12px] text-ink-300">
            Back with the ground open in {formatRemaining(left)}.
          </p>
        </div>
      </Panel>
    </div>
  );
}
