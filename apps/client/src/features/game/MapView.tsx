import { CITY_DISTRICTS } from '@frontline/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCity, useMe, useScout } from '../../lib/queries';
import { CityMap } from './CityMap';
import { ContextPanel } from './ContextPanel';

/**
 * The `/game` index: the city map and its caption (GDD §A4).
 *
 * The map's job ends at the district. Everything about what is *inside* one — the places, who is
 * holding them, what it would take — lives at `/game/city/:id`, because a panel that tried to hold
 * both would be a worse version of each.
 */
export function MapView() {
  const me = useMe();
  const city = useCity();
  const scout = useScout();
  const navigate = useNavigate();
  const myBase = me.data?.base ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!myBase) return null;

  const summaries = city.data?.districts ?? [];
  const intel = new Map(summaries.map((entry) => [entry.district.id, entry]));
  const selectedKey = selectedId ?? myBase.districtId;
  const selected = intel.get(selectedKey) ?? null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="relative min-h-0 min-w-0 flex-1 border-r border-neon-cyan/20 bg-night">
        <CityMap
          districts={CITY_DISTRICTS}
          bases={summaries.flatMap((entry) => (entry.base ? [entry.base] : []))}
          intel={intel}
          myBaseId={myBase.id}
          selectedId={selected?.district.id ?? null}
          onSelectDistrict={(district) => setSelectedId(district.id)}
        />
      </div>

      <ContextPanel
        entry={selected}
        myBaseId={myBase.id}
        pending={scout.isPending}
        onScout={(districtId) => scout.mutate({ districtId })}
        onEnter={(districtId) => void navigate(`/game/city/${districtId}`)}
        onRaid={(districtId) => void navigate(`/game/city/${districtId}`)}
      />
    </div>
  );
}
