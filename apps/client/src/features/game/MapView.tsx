import { CITY_DISTRICTS } from '@frontline/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCity, useMe, useScout } from '../../lib/queries';
import { Icon } from '../../components/ui/Icon';
import { CitiesView } from '../cities/CitiesView';
import { CityMap } from './CityMap';
import { ContextPanel } from './ContextPanel';

/**
 * The `/game` index: the city map and its caption (GDD §A4).
 *
 * The map's job ends at the district. Everything about what is *inside* one: the places, who is
 * holding them, what it would take: lives at `/game/city/:id`, because a panel that tried to hold
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
    // The bars also change height without the window doing anything: a long faction name, a
    // six-figure stockpile, so the variables themselves are watched rather than just the viewport.
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
  /**
   * Which zoom the camera is at: the city, or the step back from it.
   *
   * State rather than a route. "All cities" and "the city" are the same place at two distances, and
   * making the wider one a page meant a navigation, a fresh mount and a lost selection every time a
   * player looked at it. See `CitiesView`.
   */
  const [pulledOut, setPulledOut] = useState(false);
  const chrome = useChromeInset();

  if (!myBase) return null;

  if (pulledOut) {
    return (
      <div
        className="h-full w-full overflow-y-auto px-5"
        style={{
          paddingTop: 'calc(var(--hud-h, 96px) + 20px)',
          paddingBottom: 'calc(var(--nav-h, 104px) + 20px)',
        }}
        data-testid="cities-view"
      >
        <CitiesView onEnterCity={() => setPulledOut(false)} />
      </div>
    );
  }

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
          // game sit under the stockpile bar at 1024: visible, and impossible to click.
          top: chrome.top,
          bottom: chrome.bottom,
        }}
      />

      {/* The camera control, on the map rather than in the row of places: pulling back from the
          city is a thing you do *to this screen*, not a different screen to walk to. */}
      <div
        className="pointer-events-none absolute left-0 top-0 z-10 flex px-3"
        style={{ paddingTop: 'calc(var(--hud-h, 64px) + 12px)' }}
      >
        <button
          type="button"
          onClick={() => setPulledOut(true)}
          data-testid="all-cities"
          className="glass edge-lit pointer-events-auto flex items-center gap-2 rounded-sm border border-surface-600 px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.14em] text-ink-200 transition-colors hover:border-brass-300/70 hover:text-brass-100"
        >
          <Icon name="city" aria-hidden className="h-4 w-4" />
          All cities
        </button>
      </div>

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
