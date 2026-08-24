import { areaUnlockLevel, type GatedArea } from '@frontline/shared';
import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import { useAdmin, useMe } from '../../lib/queries';

/**
 * The scenery switcher, along the bottom of the frame.
 *
 * A sidebar spends a column of the viewport on navigation forever and forces the world into a box
 * beside it. Along the bottom it costs a strip, the artwork keeps the full width, and the thing a
 * player actually looks at is the page rather than a picture on it.
 *
 * Each entry is a **place**, not a menu item — an icon big enough to read as a destination with its
 * name under it, so the row scans as a set of doors and the one you are standing in is obvious
 * without reading a word. The buttons are deliberately chunky and reactive (Hero Zero's register
 * rather than a toolbar's): they lift on hover, press down on click, and the active one is lit from
 * inside and raised on a plinth. An interface that never moves under the pointer feels dead, and
 * these are the controls a player touches most.
 *
 * Every target clears 44px in both axes, which is the floor for a comfortable pointer target and
 * the reason the labels sit under the icons rather than beside them.
 */

export interface NavDestination {
  label: string;
  /** The word shown on hover and to assistive tech when the label alone is ambiguous. */
  title: string;
  to?: string;
  icon: IconName;
  /** Present when the destination is not built yet. */
  soon?: boolean;
  /**
   * §I3 — the screen this door leads to, when a level opens it.
   *
   * The door is still drawn, still labelled and still clickable when it is shut: the screen behind
   * it says which level opens it, which is the whole point of gating rather than hiding. What
   * changes here is only that it reads as locked, so a player is not surprised on arrival.
   */
  area?: GatedArea;
}

export const DESTINATIONS: readonly NavDestination[] = [
  { label: 'City', title: 'The city map', to: '/game', icon: 'city' },
  { label: 'Cities', title: 'Cities — one, for now', to: '/game/cities', icon: 'city', soon: true },
  // Not "Base". A crew holds a district, and the faction is who holds it — the two words the
  // player already uses for this screen. "Foothold" was a third name for the same place.
  { label: 'District', title: 'Your district', to: '/game/base', icon: 'district' },
  { label: 'Units', title: 'The roster', to: '/game/units', icon: 'units' },
  {
    label: 'Board',
    title: 'Declared fights and what came back',
    to: '/game/battles',
    icon: 'city',
  },
  { label: 'Missions', title: 'Missions', to: '/game/missions', icon: 'missions' },
  { label: 'The Bar', title: 'The bar', to: '/game/bar', icon: 'bar', area: 'bar' },
  {
    label: 'Research',
    title: 'Research',
    to: '/game/research',
    icon: 'research',
    area: 'research',
  },
  { label: 'Crew', title: 'Assignees', to: '/game/assignees', icon: 'crew' },
  {
    label: 'Training',
    title: 'Drills and reading',
    to: '/game/training',
    icon: 'units',
    area: 'training',
  },
  {
    label: 'Market',
    title: 'The Runner, the Broker and the board',
    to: '/game/market',
    icon: 'market',
    area: 'market',
  },
  { label: 'Workshop', title: 'Refits and the yard', to: '/game/workshop', icon: 'research' },
  { label: 'Satchel', title: 'Blueprints, parts and relics', to: '/game/inventory', icon: 'crew' },
  {
    label: 'Settings',
    title: 'Your name, mark, clock and passphrase',
    to: '/game/settings',
    icon: 'gear',
  },
];

/**
 * The one door that is not always there.
 *
 * Kept out of {@link DESTINATIONS} rather than filtered out of it, because it is not a place every
 * build has: `GET /api/admin` answers 404 when admin mode is off, `useAdmin` turns that into null,
 * and the row simply has one fewer door. A greyed-out entry would advertise a screen that does not
 * exist in that build.
 */
const BENCH: NavDestination = {
  label: 'Bench',
  title: 'Testing mode — knobs, presets and snapshots',
  to: '/game/admin',
  // Not the gear: Settings already wears it, and two doors with the same glyph side by side
  // are two doors a player has to read the label of every single time.
  icon: 'spark',
};

const testId = (label: string): string => `nav-${label.toLowerCase().replace(/\s+/g, '-')}`;

/**
 * One door. Active is lit and raised; the rest are unlit metal that lifts when pointed at.
 *
 * A door behind a level (§I3) still links. It reads as shut — dimmed, with a padlock over the
 * glyph and the level it opens at under the label — and clicking it goes to the screen that
 * explains itself. Disabling it would leave a player with a grey square and no way to find out
 * anything about it, which is precisely the failure the board asked to avoid.
 */
