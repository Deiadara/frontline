import {
  BUILDING_CATALOG,
  STARTING_RESOURCES,
  buildingBuildSeconds,
  buildingCost,
  playerLevelGrants,
  startingAssignees,
  startingEconomy,
  startingProgression,
  startingResearch,
  type Base,
  type BuildStructureRequest,
  type BuildStructureResponse,
  type MeResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePanel } from './BasePanel';
import { useSession } from '../../store/session';

/**
 * The district (GDD §A1) and the actions it offers (§D3 materials, §I1 XP, and the build queue).
 *
 * Stubbed at `fetch`, not at `lib/queries`: what matters here is the *body that goes on the wire*
 * and the fact that the response's own base is what the page re-renders from. A hook-level mock can
 * see neither, which is the shape of blind spot MOU-246 and MOU-276 were both filed for.
 */

const NOW = '2026-08-13T10:00:00.000Z';

/** A new district: the Nexus and the Generator, exactly what `POST /overseer` mints. */
const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: 'sector-7',
  level: 1,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  assignees: startingAssignees(),
  buildings: [
    { id: 'b-nexus', kind: 'nexus', level: 1, modifications: [] },
    { id: 'b-generator', kind: 'generator', level: 1, modifications: [] },
  ],
  buildQueue: [],
  army: {},
  trainingQueue: [],
  commanders: [],
  createdAt: NOW,
};

const me: MeResponse = {
  user: { id: 'user-1', username: 'operator', overseerId: 'ov-1', createdAt: NOW },
  overseer: null,
  base,
};

/**
 * The district after the Quarters were ordered — what the server sends back on a successful build.
 *
 * Note what it is *not*: a standing structure. Ordering a level puts it in the queue and takes the
 * materials; the level itself lands on a later read, which is the whole point of the queue.
 */
const queued: BuildStructureResponse = {
  base: {
    ...base,
    resources: { ...STARTING_RESOURCES, oil: STARTING_RESOURCES.oil - 10 },
    buildQueue: [
      {
        id: 'q-quarters',
        kind: 'quarters',
        level: 1,
        startedAt: NOW,
        durationSeconds: buildingBuildSeconds('quarters', 1, base.buildings),
      },
    ],
  },
};

const BROKE = { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 };

const fetchMock = vi.fn();

interface Stubbed {
  detail?: Base;
  /** How `POST /base/build` answers. Defaults to accepting the order. */
  build?: { ok: boolean; status: number; body: unknown };
}

function stubApi({ detail = base, build }: Stubbed = {}): void {
  const reply = (body: unknown, { ok = true, status = 200 } = {}) =>
    Promise.resolve({
      ok,
      status,
      statusText: '',
      json: () => Promise.resolve(body),
    } as Response);

  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/base/build')) {
      return build ? reply(build.body, { ok: build.ok, status: build.status }) : reply(queued);
    }
    if (path.endsWith('/base/faction')) return reply({ base: { ...detail, name: 'Vermilion' } });
    if (path.endsWith('/me')) return reply({ ...me, base: detail });
    if (path.includes('/base/')) return reply({ base: detail });
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderDistrict() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BasePanel />
    </QueryClientProvider>,
  );
}

