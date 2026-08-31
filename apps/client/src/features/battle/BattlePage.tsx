import {
  VEHICLES,
  canAfford,
  carriedSpeedPercent,
  mergeFleets,
  type VehicleId,
  type BattleBoostOption,
  type BattleReportView,
  type BattleView,
  type BattlesResponse,
  type StructureDefence,
  type Resources,
  estimatedForce,
  forecast,
} from '@frontline/shared';
import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { LoadFailure } from '../../components/ui/LoadFailure';
import { Dropdown } from '../../components/ui/Dropdown';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { PanelSection } from '../../components/ui/PanelSection';
import { FortifyMeter } from '../../components/ui/FortifyMeter';
import { CostLine } from '../../components/Resources';
import { cn } from '../../lib/cn';
import {
  useBattles,
  useBuyBattleBoost,
  useLeadBattle,
  useTakeVehicles,
  useDeployToBattle,
  useFortifyStructure,
  useMe,
} from '../../lib/queries';
import { formatRemaining } from '../base/format';
import { PageShell } from '../game/PageShell';
import { BattleReportModal } from './BattleReportModal';
import { DeployDialog } from './DeployDialog';
import { UnitChip } from '../units/UnitChip';

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
  { id: 'coming', label: 'Upcoming' },
  { id: 'reports', label: 'Reports' },
  { id: 'ground', label: 'Your ground' },
];

/** An empty stockpile, for the frame before `me` has landed. Nothing is affordable against it. */
const NOTHING_IN_STORE: Resources = {
  caps: 0,
  supplies: 0,
  oil: 0,
  scrap: 0,
  highQualityMetal: 0,
  planks: 0,
};

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
  // The stockpile the Gate's dig is priced against. Read off `me` rather than added to the board's
  // own payload: every battle write already folds its post-write crew into that cache, so this is
  // the same number the HUD is showing and it lands without a second round trip.
  const resources = me.data?.base?.resources ?? NOTHING_IN_STORE;

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
          {tab === 'ground' && <Defences structures={data.structures} resources={resources} />}
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

        <Odds view={view} />

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

      {view.side !== null && <LeadPicker view={view} />}
      {view.side !== null && <VehiclePicker view={view} />}
      {view.side !== null && <NameBuys view={view} infamy={infamy} />}
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
 * The line under it is the one that decides anything: what a machine buys is speed for the people
 * *on it*, so a bike under a column of four hundred is worth almost nothing and a hauler under
 * forty is worth all of it.
 */
