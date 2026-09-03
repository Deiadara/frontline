import type { ReinforceRequest, UnitsResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { FactionPage } from './FactionPage';
import { useSession } from '../../store/session';

/**
 * Sending help to an ally, from a page that is usually opened before `/units` has ever been read.
 *
 * The shell's `QueueRail` subscribes to `/me`, `/missions` and `/research` and **not** to `/units`,
 * so a player following a faction notification straight here has no cached army. Two things
 * followed from that:
 *
 * - the unit was `useState(fieldable[0]?.[0] ?? '')`, evaluated on the first render, when the roster
 *   was still undefined. The query resolving never corrected it, so every row rendered a `<select>`
 *   with nothing selected over a dead button, and the feature looked broken.
 * - the count was separate state with no re-clamp, so picking a unit the crew holds forty of,
 *   setting forty, then switching to one they hold two of left **40** in the field and sent it.
 *
 * The roster is served on a delay here on purpose: served synchronously, the first render already
 * has an army and the first bug cannot reproduce.
 */

const NOW = '2026-08-13T12:00:00.000Z';
const BATTLE = F.factionScreen.battles[0];
if (!BATTLE) throw new Error('the fixture has no ally battle');

/** Forty of one, two of another: the pair the count bug needs. */
const units: UnitsResponse = {
  serverNow: NOW,
  units: [],
  army: { razors: 40, snipers: 2 },
  garrisoned: {},
  abroad: {},
  supplyUsed: 42,
  supplyCap: 100,
  queue: [],
  resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
  trainingCostReduction: 0,
  trainingSpeedBonus: 0,
  built: [],
};

const fetchMock = vi.fn();

const reply = (body: unknown, delay = 0) =>
  new Promise<Response>((resolve) =>
    setTimeout(
      () =>
        resolve({
          ok: true,
          status: 200,
          statusText: '',
          json: () => Promise.resolve(body),
        } as Response),
      delay,
    ),
  );

/** The body of the one reinforcement the page sent. */
function sentBody(): ReinforceRequest {
  const post = fetchMock.mock.calls.find(([path]) => String(path).endsWith('/factions/reinforce'));
  if (!post) throw new Error('no reinforcement was sent');
  return JSON.parse((post[1] as RequestInit).body as string) as ReinforceRequest;
}

async function renderFaction() {
  const rendered = render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={['/game/faction']}>
        <FactionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The page opens on the members table; the ally fights are a rail section away.
  fireEvent.click(await screen.findByTestId('faction-section-fights'));
  return rendered;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/factions/reinforce')) return reply({ faction: F.factionScreen });
    // The roster lands after the page has already rendered once, which is the real order.
    if (path.endsWith('/units')) return reply(units, 20);
    if (path.endsWith('/factions')) return reply(F.factionScreen);
    if (path.endsWith('/me')) return reply(F.me);
    throw new Error(`unstubbed request: ${path}`);
  });
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('sending help to an ally', () => {
  it('has a unit selected once the roster lands, without the player touching the dropdown', async () => {
    await renderFaction();

    const picker = await screen.findByTestId<HTMLSelectElement>(
      `reinforce-unit-${BATTLE.battleId}`,
    );
    await waitFor(() => expect(picker.value).not.toBe(''));
    expect(screen.getByTestId(`reinforce-${BATTLE.battleId}`)).toBeEnabled();

    fireEvent.click(screen.getByTestId(`reinforce-${BATTLE.battleId}`));
    // The wire carries `army`, one unit at a time, so this is where the empty id used to surface.
    await waitFor(() => expect(Object.keys(sentBody().army)).toEqual([picker.value]));
    expect(units.army[picker.value] ?? 0).toBeGreaterThan(0);
  });

  it('brings the count down with the unit rather than sending more than the crew has', async () => {
    await renderFaction();

    const picker = await screen.findByTestId<HTMLSelectElement>(
      `reinforce-unit-${BATTLE.battleId}`,
    );
    await waitFor(() => expect(picker.value).not.toBe(''));

    const row = picker.closest('li');
    if (!row) throw new Error('the reinforcement row has no list item');
    const count = within(row).getByLabelText<HTMLInputElement>('How many');

    // Forty Razors, which the crew has, then switch to the two Snipers they have.
    fireEvent.change(picker, { target: { value: 'razors' } });
    fireEvent.change(count, { target: { value: '40' } });
    expect(count.value).toBe('40');

    fireEvent.change(picker, { target: { value: 'snipers' } });
    await waitFor(() => expect(count.value).toBe('2'));

    fireEvent.click(screen.getByTestId(`reinforce-${BATTLE.battleId}`));
    await waitFor(() => expect(sentBody().army).toEqual({ snipers: 2 }));
  });
});
