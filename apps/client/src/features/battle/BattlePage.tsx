import {
  MAX_BUILDING_GARRISONS,
  findUnit,
  type BattleBoostOption,
  type BattleReportView,
  type BattleView,
  type BattlesResponse,
  type StructureDefence,
} from '@frontline/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import {
  useBattles,
  useBuyBattleBoost,
  useDeployToBattle,
  useGarrisonStructure,
  useMe,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { PageShell } from '../game/PageShell';
import { BattleReportModal } from './BattleReportModal';
import { DeployDialog } from './DeployDialog';

/**
 * The Battles page (GDD §A4, battle rework).
 *
 * ## A list you scan, and one fight you open
 *
 * This used to be four stacked panels of prose, and the fight you actually cared about was a
 * paragraph among them. Grepolis and Ikariam both solve the same problem the same way and it is
 * the right solution: a **list of rows** where each row is a clock, a place and a verdict, and a
 * **detail** that opens when you pick one. Nothing about a fight you are not looking at is on the
 * screen, which is what buys the room to say something useful about the one you are.
 *
 * A row is deliberately three glances wide: how long you have, what the ground is, and whether you
 * are the one knocking. Everything else, the units on the ground, the intel, the boost, is in the
 * detail, because none of it means anything until you have chosen which fight to think about.
 *
 * ## Two lists, not four panels
 *
 * Coming fights and finished ones are the same shape of thing at different times, so they are one
 * switch rather than two panels competing for the top of the page. Your own defences are a third
 * tab: it is a standing concern rather than a deadline, and it was taking a third of the screen
 * from things that are.
 *
 * A fight is *called* from a district page, because that is where the ground is. This is where you
 * answer for it.
 */

type Tab = 'coming' | 'reports' | 'ground';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'coming', label: 'Coming' },
  { id: 'reports', label: 'Reports' },
  { id: 'ground', label: 'Your ground' },
];

