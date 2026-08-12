import { BUILDING_CATALOG, findDistrict, type Building } from '@frontline/shared';
import { RewardLine, ResourceGrid } from '../../components/Resources';
import { Panel } from '../../components/ui/Panel';
import { useBase, useMe } from '../../lib/queries';

export function BasePanel() {
  const me = useMe();
  const baseId = me.data?.base?.id;
  const baseQuery = useBase(baseId);
  const base = baseQuery.data?.base ?? me.data?.base ?? null;

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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <header>
          <p className="font-display text-[10px] tracking-[0.4em] text-neon-cyan/70">
            // BASE OF OPERATIONS //
          </p>
          <h1 className="text-glow-cyan mt-1 font-display text-2xl font-bold tracking-[0.15em] text-steel-100">
            {base.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Tag label={`Level ${base.level}`} />
            <Tag label={districtName} />
            <Tag label={`${base.buildings.length} Structures`} />
          </div>
        </header>

        <Panel title="Stockpile">
          <ResourceGrid resources={base.resources} className="p-4" />
        </Panel>

        <Panel title="Structures">
          <ul className="flex flex-col divide-y divide-steel-800">
            {base.buildings.map((building) => (
              <BuildingRow key={building.id} building={building} />
            ))}
          </ul>
        </Panel>
      </div>
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

function BuildingRow({ building }: { building: Building }) {
  const spec = BUILDING_CATALOG[building.kind];
  const hasOutput = Object.values(spec.output).some((v) => (v ?? 0) > 0);
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-sm font-semibold tracking-[0.1em] text-steel-100">
            {spec.name}
          </h3>
          <span className="border border-neon-cyan/30 px-1.5 py-0.5 font-display text-[9px] uppercase tracking-[0.15em] text-neon-cyan">
            Lv {building.level}
          </span>
        </div>
        <p className="mt-1 font-body text-[11px] leading-relaxed text-steel-400">
          {spec.description}
        </p>
      </div>
      <div className="shrink-0 sm:w-48 sm:text-right">
        <p className="font-display text-[9px] uppercase tracking-[0.2em] text-steel-500">
          Output / tick
        </p>
        <div className="mt-1 sm:flex sm:justify-end">
          {hasOutput ? (
            <RewardLine rewards={spec.output} />
          ) : (
            <span className="font-display text-[11px] tracking-[0.15em] text-steel-600">
              PASSIVE
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
