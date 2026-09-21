import {
  VEHICLES,
  type Army,
  mergeFleets,
  travelMinutes,
  type VehicleId,
  type BattleBoostOption,
  type BattleLeader,
  type BattleReportView,
  type BattleView,
  type BattlesResponse,
  type MovementView,
  type StructureDefence,
  type UnitLoadouts,
  combineLeaderOf,
  estimatedForce,
  findUnit,
  forecast,
  type CombinePower,
} from '@frontline/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, buttonSkin, tabSkin } from '../../components/ui/Button';
import { Confirm } from '../../components/ui/Confirm';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { HoverCard } from '../../components/ui/HoverCard';
import { Panel } from '../../components/ui/Panel';
import { PanelSection } from '../../components/ui/PanelSection';
import { FileSection } from '../overseer/FileSection';
import { cn } from '../../lib/cn';
import {
  useActions,
  useBattles,
  useDistrict,
  useBlackMarket,
  useBuyBattleBoost,
  useLayTrap,
  useLeadBattle,
  useTakeVehicles,
  useDeployToBattle,
  useCrewStanding,
  useMe,
  useUnits,
} from '../../lib/queries';
import { formatDuration, formatRemaining } from '../base/format';
import { useServerClock } from '../missions/useServerClock';
import { heldToLine, readColumn } from './column';
import { Characteristics } from '../../components/ui/LabelChip';
import { locationKindOf, whenItHolds } from '../city/characteristics';
import { BoostStash } from './BoostStash';
import { PageShell } from '../game/PageShell';
import { BattleReportModal } from './BattleReportModal';
import { DeployDialog, type DeployMode } from './DeployDialog';
import { UnitChip } from '../units/UnitChip';
import { EffectiveCard } from './EffectiveCard';

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

type Tab = 'coming' | 'reports' | 'ground' | 'inventory';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'coming', label: 'Upcoming' },
  { id: 'reports', label: 'Reports' },
  { id: 'ground', label: 'Your ground' },
  // The back room's shelf. Last, because it is the only tab that is not a list of fights.
  { id: 'inventory', label: 'Inventory' },
];

