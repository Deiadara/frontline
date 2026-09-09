import {
  STARTING_RESOURCES,
  UNIT_UPGRADE_SLOTS,
  battlefieldFor,
  findUnit,
  type Army,
  type BattleView,
  type UnitLoadouts,
  type UnitOption,
  type UnitsResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeployDialog, type DeployMode } from './DeployDialog';
import { useSession } from '../../store/session';

/**
 * The window a fight is actually fought from (§A4, K2 to K5).
 *
 * The dialog had no tests of its own: everything about it was pinned through `BattlePage` by the
 * one deployment `Deploy.test.tsx` makes. What that leaves unguarded is exactly what this window
 * is now for. Which of the two places a delta lands in is a *mode*, so the same component sends
 * `changes` or `perimeterChanges` and a wire swapped between them looks identical on screen. Half
 * and Max are arithmetic nobody sees the working of. And the roster card behind a unit's name is
 * the one thing here that comes from a different request than the rest of the window.
 */

const NOW = '2026-08-13T10:00:00.000Z';
const MARK = '2026-08-13T18:00:00.000Z';

/** Nine at home halves to four; one at home halves to one, which is the rounding worth pinning. */
const ARMY = { razors: 9, scrapers: 1 };

const view: BattleView = {
  battle: {
    id: 'press',
    target: { kind: 'location', districtId: 'rustyard', locationId: 'rustyard-press' },
    attackerBaseId: 'base-1',
    defender: { kind: 'looters' },
    scheduledFor: MARK,
    holdAfterCapture: false,
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
  // Different counts in the two places on purpose: a window reading the wrong one still draws a
  // number, and only a fixture where the two differ can say which it read.
  muster: { army: { razors: 3 }, perimeter: { razors: 2 }, size: 5 },
  enemySize: 10,
  enemyIntel: 'A rough count.',
  opponentName: 'Looters',
  boosts: [],
  boostId: null,
  officerId: null,
  vehicles: {},
  yard: {},
  leaders: [],
  traps: [],
  trapId: null,
};

/** One roster entry, off the catalogue, so the card draws the stats the game actually ships. */
function option(unitId: string, owned: number): UnitOption {
  const spec = findUnit(unitId);
  if (!spec) throw new Error(`no such unit: ${unitId}`);
  return {
    id: spec.id,
    name: spec.name,
    tier: spec.tier,
    blurb: spec.blurb,
    trainedAt: spec.trainedAt,
    unique: spec.unique,
    // Vitality carries a figure that appears nowhere else in the game, so finding it in the card
    // says the card was drawn from the roster response rather than from anything the dialog
    // already had in hand.
    stats: { ...spec.stats, vitality: 1234 },
    modifiers: [],
    rules: [],
    affinities: [],
    cost: spec.cost,
    trainSeconds: spec.trainSeconds,
    supply: spec.supply,
    unlocked: true,
    missing: [],
    owned,
    // Three brackets, all of them empty. The count is what the schema checks, and a roster that
    // does not parse leaves the name with no card to open, which is precisely the thing the last
    // test in this file is looking for.
    slots: Array.from({ length: UNIT_UPGRADE_SLOTS }, () => ({
      upgradeId: null,
      name: '',
      line: null,
      tier: 0,
      effect: {},
    })),
  };
}

const roster: UnitsResponse = {
  serverNow: NOW,
  units: [option('razors', ARMY.razors), option('scrapers', ARMY.scrapers)],
  army: ARMY,
  garrisoned: {},
  abroad: {},
  supplyUsed: 10,
  supplyCap: 40,
  queue: [],
  resources: STARTING_RESOURCES,
  trainingCostReduction: 0,
  trainingSpeedBonus: 0,
  built: [],
};

const fetchMock = vi.fn();

function stubApi(): void {
  fetchMock.mockImplementation((path: string) => {
    if (String(path).endsWith('/units')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: '',
        json: () => Promise.resolve(roster),
      } as Response);
    }
    throw new Error(`unstubbed request: ${String(path)}`);
  });
}

const confirmed = vi.fn();

