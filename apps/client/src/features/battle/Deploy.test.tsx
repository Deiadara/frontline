import {
  STARTING_RESOURCES,
  battlefieldFor,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type ActionsResponse,
  type Base,
  type BattleView,
  type BattlesResponse,
  type DeployRequest,
  type MeResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BattlePage } from './BattlePage';
import { ActionsPage } from '../actions/ActionsPage';
import { useSession } from '../../store/session';

const NOW = '2026-08-13T10:00:00.000Z';
const MARK = '2026-08-13T18:00:00.000Z';

const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: 'sector-7',
  level: 4,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  buildings: [],
  buildQueue: [],
  army: { razors: 8 },
  trainingQueue: [],
  training: startingTraining(NOW),
  inventory: {},
  fittedUpgrades: [],
  unitLoadouts: {},
  fleet: {},
  commanders: [],
  createdAt: NOW,
};

const me: MeResponse = {
  admin: false,
  user: {
    id: 'user-1',
    username: 'operator',
    overseerId: 'ov-1',
    createdAt: NOW,
    displayName: null,
    icon: 'shield',
    timezone: 'Europe/Athens',
  },
  overseer: null,
  base,
};

const view = (id: string, targetName: string): BattleView => ({
  battle: {
    id,
    target: { kind: 'location', districtId: 'rustyard', locationId: `rustyard-${id}` },
    attackerBaseId: base.id,
    defender: { kind: 'looters' },
    scheduledFor: MARK,
    holdAfterCapture: false,
    declaredAt: NOW,
    resolvedAt: null,
    seed: `${id}-seed`,
  },
  targetName,
  districtName: 'Steelbelt',
  battlefield: battlefieldFor({
    locationName: targetName,
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
  boostId: null,
  officerId: null,
  vehicles: {},
  yard: {},
  leaders: [],
});

const battles: BattlesResponse = {
  coming: [view('press', 'Kessler Press')],
  reports: [],
  slots: [],
  infamy: 40,
  gates: [],
  structures: [],
  traps: [],
  serverNow: NOW,
};

/** Nobody on the road: what the screen holds before the column sets out. */
const nothingWalking: ActionsResponse = { movements: [], serverNow: NOW };

/** The same screen once `troop_movements` has the column the deploy started. */
const walking: ActionsResponse = {
  movements: [
    {
      id: 'move-1',
      battleId: 'press',
      targetName: 'Kessler Press',
      fromName: 'Sector Seven',
      toName: 'Steelbelt',
      side: 'attacker',
      army: { razors: 2 },
      perimeter: {},
      size: 2,
      departedAt: NOW,
      arrivesAt: '2026-08-13T10:20:00.000Z',
      recallable: true,
    },
  ],
  serverNow: NOW,
};

const fetchMock = vi.fn();
let column: ActionsResponse = nothingWalking;

function stubApi(): void {
  const reply = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve(body),
    } as Response);

  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/battles/deploy') && init?.method === 'POST') {
      // The server put the column on the road, so the road answers differently from now on.
      column = walking;
      return reply({ battles, base: { ...base, army: { razors: 6 } } });
    }
    if (path.endsWith('/battles')) return reply(battles);
    if (path.endsWith('/actions')) return reply(column);
    if (path.endsWith('/me')) return reply(me);
    throw new Error(`unstubbed request: ${path}`);
  });
}

/** The body the page actually put on the wire for the one deployment it made. */
function deployBody(): DeployRequest {
  const post = fetchMock.mock.calls.find(
    ([path, init]) =>
      String(path).endsWith('/battles/deploy') &&
      (init as RequestInit | undefined)?.method === 'POST',
  );
  if (!post) throw new Error('nothing was deployed');
  return JSON.parse((post[1] as RequestInit).body as string) as DeployRequest;
}

/**
 * Both screens behind one router, because the rule under test spans them.
 *
 * The Actions screen is warmed first, the way `usePrefetchScreens` warms it at login: a cache that
 * is empty when the column sets out would be re-read on mount whatever the mutation did, and the
 * assertion would pass without the invalidation it exists to pin.
 */
function renderGame() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/battles']}>
        <Link to="/battles">The board</Link>
        <Link to="/actions">On the road</Link>
        <Routes>
          <Route path="/battles" element={<BattlePage />} />
          <Route path="/actions" element={<ActionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  column = nothingWalking;
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * §A4: "Move them" is a promise that people leave.
 *
 * Three things have to happen together, and each of them has been the one that was missing: the
 * deployment goes on the wire, the dialog gets out of the way, and the column is on the Actions
 * screen when the player goes to look for it. The last one is a cache rule rather than a request
 * rule: the road is warm from login, so a mutation that does not invalidate `queryKeys.actions`
 * leaves a 30-second-stale "Nobody is out" on the screen the units just walked onto.
 */
describe('sending a column from the battle board (§A4)', () => {
  it('puts the deployment on the wire, closes the dialog and lands the column on the road', async () => {
    stubApi();
    renderGame();
    // The road, read once before anything moves: this is the cache the deploy has to invalidate.
    fireEvent.click(screen.getByRole('link', { name: 'On the road' }));
    expect(await screen.findByText(/Nobody is out/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'The board' }));

    fireEvent.click(await screen.findByTestId('deploy-open-press'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByTestId('line-razors'), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByTestId('deploy-confirm'));

    await waitFor(() =>
      expect(deployBody()).toEqual({
        battleId: 'press',
        changes: { razors: 2 },
        perimeterChanges: {},
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The screen the player is returned to has to say where they went. `muster` is only what has
    // landed, so without this the detail reads "Nobody yet" over a roster that just lost two.
    expect(await screen.findByTestId('battle-walking-razors')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'On the road' }));
    expect(await screen.findByTestId('walking-razors')).toBeInTheDocument();
  });
});
