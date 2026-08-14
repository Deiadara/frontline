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
import { useState } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';
import { StandingReadout } from '../../components/Meters';
import { RESOURCE_META, ResourceGrid } from '../../components/Resources';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useBase, useBuildStructure, useMe, useRenameFaction } from '../../lib/queries';
import { useServerClock } from '../missions/useServerClock';
import { StructureDialog } from './StructureDialog';
import { DistrictScene } from './DistrictScene';
import { DISTRICT_PLOTS } from './plots';
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

  if (!base) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-display text-xs uppercase tracking-[0.2em] text-steel-500">
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
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {/* A plain block, not a <header>: the game shell's TopHud is already the page banner, and a
            second one makes "the HUD" ambiguous to assistive tech and to every test that scopes to
            it. The <h1> below is what carries this page's identity. */}
        <div>
          <p className="font-display text-[10px] tracking-[0.4em] text-neon-cyan/70">
            // THE DISTRICT //
          </p>
          <FactionName base={base} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag label={`Level ${base.level}`} />
            <Tag label={districtName} />
            <Tag label={`${base.buildings.length} / ${DISTRICT_PLOTS.length} Structures`} />
          </div>
        </div>

        <DistrictScene
          buildings={base.buildings}
          queue={base.buildQueue}
          selected={selectedPlot}
          onSelect={selectPlot}
        />

        {/* §I1 pays for building things, and the response is the only thing that knows this build
            is what crossed the threshold (MOU-227) — so the banner lives with the district. */}
        {build.data?.levelUp && <LevelUpBanner levelUp={build.data.levelUp} />}

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

        <Panel title={`Build queue — ${base.buildQueue.length} / ${MAX_BUILD_QUEUE}`}>
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
          <p className="border-t border-steel-800 px-4 py-2 font-display text-[10px] uppercase tracking-[0.18em] text-steel-500">
            The Apothecary holds {storageCapacity(base.buildings).toLocaleString()} of each —
            production stops there, raids and pay do not.
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
      </div>
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
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <h1 className="text-glow-cyan font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
          {base.name}
        </h1>
        <button
          type="button"
          onClick={() => setDraft(base.name)}
          className="font-display text-[10px] uppercase tracking-[0.2em] text-neon-cyan/70 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline"
        >
          Rename faction
        </button>
      </div>
    );
  }

  return (
    <form
      className="mt-1 flex flex-wrap items-center gap-2"
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
        className="min-w-0 flex-1 border border-neon-cyan/40 bg-night px-3 py-1.5 font-display text-lg tracking-[0.1em] text-steel-100 focus-visible:border-neon-cyan focus-visible:outline-none"
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
      <p className="p-4 font-body text-xs leading-relaxed text-steel-500">
        Nothing under way. Click a plot to order a level — up to {MAX_BUILD_QUEUE} at a time, worked
        one after another.
      </p>
    );
  }

  return (
    <ol className="flex flex-col divide-y divide-steel-800" data-testid="build-queue">
      {base.buildQueue.map((entry, index) => {
        const progress = queueProgressAt(entry, now);
        const remaining = queueRemainingMs(entry, now);
        return (
          <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <span className="truncate font-display text-[11px] uppercase tracking-[0.18em] text-steel-200">
                {index + 1}. {BUILDING_CATALOG[entry.kind].name} → Lv {entry.level}
              </span>
              <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-neon-cyan">
                {formatRemaining(remaining)}
              </span>
            </div>
            <span className="block h-1.5 w-full bg-steel-800">
              <span
                className={cn('block h-full', index === 0 ? 'bg-neon-cyan' : 'bg-steel-600')}
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
        <span className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
          Draw / supply
        </span>
        <span
          data-testid="power-balance"
          className={cn(
            'font-display text-sm font-semibold tabular-nums',
            grid.brownout ? 'text-neon-magenta' : 'text-neon-cyan',
          )}
        >
          {grid.draw} / {grid.supply}
        </span>
      </div>
      <span className="block h-1.5 w-full bg-steel-800">
        <span
          className={cn('block h-full', grid.brownout ? 'bg-neon-magenta' : 'bg-neon-cyan')}
          style={{ width: `${load * 100}%` }}
        />
      </span>
      <p className="font-body text-xs leading-relaxed text-steel-400">
        {grid.brownout
          ? `Brownout — everything the district makes is running at ${Math.round(grid.ratio * 100)}%, and morale is falling. Raise the Generator.`
          : `${grid.headroom} spare. The lights are on, and the crew notices.`}
      </p>
      <dl className="flex flex-col divide-y divide-steel-800 border-t border-steel-800">
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
      <p className="p-4 font-body text-xs leading-relaxed text-steel-500">
        Nothing is being made yet. The Greenhouse grows food, the Scrapyard strips salvage and the
        Garage cracks fuel.
      </p>
    );
  }

  return (
    <dl className="flex flex-col divide-y divide-steel-800" data-testid="production">
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
    <dl className="flex flex-col divide-y divide-steel-800">
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
          <span className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
            Level {base.level} → {base.level + 1}
          </span>
          <span className="font-display text-sm font-semibold tabular-nums text-neon-cyan">
            {banked} / {needed} XP
          </span>
        </div>
        <span className="block h-1.5 w-full bg-steel-800">
          <span className="block h-full bg-neon-cyan" style={{ width: `${pct}%` }} />
        </span>
      </div>
      <dl className="flex flex-col divide-y divide-steel-800 border-t border-steel-800">
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
      <dt className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
        {label}
      </dt>
      <dd
        className={cn(
          'font-display text-sm font-semibold tabular-nums',
          tone === 'good' && 'text-neon-cyan',
          tone === 'bad' && 'text-neon-magenta',
          tone === 'plain' && 'text-steel-100',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="border border-steel-700 bg-night px-2 py-0.5 font-display text-[10px] uppercase tracking-[0.18em] text-steel-300">
      {label}
    </span>
  );
}
