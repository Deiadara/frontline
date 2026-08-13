import {
  PAY_WEEK_MS,
  findDistrict,
  foodUpkeepFor,
  playerLevelGrants,
  playerXpToNextLevel,
  reputationOf,
  startOfPayWeek,
  weeklyWageBill,
  type Base,
  type BuildingKind,
} from '@frontline/shared';
import { useState } from 'react';
import { LevelUpBanner } from '../../components/LevelUp';
import { StandingReadout } from '../../components/Meters';
import { ResourceGrid } from '../../components/Resources';
import { Panel } from '../../components/ui/Panel';
import { useBase, useBuildStructure, useMe } from '../../lib/queries';
import { StructureDialog } from './StructureDialog';
import { Village } from './Village';
import { VILLAGE_PLOTS } from './plots';

/**
 * The hideout (GDD §A1) — a small village you look at and click, not a list of structure rows.
 * The W2 stockpile/standing/payroll and W6 progression readouts stay under it: the layout is what
 * §A1 replaces, not the numbers the other workstreams put on this page.
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
          Loading base…
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
            // THE HIDEOUT //
          </p>
          <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
            {base.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag label={`Level ${base.level}`} />
            <Tag label={districtName} />
            <Tag label={`${base.buildings.length} / ${VILLAGE_PLOTS.length} Structures`} />
          </div>
        </div>

        <Village buildings={base.buildings} selected={selectedPlot} onSelect={selectPlot} />

        {/* §I1 pays for building things, and the response is the only thing that knows this build
            is what crossed the threshold (MOU-227) — so the banner lives with the village. */}
        {build.data?.levelUp && <LevelUpBanner levelUp={build.data.levelUp} />}

        {selectedPlot !== null && (
          <StructureDialog
            kind={selectedPlot}
            buildings={base.buildings}
            resources={base.resources}
            pending={build.isPending}
            error={build.error}
            onBuild={() => build.mutate({ kind: selectedPlot })}
            onClose={() => setSelectedPlot(null)}
          />
        )}

        <Panel title="Stockpile">
          <ResourceGrid resources={base.resources} className="p-4" />
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
 * The wage book (GDD §H7): what the crew costs every week and when the caps next leave. Salary
 * negotiation itself is W5/MOU-164 — this is the money side of it, which is what already moves.
 */
function PayrollRows({ base, now }: { base: Base; now: Date }) {
  const officers = base.commanders.length;
  const nextPayday = new Date(startOfPayWeek(now).getTime() + PAY_WEEK_MS);

  return (
    <dl className="flex flex-col divide-y divide-steel-800">
      <PayrollRow label="Officers on the books" value={String(officers)} />
      <PayrollRow
        label="Wages / week"
        value={`${weeklyWageBill(base.economy.payroll.wages)} caps`}
      />
      <PayrollRow label="Food upkeep / week" value={`${foodUpkeepFor(officers)} food`} />
      <PayrollRow
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
        <PayrollRow label="Assignee pool" value={String(grants.assigneePool)} />
        <PayrollRow label="Assignees / officer" value={String(grants.assigneeCapPerOfficer)} />
        <PayrollRow label="Recruit slots" value={String(grants.recruitSlots)} />
      </dl>
    </div>
  );
}

function PayrollRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
        {label}
      </dt>
      <dd className="font-display text-sm font-semibold tabular-nums text-steel-100">{value}</dd>
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
