import {
  CITY_DISTRICTS,
  type BattleResult,
  type District,
  type Resources,
} from '@frontline/shared';
import { useState } from 'react';
import { useAttack, useCity, useMe } from '../../lib/queries';
import { BattleResultModal } from './BattleResultModal';
import { CityMap } from './CityMap';
import { ContextPanel } from './ContextPanel';

interface BattleReport {
  result: BattleResult;
  resources: Resources;
  targetName: string;
}

/** The `/game` index: city map + context panel + battle flow. */
export function MapView() {
  const me = useMe();
  const city = useCity();
  const myBase = me.data?.base ?? null;
  const attack = useAttack(myBase?.id);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState<BattleReport | null>(null);

  if (!myBase) return null;

  const selected = CITY_DISTRICTS.find((d) => d.id === (selectedId ?? myBase.districtId)) ?? null;

  const onAttack = (district: District) => {
    attack.mutate(
      { targetDistrictId: district.id },
      {
        onSuccess: (data) =>
          setReport({ result: data.result, resources: data.resources, targetName: district.name }),
      },
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="relative min-h-0 min-w-0 flex-1 border-r border-neon-cyan/20 bg-night">
        <CityMap
          districts={CITY_DISTRICTS}
          bases={city.data?.bases ?? []}
          myBaseId={myBase.id}
          selectedId={selected?.id ?? null}
          onSelectDistrict={(district) => setSelectedId(district.id)}
        />
        <div className="pointer-events-none absolute left-3 top-3 border border-neon-cyan/20 bg-night/70 px-2.5 py-1">
          <p className="font-display text-[9px] uppercase tracking-[0.3em] text-neon-cyan/80">
            City Grid // {CITY_DISTRICTS.length} Districts
          </p>
        </div>
      </div>

      <aside className="w-80 shrink-0 bg-night-raised">
        <ContextPanel
          selected={selected}
          myBase={myBase}
          onAttack={onAttack}
          isAttacking={attack.isPending}
        />
      </aside>

      {report && (
        <BattleResultModal
          result={report.result}
          resources={report.resources}
          targetName={report.targetName}
          onClose={() => setReport(null)}
        />
      )}
    </div>
  );
}
