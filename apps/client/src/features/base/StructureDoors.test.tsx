import {
  STARTING_RESOURCES,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type MeResponse,
  type CrewStandingResponse,
  OVERSEER_PRESETS,
  makeAttributes,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePanel } from './BasePanel';
import { useSession } from '../../store/session';

/**
 * §I3a: the doors out of a structure's own window.
 *
 * The brackets are filled and emptied here and the things that go in them are cut at the yard, so
 * a player who opens this window and finds nothing on the shelf is exactly the player who needs to
 * be sent somewhere. Asserted by *following* the link into a stand-in route rather than by reading
 * an href off a button: the control is a `<Button onClick>` that calls `useNavigate`, and a test
 * that read an attribute would pass on a button wired to nothing.
 */

const NOW = '2026-08-13T10:00:00.000Z';

const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: 'sector-7',
  level: 12,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  buildings: [
    { id: 'b-nexus', kind: 'nexus', level: 12, modifications: [], damage: 0 },
    { id: 'b-generator', kind: 'generator', level: 6, modifications: [], damage: 0 },
    { id: 'b-lab', kind: 'lab', level: 8, modifications: [], damage: 0 },
  ],
  buildQueue: [],
  army: {},
  trainingQueue: [],
  training: startingTraining('2026-08-16T00:00:00.000Z'),
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

const crewStanding = (): CrewStandingResponse => {
  const { presetId: _presetId, ...preset } = OVERSEER_PRESETS[0]!;
  return { overseer: { ...preset, id: 'ov-1' }, crewSheet: makeAttributes(15), effects: {} };
};

const fetchMock = vi.fn();

function stubApi(): void {
  const reply = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve(body),
    } as Response);

  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/overseer/me')) return reply(crewStanding());
    if (path.endsWith('/me')) return reply(me);
    if (path.includes('/base/')) return reply({ base });
    throw new Error(`unstubbed request: ${path}`);
  });
}

/** A stand-in that prints where it was reached from, query string included. */
function Landed({ name }: { name: string }) {
  return <p>{`${name}${useLocation().search}`}</p>;
}

/** The district, with stand-ins at the two places a structure's window can send a player. */
function renderDistrict() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/game/base']}>
        <Routes>
          <Route path="/game/base" element={<BasePanel />} />
          <Route path="/game/scrapyard" element={<Landed name="the scrapyard" />} />
          <Route path="/game/research" element={<Landed name="the archive" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const plot = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('§I3a: a structure sends you where the work is', () => {
  it('opens the Scrapyard on this structure’s own bench', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Generator')).toBeInTheDocument());
    fireEvent.click(plot('The Generator'));

    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByTestId('structure-build-addons-generator'));
    // The bench, not just the yard: the yard reads `?bench` and its bench ids are `BuildingKind`.
    expect(await screen.findByText('the scrapyard?bench=generator')).toBeInTheDocument();
  });

  /** §B8's door, unchanged by the rebuild: the Lab still opens the archive. */
  it('still opens research from the Lab', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Lab')).toBeInTheDocument());
    fireEvent.click(plot('The Lab'));

    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByTestId('lab-open-research'));
    expect(await screen.findByText('the archive')).toBeInTheDocument();
  });
});
