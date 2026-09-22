import { STARTING_RESOURCES, battlefieldFor, type Army, type BattleView } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeployDialog } from './DeployDialog';
import { useSession } from '../../store/session';

/**
 * §C3: the seats are the ceiling (maintainer request, 2026-09-15).
 *
 * The board's rule is one sentence, *"once you choose vehicles you're limited up to that much"*,
 * and it hides three decisions that a screenshot cannot tell apart:
 *
 * - a seat is priced in **unit slots** and not in heads, so a Cheese Wagon at thirty takes ten
 *   Ironsides at three slots each and not thirty of them;
 * - a `no_ride` sheet is outside the rule in both directions, so a Colossus neither eats a seat nor
 *   is stopped by one;
 * - an empty yard is **no** ceiling, because a column that walks is what every column was before
 *   the Garage, and a rule that stopped it would take the window's Max away from a crew that has
 *   never built a machine.
 *
 * A window that got any of those wrong still draws a tidy grid of steppers, which is why they are
 * pinned here rather than left to the browser run.
 */

const NOW = '2026-08-13T10:00:00.000Z';
const MARK = '2026-08-13T18:00:00.000Z';

/** Razors are one unit slot each, Road Reavers two, the Colossus twelve and off every vehicle. */
const ARMY: Army = { razors: 9, road_reavers: 4, the_colossus: 1 };

const view: BattleView = {
  battle: {
    id: 'press',
    target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
    attackerBaseId: 'base-1',
    defender: { kind: 'looters' },
    scheduledFor: MARK,
    holdAfterCapture: false,
    wokeSleepers: false,
    declaredAt: NOW,
    resolvedAt: null,
    seed: 'press-seed',
  },
  targetName: 'Kessler Press',
  districtName: 'Steelbelt',
  battlefield: battlefieldFor({
    locationName: 'Kessler Press',
    kind: 'scrap_press',
    fortifyDifficulty: 'medium',
    fortifyLevel: 0,
    at: new Date(MARK),
    weather: 'normal',
  }),
  role: 'attacker',
  side: 'attacker',
  deploymentOpen: true,
  muster: { army: {}, perimeter: {}, size: 0 },
  enemySize: 10,
  enemyIntel: 'A rough count.',
  opponentName: 'Looters',
  boosts: [],
  boostIds: [],
  boostSlots: 1,
  officerId: null,
  vehicles: {},
  yard: {},
  leaders: [],
  traps: [],
  trapId: null,
};

const fetchMock = vi.fn();

/** Only `/units` is answered: nothing in this file presses a control that writes. */
function stubApi(anyRide = false): void {
  fetchMock.mockImplementation((path: string) => {
    if (String(path).endsWith('/units')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: '',
        json: () =>
          Promise.resolve({
            serverNow: NOW,
            units: [],
            army: ARMY,
            garrisoned: {},
            abroad: {},
            unitSlotsUsed: 0,
            unitSlotsCap: 100,
            gateArmy: {},
            moveDestinations: [],
            standingAt: {},
            fleet: {},
            queue: [],
            resources: STARTING_RESOURCES,
            trainingCostReduction: 0,
            trainingSpeedBonus: 0,
            built: [],
            anyRide,
          }),
      } as Response);
    }
    throw new Error(`unstubbed request: ${String(path)}`);
  });
}

function open(over: Partial<BattleView> = {}, army: Army = ARMY) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeployDialog
        view={{ ...view, ...over }}
        army={army}
        loadouts={{}}
        bagPercent={0}
        homeDistrictId="neon-docks"
        notoriety={100_000}
        mode="line"
        pending={false}
        error={null}
        onClose={() => undefined}
        onConfirm={() => undefined}
      />
    </QueryClientProvider>,
  );
}