export function BattlePage() {
  const battles = useBattles();
  const me = useMe();
  const deploy = useDeployToBattle();

  const [tab, setTab] = useState<Tab>('coming');
  const [openId, setOpenId] = useState<string | null>(null);
  const [deploying, setDeploying] = useState<BattleView | null>(null);
  const [reading, setReading] = useState<BattleReportView | null>(null);

  const data = battles.data;
  const army = me.data?.base?.army ?? {};
  const notoriety = me.data?.base?.economy.notoriety ?? 0;

  // The fight the detail is showing. Falls back to the first one so the page never opens on an
  // empty right-hand column with a full list beside it.
  const open = data?.coming.find((view) => view.battle.id === openId) ?? data?.coming[0] ?? null;

  return (
    <PageShell
      title="Battles"
      icon="battles"
      lede="Fights are called for a time, and everybody gets to see them coming."
      action={data ? <Counts data={data} /> : null}
    >
      {!data ? (
        <p className="p-6 font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Reading the board…
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Tabs tab={tab} onPick={setTab} data={data} />

          {tab === 'coming' &&
            (data.coming.length === 0 ? (
              <Empty>
                Nothing is called. Walk into a district, pick something worth taking, and name the
                hour.
              </Empty>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <ul className="flex flex-col gap-2" data-testid="coming-battles">
                  {data.coming.map((view) => (
                    <ComingRow
                      key={view.battle.id}
                      view={view}
                      now={Date.parse(data.serverNow)}
                      open={view.battle.id === open?.battle.id}
                      onOpen={() => setOpenId(view.battle.id)}
                    />
                  ))}
                </ul>
                {open && (
                  <BattleDetail
                    view={open}
                    infamy={data.infamy}
                    now={Date.parse(data.serverNow)}
                    onDeploy={() => setDeploying(open)}
                    deploying={deploy.isPending && deploying?.battle.id === open.battle.id}
                  />
                )}
              </div>
            ))}

          {tab === 'reports' && <Reports reports={data.reports} onRead={setReading} />}
          {tab === 'ground' && <Defences structures={data.structures} />}
        </div>
      )}

      {deploying && (
        <DeployDialog
          view={deploying}
          army={army}
          notoriety={notoriety}
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

/** The two numbers worth having in the title bar: what is coming, and what you have to spend. */
function Counts({ data }: { data: BattlesResponse }) {
  return (
    <span className="flex items-center gap-3">
      <span
        data-testid="board-infamy"
        className="font-display text-sm font-bold tabular-nums text-oxblood-300"
      >
        {data.infamy} infamy
      </span>
    </span>
  );
}

function Tabs({
  tab,
  onPick,
  data,
}: {
  tab: Tab;
  onPick: (tab: Tab) => void;
  data: BattlesResponse;
}) {
  const count: Record<Tab, number> = {
    coming: data.coming.length,
    reports: data.reports.length,
    ground: data.structures.length,
  };
  return (
    <div role="tablist" aria-label="Battles" className="flex flex-wrap gap-1.5">
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          data-testid={`battles-tab-${entry.id}`}
          onClick={() => onPick(entry.id)}
          className={cn(
            'edge-lit flex items-center gap-2 rounded-sm border px-3 py-2 transition-colors duration-150',
            'font-display text-[12px] font-bold uppercase tracking-[0.14em]',
            tab === entry.id
              ? 'border-brass-300/80 bg-brass-300/15 text-brass-100'
              : 'border-surface-600 bg-surface-800/70 text-ink-300 hover:border-iris-300/60 hover:text-ink-100',
          )}
        >
          {entry.label}
          <span className="font-display text-[11px] tabular-nums text-ink-300">
            {count[entry.id]}
          </span>
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <Panel>
      <p className="p-6 font-body text-[13px] leading-relaxed text-ink-300">{children}</p>
    </Panel>
  );
}

const ROLE_TONE: Record<BattleView['role'], string> = {
  attacker: 'border-brass-500/60 text-brass-300',
  defender: 'border-oxblood-500/60 text-oxblood-300',
  bystander: 'border-surface-600 text-ink-300',
};

/**
 * One coming fight, as a row.
 *
 * The clock leads, in the largest type on the row, because it is the only thing here a player can
 * be late for. Under it the ground and who is on the other side of it; to the right the side you
 * are on. Three facts, no sentences.
 */
function ComingRow({
  view,
  now,
  open,
  onOpen,
}: {
  view: BattleView;
  now: number;
  open: boolean;
  onOpen: () => void;
}) {
  const left = Date.parse(view.battle.scheduledFor) - now;
  const urgent = left <= 60 * 60 * 1000;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? 'true' : undefined}
        data-testid={`battle-${view.battle.id}`}
        className={cn(
          'edge-lit flex w-full items-center gap-3 rounded-sm border p-2.5 text-left transition-colors duration-150',
          open
            ? 'border-brass-300/80 bg-brass-300/10'
            : 'border-surface-700 bg-surface-900/70 hover:border-iris-300/60',
        )}
      >
        <span
          className={cn(
            'flex h-11 w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-sm border',
            urgent
              ? 'border-oxblood-500/70 bg-oxblood-300/10'
              : 'border-surface-600 bg-surface-950',
          )}
        >
          <span
            className={cn(
              'font-display text-[13px] font-bold leading-none tabular-nums',
              urgent ? 'text-oxblood-300' : 'text-ink-100',
            )}
          >
            {formatRemaining(left)}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[13px] font-bold tracking-[0.06em] text-ink-100">
            {view.targetName}
          </span>
          <span className="block truncate font-body text-[11px] text-ink-300">
            {view.districtName} · {view.opponentName}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-sm border px-1.5 py-0.5 font-display text-[10px] uppercase tracking-[0.14em]',
            ROLE_TONE[view.role],
          )}
        >
          {view.role}
        </span>
      </button>
    </li>
  );
}