const plot = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name} —`) });
const dialog = () => screen.getByRole('dialog');

/** The body the page actually put on the wire for the one order it made. */
function buildBody(): BuildStructureRequest {
  const post = fetchMock.mock.calls.find(
    ([path, init]) =>
      (init as RequestInit | undefined)?.method === 'POST' && String(path).endsWith('/base/build'),
  );
  if (!post) throw new Error('no build was sent');
  return JSON.parse((post[1] as RequestInit).body as string) as BuildStructureRequest;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('§A1 — the district is a place, not a list', () => {
  it('stands every structure in the catalogue on its own clickable plot', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Nexus')).toBeInTheDocument());
    for (const spec of Object.values(BUILDING_CATALOG)) {
      expect(plot(spec.name)).toBeInTheDocument();
    }
  });

  it('tells standing, vacant and locked plots apart', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Nexus')).toHaveAccessibleName(/level 1/));
    // Unlocked at Nexus 1 and not yet built.
    expect(plot('The Quarters')).toHaveAccessibleName(/vacant plot/);
    // Unlocked at Nexus 12 — the third state, and the one a six-structure village had no room for.
    expect(plot('The Garage')).toHaveAccessibleName(/locked, needs the Nexus at level 12/);
  });

  it('opens the plot dialog on click, and closes it again', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    fireEvent.click(plot('The Quarters'));

    expect(within(dialog()).getByRole('heading', { name: 'The Quarters' })).toBeInTheDocument();
    expect(within(dialog()).getByText('Vacant plot')).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the faction, and offers to rename it', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The Ninth Street Crew'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename faction' }));
    fireEvent.change(screen.getByLabelText('Faction name'), { target: { value: 'Vermilion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vermilion'),
    );
  });
});

describe('§D3 — building and upgrading consume materials, and take time', () => {
  it('quotes the catalogue cost and the clock, then sends the order', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    fireEvent.click(plot('The Quarters'));

    const cost = buildingCost('quarters', 1, base.buildings);
    expect(within(dialog()).getByText(String(cost.oil))).toBeInTheDocument();
    // The clock is what makes this a queue rather than a purchase, so it has to be quoted.
    expect(within(dialog()).getByText('Build time')).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));
    await waitFor(() => expect(buildBody()).toEqual({ kind: 'quarters' }));
  });

  it('shows the order in the queue, from the response and without a refetch', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toHaveAccessibleName(/vacant plot/));
    fireEvent.click(plot('The Quarters'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));

    // The plot says it is being worked on — not that it is standing, which it is not.
    await waitFor(() => expect(plot('The Quarters')).toHaveAccessibleName(/under construction/));
    expect(
      within(screen.getByTestId('build-queue')).getByText(/The Quarters → Lv 1/),
    ).toBeInTheDocument();
  });

  it('offers an upgrade, not a build, on a plot that already has something on it', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Nexus')).toBeInTheDocument());
    fireEvent.click(plot('The Nexus'));

    expect(within(dialog()).getByRole('button', { name: 'Queue upgrade' })).toBeInTheDocument();
    expect(within(dialog()).getByText('Upgrade to level 2')).toBeInTheDocument();
  });

  it('refuses to offer a build the stockpile cannot cover', async () => {
    stubApi({ detail: { ...base, resources: BROKE } });
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    fireEvent.click(plot('The Quarters'));

    expect(within(dialog()).getByRole('button', { name: 'Queue build' })).toBeDisabled();
  });

  it('explains a plot the Nexus is holding down instead of offering it', async () => {
    stubApi();
    renderDistrict();

    // The Generator is level 1 and so is the Nexus — §A1's ceiling, not a money problem.
    await waitFor(() => expect(plot('The Generator')).toBeInTheDocument());
    fireEvent.click(plot('The Generator'));

    expect(within(dialog()).getByText(/CAPPED BY THE NEXUS/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Queue upgrade' })).toBeDisabled();
  });

  it('explains a plot the Nexus has not unlocked yet', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Garage')).toBeInTheDocument());
    fireEvent.click(plot('The Garage'));

    expect(within(dialog()).getByText(/NEEDS THE NEXUS AT LEVEL 12/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Queue build' })).toBeDisabled();
  });

  it('surfaces the server refusal rather than failing silently', async () => {
    stubApi({
      build: {
        ok: false,
        status: 409,
        body: {
          error: { code: 'INSUFFICIENT_RESOURCES', message: 'You cannot cover the materials' },
        },
      },
    });
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    fireEvent.click(plot('The Quarters'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You cannot cover the materials'),
    );
  });
});

describe('§A1 — the grid and what the district makes', () => {
  it('reports draw against supply, and calls a brownout what it is', async () => {
    stubApi();
    renderDistrict();

    // Nexus 1 draws 4; one Generator level supplies 26. Comfortable, and reported as such.
    await waitFor(() => expect(screen.getByTestId('power-balance')).toHaveTextContent('4 / 26'));
    expect(screen.getByText(/spare\. The lights are on/)).toBeInTheDocument();
  });

  it('shows the Generator burning fuel with nothing yet producing it', async () => {
    stubApi();
    renderDistrict();

    // The only rate a brand-new district has is the fuel going the wrong way.
    await waitFor(() => expect(screen.getByTestId('production')).toBeInTheDocument());
    expect(within(screen.getByTestId('production')).getByText(/^-/)).toBeInTheDocument();
  });
});

describe('§I1 — building things pays XP', () => {
  it('announces a level the build itself paid for', async () => {
    stubApi({ build: { ok: true, status: 200, body: { ...queued, levelUp: levelUp() } } });
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    fireEvent.click(plot('The Quarters'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));

    const banner = await screen.findByRole('region', { name: 'Level up' });
    expect(banner).toHaveTextContent('LEVEL 2');
  });

  it('says nothing when the order did not cross a level', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    fireEvent.click(plot('The Quarters'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));

    await waitFor(() => expect(plot('The Quarters')).toHaveAccessibleName(/under construction/));
    expect(screen.queryByRole('region', { name: 'Level up' })).not.toBeInTheDocument();
  });
});

function levelUp() {
  return { level: 2, levelsGained: 1, grants: playerLevelGrants(2) };
}
