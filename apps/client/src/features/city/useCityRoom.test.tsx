/**
 * Which city's room a screen stands in, and what happens when that door is shut.
 *
 * `useHomeCity` is stubbed rather than driven through `/me`, because what is under test here is
 * the join between the remembered city and the door list, not `cityOf`. The real wiring, with a
 * real server behind it, is walked in `e2e/city-memory.spec.ts`.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewedCity } from '../../store/viewedCity';
import { useCityRoom, useRememberDistrictCity } from './useCityRoom';

let home: string | null = 'ashfall';

vi.mock('../../lib/queries', () => ({
  useHomeCity: () => home,
}));

/** A room screen: it prints the city it would read, and can walk to another. */
function Room() {
  const { city, choose } = useCityRoom();
  return (
    <button type="button" data-testid="room" onClick={() => choose('terminus')}>
      {city ?? 'home'}
    </button>
  );
}

beforeEach(() => {
  home = 'ashfall';
  useViewedCity.getState().forget();
});
afterEach(() => useViewedCity.getState().forget());

describe('a room and the city it is in', () => {
  it('reads the crew’s own city when nothing has been chosen', () => {
    render(<Room />);
    // `home` rather than a city id: a bare read is what the server answers with the crew's own,
    // and it lands on the cache entry the boot prefetch warmed.
    expect(screen.getByTestId('room')).toHaveTextContent('home');
  });

  it('reads the remembered city before any door list has arrived', () => {
    act(() => useViewedCity.getState().look('terminus'));
    render(<Room />);
    expect(screen.getByTestId('room')).toHaveTextContent('terminus');
  });

  it('reads the remembered city while the door list says it is open', () => {
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().noteRooms(['ashfall', 'terminus']));
    render(<Room />);
    expect(screen.getByTestId('room')).toHaveTextContent('terminus');
  });

  /**
   * The case the maintainer named: a crew that has lost its last holding in a city must not be
   * left standing in a locked room. The map may keep drawing that city, which is how a player
   * decides to go and take it back, but the room falls back to one they can walk into.
   */
  it('falls back to the crew’s own when the remembered city’s door is shut', () => {
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().noteRooms(['ashfall']));
    render(<Room />);
    expect(screen.getByTestId('room')).toHaveTextContent('home');
  });

  it('falls back after a refusal takes the city off the list', () => {
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().noteRooms(['ashfall', 'terminus']));
    render(<Room />);
    expect(screen.getByTestId('room')).toHaveTextContent('terminus');

    act(() => useViewedCity.getState().shutRoom('terminus'));
    expect(screen.getByTestId('room')).toHaveTextContent('home');
  });

  /** A shut room does not move the map. Losing the bar is not a reason to stop looking. */
  it('leaves the city being looked at alone when a door is shut', () => {
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().shutRoom('terminus'));
    expect(useViewedCity.getState().cityId).toBe('terminus');
  });

  it('remembers a city the player walks to, and outlives the screen they chose it on', () => {
    const first = render(<Room />);
    act(() => screen.getByTestId('room').click());
    expect(useViewedCity.getState().cityId).toBe('terminus');

    first.unmount();
    render(<Room />);
    expect(screen.getByTestId('room')).toHaveTextContent('terminus');
  });

  /** The point of one store rather than five: the Bar's choice is the market's choice. */
  it('is the same city in two rooms at once', () => {
    render(
      <>
        <Room />
        <Room />
      </>,
    );
    act(() => screen.getAllByTestId('room')[0]!.click());
    for (const one of screen.getAllByTestId('room')) expect(one).toHaveTextContent('terminus');
  });
});

function District({ districtId }: { districtId: string }) {
  useRememberDistrictCity(districtId);
  return null;
}

/**
 * Walking into a district is walking into its city, which is what makes every way back out land on
 * the right map: the X, the back link and the browser's own back button all go to `/game`.
 */
describe('a district remembering its city', () => {
  it('remembers the city a district is in', () => {
    render(<District districtId="viaduct" />);
    expect(useViewedCity.getState().cityId).toBe('terminus');
  });

  it('records the crew’s own city as nothing chosen', () => {
    act(() => useViewedCity.getState().look('terminus'));
    render(<District districtId="steelbelt" />);
    expect(useViewedCity.getState().cityId).toBeNull();
  });

  it('leaves the remembered city alone for a district the atlas does not know', () => {
    act(() => useViewedCity.getState().look('terminus'));
    render(<District districtId="not-a-district" />);
    expect(useViewedCity.getState().cityId).toBe('terminus');
  });

  /**
   * `/me` is a separate query with no poll, so on a cold load of a district URL it can land after
   * the district does. Writing a city before the crew's own is known would store `terminus` for a
   * Terminus crew and then correct itself, which is churn to reach the state it started in.
   */
  it('waits for the crew’s own city to be known', () => {
    home = null;
    render(<District districtId="steelbelt" />);
    expect(useViewedCity.getState().cityId).toBeNull();
    expect(useViewedCity.getState().rooms).toBeNull();
  });
});