function field(testId: string): HTMLInputElement {
  return screen.getByTestId(testId);
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  stubApi();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what the machines will seat', () => {
  it('puts no ceiling on a column with nothing loaded', () => {
    open();
    fireEvent.click(screen.getByTestId('deploy-max-razors'));
    expect(field('line-razors').value).toBe('9');
    expect(field('line-razors').max).toBe('9');
    expect(screen.getByTestId('deploy-seats')).toHaveTextContent(
      '9 unit slots, all of them on foot',
    );
  });

  it('stops Max at the seats once a machine is loaded', () => {
    // One Scrappy seats two, against nine Razors at home.
    open({ vehicles: { motorcycle: 1 } });
    expect(field('line-razors').max).toBe('2');
    fireEvent.click(screen.getByTestId('deploy-max-razors'));
    expect(field('line-razors').value).toBe('2');
    expect(screen.getByTestId('deploy-seats')).toHaveTextContent('2 of 2 unit slots loaded');
    // The row says why it stopped short of the nine at home, beside the count of them.
    expect(screen.getByTestId('seated-razors')).toHaveTextContent('seats 2');
  });

  it('counts a unit in unit slots, not in heads', () => {
    // A Scar seats eight: eight Razors at one apiece, or four Road Reavers at two.
    open({ vehicles: { scrap_car: 1 } });
    expect(field('line-razors').max).toBe('8');
    expect(field('line-road_reavers').max).toBe('4');
  });

  it('spends the seats on whoever is picked first', () => {
    open({ vehicles: { scrap_car: 1 } });
    fireEvent.change(field('line-road_reavers'), { target: { value: '3' } });
    // Six of the eight are sitting down, so two are left and the Razors may have those two.
    expect(field('line-razors').max).toBe('2');
    expect(screen.getByTestId('deploy-seats')).toHaveTextContent('6 of 8 unit slots loaded');
  });

  it('leaves a sheet that will not ride out of the rule entirely', () => {
    // The Colossus carries `no_ride` and costs twelve unit slots. With two seats in the yard it is
    // neither stopped by them nor charged against them: it walks, as it always did.
    open({ vehicles: { motorcycle: 1 } });
    expect(field('line-the_colossus').max).toBe('1');
    fireEvent.click(screen.getByTestId('deploy-max-the_colossus'));
    expect(field('line-the_colossus').value).toBe('1');
    expect(screen.getByTestId('deploy-seats')).toHaveTextContent('0 of 2 unit slots loaded');
    // ...and the Razors still have both seats.
    expect(field('line-razors').max).toBe('2');
  });

  it('will not give back a seat that is carrying somebody', () => {
    open({ vehicles: { motorcycle: 1 } });
    const drop = screen.getByTestId('deploy-take-less-motorcycle');
    expect(drop).toBeEnabled();
    fireEvent.click(screen.getByTestId('deploy-max-razors'));
    // Two Razors are in the only machine, so it cannot be put back in the yard under them.
    expect(drop).toBeDisabled();
  });

  it('offers what is parked as well as what is loaded', () => {
    open({ vehicles: { motorcycle: 1 }, yard: { scrap_car: 2 } });
    expect(screen.getByTestId('deploy-take-motorcycle')).toBeInTheDocument();
    expect(screen.getByTestId('deploy-take-scrap_car')).toHaveTextContent('2 in the yard');
  });
});

/**
 * §C3: the crew that can seat anything (`any_ride`, bug pass 2026-09-19).
 *
 * `no_ride` is the one rule on a sheet that three different things in the game can *waive*: a
 * location bonus, a research rung and a perk all set `anyRide`, and the server reads it in both
 * places that matter. `ridingUnitSlots(muster, effects.anyRide)` is what `deploy.ts` refuses a
 * batch against, and `ridingGroups(fielded, anyRide)` is what the settle spends seats with.
 *
 * The window read neither. It asked the catalogue (`walksAlways`), which is a fact about the
 * sheet and not about this crew, so a crew holding the waiver got a Colossus that was charged no
 * seat on screen and twelve at the door: the stepper went to its Max, the footer said the yard
 * was empty, and the confirm came back `no_seats` with nothing on the window having said why.
 */
describe('a crew whose machines seat anything', () => {
  /*
   * The waiver rides on `/units`, so every assertion here is behind the fetch.
   *
   * `open` renders before the query has answered, and the first paint is the catalogue's reading
   * by construction: `roster.data` is undefined and `anyRide` falls to `false`. Waiting for the
   * row to change is the assertion, not a workaround for one, and the last test in this block is
   * the control that proves the wait is not simply waiting for nothing.
   */
  it('charges the Colossus its twelve seats and stops the stepper there', async () => {
    stubApi(true);
    // An Armoured Car seats thirty. The Colossus is twelve of them for this crew, not nothing.
    open({ vehicles: { armoured_car: 1 } });
    await waitFor(() => expect(screen.queryByTestId('walks-the_colossus')).toBeNull());
    expect(field('line-the_colossus').max).toBe('1');
    fireEvent.click(screen.getByTestId('deploy-max-the_colossus'));
    expect(screen.getByTestId('deploy-seats')).toHaveTextContent('12 of 30 unit slots loaded');
    // ...and the eighteen left are what the Razors may have, not the whole thirty.
    fireEvent.click(screen.getByTestId('deploy-max-razors'));
    expect(screen.getByTestId('deploy-seats')).toHaveTextContent('21 of 30 unit slots loaded');
  });

  it('stops offering the Colossus a seat it does not have', async () => {
    stubApi(true);
    // One Scrappy seats two. Twelve will not fit, so the stepper may not leave zero.
    open({ vehicles: { motorcycle: 1 } });
    await waitFor(() => expect(field('line-the_colossus').max).toBe('0'));
  });

  it('does not tell this crew the Colossus walks', async () => {
    stubApi(true);
    open({ vehicles: { armoured_car: 1 } });
    await waitFor(() => expect(screen.queryByTestId('walks-the_colossus')).toBeNull());
  });

  it('still says it walks for a crew without the waiver', async () => {
    open({ vehicles: { armoured_car: 1 } });
    // Awaited the same way as the three above, so this is the same moment in the render and the
    // difference between them is the payload and nothing else.
    await screen.findByTestId('deploy-seats');
    expect(screen.getByTestId('walks-the_colossus')).toBeInTheDocument();
    expect(field('line-the_colossus').max).toBe('1');
    fireEvent.click(screen.getByTestId('deploy-max-the_colossus'));
    expect(screen.getByTestId('deploy-seats')).toHaveTextContent('0 of 30 unit slots loaded');
  });
});