/** The one fight the player has opened: the ground, who is on it, and what a name would buy. */
function BattleDetail({
  view,
  infamy,
  now,
  onDeploy,
  deploying,
}: {
  view: BattleView;
  infamy: number;
  now: number;
  onDeploy: () => void;
  deploying: boolean;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid={`battle-detail-${view.battle.id}`}>
      <Panel
        title={view.targetName}
        action={
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
            {view.districtName}
          </span>
        }
      >
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Figure
            label="Goes off in"
            value={formatRemaining(Date.parse(view.battle.scheduledFor) - now)}
          />
          <Figure label="Against" value={view.opponentName} />
          <Figure
            label="They have there"
            value={view.enemySize === null ? 'Unknown' : `~${view.enemySize}`}
            note={view.enemyIntel}
          />
        </div>

        <Forces view={view} />

        {view.side !== null && (
          <div className="flex flex-wrap items-center gap-3 border-t border-surface-700 p-4">
            <Button
              disabled={!view.deploymentOpen || deploying}
              onClick={onDeploy}
              data-testid={`deploy-open-${view.battle.id}`}
            >
              {view.deploymentOpen ? 'Move people' : 'They are on the ground'}
            </Button>
            {!view.deploymentOpen && (
              <span className="font-body text-[11px] text-ink-300">
                Nobody moves in the last minute before the mark.
              </span>
            )}
          </div>
        )}
      </Panel>

      {view.side !== null && <NameBuys view={view} infamy={infamy} />}
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border border-surface-700 bg-surface-950/60 p-2.5">
      <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">{label}</p>
      <p className="mt-0.5 truncate font-display text-base font-bold tabular-nums text-ink-100">
        {value}
      </p>
      {note !== undefined && note !== '' && (
        <p className="mt-1 font-body text-[11px] leading-snug text-ink-300">{note}</p>
      )}
    </div>
  );
}

/**
 * What you have on the ground, unit by unit.
 *
 * The board's own request, and the thing the old page could not answer at all: it printed a single
 * body count. A player deciding whether to buy a boost for the heavy end of their force has to be
 * able to see whether they *sent* the heavy end of their force.
 */