export function BattlePage() {
  const battles = useBattles();
  /*
   * The back room's shelf, for the Inventory tab.
   *
   * The stash rides on the black market response rather than on `/me` or `/battles`, because it is
   * the back room's own ledger. Read here rather than inside the tab so the badge on the strip and
   * the list behind it are one number from one request.
   */
  const backRoom = useBlackMarket();
  const stash = backRoom.data?.stash ?? {};
  const stashHeld = Object.values(stash).reduce((sum, n) => sum + (n ?? 0), 0);
  const me = useMe();
  const road = useActions();
  const deploy = useDeployToBattle();
  /*
   * §A4: who the other side's ring took on the way out, reported once and then dismissed.
   *
   * The toll has always been charged. It came off the roster inside the same request that pulled
   * the units back, and nothing said a word: a crew that withdrew forty and counted thirty four at
   * home had no way to tell a ring from a miscount. Held in state rather than read off the board,
   * because it is news about one request rather than a fact about the fight.
   */
  const [caughtLeaving, setCaughtLeaving] = useState<Army>({});

  /*
   * The fight a receipt sent the player to look at (maintainer request, 2026-09-15).
   *
   * A battle report's notification links at `?report=<battleId>` rather than at the bare screen,
   * so arriving that way opens the Reports tab on that fight instead of on a list the player then
   * has to search. Read once into the initial tab so the page never paints `coming` and then jumps.
   */
  const [params, setParams] = useSearchParams();
  const wanted = params.get('report');

  const [tab, setTab] = useState<Tab>(wanted === null ? 'coming' : 'reports');
  const [openId, setOpenId] = useState<string | null>(null);
  /* Which fight the dialog is open on, and which of its two places it is moving people to. One
     dialog, two modes, so the state has to carry both. The id rather than the view: the view is
     rebuilt on every poll, and a dialog holding the one it opened with would quote a muster and a
     window that were true when it was pressed. */
  const [deploying, setDeploying] = useState<{ battleId: string; mode: DeployMode } | null>(null);
  const [reading, setReading] = useState<BattleReportView | null>(null);
  /**
   * Whether the receipt's fight has been opened yet.
   *
   * A ref rather than state, and it is what stops the modal reopening for ever: closing it sets
   * `reading` to null, and an effect keyed on the response alone would put it straight back up on
   * the next poll. It is also why the query is cleared below: a reload of the same URL should show
   * the report again, but a close within the session should not.
   */
  const opened = useRef(false);

  const data = battles.data;
  /*
   * Ticks once a second against the server's clock. `Date.parse(data.serverNow)` was the clock
   * before, so every countdown on the page moved only when a poll landed, in five-second steps.
   */
  const now = useServerClock(data?.serverNow, battles.dataUpdatedAt).getTime();
  const army = me.data?.base?.army ?? {};
  /** §C3: the workshop's brackets, which move a unit's speed and therefore the column's clock. */
  const loadouts = me.data?.base?.unitLoadouts ?? {};
  const notoriety = me.data?.base?.economy.notoriety ?? 0;
  /*
   * §A4: the crew's bag channel, so the deploy window's loot figure is the one the settler spends.
   *
   * Cached and shared with every other screen that reads it; this page subscribes to nothing else
   * of the crew's standing, and a raid's haul is capped by exactly this number.
   */
  const standing = useCrewStanding();

  // The fight the detail is showing. Falls back to the first one so the page never opens on an
  // empty right-hand column with a full list beside it.
  const open = data?.coming.find((view) => view.battle.id === openId) ?? data?.coming[0] ?? null;

  const deployingView =
    deploying === null
      ? null
      : (data?.coming.find((view) => view.battle.id === deploying.battleId) ?? null);
  /*
   * Closing the dialog also forgets the last refusal. The mutation is the page's, not the
   * dialog's, so without this the next fight's dialog opened on the previous fight's error.
   */
  const { reset: resetDeploy } = deploy;
  const closeDeploy = () => {
    setDeploying(null);
    resetDeploy();
  };
  /*
   * Open the receipt's own report, once, as soon as the response carries it.
   *
   * After the response rather than on mount: the reports arrive with the poll, so a page that
   * tried to open one at mount would find an empty list and do nothing. The query is cleared on
   * the way through so the back button and a later close do not put the modal up again, and
   * `replace` keeps the trip out of the history: a player pressing back wants the bell, not this
   * screen with a modal on it.
   */
  useEffect(() => {
    if (wanted === null || opened.current || data === undefined) return;
    const found = data.reports.find((report) => report.battleId === wanted);
    if (found === undefined) return;
    opened.current = true;
    setReading(found);
    setParams({}, { replace: true });
  }, [wanted, data, setParams]);

  // A fight that resolved or was withdrawn while its dialog was up leaves nothing to send to.
  useEffect(() => {
    if (deploying !== null && deployingView === null) {
      setDeploying(null);
      resetDeploy();
    }
  }, [deploying, deployingView, resetDeploy]);

  return (
    <PageShell
      title="Battles"
      icon="battles"
      // No lede (maintainer, 2026-09-21). "Fights are called for a time, and everybody gets to
      // see them coming" is a rule a player learns from the board itself, and it was a line of
      // standing grey text over the one screen where every row is already a clock.
      action={data ? <Counts data={data} /> : null}
      wide
      fills
    >
      {battles.isError ? (
        /*
         * A failure said out loud, with a way to try again.
         *
         * This branch is why a single unreadable row in an account's battle history made the whole
         * screen unreachable *silently*: the page drew every state that was not data as "Reading
         * the board...", so a 500 looked exactly like a slow network and looked like it forever.
         */
        <LoadFailure
          what="The board"
          onRetry={() => void battles.refetch()}
          detail="Whatever went wrong is on our side, not yours. The fights themselves are unaffected: they resolve on their own clock."
        />
      ) : !data ? (
        <p className="p-6 font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Reading the board…
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Tabs tab={tab} onPick={setTab} data={data} stashHeld={stashHeld} />

          {Object.keys(caughtLeaving).length > 0 && (
            <div
              data-testid="caught-leaving"
              className="flex items-start justify-between gap-3 rounded-sm border border-danger-500/60 bg-danger-900/20 px-3 py-2 text-[11px] text-ink-200"
            >
              <p>
                <span className="font-display uppercase tracking-[0.12em] text-danger-300">
                  Stopped on the way out
                </span>{' '}
                Their ring caught{' '}
                {Object.entries(caughtLeaving)
                  .map(([unitId, count]) => `${count} ${findUnit(unitId)?.name ?? unitId}`)
                  .join(', ')}
                . They are not coming home.
              </p>
              <button
                type="button"
                className="font-display text-[10px] uppercase tracking-[0.12em] text-ink-400 hover:text-ink-200"
                onClick={() => setCaughtLeaving({})}
              >
                Dismiss
              </button>
            </div>
          )}

          {tab === 'coming' &&
            (data.coming.length === 0 ? (
              <Empty>
                Nothing is called. Walk into a district, pick something worth taking, and name the
                hour.
              </Empty>
            ) : (
              /*
               * One frame, two columns, and the rail is what moves (the Training tab's shape).
               *
               * The maintainer asked for this screen to be built the way the gym is, and the reason is
               * the same: picking the fourth fight out of a list must not move the fight you were
               * reading. So the frame is fixed, the rail scrolls inside its own panel, and the
               * detail beside it keeps its top edge wherever the rail is scrolled to.
               *
               * `items-stretch` and `min-h-0` on both columns are what hold the two sides level at
               * every height. Without `min-h-0` a flex child will not shrink below its content and
               * the whole sheet grows a scrollbar, which is the failure this layout exists to end.
               */
              <div className="grid min-h-0 flex-1 items-stretch gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
                <Panel title="Called" className="ink-frame min-h-0 flex-1">
                  {/* The one scrolling region on the screen. Twenty fights have to be reachable
                      without the detail beside them moving a pixel. */}
                  <ul
                    className="min-h-0 flex-1 divide-y divide-surface-700 overflow-y-auto"
                    data-testid="coming-battles"
                  >
                    {data.coming.map((view) => (
                      <li key={view.battle.id}>
                        <ComingRow
                          view={view}
                          now={now}
                          open={view.battle.id === open?.battle.id}
                          onOpen={() => setOpenId(view.battle.id)}
                        />
                      </li>
                    ))}
                  </ul>
                </Panel>

                {open && (
                  /*
                   * The detail takes whatever height is left, and only scrolls when a viewport
                   * genuinely cannot hold it. A fight carries four panels (the ground, the leader,
                   * the machines and the boost), which no 768-tall laptop fits, and cut content is
                   * the one thing the maintainer's bar rules out outright.
                   */
                  <div
                    /*
                     * Keyed on the fight, so picking another one starts that fight's page at the
                     * top of it.
                     *
                     * The pane is the only scrolling region on this screen, and it kept its offset
                     * across a change of subject: a player who had scrolled down to the boost on
                     * one fight and then pressed another row landed halfway down the new fight,
                     * with the ground, the odds and the leader above the fold and no sign that
                     * anything had moved. Remounting is also what clears the pickers inside the
                     * detail, which are about the fight that was open rather than the one that is.
                     */
                    key={open.battle.id}
                    className="min-h-0 min-w-0 overflow-y-auto"
                    data-testid="battle-detail-pane"
                  >
                    <BattleDetail
                      view={open}
                      homeDistrictId={me.data?.base?.districtId ?? null}
                      army={army}
                      loadouts={loadouts}
                      infamy={data.infamy}
                      now={now}
                      walking={columnsTo(road.data?.movements, open.battle.id)}
                      onDeploy={(mode) => setDeploying({ battleId: open.battle.id, mode })}
                      deploying={deploy.isPending && deploying?.battleId === open.battle.id}
                    />
                  </div>
                )}
              </div>
            ))}

          {tab === 'reports' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Reports reports={data.reports} onRead={setReading} />
            </div>
          )}
          {tab === 'inventory' && (
            <BoostStash stash={stash} inventory={me.data?.base?.inventory ?? {}} />
          )}

          {tab === 'ground' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Defences structures={data.structures} />
            </div>
          )}
        </div>
      )}

      {deploying !== null && deployingView !== null && (
        <DeployDialog
          view={deployingView}
          army={army}
          loadouts={loadouts}
          bagPercent={standing.data?.haulPercent ?? 0}
          homeDistrictId={me.data?.base?.districtId ?? null}
          notoriety={notoriety}
          mode={deploying.mode}
          pending={deploy.isPending}
          error={deploy.error}
          onClose={closeDeploy}
          onConfirm={(changes, perimeterChanges) =>
            deploy.mutate(
              { battleId: deployingView.battle.id, changes, perimeterChanges },
              {
                onSuccess: (result) => {
                  setCaughtLeaving(result.caughtLeaving);
                  closeDeploy();
                },
              },
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
        {Math.round(data.infamy).toLocaleString()} infamy
      </span>
    </span>
  );
}

function Tabs({
  tab,
  onPick,
  data,
  stashHeld,
}: {
  tab: Tab;
  onPick: (tab: Tab) => void;
  data: BattlesResponse;
  /** How many boosts are on the shelf, for the badge on the Inventory tab. */
  stashHeld: number;
}) {
  const count: Record<Tab, number> = {
    coming: data.coming.length,
    reports: data.reports.length,
    ground: data.structures.length,
    // Filled by the caller, which is the only thing holding the black market query.
    inventory: stashHeld,
  };
  return (
    <div role="tablist" aria-label="Battles" className="flex shrink-0 flex-wrap gap-1.5">
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          aria-selected={tab === entry.id}
          data-testid={`battles-tab-${entry.id}`}
          onClick={() => onPick(entry.id)}
          className={tabSkin({ active: tab === entry.id })}
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
    <FileSection icon="battles" title="Nothing here">
      <p className="font-body text-[13px] leading-relaxed text-ink-300">{children}</p>
    </FileSection>
  );
}

const ROLE_TONE: Record<BattleView['role'], string> = {
  attacker: 'border-brass-500/60 text-brass-300',
  defender: 'border-oxblood-500/60 text-oxblood-300',
  bystander: 'border-surface-600 text-ink-300',
};

/**
 * One coming fight, as a rail entry.
 *
 * Built the way the gym's roster rail is: a lit left edge and a wash in the same brass on the one
 * that is open, rather than a heavier outline. The weight of a border is how a list says "this is
 * a different kind of thing"; **colour** is how it says "this is the one you are looking at", and
 * `.ink-frame-brass` is the same stroke width as `.ink-frame` for exactly that reason.
 *
 * The clock leads, because it is the only thing here a player can be late for, and it sits in a
 * fixed-width column set in `tabular-nums` so twenty of them read as one column of figures rather
 * than as twenty rows that each start somewhere slightly different.
 *
 * The name wraps rather than truncating. A cut label is the thing the layout gate is for, and a
 * rail is a list rather than a table with an aligned column, so a row growing a line is free.
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
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={open}
      aria-current={open ? 'true' : undefined}
      data-testid={`battle-${view.battle.id}`}
      className={cn(
        'relative flex w-full items-center gap-2.5 border-l-[3px] py-2.5 pl-2.5 pr-3 text-left transition-all duration-150',
        open
          ? 'border-brass-300 bg-brass-300/10'
          : 'border-transparent hover:border-iris-300/60 hover:bg-surface-800/70',
      )}
    >
      <span
        className={cn(
          'w-[3.75rem] shrink-0 text-center font-display text-[13px] font-bold leading-none tabular-nums',
          urgent ? 'text-oxblood-300' : 'text-brass-300',
        )}
      >
        {formatRemaining(left)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-stamp text-[13px] leading-[1.15] text-ink-100">
          {view.targetName}
        </span>
        <span className="block break-words font-display text-[10px] uppercase tracking-[0.14em] text-ink-300">
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
  );
}

/** The one fight the player has opened: the ground, who is on it, and what a name would buy. */
/**
 * Everything this crew has walking to one fight.
 *
 * Read off the Actions screen's own payload rather than off the board's: a column is a
 * `troop_movements` row and `BattleView.muster` is only what has *landed*, so the two screens
 * would otherwise be quoting different halves of the same force.
 */
function columnsTo(movements: readonly MovementView[] | undefined, battleId: string): Army {
  return (movements ?? [])
    .filter((movement) => movement.battleId === battleId)
    .reduce<Army>(
      (total, movement) => mergeCounts(mergeCounts(total, movement.army), movement.perimeter),
      {},
    );
}

function mergeCounts(into: Army, force: Army): Army {
  const next = { ...into };
  for (const [unitId, count] of Object.entries(force)) {
    next[unitId] = (next[unitId] ?? 0) + count;
  }
  return next;
}

function BattleDetail({
  view,
  homeDistrictId,
  army,
  loadouts,
  infamy,
  now,
  walking,
  onDeploy,
  deploying,
}: {
  view: BattleView;
  /** §C3: where the crew lives, which decides whether there is a road to this fight at all. */
  homeDistrictId: string | null;
  /** §C3: what is still at home, so the machines panel can quote a column that could be sent. */
  army: Army;
  /** §C3: the crew's brackets, so the quoted pace is the sheet the road will actually read. */
  loadouts: UnitLoadouts;
  infamy: number;
  now: number;
  /** What is still on the road to this fight: nobody has arrived yet, but they have left. */
  walking: Army;
  onDeploy: (mode: DeployMode) => void;
  deploying: boolean;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid={`battle-detail-${view.battle.id}`}>
      {/* The one the rail has open, said again in colour rather than in weight: `.ink-frame-brass`
          is the same stroke as `.ink-frame`, so what marks it is the brass and nothing else. */}
      <section
        className="ink-frame ink-frame-brass card-paper washed flex min-w-0 flex-col"
        data-testid="battle-head"
      >
        <header className="flex flex-col gap-2 px-4 pt-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="icon-plate flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-brass-300 [&_svg]:h-5 [&_svg]:w-5"
            >
              <Icon name="battles" />
            </span>
            <h2 className="min-w-0 flex-1 font-stamp text-[17px] leading-tight text-ink-100">
              {view.targetName}
            </h2>
            <span className="shrink-0 rounded-sm border border-surface-600 px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
              {view.districtName}
            </span>
          </div>
          <span aria-hidden className="ink-rule block w-full" />
        </header>
        {/*
          §A4: what the ground is like, under the name of the ground and above everything else.
          
          It used to be nowhere on this screen: the characteristics decide a real share of the
          outcome and a player could only learn them by opening the district, reading the location
          card and remembering. A row here, with the tiers on the chips, is what makes "send the
          Anodics rather than the Snipers" a decision somebody can make before the mark rather than
          a lesson they read in the report afterwards.
        */}
        <div className="border-b border-surface-700 px-4 pb-3 pt-3">
          <Characteristics
            labels={view.battlefield.labels}
            size="md"
            when={whenItHolds(
              locationKindOf(
                view.battle.target.kind === 'location' ? view.battle.target.locationId : undefined,
              ),
              view.battlefield.weather,
            )}
            data-testid="battle-characteristics"
          />
          {/* The two figures the ground is worth on its own, said in words rather than left in the
              chips: a fortified location and a defensible one are different problems. */}
          <p className="mt-1.5 font-body text-[12px] leading-snug text-ink-300">
            {view.battlefield.locationName} holds {view.battlefield.frontage} across the front
            {view.battlefield.baseDefense > 0 &&
              `, and is worth ${view.battlefield.baseDefense} armour to whoever stands on it`}
            {view.battlefield.fortifyPercent > 0 &&
              `. Dug in: +${Math.round(view.battlefield.fortifyPercent)}% toughness to the holder`}
            .
          </p>
        </div>

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

        <Forces view={view} walking={walking} loadouts={loadouts} />

        <Odds view={view} />

        {view.side !== null && (
          <div className="flex flex-wrap items-center gap-3 border-t border-surface-700 p-4">
            <Button
              disabled={!view.deploymentOpen || deploying}
              onClick={() => onDeploy('line')}
              data-testid={`deploy-open-${view.battle.id}`}
            >
              {view.deploymentOpen ? 'Send units' : 'They are on the ground'}
            </Button>
            {/*
              The ring, on a control of its own, because it is a different bet from the line.
              It is also the one thing on this screen nobody would guess from its name, so the
              button explains itself rather than sending a player to the manual: a `HoverCard`
              rather than a `data-tip`, since the tip layer draws one line of tracked capitals and
              this is two sentences of prose. The trigger is already a button, so what carries the
              button's dressing is a span inside it.
            */}
            {view.deploymentOpen && (
              <HoverCard
                label="Station units in the periphery"
                onActivate={() => onDeploy('ring')}
                disabled={deploying}
                data-testid={`perimeter-open-${view.battle.id}`}
                card={
                  <div className="flex flex-col gap-1.5">
                    <p className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-brass-300">
                      The ring
                    </p>
                    <p className="font-body text-[13px] leading-relaxed text-ink-100">
                      A cordon thrown around the fight. It never takes part: it stands outside and
                      takes down whoever tries to leave once the losing side has had enough.
                    </p>
                    <p className="font-body text-[13px] leading-relaxed text-ink-100">
                      Every unit on it is a unit not in the line, and withdrawing past a ring the
                      other side has already set costs unit slots of your own.
                    </p>
                  </div>
                }
              >
                <span
                  className={buttonSkin({
                    variant: 'ghost',
                    // `disabled:` never fires on a span, so the dimming is spelled out.
                    className: deploying ? 'opacity-40' : undefined,
                  })}
                >
                  Station units in the periphery
                </span>
              </HoverCard>
            )}
            {!view.deploymentOpen && (
              <span className="font-body text-[11px] text-ink-300">
                Nobody moves in the last minute before the mark.
              </span>
            )}
          </div>
        )}
      </section>

      {view.side !== null && <LeadPicker view={view} />}
      {/* §C3: a machine shortens a road. A crew holding its own district has no road to this
          fight, so the picker would only be a way to put the yard where a wipe can wreck it. */}
      {view.side !== null &&
        !(view.side === 'defender' && view.battle.target.districtId === homeDistrictId) && (
          <VehiclePicker
            view={view}
            army={army}
            loadouts={loadouts}
            homeDistrictId={homeDistrictId}
          />
        )}
      {view.side !== null && <NameBuys view={view} infamy={infamy} />}
      {/* §I4: only the side standing on the ground has anything to bury under it. */}
      {view.side === 'defender' && <TrapPicker view={view} />}
    </div>
  );
}

/**
 * §C3: the machines this crew is taking.
 *
 * A row of counters over what the yard and this fight hold between them, because the question is
 * "how many of these am I sending" rather than "which one". Committed machines have left the yard,
 * exactly as deployed units have left the roster, so the totals on this panel always add up to the
 * fleet the crew owns.
 *
 * The line under it is the one that decides anything: a column arrives when its last people do
 * (§C3), so a bike under a column of four hundred is worth nothing at all and a bus that seats
 * the whole of a force of thirty is worth all of it.
 */
function VehiclePicker({
  view,
  army,
  loadouts,
  homeDistrictId,
}: {
  view: BattleView;
  /** What is still at home: the biggest column this crew could put on this road. */
  army: Army;
  /** The crew's brackets: the armour line takes speed off a sheet, so the road reads them. */
  loadouts: UnitLoadouts;
  homeDistrictId: string | null;
}) {
  const take = useTakeVehicles();
  /*
   * §C3: whether this crew's machines seat anything at all (`any_ride`, bug pass 2026-09-19).
   *
   * The same read the deploy window makes, and for the same reason: `no_ride` is a fact about a
   * sheet and the waiver is a fact about a crew, so a panel that quotes a road off the catalogue
   * alone tells a crew holding it that a Colossus walks when the server puts it in a truck. A warm
   * cache by the time anybody is standing on this page (`usePrefetchScreens`), and `?? false` is
   * the reading before it lands.
   */
  const anyRide = useUnits().data?.anyRide ?? false;
  const shut = !view.deploymentOpen;
  const owned = mergeFleets(view.yard, view.vehicles);
  /*
   * The pace, quoted against a column that exists.
   *
   * There is no column at the moment this renders, so the honest thing to quote is the one the
   * player can still choose: **everybody at home**, which is what the deploy dialog's Max on every
   * row produces and the slowest column this yard will ever have to move. It used to quote
   * `carriedSpeedPercent(view.vehicles, view.muster.size)` instead, where `muster.size` is the
   * *whole side's* folded deployment, allies and everything already on the ground included, which
   * is not a force this crew is sending anywhere.
   *
   * `columnSpeed` is the server's own function (`battle/movement.ts`, `travelMsTo`), so the pace on
   * this panel is the pace the road is measured with rather than a second arithmetic that agrees by
   * inspection. The crew's travel reduction is not on this payload and only ever shortens a road,
   * so the clock below is an upper bound and says so.
   */
  // Unit slots rather than heads: a machine's capacity is a slot budget, and an Ironside at two
  // slots takes two of them. Printing it as "seats" read as a head count and was the misreading
  // the currency exists to stop.
  const unitSlotSeats = VEHICLES.reduce(
    (total, spec) => total + spec.capacity * (view.vehicles[spec.id] ?? 0),
    0,
  );
  const column = readColumn(view.vehicles, army, loadouts, anyRide);
  const minutes =
    homeDistrictId === null
      ? null
      : travelMinutes(homeDistrictId, view.battle.target.districtId, { speed: column.speed });

  const set = (id: VehicleId, count: number) =>
    take.mutate({
      battleId: view.battle.id,
      vehicles: Object.fromEntries(
        Object.entries({ ...view.vehicles, [id]: count }).filter(([, amount]) => amount > 0),
      ),
    });

  const lines = VEHICLES.filter((spec) => (owned[spec.id] ?? 0) > 0);
  return (
    <FileSection icon="gear" title="Machines" note="No one prefers going there on foot">
      <div className="flex flex-col gap-2.5" data-testid="vehicle-picker">
        <PanelSection
          label="Loaded"
          note={
            lines.length === 0
              ? 'Nothing in the yard'
              : [
                  `${unitSlotSeats} unit slots`,
                  // Nobody at home is not a column, and `heldToLine` over one reads "Rides at 0".
                  column.speed > 0 ? heldToLine(column) : null,
                  minutes === null ? null : `${formatDuration(minutes * 60)} at most`,
                ]
                  .filter((part) => part !== null)
                  .join(' · ')
          }
        >
          {lines.length === 0 ? (
            <p className="font-body text-[12px] leading-relaxed text-ink-300">
              Build something in the Garage first. A column with nothing under it walks.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {lines.map((spec) => {
                const taking = view.vehicles[spec.id] ?? 0;
                const held = owned[spec.id] ?? 0;
                return (
                  <li
                    key={spec.id}
                    className="flex items-center justify-between gap-2"
                    data-testid={`take-${spec.id}`}
                  >
                    <span className="min-w-0 truncate font-body text-[12px] text-ink-100">
                      {spec.name}{' '}
                      <span className="text-ink-400">
                        carries {spec.capacity}, speed {spec.speed}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={shut || taking === 0 || take.isPending}
                        onClick={() => set(spec.id, taking - 1)}
                        data-testid={`take-less-${spec.id}`}
                      >
                        −
                      </Button>
                      <span className="w-10 text-center font-display text-[12px] tabular-nums text-brass-300">
                        {taking}/{held}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={shut || taking >= held || take.isPending}
                        onClick={() => set(spec.id, taking + 1)}
                        data-testid={`take-more-${spec.id}`}
                      >
                        +
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelSection>
        {take.error && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            {take.error.message}
          </p>
        )}
      </div>
    </FileSection>
  );
}

/**
 * §D1: who is leading this one, if anybody.
 *
 * A drop-down for the same reason the boost is one: it is at most one choice out of a list of
 * comparable things, and the interesting part is the comparison. What is on each line is what the
 * officer would *fight* as, because that is the decision: a Head of Security with a Strength of 70
 * is a unit worth putting in the line and a Head of Finance is not.
 *
 * Free, and free to change up to the mark. What it costs is on the card under it, and it is worth
 * spelling out: a fight that goes badly can take an officer out of the crew for a day, and it takes
 * this side's report with them.
 */
function LeadPicker({ view }: { view: BattleView }) {
  const lead = useLeadBattle();
  const chosen = view.leaders.find((leader) => leader.officerId === view.officerId) ?? null;
  const shut = !view.deploymentOpen;

  return (
    // No note: the section is called Leading, it holds one picker, and the sentence under the
    // title was the same instruction the panel under it was already giving (maintainer, 2026-09-12).
    <FileSection icon="crew" title="Leading">
      <div className="flex flex-col gap-2.5" data-testid="lead-picker">
        <PanelSection
          label="At the front"
          note={shut ? 'They are already on the ground' : undefined}
          action={
            view.officerId === null ? undefined : (
              <Button
                size="sm"
                variant="ghost"
                disabled={shut || lead.isPending}
                onClick={() => lead.mutate({ battleId: view.battle.id, officerId: null })}
                data-testid="lead-clear"
              >
                Keep them home
              </Button>
            )
          }
        >
          {chosen ? (
            <>
              <p className="font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
                {chosen.name}
              </p>
              {/* The whole battle sheet (maintainer request, 2026-09-12), not the two headline
                  figures: stealth decides whether the fight starts on your terms and morale
                  decides whether it ends early, and a player choosing between two officers was
                  being shown neither. What being led *costs* is on the officer's own page, which
                  is where a rule about officers belongs. */}
              <OfficerSheet stats={chosen.stats} />
            </>
          ) : (
            <p className="font-body text-[12px] leading-relaxed text-ink-300">
              Nobody is leading. Their perks stay at home with them, and so does the risk.
            </p>
          )}
        </PanelSection>

        <Dropdown
          label="Officer"
          placeholder={view.leaders.length === 0 ? 'Nobody fit to send' : 'Send somebody'}
          value={view.officerId ?? ''}
          disabled={shut || view.leaders.length === 0 || lead.isPending}
          options={view.leaders.map((leader) => ({
            value: leader.officerId,
            label: leader.name,
            // The road beside the sheet (maintainer request, 2026-09-15): the server prices each
            // officer's own walk or ride to this ground, and a picker that printed the sheet alone
            // was offering a choice between two sheets when the choice is a sheet against a road.
            hint: `${leader.stats.offense} damage · ${leader.stats.vitality} vitality · ${leader.stats.armor} armour · ${leader.travelMinutes} min on the road`,
          }))}
          onChange={(officerId) => lead.mutate({ battleId: view.battle.id, officerId })}
          data-testid="lead-officer-picker"
        />
        {lead.error && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            {lead.error.message}
          </p>
        )}
      </div>
    </FileSection>
  );
}

/** A figure on its own tile: the same tile a crew's file keeps its standing in. */
/**
 * An officer's battle sheet, as they would fight.
 *
 * Every stat the engine reads, rather than the two the panel used to print: the same figures a
 * unit card carries, in the same order, so comparing an officer against the people they are
 * leading is reading one row against another. `lootCapacity` is left off on purpose: an officer
 * carries nothing home, and a zero on a sheet reads as a weakness rather than as "not applicable".
 */
function OfficerSheet({ stats }: { stats: BattleLeader['stats'] }) {
  const rows: readonly (readonly [string, number])[] = [
    ['Damage', stats.offense],
    ['Vitality', stats.vitality],
    ['Armour', stats.armor],
    ['Penetration', stats.penetration],
    ['Range', stats.range],
    ['Speed', stats.speed],
    ['Evasion', stats.evasion],
    ['Stealth', stats.stealth],
    ['Morale', stats.morale],
    ['Intimidation', stats.intimidation],
  ];
  return (
    <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3" data-testid="lead-sheet">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
            {label}
          </dt>
          <dd className="font-display text-[13px] font-bold tabular-nums text-ink-100">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-sm border border-surface-700 bg-surface-950/40 px-2.5 py-2">
      <p className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">{label}</p>
      <p className="break-words font-display text-[15px] font-bold leading-tight tabular-nums text-brass-100">
        {value}
      </p>
      {note !== undefined && note !== '' && (
        <p className="font-body text-[11px] leading-snug text-ink-300">{note}</p>
      )}
    </div>
  );
}

/**
 * What you have on the ground, unit by unit.
 *
 * The board's own request, and the thing the old page could not answer at all: it printed a single
 * unit count. A player deciding whether to buy a boost for the heavy end of their force has to be
 * able to see whether they *sent* the heavy end of their force.
 */
/**
 * The Combine legendary's power over this fight, or `undefined`.
 *
 * Three conditions, all of them the settler's (`battle/resolve.ts`): the side being attacked is
 * the regime, a legendary commands that district, and he is still standing. A crew or the looters
 * holding a plot in his district do not inherit his shadow with it, and a district whose leader is
 * dead fights without him, which is the whole of what killing him buys.
 *
 * Whether he is standing is the one part `BattlesResponse` does not carry, so it is read off the
 * district the fight is on. The query is **off** for every other fight: `useDistrict` is disabled
 * on an undefined id, so a fight against another crew, or on ground no legendary commands, adds no
 * request and no poll to this page.
 */
function usePresenceOver(view: BattleView): CombinePower | undefined {
  const districtId = view.battle.target.districtId;
  const leader = combineLeaderOf(districtId);
  const regime = view.battle.defender.kind === 'government';
  const district = useDistrict(regime && leader ? districtId : undefined);
  if (!leader || !regime) return undefined;
  return district.data?.combineLeader?.alive === true ? leader.power : undefined;
}

/**
 * How this looks, before it happens.
 *
 * Sixty runs of **the engine that will actually settle it**, on **the ground it will settle on**,
 * against what the crew can make out of the other side. `battle/forecast.ts` has existed and been
 * tested for a long time and reached no screen where there is an enemy: it was wired only into the
 * garrison picker, which never has one. So the one number a player most needs before committing
 * people to a fight was computed, correct and invisible.
 *
 * The ground is the point. Combat width alone swings identical forces from a certain win to a
 * certain loss, and until `BattleView` carried the battlefield there was no honest way to show
 * this: a forecast run on bare open field is a confident answer about a different fight.
 *
 * Nothing is shown when the crew cannot count the enemy. That is the §A4 rule and it is not a
 * limitation to work around: an estimate built on no intelligence is worse than no estimate, and
 * the line says so rather than printing a number nobody should trust.
 *
 * **The legendary over the ground is in the arithmetic** (maintainer, 2026-09-20). He was not, and
 * that was the one omission here that reverses the answer rather than shading it: the engine reads
 * a leader through `SideSetup.presence`, and with it left off, a fight in his district was
 * forecast as a fight nobody commands. `battle/combine.test.ts` measures the Syndic on these
 * numbers: 20 Greycoats hold 3 of 80 seeds against 24 Razors bare and 75 of 80 under her. A player
 * was being shown a near-certain win for a fight they will almost certainly lose.
 *
 * This is not fog of war. The district header names him, his card is public and his power is on
 * the chip at the top of it, so the only thing hidden was the sum.
 */
function Odds({ view }: { view: BattleView }) {
  const facing = view.enemySize;
  const defending = view.role === 'defender';
  const presence = usePresenceOver(view);
  // Keyed off the plan rather than the object: `view` is rebuilt on every poll, so depending on the
  // army's identity would re-run sixty simulations a second and the number would never hold still
  // long enough to read. Sixty runs is cheap once and not cheap every render.
  //
  // The presence is in the key as well as in the setup: it arrives one request after the rest of
  // the plan (see {@link usePresenceOver}), so a key without it would hold the leaderless reading
  // on screen for as long as the fight is open.
  const plan = JSON.stringify([
    view.muster?.army ?? {},
    facing,
    view.battlefield,
    defending,
    presence ?? null,
  ]);
  const read = useMemo(() => {
    const [sending, size, ground, holding, shadow] = JSON.parse(plan) as [
      Record<string, number>,
      number | null,
      BattleView['battlefield'],
      boolean,
      CombinePower | null,
    ];
    const units = Object.values(sending).reduce((total, count) => total + count, 0);
    if (size === null || units === 0) return null;
    return forecast({
      seed: plan,
      battlefield: ground,
      attacker: { name: 'you', army: sending, defending: holding },
      defender: {
        name: 'them',
        army: estimatedForce(size),
        defending: !holding,
        // Defender-only by construction, and the gate above is `defender.kind === 'government'`:
        // the one side a Combine legendary ever stands behind is the Combine's, which is the same
        // reading `battle/resolve.ts` takes at the settle.
        ...(shadow === null ? {} : { presence: shadow }),
      },
    });
  }, [plan]);

  if (view.side === null) return null;

  return (
    <div className="border-t border-surface-700 p-4" data-testid="battle-odds">
      <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
        How it looks
      </p>
      {read === null ? (
        <p
          className="mt-1 font-body text-[12px] leading-relaxed text-ink-300"
          data-testid="odds-none"
        >
          {facing === null
            ? 'Nobody has counted what is waiting. You will find out when you get there.'
            : 'Put people on the ground and this will tell you how it looks.'}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="font-display text-lg font-bold tabular-nums text-brass-300">
            {Math.round(read.winChance * 100)}%
          </span>
          <span className="font-body text-[12px] text-ink-200">
            you take it, in {read.runs} runs of the real thing
          </span>
          <span className="font-body text-[12px] text-ink-300">
            about {Math.round(read.attackerSurvival * 100)}% of yours walk out
          </span>
        </div>
      )}
    </div>
  );
}

function Forces({
  view,
  walking,
  loadouts,
}: {
  view: BattleView;
  walking: Army;
  loadouts: UnitLoadouts;
}) {
  const muster = view.muster;
  if (!muster) return null;
  const rows = Object.entries(muster.army).filter(([, count]) => count > 0);
  const ring = Object.entries(muster.perimeter).filter(([, count]) => count > 0);
  const road = Object.entries(walking).filter(([, count]) => count > 0);

  return (
    <div className="border-t border-surface-700 p-4" data-testid="battle-forces">
      <p className="font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
        On the ground
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 font-body text-[12px] text-ink-300">
          {road.length > 0
            ? 'Nobody yet. They are still walking.'
            : 'Nobody yet. An empty field is a loss you called yourself.'}
        </p>
      ) : (
        // Wraps, and the box grows with it: a force of nine kinds is a real state and it used to
        // run off the edge of a row that could not get taller.
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {rows.map(([unitId, count]) => (
            <li key={unitId}>
              {/* §A4: the chip says how many. The card behind it says what they are worth *here*,
                  which is the question a player standing in front of a muster is actually asking.
                  The chip's own card is the catalogue sheet, and on a battlefield that is the
                  weaker half of the answer: this one is the same sheet run through the ground. */}
              <UnitChip
                unitId={unitId}
                count={count}
                label={onGroundLabel(unitId)}
                card={<EffectiveCard unitId={unitId} view={view} loadouts={loadouts} />}
                data-testid={`force-${unitId}`}
              />
            </li>
          ))}
        </ul>
      )}
      {/*
       * §A4: what has left but not arrived.
       *
       * Sending people starts a column (`battle/movement.ts`); they join the muster when it lands.
       * Without this the screen a player is returned to after pressing "Move them" says "Nobody
       * yet" while the units are gone off the roster, which reads as a button that did nothing.
       */}
      {road.length > 0 && (
        <>
          <p className="mt-3 font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
            On the road
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="battle-walking">
            {road.map(([unitId, count]) => (
              <li key={`road-${unitId}`}>
                <UnitChip
                  unitId={unitId}
                  count={count}
                  muted
                  label={onGroundLabel(unitId)}
                  card={<EffectiveCard unitId={unitId} view={view} loadouts={loadouts} />}
                  data-testid={`battle-walking-${unitId}`}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {ring.length > 0 && (
        <>
          <p className="mt-3 font-display text-[10px] uppercase tracking-[0.2em] text-ink-300">
            On the ring
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ring.map(([unitId, count]) => (
              <li key={unitId}>
                <UnitChip
                  unitId={unitId}
                  count={count}
                  muted
                  label={onGroundLabel(unitId)}
                  card={<EffectiveCard unitId={unitId} view={view} loadouts={loadouts} />}
                  data-testid={`ring-${unitId}`}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * What the hover on a chip is called, for anybody who cannot see it.
 *
 * The unit's **name**, never the wire id: an `aria-label` is read out, and the board was announcing
 * every stack in a fight as "road_reavers on this ground". `BattleView` carries counts by id and
 * nothing else, so the name comes off the catalogue, and an id the catalogue has never heard of
 * falls back to the id rather than to an empty label.
 */
function onGroundLabel(unitId: string): string {
  return `${findUnit(unitId)?.name ?? unitId} on this ground`;
}

/**
 * §D7: the one boost this fight goes in with, from either of the two places one comes from.
 *
 * A drop-down rather than a wall of cards, because one is applied per battle and the choice is
 * between comparable things: the same shape of effect at different prices and different reach. The
 * option list carries the price and the reach on every line, so the comparison is in the list and
 * not in the player's head.
 *
 * Two kinds are on it. A **name** is bought here and now with infamy. **Contraband** was bought off
 * the black market days ago and is sitting in the crew's bag; it used to apply itself to whichever
 * fight happened next, on both sides, which meant the decision a player had actually made was
 * "when to next press attack". It is a choice on this screen now, made against intel they have
 * already read, and it costs nothing to change right up to the mark.
 *
 * The ones nobody has put on the table are still shown, greyed and labelled with what would put
 * them there. A boost you cannot see is a boost you never research.
 */
function NameBuys({ view, infamy }: { view: BattleView; infamy: number }) {
  const buy = useBuyBattleBoost();
  const taken = view.boostIds
    .map((id) => view.boosts.find((option) => option.id === id))
    .filter((option): option is BattleBoostOption => option !== undefined);
  const [picked, setPicked] = useState<string>('');
  const choice = view.boosts.find((option) => option.id === picked) ?? null;
  /** The one the player has said yes to, waiting on the confirmation. */
  const [confirming, setConfirming] = useState<BattleBoostOption | null>(null);

  const shut = !view.deploymentOpen;
  const full = view.boostIds.length >= view.boostSlots;
  const blocked = full
    ? view.boostSlots === 1
      ? 'This fight has its name'
      : `This fight has all ${view.boostSlots} of its names`
    : blockerFor(choice, shut);

  return (
    <FileSection icon="infamy" title="Boosts" note="Burn the name to boost the fight">
      <div className="flex flex-col gap-2.5" data-testid="name-buys">
        <PanelSection
          label={view.boostSlots === 1 ? 'Running' : `Running (${taken.length}/${view.boostSlots})`}
          note={taken.length > 0 ? undefined : 'One per fight'}
          data-testid="boost-bought"
        >
          {taken.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {taken.map((option) => (
                <li key={option.id}>
                  <p className="font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
                    {option.name}
                  </p>
                  <p className="mt-0.5 font-body text-[12px] leading-snug text-ink-100">
                    {option.effect} · reaching {option.reach}% of what you sent
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-body text-[12px] leading-relaxed text-ink-300">Nothing taken yet.</p>
          )}
        </PanelSection>

        <PanelSection
          label="On the table"
          note={blocked ?? `You have ${infamy} infamy`}
          action={
            <Button
              size="sm"
              variant={choice?.held ? 'primary' : 'danger'}
              disabled={choice === null || blocked !== null || buy.isPending}
              /*
               * Asks before it sends (maintainer request, 2026-09-12).
               *
               * A name is final: it cannot be swapped, cleared or refunded, and the infamy is gone
               * the moment the request lands. A confirmation is the only thing standing between a
               * misclick on a drop-down and a rank's worth of points, and the server refuses a
               * second name rather than charging for a change of mind, so there is no undo behind
               * this button to fall back on.
               */
              onClick={() => choice && setConfirming(choice)}
              data-testid="buy-boost"
            >
              {choice?.held ? 'Take it in' : 'Burn the name'}
            </Button>
          }
        >
          <div className="flex flex-col gap-2.5">
            <Dropdown
              label="Boost"
              placeholder={full ? 'Nothing more to take' : 'Choose a boost'}
              value={picked}
              disabled={shut || full}
              options={view.boosts.map((option) => ({
                value: option.id,
                label: option.name,
                hint: hintFor(option),
                // A name already on this fight is not on offer: taking it twice is refused.
                disabled:
                  !option.available || !option.affordable || view.boostIds.includes(option.id),
              }))}
              onChange={setPicked}
              data-testid="boost-picker"
            />
            {choice && (
              <div className="rounded-sm border border-surface-700 bg-surface-950/60 p-2.5">
                <p className="font-body text-[12px] leading-relaxed text-ink-100">
                  {choice.description}
                </p>
                <p className="mt-1.5 font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
                  {choice.effect}
                </p>
                <p className="mt-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                  {choice.held ? choice.source : `${choice.cost.toLocaleString()} infamy`} · reaches{' '}
                  {choice.reach}% of your force
                </p>
              </div>
            )}
          </div>
        </PanelSection>
        {buy.error && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            {buy.error.message}
          </p>
        )}
      </div>

      {confirming && (
        <Confirm
          title={confirming.held ? 'Take it in?' : 'Burn the name?'}
          body={
            confirming.held
              ? `Take ${confirming.name} into this fight? It leaves the bag the moment the fight goes off, whichever way it goes, and it cannot be taken back out.`
              : `Spend ${confirming.cost.toLocaleString()} infamy on ${confirming.name} for this fight? The name is burned: it cannot be swapped, cleared or refunded.`
          }
          confirm={confirming.held ? 'Take it in' : 'Burn it'}
          testId="confirm-boost"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            buy.mutate(
              { battleId: view.battle.id, boostId: confirming.id },
              { onSuccess: () => setPicked('') },
            );
            setConfirming(null);
          }}
        />
      )}
    </FileSection>
  );
}

/**
 * §I4: the one trap a defender may set under this fight.
 *
 * Beside the Boosts panel and in the same register, because it is the same kind of decision made
 * against the same intel: a thing you commit before the mark, changeable right up to it. What is
 * different is what it costs, and the panel says so: naming a trap spends nothing and clearing it
 * refunds nothing, because the trap only leaves the inventory when somebody walks over it.
 *
 * The whole catalogue is listed, held or not, for the reason the boost list is: a trap that is
 * absent from this panel is a trap nobody goes to the yard for. The server has already worded why
 * a row is dead and this screen prints it rather than deciding anything.
 */
function TrapPicker({ view }: { view: BattleView }) {
  const set = useLayTrap();
  const chosen = view.traps.find((option) => option.trapId === view.trapId) ?? null;
  const [picked, setPicked] = useState<string>('');
  const choice = view.traps.find((option) => option.trapId === picked) ?? null;

  const shut = !view.deploymentOpen;
  const blocked = shut
    ? 'They are already on the ground'
    : choice !== null && !choice.available
      ? choice.blocker
      : null;

  return (
    <FileSection
      icon="alert"
      title="Trap"
      note="Set under the approach, and only on ground you are holding"
    >
      <div className="flex flex-col gap-2.5" data-testid="trap-picker">
        <PanelSection
          label="Under the approach"
          note={
            shut ? 'They are already on the ground' : 'One per fight, and only when you hold it'
          }
          action={
            view.trapId === null ? undefined : (
              <Button
                size="sm"
                variant="ghost"
                disabled={shut || set.isPending}
                onClick={() => set.mutate({ battleId: view.battle.id, trapId: null })}
                data-testid="trap-clear"
              >
                Dig it back up
              </Button>
            )
          }
          data-testid="trap-set"
        >
          {chosen ? (
            <>
              <p className="font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
                {chosen.name}
              </p>
              <p className="mt-0.5 font-body text-[12px] leading-snug text-ink-100">
                It goes off before anybody is in contact, and it never turns an attack back. Nothing
                leaves the bag until then, so moving it to another fight costs you nothing.
              </p>
              {/* The count is on the panel rather than only inside the picker: what a player wants
                  to know before naming the same shell on a second fight is how many they have. */}
              <p className="mt-1 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                {chosen.held} in the bag
              </p>
            </>
          ) : (
            <p className="font-body text-[12px] leading-relaxed text-ink-300">
              Nothing buried. The Scrapyard cuts these, and you set one on a fight you are
              defending.
            </p>
          )}
        </PanelSection>

        <PanelSection
          label="In the bag"
          note={blocked ?? 'Free to change right up to the mark'}
          action={
            <Button
              size="sm"
              disabled={choice === null || blocked !== null || set.isPending}
              onClick={() =>
                choice &&
                set.mutate(
                  { battleId: view.battle.id, trapId: choice.trapId },
                  { onSuccess: () => setPicked('') },
                )
              }
              data-testid="set-trap"
            >
              Bury it
            </Button>
          }
        >
          <div className="flex flex-col gap-2.5">
            <Dropdown
              label="Trap"
              placeholder={view.trapId === null ? 'Choose a trap' : 'Set a different one'}
              value={picked}
              disabled={shut}
              options={view.traps.map((option) => ({
                value: option.trapId,
                label: option.name,
                hint: option.available ? `${option.held} in the bag` : option.blocker,
                disabled: !option.available,
              }))}
              onChange={setPicked}
              data-testid="trap-option-picker"
            />
            {choice && (
              <div className="rounded-sm border border-surface-700 bg-surface-950/60 p-2.5">
                <p className="font-body text-[12px] leading-relaxed text-ink-100">
                  {choice.description}
                </p>
                <p className="mt-1.5 font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
                  {choice.available ? `${choice.held} in the bag` : choice.blocker}
                </p>
              </div>
            )}
          </div>
        </PanelSection>
        {set.error && (
          <p role="alert" className="font-body text-[12px] text-oxblood-300">
            {set.error.message}
          </p>
        )}
      </div>
    </FileSection>
  );
}

function hintFor(option: BattleBoostOption): string {
  if (!option.available) return option.source || 'Nobody has put this on the table';
  const reach = option.reach === 0 ? 'reaches nothing you sent' : `reaches ${option.reach}%`;
  // A crate's price is not on this line because it has already been paid. What a player wants to
  // know about one is how many are left in the bag, which is what `source` carries for held boosts.
  const price = option.held ? option.source : `${option.cost.toLocaleString()} infamy`;
  return `${price} · ${option.effect} · ${reach}`;
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
    <FileSection
      icon="archive"
      title="Reports"
      note="Every fight this crew was in, most recent first"
    >
      <ul
        className="flex flex-col divide-y divide-surface-700 rounded-sm border border-surface-700 bg-surface-950/40"
        data-testid="battle-reports"
      >
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
    </FileSection>
  );
}

/** Your own ground: the way in, and what is standing behind it. */
function Defences({ structures }: { structures: readonly StructureDefence[] }) {
  const gate = structures.find((structure) => structure.kind === 'gate') ?? null;
  const rest = structures.filter((structure) => structure.kind !== 'gate');

  return (
    <FileSection icon="district" title="Your ground">
      <div className="flex flex-col gap-2.5" data-testid="structures">
        {/* One section, called after the thing it is about (maintainer request, 2026-09-12). It was
            "The way in" wrapped around a line that said "The Gate 2", which is a heading and a
            subheading saying the same word, and neither of them said what the level was worth. */}
        <PanelSection label="The gate" data-testid="gate-defence">
          {gate === null ? (
            <p className="font-body text-[12px] leading-relaxed text-ink-300">
              You have no Gate. Raise one in the district and it becomes the thing an attacker has
              to get through.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-[13px] uppercase tracking-[0.14em] text-ink-100">
                  Level <span className="tabular-nums text-brass-300">{gate.level}</span>
                </span>
              </div>
              {/* What the level is actually worth, which is the question the section exists to
                  answer. Both figures are the district's folded totals, so a modification that
                  lifts either is counted here rather than only in the fight. */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
                    Toughness
                  </dt>
                  <dd className="font-display text-[13px] font-bold tabular-nums text-ink-100">
                    +{Math.round(gate.defensePercent ?? 0)}%
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="font-display text-[10px] uppercase tracking-[0.16em] text-ink-300">
                    Against scouts
                  </dt>
                  <dd className="font-display text-[13px] font-bold tabular-nums text-ink-100">
                    +{Math.round(gate.intelResistancePercent ?? 0)}%
                  </dd>
                </div>
              </dl>
              <p className="font-body text-[11px] leading-snug text-ink-300">
                Every level is worth more of both, and there is nothing else to buy on it.
              </p>
            </div>
          )}
        </PanelSection>

        <PanelSection
          label="What is standing"
          note="A lost raid costs the district hours of output, never a structure"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {rest.map((structure) => (
              <div
                key={structure.buildingId}
                data-testid={`structure-${structure.kind}`}
                className="flex items-center justify-between gap-3 rounded-sm border border-surface-700 bg-surface-950/50 p-2"
              >
                <span className="min-w-0">
                  <span className="block truncate font-display text-[12px] uppercase tracking-[0.14em] text-ink-200">
                    {structure.label} {structure.level}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </PanelSection>
      </div>
    </FileSection>
  );
}