function VehiclePicker({ view }: { view: BattleView }) {
  const take = useTakeVehicles();
  const shut = !view.deploymentOpen;
  const owned = mergeFleets(view.yard, view.vehicles);
  const bodies = view.muster?.size ?? 0;
  const speed = carriedSpeedPercent(view.vehicles, bodies);

  const set = (id: VehicleId, count: number) =>
    take.mutate({
      battleId: view.battle.id,
      vehicles: Object.fromEntries(
        Object.entries({ ...view.vehicles, [id]: count }).filter(([, amount]) => amount > 0),
      ),
    });

  const lines = VEHICLES.filter((spec) => (owned[spec.id] ?? 0) > 0);
  return (
    <Panel title="Machines">
      <div className="flex flex-col gap-2.5 p-4" data-testid="vehicle-picker">
        <PanelSection
          label="Loaded"
          note={
            lines.length === 0
              ? 'Nothing in the yard'
              : speed > 0
                ? `${speed}% off the road for this column`
                : 'Nothing loaded, so everybody walks'
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
                        carries {spec.capacity}, {spec.speedPercent}% off the road
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
      </div>
    </Panel>
  );
}

/**
 * §D1: who is leading this one, if anybody.
 *
 * A drop-down for the same reason the boost is one: it is at most one choice out of a list of
 * comparable things, and the interesting part is the comparison. What is on each line is what the
 * officer would *fight* as, because that is the decision: a Head of Security with a Strength of 70
 * is a body worth putting in the line and a Finance Officer is not.
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
    <Panel title="Leading">
      <div className="flex flex-col gap-2.5 p-4" data-testid="lead-picker">
        <PanelSection
          label="At the front"
          note={shut ? 'They are already on the ground' : 'One officer, and only if you want one'}
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
              <p className="mt-0.5 font-body text-[12px] leading-snug text-ink-100">
                Fights at {chosen.stats.offense} damage and {chosen.stats.vitality} vitality. Half
                as likely to be shot at while anyone else is standing, and never killed: the worst
                that happens is a day laid up, and no report from this fight.
              </p>
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
            hint: `${leader.stats.offense} damage · ${leader.stats.vitality} vitality · ${leader.stats.armor} armour`,
          }))}
          onChange={(officerId) => lead.mutate({ battleId: view.battle.id, officerId })}
          data-testid="lead-officer-picker"
        />
      </div>
    </Panel>
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
 */
function Odds({ view }: { view: BattleView }) {
  const facing = view.enemySize;
  const defending = view.role === 'defender';
  // Keyed off the plan rather than the object: `view` is rebuilt on every poll, so depending on the
  // army's identity would re-run sixty simulations a second and the number would never hold still
  // long enough to read. Sixty runs is cheap once and not cheap every render.
  const plan = JSON.stringify([view.muster?.army ?? {}, facing, view.battlefield, defending]);
  const read = useMemo(() => {
    const [sending, size, ground, holding] = JSON.parse(plan) as [
      Record<string, number>,
      number | null,
      BattleView['battlefield'],
      boolean,
    ];
    const bodies = Object.values(sending).reduce((total, count) => total + count, 0);
    if (size === null || bodies === 0) return null;
    return forecast({
      seed: plan,
      battlefield: ground,
      attacker: { name: 'you', army: sending, defending: holding },
      defender: { name: 'them', army: estimatedForce(size), defending: !holding },
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
        // Wraps, and the box grows with it: a force of nine kinds is a real state and it used to
        // run off the edge of a row that could not get taller.
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {rows.map(([unitId, count]) => (
            <li key={unitId}>
              <UnitChip unitId={unitId} count={count} data-testid={`force-${unitId}`} />
            </li>
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
              <li key={unitId}>
                <UnitChip unitId={unitId} count={count} muted data-testid={`ring-${unitId}`} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
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
  const bought = view.boosts.find((option) => option.id === view.boostId) ?? null;
  const [picked, setPicked] = useState<string>('');
  const choice = view.boosts.find((option) => option.id === picked) ?? null;

  const shut = !view.deploymentOpen;
  const blocked = blockerFor(choice, shut);

  return (
    <Panel title="Boosts">
      <div className="flex flex-col gap-2.5 p-4" data-testid="name-buys">
        <PanelSection
          label="Running"
          note={bought ? undefined : 'One per fight'}
          data-testid="boost-bought"
        >
          {bought ? (
            <>
              <p className="font-display text-[12px] uppercase tracking-[0.14em] text-brass-300">
                {bought.name}
              </p>
              <p className="mt-0.5 font-body text-[12px] leading-snug text-ink-100">
                {bought.effect} · reaching {bought.reach}% of what you sent
              </p>
            </>
          ) : (
            <p className="font-body text-[12px] leading-relaxed text-ink-300">
              Nothing taken. Swapping a name for another one later costs the name twice; swapping
              contraband costs nothing.
            </p>
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
              onClick={() =>
                choice &&
                buy.mutate(
                  { battleId: view.battle.id, boostId: choice.id },
                  { onSuccess: () => setPicked('') },
                )
              }
              data-testid="buy-boost"
            >
              {choice?.held ? 'Take it in' : 'Burn the name'}
            </Button>
          }
        >
          <div className="flex flex-col gap-2.5">
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
              <div className="rounded-sm border border-surface-700 bg-surface-950/60 p-2.5">
                <p className="font-body text-[12px] leading-relaxed text-ink-100">
                  {choice.description}
                </p>
                <p className="mt-1.5 font-display text-[11px] uppercase tracking-[0.14em] text-brass-300">
                  {choice.effect}
                </p>
                <p className="mt-0.5 font-display text-[11px] uppercase tracking-[0.14em] text-ink-300">
                  {choice.held ? choice.source : `${choice.cost} infamy`} · reaches {choice.reach}%
                  of your force
                </p>
              </div>
            )}
          </div>
        </PanelSection>
      </div>
    </Panel>
  );
}

function hintFor(option: BattleBoostOption): string {
  if (!option.available) return option.source || 'Nobody has put this on the table';
  const reach = option.reach === 0 ? 'reaches nothing you sent' : `reaches ${option.reach}%`;
  // A crate's price is not on this line because it has already been paid. What a player wants to
  // know about one is how many are left in the bag, which is what `source` carries for held boosts.
  const price = option.held ? option.source : `${option.cost} infamy`;
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

/** Your own ground: the way in, and what is standing behind it. */
function Defences({
  structures,
  resources,
}: {
  structures: readonly StructureDefence[];
  resources: Resources;
}) {
  const fortify = useFortifyStructure();
  const gate = structures.find((structure) => structure.kind === 'gate') ?? null;
  const rest = structures.filter((structure) => structure.kind !== 'gate');

  return (
    <Panel title="Your ground">
      <div className="flex flex-col gap-2.5 p-4" data-testid="structures">
        <PanelSection
          label="The way in"
          note="Digging the Gate in is the one defence you buy with materials"
          data-testid="gate-defence"
          action={
            gate?.nextFortify ? (
              <Button
                size="sm"
                disabled={fortify.isPending || !canAfford(resources, gate.nextFortify.cost)}
                onClick={() => fortify.mutate({ buildingId: gate.buildingId })}
                data-testid="fortify-gate"
              >
                {fortify.isPending ? 'Digging…' : `Dig in to ${gate.nextFortify.level}`}
              </Button>
            ) : undefined
          }
        >
          {gate === null ? (
            <p className="font-body text-[12px] leading-relaxed text-ink-300">
              You have no Gate. Raise one in the district and it becomes the thing an attacker has
              to get through.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FortifyMeter level={gate.fortification} percent={gate.fortifyPercent} />
                <span className="font-body text-[11px] text-ink-300">
                  {gate.damage > 0
                    ? `Wrecked ${Math.round(gate.damage)}% · running at ${Math.round(gate.effectiveness * 100)}%`
                    : `Gate ${gate.level} · intact`}
                </span>
              </div>
              {gate.nextFortify ? (
                <div className="flex flex-col gap-1.5">
                  <span className="font-display text-[11px] uppercase tracking-[0.16em] text-ink-300">
                    Level {gate.nextFortify.level} takes it to +{gate.nextFortify.bonusPercent}%
                  </span>
                  <CostLine cost={gate.nextFortify.cost} stock={resources} />
                </div>
              ) : (
                <span className="font-display text-[11px] uppercase tracking-[0.16em] text-brass-300">
                  As dug in as it goes
                </span>
              )}
            </div>
          )}
        </PanelSection>

        <PanelSection
          label="What is standing"
          note="A wrecked building does as little as half its job"
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
                  <span className="block font-body text-[11px] text-ink-300">
                    {structure.damage > 0
                      ? `Wrecked ${Math.round(structure.damage)}% · running at ${Math.round(structure.effectiveness * 100)}%`
                      : 'Intact'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </PanelSection>
      </div>
    </Panel>
  );
}
