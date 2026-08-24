import {
  BUILDING_CATALOG,
  FACTION_NAME_MAX,
  MAX_BUILD_QUEUE,
  PAY_WEEK_MS,
  RESOURCE_KEYS,
  districtProduction,
  findDistrict,
  foodUpkeepFor,
  populationCapacity,
  playerLevelGrants,
  playerXpToNextLevel,
  queueProgressAt,
  queueRemainingMs,
  reputationOf,
  startOfPayWeek,
  storageCapacity,
  weeklyWageBill,
  type Base,
  type BuildingKind,
} from '@frontline/shared';
import { useState, type ReactNode } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';
import { StandingReadout } from '../../components/Meters';
import { RESOURCE_META, ResourceGrid } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBase, useBuildStructure, useMe, useRenameFaction } from '../../lib/queries';
import { useMeasuredHeight } from '../../lib/useMeasuredHeight';
import { useServerClock } from '../missions/useServerClock';
import { StructureDialog } from './StructureDialog';
import { DistrictScene } from './DistrictScene';
import { DISTRICT_SITES } from './plots';
import { formatRate, formatRemaining } from './format';

/**
 * The district (GDD §A1) — a place you look at and click, not a list of structure rows.
 *
 * Everything under the scene is a readout of something the scene cannot show: what is being built,
 * what the grid is doing, what the structures are making, and the W2/W6 numbers that were already
 * on this page. Nothing here computes a game rule — every figure comes from a shared function the
 * server calls too.
 */
export function BasePanel() {
  const me = useMe();
  const baseId = me.data?.base?.id;
  const baseQuery = useBase(baseId);
  const base = baseQuery.data?.base ?? me.data?.base ?? null;
  const build = useBuildStructure(baseId);
  const [selectedPlot, setSelectedPlot] = useState<BuildingKind | null>(null);
  const [titleRef, titleHeight] = useMeasuredHeight();

  if (!base) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-ink-300">
          Loading district…
        </p>
      </div>
    );
  }

  const districtName = findDistrict(base.districtId)?.name ?? base.districtId;
  const now = new Date();

  // A fresh plot starts with a clean slate: the refusal from the last one is not about this one.
  const selectPlot = (kind: BuildingKind) => {
    build.reset();
    setSelectedPlot(kind);
  };

  return (
    // The district *is* the screen. It fills the viewport behind the floating chrome, and
    // everything written about it scrolls in a column over the top — the readouts are a report on
    // the place, so they belong on it rather than under it in a document that pushes it off-screen.
    <div
      className="relative h-full w-full"
      // What the district has to lay itself out under: the HUD, plus this screen's own title row.
      // Published as a variable rather than passed as a prop because the scene is the thing that
      // has to know, and it is two components down — and because the row's height is a
      // measurement, not a constant: it grows when the name wraps.
      style={
        {
          '--scene-top': `calc(var(--hud-h, 0px) + ${Math.round(titleHeight)}px)`,
        } as React.CSSProperties
      }
    >
      <DistrictScene
        buildings={base.buildings}
        queue={base.buildQueue}
        selected={selectedPlot}
        onSelect={selectPlot}
      />

      {/* The district's own title bar, docked under the HUD.

          It used to be a plaque floating over the painting's top-left corner, which put it — and
          the three tags under it — squarely on the Quarters: the biggest building on the plate,
          visible and unclickable behind a sign. Docking it means the picture starts below it and
          nothing is ever buried.

          Two groups on one line rather than a stack of five things: the name, which is a control,
          and the three facts about the place, which are not. The player's *own* name is in the HUD
          a few pixels above; this is the ground they hold. */}
      {/* The ref is on an unpadded wrapper: `useMeasuredHeight` reads the *content* box, so
          measuring the padded row itself would report a height 16px short of the room it takes. */}
      <div
        ref={titleRef}
        className="pointer-events-none absolute inset-x-0 z-20"
        style={{ top: 'var(--hud-h, 0px)' }}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2">
          <FactionName base={base} />
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag label={`Level ${base.level}`} />
            <Tag label={districtName} />
            <Tag label={`${base.buildings.length} / ${DISTRICT_SITES.length} Structures`} />
          </div>
        </div>
      </div>

      {/* §I1 pays for building things, and the response is the only thing that knows this build is
          what crossed the threshold (MOU-227) — so the banner lives with the district, over it, and
          not folded into a drawer the player would have to open to find out they levelled. */}
      {build.data?.levelUp && (
        <div
          className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 pt-3"
          // Under the title row, whatever the title row turned out to be. It used to clear the
          // chrome by a hard-coded 96px, measured against a taller plaque that no longer exists —
          // the kind of constant that is right on the day it is typed and silently wrong after the
          // next layout change.
          style={{ top: 'var(--scene-top, var(--hud-h, 0px))' }}
        >
          <div className="pointer-events-auto w-full max-w-2xl">
            <LevelUpBanner levelUp={build.data.levelUp} />
          </div>
        </div>
      )}

      <ReportsDrawer>
        <Panel title={`Build queue (${base.buildQueue.length} / ${MAX_BUILD_QUEUE})`}>
          <BuildQueue base={base} />
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="The grid">
            <GridReadout base={base} />
          </Panel>
          <Panel title="Production">
            <ProductionRows base={base} />
          </Panel>
        </div>

        <Panel title="Stockpile">
          <ResourceGrid resources={base.resources} className="p-4" />
          <p className="border-t border-surface-700 px-4 py-2 font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
            The Apothecary holds {storageCapacity(base.buildings).toLocaleString()} of each.
            Production stops there. Raids and pay do not.
          </p>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Standing">
            <StandingReadout economy={base.economy} reputation={reputationOf(base.economy, now)} />
          </Panel>
          <Panel title="Payroll">
            <PayrollRows base={base} now={now} />
          </Panel>
        </div>

        <Panel title="Progression">
          <ProgressionRows base={base} />
        </Panel>
      </ReportsDrawer>

      {selectedPlot !== null && (
        <StructureDialog
          kind={selectedPlot}
          base={base}
          pending={build.isPending}
          error={build.error}
          onBuild={() => build.mutate({ kind: selectedPlot })}
          onClose={() => setSelectedPlot(null)}
        />
      )}
    </div>
  );
}

