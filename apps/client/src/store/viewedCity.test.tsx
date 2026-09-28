/**
 * The city a player is looking at outlives the screen they chose it on.
 *
 * That is the whole of the bug this store was made for. Six screens each held it in a `useState`,
 * and a `useState` dies with the component: going into a district and back out, or into the Bar
 * and back to the map, put the player in their home city every time. The cases below mount a
 * component, choose a city, throw the component away, and mount a fresh one, which is what a route
 * change does. A `useState` cannot pass them.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewedCity, viewedCityKey } from './viewedCity';
import { useSession } from './session';

/** A screen that prints whichever city it is looking at, the way the map and the rooms read it. */
function Looking() {
  const cityId = useViewedCity((state) => state.cityId);
  return <span data-testid="looking">{cityId ?? 'home'}</span>;
}

beforeEach(() => {
  useViewedCity.getState().forget();
  localStorage.clear();
});
afterEach(() => {
  useViewedCity.getState().forget();
  localStorage.clear();
});

describe('the city being looked at', () => {
  it('starts on the crew’s own', () => {
    expect(useViewedCity.getState().cityId).toBeNull();
  });

  it('survives the screen that chose it being thrown away', () => {
    const first = render(<Looking />);
    act(() => useViewedCity.getState().look('terminus'));
    expect(screen.getByTestId('looking')).toHaveTextContent('terminus');

    // A navigation: this screen goes, another arrives. Component state would not make the trip.
    first.unmount();
    render(<Looking />);
    expect(screen.getByTestId('looking')).toHaveTextContent('terminus');
  });

  it('is the same city on two screens at once', () => {
    render(
      <>
        <Looking />
        <Looking />
      </>,
    );
    act(() => useViewedCity.getState().look('terminus'));
    const both = screen.getAllByTestId('looking');
    expect(both).toHaveLength(2);
    for (const one of both) expect(one).toHaveTextContent('terminus');
  });

  it('goes back to the crew’s own when it is told null', () => {
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().look(null));
    expect(useViewedCity.getState().cityId).toBeNull();
  });
});

describe('which rooms are open', () => {
  it('knows nothing until a room has answered', () => {
    expect(useViewedCity.getState().rooms).toBeNull();
  });

  it('takes the list off a room payload', () => {
    act(() => useViewedCity.getState().noteRooms(['ashfall', 'terminus']));
    expect(useViewedCity.getState().rooms).toEqual(['ashfall', 'terminus']);
  });

  /**
   * Every room's poll calls this, ten times a minute between them. A fresh array each time would
   * be a new store value each time, which wakes every screen reading the store for nothing.
   */
  it('does not churn when a poll brings back the same list', () => {
    act(() => useViewedCity.getState().noteRooms(['ashfall', 'terminus']));
    const first = useViewedCity.getState().rooms;
    act(() => useViewedCity.getState().noteRooms(['ashfall', 'terminus']));
    expect(useViewedCity.getState().rooms).toBe(first);
  });

  it('takes a city off the list when the server refuses its room', () => {
    act(() => useViewedCity.getState().noteRooms(['ashfall', 'terminus']));
    act(() => useViewedCity.getState().shutRoom('terminus'));
    expect(useViewedCity.getState().rooms).toEqual(['ashfall']);
  });

  /**
   * A refusal is worth recording even before any room has answered: that is exactly the crew who
   * walked into a city off the map, has no door list yet, and must not be asked to keep trying.
   */
  it('records a refusal against an unknown list rather than dropping it', () => {
    act(() => useViewedCity.getState().shutRoom('terminus'));
    expect(useViewedCity.getState().rooms).toEqual([]);
  });
});

/**
 * A session ending takes the city with it.
 *
 * The next player in this tab is a different crew with different ground. Leaving the last one's
 * city behind would open their session on somebody else's map and send every room read to a door
 * that is shut to them.
 */
describe('logging out', () => {
  it('forgets where the previous crew was standing', () => {
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().noteRooms(['ashfall', 'terminus']));

    act(() => useSession.getState().logout());

    expect(useViewedCity.getState().cityId).toBeNull();
    expect(useViewedCity.getState().rooms).toBeNull();
  });
});

/**
 * The City tab returns to the last city the crew left it on, across a reload (maintainer,
 * 2026-09-25), and to its own city when it never looked anywhere else.
 *
 * A reload is modelled as `forget` (memory gone) followed by the shell settling on the same base.
 */
describe('across a reload', () => {
  it('comes back to the city the crew was last looking at', () => {
    act(() => useViewedCity.getState().settle('base-a'));
    act(() => useViewedCity.getState().look('terminus'));

    act(() => useViewedCity.getState().forget());
    act(() => useViewedCity.getState().settle('base-a'));

    expect(useViewedCity.getState().cityId).toBe('terminus');
  });

  it('starts a crew that never looked elsewhere on its own city', () => {
    act(() => useViewedCity.getState().settle('base-new'));
    expect(useViewedCity.getState().cityId).toBeNull();
  });

  it('returns home once the crew has gone back to its own city', () => {
    act(() => useViewedCity.getState().settle('base-a'));
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().look(null));
    expect(localStorage.getItem(viewedCityKey('base-a'))).toBeNull();

    act(() => useViewedCity.getState().forget());
    act(() => useViewedCity.getState().settle('base-a'));
    expect(useViewedCity.getState().cityId).toBeNull();
  });

  it('keeps one crew’s city away from another crew on the same machine', () => {
    act(() => useViewedCity.getState().settle('base-a'));
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useSession.getState().logout());

    act(() => useViewedCity.getState().settle('base-b'));
    expect(useViewedCity.getState().cityId).toBeNull();
  });

  it('does not undo a choice made since when the shell settles again', () => {
    act(() => useViewedCity.getState().settle('base-a'));
    act(() => useViewedCity.getState().look('terminus'));
    act(() => useViewedCity.getState().settle('base-a'));
    expect(useViewedCity.getState().cityId).toBe('terminus');
  });

  it('still works for the sitting when storage refuses', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      act(() => useViewedCity.getState().settle('base-a'));
      act(() => useViewedCity.getState().look('terminus'));
      expect(useViewedCity.getState().cityId).toBe('terminus');
    } finally {
      blocked.mockRestore();
    }
  });
});
