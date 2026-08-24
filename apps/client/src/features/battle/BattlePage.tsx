import {
  MAX_BUILDING_GARRISONS,
  type BattleReportView,
  type BattleView,
  type BattlesResponse,
  type SacrificeOption,
  type StructureDefence,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import {
  useBattles,
  useDeployToBattle,
  useGarrisonStructure,
  useMe,
  useSacrificeInfamy,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { PageShell } from '../game/PageShell';
import { BattleReportModal } from './BattleReportModal';
import { DeployDialog } from './DeployDialog';

/**
 * The board (GDD §A4, battle rework).
 *
 * Everything with a **deadline** on it lives here, and that is the organising idea: a declared fight
 * is the only thing in this game a player can be late for. So the coming fights are at the top, with
 * a countdown and the one control that matters before the mark; the reports are under them; and the
 * two standing decisions — what your own district is worth to break into, and what your name will
 * buy — are at the bottom where they can be read at leisure.
 *
 * A fight is *called* from a district page, because that is where the ground is. This is where you
 * answer for it.
 */

export function BattlePage() {
  const battles = useBattles();
  const me = useMe();
  const deploy = useDeployToBattle();

  const [deploying, setDeploying] = useState<BattleView | null>(null);
  const [reading, setReading] = useState<BattleReportView | null>(null);

  const data = battles.data;
  const army = me.data?.base?.army ?? {};

  return (
    <PageShell
      title="The Board"
      icon="city"
      lede="Fights are called for a time, and everybody gets to see them coming."
      action={
        data ? (
          <span
            data-testid="board-infamy"
            className="font-display text-sm font-bold tabular-nums text-sear-300"
          >
            {data.infamy} infamy
          </span>
        ) : null
      }
    >
      {!data ? (
        <p className="p-6 font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Reading the board…
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <Coming
            data={data}
            onDeploy={setDeploying}
            deployingId={deploy.isPending ? deploying?.battle.id : undefined}
          />
          <Reports reports={data.reports} onRead={setReading} />
          <div className="grid gap-5 lg:grid-cols-2">
            <Defences structures={data.structures} />
            <Sinks
              sacrifices={data.sacrifices}
              running={data.sacrificeRunning}
              infamy={data.infamy}
            />
          </div>
        </div>
      )}

      {deploying && (
        <DeployDialog
          view={deploying}
          army={army}
          infamy={data?.infamy ?? 0}
          pending={deploy.isPending}
          error={deploy.error}
          onClose={() => setDeploying(null)}
          onConfirm={(changes, perimeterChanges) =>
            deploy.mutate(
              { battleId: deploying.battle.id, changes, perimeterChanges },
              { onSuccess: () => setDeploying(null) },
            )
          }
        />
      )}

      {reading && (
        <BattleReportModal
          analysis={reading.analysis}
          side={reading.side}
          onClose={() => setReading(null)}
        />
      )}
    </PageShell>
  );
}

function Coming({
  data,
  onDeploy,
  deployingId,
}: {
  data: BattlesResponse;
  onDeploy: (view: BattleView) => void;
  deployingId: string | undefined;
}) {
  const now = Date.parse(data.serverNow);
  return (
    <Panel title="Coming">
      {data.coming.length === 0 ? (
        <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
          You have not called a fight. Walk into a district, pick a location worth taking, and name
          the hour. It has to be at least eight hours away and no more than a day.
        </p>
      ) : (
        <div className="grid gap-3 p-4 lg:grid-cols-2" data-testid="coming-battles">
          {data.coming.map((view) => (
            <article
              key={view.battle.id}
              data-testid={`battle-${view.battle.id}`}
              className={cn(
                'flex flex-col gap-2 border p-3',
                view.role === 'defender'
                  ? 'border-oxblood-500/50 bg-oxblood-300/5'
                  : view.role === 'attacker'
                    ? 'border-brass-500/50 bg-brass-300/5'
                    : 'border-surface-700 bg-surface-900',
              )}
            >
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
                    {view.districtName}
                  </p>
                  <h3 className="truncate font-display text-sm font-bold tracking-[0.08em] text-ink-100">
                    {view.targetName}
                  </h3>
                </div>
                <span className="shrink-0 border border-surface-600 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
                  {view.role}
                </span>
              </header>

              <dl className="flex flex-col divide-y divide-surface-700 border-y border-surface-700">
                <Row
                  label="Goes off in"
                  value={formatRemaining(Date.parse(view.battle.scheduledFor) - now)}
                />
                <Row label="Against" value={view.opponentName} />
                <Row label="You have there" value={String(view.muster?.size ?? 0)} />
                <Row
                  label="They have there"
                  value={view.enemySize === null ? 'unknown' : `about ${view.enemySize}`}
                />
              </dl>

              <p className="font-body text-[11px] leading-relaxed text-ink-300">
                {view.enemyIntel}
              </p>

              {view.side !== null && (
                <div>
                  <Button
                    size="sm"
                    disabled={!view.deploymentOpen || deployingId === view.battle.id}
                    onClick={() => onDeploy(view)}
                    data-testid={`deploy-open-${view.battle.id}`}
                  >
                    {view.deploymentOpen ? 'Move people' : 'They are on the ground'}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Reports({
  reports,
  onRead,
}: {
  reports: readonly BattleReportView[];
  onRead: (report: BattleReportView) => void;
}) {
  return (
    <Panel title="What came back">
      {reports.length === 0 ? (
        <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
          Nothing has gone off yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-surface-700 p-4" data-testid="battle-reports">
          {reports.map((report) => (
            <li
              key={report.battleId}
              className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <span className="min-w-0">
                <span
                  className={cn(
                    'block font-display text-[12px] uppercase tracking-[0.14em]',
                    report.won ? 'text-brass-300' : 'text-oxblood-300',
                  )}
                >
                  {report.won ? 'Held' : 'Lost'} · {report.targetName}
                </span>
                <span className="block font-body text-[11px] text-ink-300">
                  {report.redacted
                    ? 'Nobody came back to tell you what happened.'
                    : (report.analysis?.headline ?? '')}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRead(report)}
                data-testid={`read-${report.battleId}`}
              >
                Read
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Your own ground: what is standing, how badly it has been hit, and who is watching it. */
function Defences({ structures }: { structures: readonly StructureDefence[] }) {
  const garrison = useGarrisonStructure();
  return (
    <Panel title="Your ground">
      <div className="flex flex-col gap-2 p-4" data-testid="structures">
        <p className="font-body text-[11px] leading-relaxed text-ink-300">
          Watching a structure means posting some of your people inside it. You can do that three
          times over on the same building, and each set of watchers makes it harder for an attacker
          to get in. If they do get in, they leave damage behind — and a damaged building does as
          little as half its job until it is fixed. Building it up one more level fixes it.
        </p>
        {structures.map((structure) => (
          <div
            key={structure.buildingId}
            data-testid={`structure-${structure.kind}`}
            className="flex items-center justify-between gap-3 border border-surface-700 p-2"
          >
            <span className="min-w-0">
              <span className="block font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                {structure.label} {structure.level}
              </span>
              <span className="block font-body text-[11px] text-ink-300">
                {structure.damage > 0
                  ? `Wrecked ${Math.round(structure.damage)}% · running at ${Math.round(structure.effectiveness * 100)}%`
                  : 'Intact'}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-display text-[11px] tabular-nums text-brass-300">
                {structure.garrisons} / {MAX_BUILDING_GARRISONS}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={garrison.isPending || structure.garrisons >= MAX_BUILDING_GARRISONS}
                onClick={() => garrison.mutate({ buildingId: structure.buildingId, delta: 1 })}
                data-testid={`watch-${structure.kind}`}
              >
                Watch
              </Button>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** §D7 — the only thing in the game that lowers infamy is a player choosing to spend it. */
function Sinks({
  sacrifices,
  running,
  infamy,
}: {
  sacrifices: readonly SacrificeOption[];
  running: string | null;
  infamy: number;
}) {
  const sacrifice = useSacrificeInfamy();
  return (
    <Panel title="What a name buys">
      <div className="flex flex-col gap-2 p-4" data-testid="sacrifices">
        <p className="font-body text-[11px] leading-relaxed text-ink-300">
          You have {infamy}. {running ?? 'Nothing is burning right now.'}
        </p>
        {sacrifices.map((option) => (
          <div
            key={option.id}
            data-testid={`sacrifice-${option.id}`}
            className="flex items-start justify-between gap-3 border border-surface-700 p-2"
          >
            <span className="min-w-0">
              <span className="block font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                {option.name}
              </span>
              <span className="block font-body text-[11px] leading-relaxed text-ink-300">
                {option.description}
              </span>
              <span className="mt-1 block font-display text-[10px] uppercase tracking-[0.16em] text-brass-300">
                {option.cost} infamy · {option.effect}
              </span>
            </span>
            <Button
              size="sm"
              variant="danger"
              disabled={!option.affordable || running !== null || sacrifice.isPending}
              onClick={() => sacrifice.mutate({ sacrificeId: option.id })}
              data-testid={`burn-${option.id}`}
            >
              Burn it
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">{label}</dt>
      <dd className="truncate font-display text-xs tabular-nums text-ink-200">{value}</dd>
    </div>
  );
}
