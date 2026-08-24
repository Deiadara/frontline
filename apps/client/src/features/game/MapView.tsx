import { CITY_DISTRICTS } from '@frontline/shared';
import { useEffect, useState } from 'react';
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
/**
 * How much of the frame the intel panel is standing on.
 *
 * Shared with `CityMap`'s `safeArea` rather than being a number in two places: the panel and the
 * ground it covers have to agree, and the failure when they disagree is a district you can see and
 * cannot click.
 */
const INTEL_WIDTH = 320;
const INTEL_GUTTER = 12;

/**
 * The chrome's live height, in pixels, read off the CSS variables the shell publishes.
 *
 * A `ResizeObserver` on the bars already writes `--hud-h` and `--nav-h`; this is the one consumer
 * that cannot use them in a stylesheet, because it is laying out a canvas.
 */
function useChromeInset(): { top: number; bottom: number } {
  const [inset, setInset] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const px = (name: string, fallback: number) => {
        const raw = style.getPropertyValue(name).trim();
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
      };
      setInset({ top: px('--hud-h', 96) + 12, bottom: px('--nav-h', 104) + 12 });
    };
    read();
    window.addEventListener('resize', read);
    // The bars also change height without the window doing anything — a long faction name, a
    // six-figure stockpile — so the variables themselves are watched rather than just the viewport.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      window.removeEventListener('resize', read);
      observer.disconnect();
    };
  }, []);
  return inset;
}

export function MapView() {
  const me = useMe();
  const city = useCity();
  const scout = useScout();
  const navigate = useNavigate();
  const myBase = me.data?.base ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const chrome = useChromeInset();

  if (!myBase) return null;

  const summaries = city.data?.districts ?? [];
  const intel = new Map(summaries.map((entry) => [entry.district.id, entry]));
  const selectedKey = selectedId ?? myBase.districtId;
  const selected = intel.get(selectedKey) ?? null;

  return (
    // The map is the whole viewport, not a pane with a sidebar cut out of it. The intel panel
    // floats over the right-hand side instead of taking a column out of the city: a district the
    // panel happens to be sitting on can still be dragged out from under it, and at 1024px the map
    // no longer loses a third of its width to a panel that is empty until something is selected.
    <div className="relative h-full w-full bg-surface-950">
      <CityMap
        districts={CITY_DISTRICTS}
        bases={summaries.flatMap((entry) => (entry.base ? [entry.base] : []))}
        intel={intel}
        myBaseId={myBase.id}
        selectedId={selected?.district.id ?? null}
        onSelectDistrict={(district) => setSelectedId(district.id)}
        safeArea={{
          right: INTEL_WIDTH + INTEL_GUTTER * 2,
          // The chrome measures itself (`--hud-h` / `--nav-h`), and the map has to be told, because
          // a Pixi scene cannot read a CSS variable. Without it the two hardest districts in the
          // game sit under the stockpile bar at 1024 — visible, and impossible to click.
          top: chrome.top,
          bottom: chrome.bottom,
        }}
      />

      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 flex max-w-full items-center"
        style={{
          padding: INTEL_GUTTER,
          paddingTop: 'calc(var(--hud-h, 64px) + 16px)',
          paddingBottom: 'calc(var(--nav-h, 88px) + 16px)',
        }}
      >
        <div
          className="pointer-events-auto max-h-full max-w-full overflow-y-auto"
          style={{ width: INTEL_WIDTH }}
        >
          <ContextPanel
            entry={selected}
            myBaseId={myBase.id}
            pending={scout.isPending}
            onScout={(districtId) => scout.mutate({ districtId })}
            onEnter={(districtId) => void navigate(`/game/city/${districtId}`)}
            onRaid={(districtId) => void navigate(`/game/city/${districtId}`)}
          />
        </div>
      </div>
    </div>
  );
}