function Destination({
  destination,
  locked,
}: {
  destination: NavDestination;
  locked: number | null;
}) {
  const body = (active: boolean) => (
    <>
      <span
        className={cn(
          // Not brushed: eight frayed tiles in a row is texture competing with itself, and the bar
          // they sit on already carries the hand-made read.
          'edge-lit relative flex h-[46px] w-[46px] items-center justify-center rounded-md border',
          'transition-all duration-150 ease-out',
          active
            ? 'border-brass-300/80 bg-gradient-to-b from-brass-300/30 to-brass-500/15 text-brass-100 shadow-brass'
            : 'border-surface-600 bg-gradient-to-b from-surface-700 to-surface-800 text-ink-300 ' +
                'group-hover:-translate-y-0.5 group-hover:border-iris-300/70 group-hover:text-iris-100 ' +
                'group-hover:shadow-lifted group-active:translate-y-0',
        )}
      >
        <Icon name={destination.icon} className={cn('h-6 w-6', locked !== null && 'opacity-40')} />
        {/* The padlock, drawn over the glyph rather than replacing it: the door still has to be
            recognisable as the Bar or the Market, or a player cannot tell which one is shut. */}
        {locked !== null && (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center"
            data-testid={`nav-locked-${destination.area ?? ''}`}
          >
            <Icon name="lock" className="h-5 w-5 text-brass-300" />
          </span>
        )}
        {/* The lit plinth under the active door. Drawn rather than implied by colour alone, because
            colour alone is the one signal a player with a colour deficiency does not get. */}
        {active && (
          <span
            aria-hidden
            className="absolute -bottom-[7px] h-[3px] w-8 rounded-full bg-brass-300 shadow-brass"
          />
        )}
      </span>
      <span
        className={cn(
          'font-display text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150',
          active ? 'text-brass-100' : 'text-ink-300 group-hover:text-ink-100',
        )}
      >
        {destination.label}
      </span>
      {locked !== null && (
        <span className="-mt-1.5 font-display text-[10px] uppercase tracking-[0.12em] text-brass-300">
          Lv {locked}
        </span>
      )}
    </>
  );

  if (destination.to === undefined) {
    return (
      <span
        className="group flex w-[72px] cursor-not-allowed flex-col items-center gap-1 opacity-40"
        title={destination.title}
        aria-disabled="true"
        data-testid={testId(destination.label)}
      >
        {body(false)}
      </span>
    );
  }

  return (
    <NavLink
      to={destination.to}
      // `end` only on the city map: it is the index route, so without it every child route would
      // light the city up as well as itself.
      end={destination.to === '/game'}
      title={
        locked === null ? destination.title : `${destination.title} — opens at level ${locked}`
      }
      className="group flex w-[72px] flex-col items-center gap-1 focus-visible:outline-none"
      data-testid={testId(destination.label)}
    >
      {({ isActive }) => body(isActive)}
    </NavLink>
  );
}

export function BottomNav() {
  const admin = useAdmin();
  const me = useMe();
  const destinations = admin.data ? [...DESTINATIONS, BENCH] : DESTINATIONS;
  // §I3 — read once for the row. `useMe` is already resolved by every screen behind `/game`, so
  // this is a cache read rather than a request.
  const level = me.data?.base?.level ?? 1;
  const lockedAt = (destination: NavDestination): number | null => {
    if (destination.area === undefined) return null;
    const opensAt = areaUnlockLevel(destination.area);
    return level < opensAt ? opensAt : null;
  };

  return (
    <nav
      aria-label="Places"
      // `flex-wrap`. Fourteen doors no longer fit one 1024px row, and without it the row does not
      // spill — it *shrinks*, squeezing each door to 65px until "Workshop" wraps onto two lines
      // inside a target the pointer can barely tell from its neighbour. Wrapping puts the overflow
      // on a second row instead, which the shell absorbs for free because it measures this bar's
      // height rather than assuming it. Adding `shrink-0` here without the wrap is the version that
      // really does push a destination off the side of the screen.
      className="glass painted washed rivets pointer-events-auto relative flex shrink-0 flex-wrap items-end justify-center gap-x-1.5 gap-y-2 border-t-2 border-brass-500/45 px-4 pb-2 pt-2 shadow-panel"
    >
      {destinations.map((destination) => (
        <Destination
          key={destination.label}
          destination={destination}
          locked={lockedAt(destination)}
        />
      ))}
    </nav>
  );
}
