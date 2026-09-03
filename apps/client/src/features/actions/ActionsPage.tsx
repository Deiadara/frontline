import { movementCancelWindowMs, type ActionsResponse, type MovementView } from '@frontline/shared';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { ScreenLoad } from '../../components/ui/LoadFailure';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useActions, useRecallColumn } from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { PageShell } from '../game/PageShell';
import { UnitChip } from '../units/UnitChip';

/**
 * Actions (§A4): everybody who is not where they started.
 *
 * The board answers "what is coming and what came back". This answers "where is everybody right
 * now", which became a real question the moment a force stopped arriving instantly: units sent to a
 * fight are on neither the roster nor the ground while they walk, and without this screen that is a
 * third place a player cannot see into.
 *
 * One row per column, and the row is the sentence: who, from where, to what, and how long. A column
 * inside the first tenth of its walk can be turned around, and the units go straight back onto the
 * roster: they have not reached anybody's ring, so unlike a withdrawal from ground already held,
 * nothing is owed for leaving.
 */
export function ActionsPage() {
  const query = useActions();
  const recall = useRecallColumn();
  const now = useServerClock(query.data?.serverNow, query.dataUpdatedAt);
  const data = query.data;

  return (
    <PageShell title="On the road" icon="actions" action={data ? <Counts data={data} /> : null}>
      {!data ? (
        <ScreenLoad
          what="The road"
          loading="Counting heads…"
          isError={query.isError}
          onRetry={() => void query.refetch()}
          detail="Nothing has been lost. Every column still gets where it was going."
        />
      ) : data.movements.length === 0 ? (
        <Panel>
          <p className="p-6 font-body text-[13px] leading-relaxed text-ink-300">
            Nobody is out. Every unit you have is standing in your own district, which is the only
            place they are no use at all.
          </p>
        </Panel>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="movements">
          {/* A recall the server refuses. `movement.recallable` is computed when the response is
              built and `/actions` polls at 5s, while the row's own `canRecall` is recomputed every
              second: for up to five seconds after the window shuts the row reads "0s left to
              decide" beside a live button. Pressing it was silent, and the only visible consequence
              was the button disappearing a moment later. `DeclareDialog` renders this same
              mutation's error. */}
          {recall.error !== null && (
            <li role="alert" className="font-body text-[13px] text-oxblood-300">
              {recall.error.message}
            </li>
          )}
          {data.movements.map((movement) => (
            <Column
              key={movement.id}
              movement={movement}
              now={now}
              pending={recall.isPending}
              onRecall={() => recall.mutate({ movementId: movement.id })}
            />
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function Counts({ data }: { data: ActionsResponse }) {
  const bodies = data.movements.reduce((total, movement) => total + movement.size, 0);
  return (
    <span className="font-display text-[12px] uppercase tracking-[0.14em] tabular-nums text-ink-300">
      {data.movements.length} on the move · {bodies} bodies
    </span>
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
  const line = Object.entries(movement.army).filter(([, count]) => count > 0);
  const ring = Object.entries(movement.perimeter).filter(([, count]) => count > 0);
  const canRecall = movementCancelWindowMs(
    {
      ...movement,
      baseId: '',
      fromDistrictId: '',
      toDistrictId: '',
    },
    now,
  );

  return (
    <li>
      <Panel
        title={movement.targetName}
        action={
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
            {movement.side === 'attacker' ? 'Going in' : 'Holding'}
          </span>
        }
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2 font-display text-[12px] uppercase tracking-[0.12em] text-ink-200">
            <span>{movement.fromName}</span>
            <Icon name="actions" aria-hidden className="h-4 w-4 text-brass-300" />
            <span>{movement.toName}</span>
            <span className="ml-auto tabular-nums text-brass-300">{formatRemaining(left)}</span>
          </div>

          <span className="block h-1.5 w-full overflow-hidden rounded-sm bg-surface-800">
            <span
              className="block h-full rounded-sm bg-brass-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>

          <ul className="flex flex-wrap gap-1.5">
            {line.map(([unitId, count]) => (
              <li key={unitId}>
                <UnitChip unitId={unitId} count={count} data-testid={`walking-${unitId}`} />
              </li>
            ))}
            {ring.map(([unitId, count]) => (
              <li key={`ring-${unitId}`}>
                <UnitChip unitId={unitId} count={count} muted />
              </li>
            ))}
          </ul>

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