function open(
  mode: DeployMode,
  over: Partial<BattleView> = {},
  army: Army = ARMY,
  loadouts: UnitLoadouts = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DeployDialog
        view={{ ...view, ...over }}
        army={army}
        loadouts={loadouts}
        homeDistrictId="neon-docks"
        // Above every gate in the catalogue, so nothing in this fixture is locked out by rank.
        notoriety={100_000}
        mode={mode}
        pending={false}
        error={null}
        onClose={() => undefined}
        onConfirm={confirmed}
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
  confirmed.mockReset();
  stubApi();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the deploy dialog (§A4)', () => {
  it('Half takes half of what is at home, and never nothing while anybody is there', () => {
    open('line');
    fireEvent.click(screen.getByTestId('deploy-half-razors'));
    expect(field('line-razors').value).toBe('4');

    // One at home is the case the rounding gets wrong: half of one floors to nought, and a button
    // that sends nobody is a button that looks broken.
    fireEvent.click(screen.getByTestId('deploy-half-scrapers'));
    expect(field('line-scrapers').value).toBe('1');
  });

  it('Max takes everybody at home, and no more than that', () => {
    open('line');
    fireEvent.click(screen.getByTestId('deploy-max-razors'));
    expect(field('line-razors').value).toBe(String(ARMY.razors));
    // The stepper's own ceiling is the same figure, so Max lands on it rather than past it.
    expect(field('line-razors').max).toBe(String(ARMY.razors));
  });

  it('the line sends its deltas as the army and leaves the ring alone', async () => {
    open('line');
    expect(screen.getByTestId('deploy-dialog')).toBeInTheDocument();
    // What is already there, read off the muster's army rather than its perimeter.
    expect(
      within(screen.getByTestId('deploy-razors')).getByText(/3 in the line/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('ring-razors')).toBeNull();

    fireEvent.change(field('line-razors'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('deploy-confirm'));
    await waitFor(() => expect(confirmed).toHaveBeenCalledWith({ razors: 2 }, {}));
  });

  it('the periphery sends its deltas as the ring and leaves the line alone', async () => {
    open('ring');
    expect(screen.getByTestId('perimeter-dialog')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('deploy-razors')).getByText(/2 on the ring/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('line-razors')).toBeNull();

    // The withdrawal bound is the ring's own count, not the line's: pulling three off a ring of
    // two is a move the server refuses and the field must not offer.
    expect(field('ring-razors').min).toBe('-2');

    fireEvent.change(field('ring-razors'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('deploy-confirm'));
    await waitFor(() => expect(confirmed).toHaveBeenCalledWith({}, { razors: 2 }));
  });

  it('a unit name opens the roster card, with the sheet the Units page draws', async () => {
    open('line');
    const name = await screen.findByRole('button', { name: 'Razors' });
    fireEvent.mouseEnter(name);

    const card = await screen.findByTestId('unit-razors');
    // The figures on the card come from `/units`, and nothing else in this window carries them.
    expect(within(card).getByText('1234')).toBeInTheDocument();
    expect(within(card).getByTestId('marks-razors')).toBeInTheDocument();
    // The card is read, not acted on: no price box, so no Train order from a battle window.
    expect(within(card).queryByTestId('action-razors')).toBeNull();
  });
});

/**
 * §C3: who is not getting on the truck, and what the column is therefore held to.
 *
 * The Colossus carries the `no_ride` rule, so no seat in the city takes one and the whole column
 * walks at its pace. Both halves are asserted, because either alone is satisfied by a screen that
 * is wrong: a note that is always there says nothing about the machines, and a note that is never
 * there passes on a fixture with nothing loaded.
 */
describe('a unit that will not board', () => {
  const WALKER: Army = { ...ARMY, the_colossus: 1 };

  it('says nothing while the yard is empty, because everybody walks anyway', () => {
    open('line', { vehicles: {} }, WALKER);
    expect(screen.queryByTestId('walks-the_colossus')).toBeNull();
  });

  it('is marked once anything is loaded, and it alone', () => {
    open('line', { vehicles: { armoured_car: 1 } }, WALKER);
    expect(screen.getByTestId('walks-the_colossus')).toHaveTextContent('walks');
    // The bodies that do fit are not marked: the note is about the sheet, not about the fight.
    expect(screen.queryByTestId('walks-razors')).toBeNull();
  });

  it('holds the column at its own pace, and the window names it', () => {
    open('line', { vehicles: { armoured_car: 1 } }, WALKER);
    // Nothing picked yet, so there is no column and no pace to quote.
    expect(screen.getByTestId('deploy-column')).toHaveTextContent('');

    fireEvent.change(field('line-the_colossus'), { target: { value: '1' } });
    fireEvent.change(field('line-razors'), { target: { value: '4' } });

    const colossus = findUnit('the_colossus');
    const line = screen.getByTestId('deploy-column');
    expect(line).toHaveTextContent(
      `Held to ${colossus?.stats.speed} by 1 ${colossus?.name} walking`,
    );
    expect(line).toHaveTextContent('on the road at most');
  });
});