function Forces({ view }: { view: BattleView }) {
  const muster = view.muster;
  if (!muster) return null;
  const rows = Object.entries(muster.army).filter(([, count]) => count > 0);
  const ring = Object.entries(muster.perimeter).filter(([, count]) => count > 0);

  return (
    <div className="border-t border-surface-700 p-4" data-testid="battle-forces">
      <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
        On the ground
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 font-body text-[12px] text-ink-300">
          Nobody yet. An empty field is a loss you called yourself.
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {rows.map(([unitId, count]) => (
            <UnitPill key={unitId} unitId={unitId} count={count} />
          ))}
        </ul>
      )}
      {ring.length > 0 && (
        <>
          <p className="mt-3 font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
            On the ring
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ring.map(([unitId, count]) => (
              <UnitPill key={unitId} unitId={unitId} count={count} muted />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function UnitPill({
  unitId,
  count,
  muted = false,
}: {
  unitId: string;
  count: number;
  muted?: boolean;
}) {
  const unit = findUnit(unitId);
  return (
    <li
      data-testid={`force-${unitId}`}
      className={cn(
        'flex items-center gap-2 rounded-sm border px-2 py-1',
        muted ? 'border-surface-700 bg-surface-900/60' : 'border-surface-600 bg-surface-800/70',
      )}
    >
      <Icon name="units" className={cn('h-4 w-4', muted ? 'text-ink-300' : 'text-brass-300')} />
      <span className="font-display text-[11px] uppercase tracking-[0.1em] text-ink-200">
        {unit?.name ?? unitId}
      </span>
      <span className="font-display text-[13px] font-bold tabular-nums text-ink-100">{count}</span>
    </li>
  );
}

/**
 * §D7: what a name buys, for this fight and no other.
 *
 * A drop-down rather than a wall of cards, because one is bought per battle and the choice is
 * between comparable things: the same shape of effect at different prices and different reach. The
 * option list carries the price and the reach on every line, so the comparison is in the list and
 * not in the player's head.
 *
 * The ones nobody has put on the table are still shown, greyed and labelled with what would put
 * them there. A boost you cannot see is a boost you never research.
 */
function NameBuys({ view, infamy }: { view: BattleView; infamy: number }) {
  const buy = useBuyBattleBoost();
  const bought = view.boosts.find((option) => option.id === view.boostId) ?? null;
  const [picked, setPicked] = useState<string>('');
  const choice = view.boosts.find((option) => option.id === picked) ?? null;

  const shut = !view.deploymentOpen;
  const blocked = blockerFor(choice, shut);

  return (
    <Panel title="What a name buys">
      <div className="flex flex-col gap-3 p-4" data-testid="name-buys">
        {bought ? (
          <div
            className="border border-brass-300/60 bg-brass-300/10 p-2.5"
            data-testid="boost-bought"
          >
            <p className="font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
              {bought.name}
            </p>
            <p className="mt-0.5 font-body text-[12px] leading-snug text-ink-100">
              {bought.effect} · reaching {bought.reach}% of what you sent
            </p>
          </div>
        ) : (
          <p className="font-body text-[12px] leading-relaxed text-ink-300">
            One per fight. It is paid the moment you take it, and changing your mind costs the name
            twice.
          </p>
        )}

        <Dropdown
          label="Boost"
          placeholder={bought ? 'Take a different one' : 'Choose a boost'}
          value={picked}
          disabled={shut}
          options={view.boosts.map((option) => ({
            value: option.id,
            label: option.name,
            hint: hintFor(option),
            disabled: !option.available || !option.affordable,
          }))}
          onChange={setPicked}
          data-testid="boost-picker"
        />

        {choice && (
          <div className="border border-surface-700 bg-surface-950/60 p-2.5">
            <p className="font-body text-[12px] leading-relaxed text-ink-100">
              {choice.description}
            </p>
            <p className="mt-1.5 font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
              {choice.effect}
            </p>
            <p className="mt-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
              {choice.cost} infamy · reaches {choice.reach}% of your force
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="danger"
            disabled={choice === null || blocked !== null || buy.isPending}
            onClick={() =>
              choice &&
              buy.mutate(
                { battleId: view.battle.id, boostId: choice.id },
                { onSuccess: () => setPicked('') },
              )
            }
            data-testid="buy-boost"
          >
            Burn the name
          </Button>
          <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
            {blocked ?? `You have ${infamy}`}
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** The line under the option: price, reach, and why it is out of reach when it is. */
function hintFor(option: BattleBoostOption): string {
  if (!option.available) return option.source || 'Nobody has put this on the table';
  const reach = option.reach === 0 ? 'reaches nothing you sent' : `reaches ${option.reach}%`;
  return `${option.cost} infamy · ${option.effect} · ${reach}`;
}

/** Why the button is off, in the player's words, or null when it is on. */
function blockerFor(option: BattleBoostOption | null, shut: boolean): string | null {
  if (shut) return 'They are already on the ground';
  if (option === null) return null;
  if (!option.available) return option.source || 'Nobody has put this on the table';
  if (!option.affordable) return 'Your name is not worth that yet';
  return null;
}

function Reports({
  reports,
  onRead,
}: {
  reports: readonly BattleReportView[];
  onRead: (report: BattleReportView) => void;
}) {
  if (reports.length === 0) return <Empty>Nothing has gone off yet.</Empty>;
  return (
    <Panel>
      <ul className="flex flex-col divide-y divide-surface-700 p-2" data-testid="battle-reports">
        {reports.map((report) => (
          <li key={report.battleId}>
            <button
              type="button"
              onClick={() => onRead(report)}
              data-testid={`read-${report.battleId}`}
              className="flex w-full items-center gap-3 p-2 text-left transition-colors duration-150 hover:bg-brass-300/10"
            >
              <span
                className={cn(
                  'flex h-9 w-16 shrink-0 items-center justify-center rounded-sm border font-display text-[11px] font-bold uppercase tracking-[0.14em]',
                  report.won
                    ? 'border-brass-300/70 bg-brass-300/10 text-brass-300'
                    : 'border-oxblood-500/70 bg-oxblood-300/10 text-oxblood-300',
                )}
              >
                {report.won ? 'Held' : 'Lost'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[13px] tracking-[0.06em] text-ink-100">
                  {report.targetName}
                </span>
                <span className="block truncate font-body text-[11px] text-ink-300">
                  {report.redacted
                    ? 'Nobody came back to tell you what happened.'
                    : (report.analysis?.headline ?? '')}
                </span>
              </span>
              <Icon name="chevron-down" className="h-4 w-4 shrink-0 -rotate-90 text-ink-300" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Your own ground: what is standing, how badly it has been hit, and who is watching it. */
function Defences({ structures }: { structures: readonly StructureDefence[] }) {
  const garrison = useGarrisonStructure();
  return (
    <Panel title="Your ground">
      <div className="flex flex-col gap-2 p-4" data-testid="structures">
        <p className="font-body text-[12px] leading-relaxed text-ink-300">
          Watchers make a building harder to break into, three sets to a building. What gets in
          leaves damage, and a damaged building does as little as half its job until it is built up
          a level.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {structures.map((structure) => (
            <div
              key={structure.buildingId}
              data-testid={`structure-${structure.kind}`}
              className="flex items-center justify-between gap-3 border border-surface-700 bg-surface-950/50 p-2"
            >
              <span className="min-w-0">
                <span className="block truncate font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
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
      </div>
    </Panel>
  );
}
