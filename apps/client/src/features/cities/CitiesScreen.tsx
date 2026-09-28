import { useNavigate } from 'react-router-dom';
import { useViewedCity } from '../../store/viewedCity';
import { useHomeCity } from '../../lib/queries';
import { CitiesView } from './CitiesView';

/**
 * The world, as its own page (maintainer, 2026-09-25).
 *
 * It was state on the map (`CityView`'s `pulledOut`), which put the wall of cities and the map it
 * covers on one history entry: a player who went out to the world and pressed Back left the game
 * instead of going back to the city they came from. It is a page now, at `/game/city`, so the
 * three steps of the same zoom are three steps in the history: the world, a city's map, a district.
 *
 * Picking a city records it and goes to the map, which reads the same store. The route carries no
 * city of its own because there is nothing to carry: this screen is every city there is.
 */
export function CitiesScreen() {
  const navigate = useNavigate();
  const look = useViewedCity((state) => state.look);
  const home = useHomeCity();

  return (
    <div
      className="h-full w-full overflow-y-auto px-5"
      style={{
        paddingTop: 'calc(var(--hud-h, 96px) + 20px)',
        paddingBottom: 'calc(var(--nav-h, 104px) + 20px)',
      }}
      data-testid="cities-view"
    >
      <CitiesView
        onEnterCity={(picked) => {
          // Null for the crew's own city, so the store holds "somewhere else" rather than a copy
          // of a fact the crew row already carries. See `store/viewedCity.ts`.
          look(picked === home ? null : picked);
          void navigate('/game');
        }}
      />
    </div>
  );
}
