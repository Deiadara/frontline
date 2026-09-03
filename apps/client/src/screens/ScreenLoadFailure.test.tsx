import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { ActionsPage } from '../features/actions/ActionsPage';
import { BarPage } from '../features/bar/BarPage';
import { BasePanel } from '../features/base/BasePanel';
import { BlackMarketPage } from '../features/market/BlackMarketPage';
import { CrewPage } from '../features/crew/CrewPage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { MarketPage } from '../features/market/MarketPage';
import { MissionsPage } from '../features/missions/MissionsPage';
import { OverseerProfilePage } from '../features/overseer/OverseerProfilePage';
import { ResearchPage } from '../features/research/ResearchPage';
import { TrainingPage } from '../features/overseer/TrainingPage';
import { UnitsPage } from '../features/units/UnitsPage';
import { WorkshopPage } from '../features/workshop/WorkshopPage';
import { useSession } from '../store/session';

/**
 * Every screen behind the nav has to say when it could not load.
 *
 * The bug this exists for hid for months: `GET /battles` was answering 500 for one account, and the
 * page drew every state that was not data as "Reading the board…", so a server error was
 * indistinguishable from a slow network and stayed that way for ever. Nobody could describe it, so
 * nobody reported it.
 *
 * `LoadFailure` and a Playwright sweep were the answer, and the sweep is a hand-written list of
 * eight routes, so the ten screens added afterwards each shipped the same bug again. Two of them
 * were worse than a spinner: the Bar drew "Nobody in tonight" over a dead stool and a payroll of 0,
 * and the mission board drew "Nowhere is hiring. Scout something." Both are sentences about the
 * game world, in the game's own voice, in answer to a broken request.
 *
 * This is the unit-level version of that sweep, and it is a *table*: adding a screen here is one
 * line, which is the thing the Playwright list is not. Every request 500s, so nothing on screen can
 * be a real game state.
 */

const fetchMock = vi.fn();

/** Every endpoint refuses, the way a broken server refuses: a 500 carrying an error envelope. */
const SERVER_ERROR = {
  ok: false,
  status: 500,
  statusText: 'Internal Server Error',
  json: () => Promise.resolve({ error: { code: 'INTERNAL', message: 'Something went wrong' } }),
} as Response;

const SCREENS: readonly [string, ComponentType][] = [
  ['the district', BasePanel],
  ['the Bar', BarPage],
  ['the crew', CrewPage],
  ['the road', ActionsPage],
  ['the mission board', MissionsPage],
  ['the archive', ResearchPage],
  ['the market', MarketPage],
  ['the back room', BlackMarketPage],
  ['the satchel', InventoryPage],
  ['the units tab', UnitsPage],
  ['the gym', TrainingPage],
  ['the workshop', WorkshopPage],
  ['the overseer file', OverseerProfilePage],
];

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(SERVER_ERROR);
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('a screen that cannot load says so', () => {
  it.each(SCREENS)('%s', async (_name, Screen) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/game']}>
          <Screen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('load-failure')).toBeInTheDocument());
    // ...and offers the one remedy that fits, rather than telling the player to reload the game.
    expect(screen.getByTestId('load-retry')).toBeInTheDocument();
  });
});