/**
 * The faction's name (§A1), and the one control that changes it.
 *
 * An inline edit rather than a settings page: it is one field, it is the first thing a new player
 * wants to change, and sending them somewhere else to change it is how it never gets changed.
 */
function FactionName({ base }: { base: Base }) {
  const rename = useRenameFaction(base.id);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      // A plaque over the gate, not a heading on a page. It has to stay readable against lit
      // windows and wet ground, so it gets its own dark ground and a border of sodium light rather
      // than a text-shadow doing all the work. The rename control is an affordance on it — always
      // reachable by keyboard, but out of the picture until the plaque is pointed at.
      // **The whole plaque is the button.**
      //
      // The rename control used to be a pencil that appeared on hover, which fails the first rule of
      // an affordance: a control you cannot see is a control that does not exist. Nothing told a
      // player the name was theirs to change, and the one gesture that would have revealed it —
      // hovering a heading — is not a gesture anyone performs on a heading.
      //
      // Now the plaque looks pressable at rest (a raised edge, a pencil always visible, a pointer
      // cursor) and says what it does on hover and to assistive tech. Fitts's law does the rest: the
      // target went from a 16px glyph to the entire sign.
      <button
        type="button"
        onClick={() => setDraft(base.name)}
        title="Rename your faction"
        aria-label={`${base.name}. Rename your faction`}
        className="group glass painted edge-lit pointer-events-auto flex items-center gap-2 rounded-md border border-brass-500/50 px-3 py-1.5 shadow-panel transition-all duration-150 hover:-translate-y-px hover:border-brass-300/80 hover:shadow-brass active:translate-y-0"
      >
        {/* The one plaque on the screen, so the one place the stamped face earns its keep: at 20px
            a struck-ribbon letterform reads as a sign bolted to a wall, which is what this is. The
            dense 10–12px labels everywhere else are set in Rajdhani for legibility — see
            `fontStacks`. */}
        <h1 className="font-stamp text-lg font-bold tracking-[0.08em] text-ink-100 text-on-art">
          {base.name}
        </h1>
        <span className="flex items-center gap-1.5 text-brass-300/80 transition-colors group-hover:text-brass-100">
          <Icon name="edit" className="h-4 w-4" />
          <span className="font-display text-[11px] uppercase tracking-[0.16em]">Rename</span>
        </span>
      </button>
    );
  }

  return (
    <form
      className="pointer-events-auto mt-1 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const name = draft.trim();
        if (name.length < 2) return;
        rename.mutate({ name }, { onSuccess: () => setDraft(null) });
      }}
    >
      <label className="sr-only" htmlFor="faction-name">
        Faction name
      </label>
      <input
        id="faction-name"
        value={draft}
        autoFocus
        maxLength={FACTION_NAME_MAX}
        onChange={(event) => setDraft(event.target.value)}
        className="min-w-0 flex-1 border border-brass-500/60 bg-surface-950 px-3 py-1.5 font-display text-lg tracking-[0.1em] text-ink-100 focus-visible:border-brass-300 focus-visible:outline-none"
      />
      <Button size="sm" type="submit" disabled={rename.isPending || draft.trim().length < 2}>
        {rename.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={() => setDraft(null)}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * What is being built, in the order it will land (§A1).
 *
 * The countdown ticks against the *server's* clock, like the mission board's: a machine with a
 * skewed clock shows the same remaining time as everyone else, and still cannot make a build land
 * early.
 */
function BuildQueue({ base }: { base: Base }) {
  const now = useServerClock(undefined, undefined);

  if (base.buildQueue.length === 0) {
    return (
      <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
        Nothing under way. Click a plot to order a level. Up to {MAX_BUILD_QUEUE} at a time, worked
        one after another.
      </p>
    );
  }

  return (
    <ol className="flex flex-col divide-y divide-surface-700" data-testid="build-queue">
      {base.buildQueue.map((entry, index) => {
        const progress = queueProgressAt(entry, now);
        const remaining = queueRemainingMs(entry, now);
        return (
          <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="truncate font-display text-[12px] uppercase tracking-[0.18em] text-ink-200">
                {index + 1}. {BUILDING_CATALOG[entry.kind].name} → Lv {entry.level}
              </span>
              <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-brass-300">
                {formatRemaining(remaining)}
              </span>
            </div>
            <span className="block h-1.5 w-full bg-surface-700">
              <span
                className={cn('block h-full', index === 0 ? 'bg-brass-300' : 'bg-surface-600')}
                style={{ width: `${progress * 100}%` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Supply against draw, and what a shortfall is costing (§A1 — the Generator's whole job). */
function GridReadout({ base }: { base: Base }) {
  const { grid } = districtProduction(base.buildings);
  const load = grid.supply === 0 ? 1 : Math.min(1, grid.draw / grid.supply);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
          Draw / supply
        </span>
        <span
          data-testid="power-balance"
          className={cn(
            'font-display text-sm font-semibold tabular-nums',
            grid.brownout ? 'text-oxblood-300' : 'text-brass-300',
          )}
        >
          {grid.draw} / {grid.supply}
        </span>
      </div>
      <span className="block h-1.5 w-full bg-surface-700">
        <span
          className={cn('block h-full', grid.brownout ? 'bg-oxblood-300' : 'bg-brass-300')}
          style={{ width: `${load * 100}%` }}
        />
      </span>
      <p className="font-body text-xs leading-relaxed text-ink-300">
        {grid.brownout
          ? `Brownout. Everything the district makes is running at ${Math.round(grid.ratio * 100)}%, and morale is going with it. Raise the Generator.`
          : `${grid.headroom} spare. The lights are on, and the crew notices.`}
      </p>
      <dl className="flex flex-col divide-y divide-surface-700 border-t border-surface-700">
        <StatRow label="Fuel burn" value={formatRate(-grid.oilPerHour)} />
        <StatRow
          label="Housed"
          value={`${base.commanders.length} / ${populationCapacity(base.buildings)}`}
        />
      </dl>
    </div>
  );
}

/** Net hourly output, brownout and modifications already folded in by the shared function. */
function ProductionRows({ base }: { base: Base }) {
  const { perHour } = districtProduction(base.buildings);
  const producing = RESOURCE_KEYS.filter((key) => (perHour[key] ?? 0) !== 0);

  if (producing.length === 0) {
    return (
      <p className="p-4 font-body text-xs leading-relaxed text-ink-300">
        Nothing is being made yet. The Greenhouse grows food, the Scrapyard strips salvage and the
        Garage cracks fuel.
      </p>
    );
  }

  return (
    <dl className="flex flex-col divide-y divide-surface-700" data-testid="production">
      {producing.map((key) => (
        <StatRow
          key={key}
          label={RESOURCE_META[key].label}
          value={formatRate(perHour[key] ?? 0)}
          tone={(perHour[key] ?? 0) < 0 ? 'bad' : 'good'}
        />
      ))}
    </dl>
  );
}

/**
 * The wage book (GDD §H7): what the crew costs every week and when the caps next leave. Salary
 * negotiation itself is W5/MOU-164 — this is the money side of it, which is what already moves.
 */
function PayrollRows({ base, now }: { base: Base; now: Date }) {
  const officers = base.commanders.length;
  const nextPayday = new Date(startOfPayWeek(now).getTime() + PAY_WEEK_MS);

  return (
    <dl className="flex flex-col divide-y divide-surface-700">
      <StatRow label="Officers on the books" value={String(officers)} />
      <StatRow label="Wages / week" value={`${weeklyWageBill(base.economy.payroll.wages)} caps`} />
      <StatRow label="Food upkeep / week" value={`${foodUpkeepFor(officers)} food`} />
      <StatRow
        label="Next payday"
        value={nextPayday.toLocaleDateString(undefined, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })}
      />
    </dl>
  );
}

/**
 * Player progression (GDD §I). The bar is XP banked towards the next level — `base.progression`
 * holds progress only, never a second copy of the level. The three rows under it are the §I2
 * grants (§G8 pool, §G3 per-officer cap, §H8 recruit slots), read straight off the shared formula
 * so the screen cannot drift from what the server grants.
 */
function ProgressionRows({ base }: { base: Base }) {
  const needed = playerXpToNextLevel(base.level);
  const banked = base.progression.xpIntoLevel;
  const pct = Math.max(0, Math.min(100, (banked / needed) * 100));
  const grants = playerLevelGrants(base.level);

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">
            Level {base.level} → {base.level + 1}
          </span>
          <span className="font-display text-sm font-semibold tabular-nums text-brass-300">
            {banked} / {needed} XP
          </span>
        </div>
        <span className="block h-1.5 w-full bg-surface-700">
          <span className="block h-full bg-brass-300" style={{ width: `${pct}%` }} />
        </span>
      </div>
      <dl className="flex flex-col divide-y divide-surface-700 border-t border-surface-700">
        <StatRow label="Assignee pool" value={String(grants.assigneePool)} />
        <StatRow label="Assignees / officer" value={String(grants.assigneeCapPerOfficer)} />
        <StatRow label="Recruit slots" value={String(grants.recruitSlots)} />
      </dl>
    </div>
  );
}

function StatRow({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'good' | 'bad';
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-ink-300">{label}</dt>
      <dd
        className={cn(
          'font-display text-sm font-semibold tabular-nums',
          tone === 'good' && 'text-brass-300',
          tone === 'bad' && 'text-oxblood-300',
          tone === 'plain' && 'text-ink-100',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="glass rounded-sm border border-surface-600/80 px-2 py-0.5 font-display text-[11px] uppercase tracking-[0.12em] text-ink-200">
      {label}
    </span>
  );
}

/**
 * Everything written *about* the district, folded away until it is asked for.
 *
 * The district page used to be a three-thousand-pixel document with a picture at the top: build
 * queue, grid, production, stockpile, standing, payroll, progression. All of it is worth reading and
 * none of it is worth losing the place to — a player who opens their district wants to look at it
 * and click a building, and scrolling the town off the top of the screen to reach a payroll table
 * is what makes a game read as a spreadsheet.
 *
 * So it slides up over the scene instead, closed by default, and the district stays where it is
 * behind it. Closed, the whole viewport is the place; open, the numbers are one click away and the
 * place is still visible under them.
 */
function ReportsDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-4"
        style={{ bottom: 'calc(var(--nav-h, 88px) + 10px)' }}
      >
        <Button
          variant={open ? 'ghost' : 'primary'}
          size="sm"
          className="pointer-events-auto"
          aria-expanded={open}
          aria-controls="district-reports"
          onClick={() => setOpen((was) => !was)}
          data-testid="reports-toggle"
        >
          {open ? 'Hide reports ▾' : 'Reports ▴'}
        </Button>
      </div>

      {open && (
        <div
          id="district-reports"
          data-testid="district-reports"
          className="glass-strong absolute inset-x-0 z-20 max-h-[62vh] overflow-y-auto border-t border-brass-500/30 px-4 py-5 shadow-panel"
          style={{ bottom: 'var(--nav-h, 88px)' }}
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-5">{children}</div>
        </div>
      )}
    </>
  );
}
