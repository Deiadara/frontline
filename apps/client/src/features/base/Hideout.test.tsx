import {
  BUILDING_CATALOG,
  STARTING_RESOURCES,
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
 * The hideout village (GDD §A1) and the one action it offers (§D3, §I1).
 *
 * Stubbed at `fetch`, not at `lib/queries`: what matters here is the *body that goes on the wire*
 * and the fact that the response's own base is what the village re-renders from. A hook-level mock
 * can see neither, which is the shape of blind spot MOU-246 and MOU-276 were both filed for.
 */

const NOW = '2026-08-13T10:00:00.000Z';

const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: "Operator's Foothold",
  districtId: 'sector-7',
  level: 1,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  assignees: startingAssignees(),
  buildings: [
    { id: 'b-cc', kind: 'command_center', level: 1 },
    { id: 'b-reactor', kind: 'reactor', level: 1 },
  ],
  commanders: [],
  createdAt: NOW,
};

const me: MeResponse = {
  user: { id: 'user-1', username: 'operator', overseerId: 'ov-1', createdAt: NOW },
  overseer: null,
  base,
};

/** The village after the foundry went up — what the server sends back on a successful build. */
const built: BuildStructureResponse = {
  base: {
    ...base,
    resources: { ...STARTING_RESOURCES, oil: STARTING_RESOURCES.oil - 50 },
    buildings: [...base.buildings, { id: 'b-foundry', kind: 'foundry', level: 1 }],
  },
};

const BROKE = { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 };

const fetchMock = vi.fn();

interface Stubbed {
  detail?: Base;
  /** How `POST /base/build` answers. Defaults to accepting the build. */
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
      return build ? reply(build.body, { ok: build.ok, status: build.status }) : reply(built);
    }
    if (path.endsWith('/me')) return reply({ ...me, base: detail });
    if (path.includes('/base/')) return reply({ base: detail });
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderHideout() {
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

/** The body the page actually put on the wire for the one build it made. */
function buildBody(): BuildStructureRequest {
  const post = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
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

describe('§A1 — the hideout is a village, not a list', () => {
  it('stands every structure in the catalogue on its own clickable plot', async () => {
    stubApi();
    renderHideout();

    await waitFor(() => expect(plot('Command Center')).toBeInTheDocument());
    for (const spec of Object.values(BUILDING_CATALOG)) {
      expect(plot(spec.name)).toBeInTheDocument();
    }
  });

  it('says which plots are standing and which are empty ground', async () => {
    stubApi();
    renderHideout();

    await waitFor(() => expect(plot('Command Center')).toHaveAccessibleName(/level 1/));
    expect(plot('Foundry')).toHaveAccessibleName(/vacant plot/);
  });

  it('opens the plot dialog on click, and closes it again', async () => {
    stubApi();
    renderHideout();

    await waitFor(() => expect(plot('Foundry')).toBeInTheDocument());
    fireEvent.click(plot('Foundry'));

    expect(within(dialog()).getByRole('heading', { name: 'Foundry' })).toBeInTheDocument();
    expect(within(dialog()).getByText('Vacant plot')).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('§D3 — building and upgrading consume oil', () => {
  it('quotes the catalogue cost for an empty plot and sends the build', async () => {
    stubApi();
    renderHideout();

    await waitFor(() => expect(plot('Foundry')).toBeInTheDocument());
    fireEvent.click(plot('Foundry'));

    const cost = buildingCost('foundry', 1);
    expect(within(dialog()).getByText(String(cost.oil))).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Build' }));

    await waitFor(() => expect(buildBody()).toEqual({ kind: 'foundry' }));
  });

  it('re-renders the village from the response, without a refetch', async () => {
    stubApi();
    renderHideout();

    await waitFor(() => expect(plot('Foundry')).toHaveAccessibleName(/vacant plot/));
    fireEvent.click(plot('Foundry'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Build' }));

    await waitFor(() => expect(plot('Foundry')).toHaveAccessibleName(/level 1/));
  });

  it('offers an upgrade, not a build, on a plot that already has something on it', async () => {
    stubApi();
    renderHideout();

    await waitFor(() => expect(plot('Command Center')).toBeInTheDocument());
    fireEvent.click(plot('Command Center'));

    expect(within(dialog()).getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
    expect(within(dialog()).getByText('Upgrade to level 2')).toBeInTheDocument();
  });

  it('refuses to offer a build the stockpile cannot cover', async () => {
    stubApi({ detail: { ...base, resources: BROKE } });
    renderHideout();

    await waitFor(() => expect(plot('Foundry')).toBeInTheDocument());
    fireEvent.click(plot('Foundry'));

    expect(within(dialog()).getByRole('button', { name: 'Build' })).toBeDisabled();
  });

  it('explains a plot the Command Center is holding down instead of offering it', async () => {
    stubApi();
    renderHideout();

    // Reactor is level 1 and so is the Command Center — §D3's ceiling, not a money problem.
    await waitFor(() => expect(plot('Fusion Reactor')).toBeInTheDocument());
    fireEvent.click(plot('Fusion Reactor'));

    expect(within(dialog()).getByText(/CAPPED BY THE COMMAND CENTER/)).toBeInTheDocument();
    expect(within(dialog()).getByRole('button', { name: 'Upgrade' })).toBeDisabled();
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
    renderHideout();

    await waitFor(() => expect(plot('Foundry')).toBeInTheDocument());
    fireEvent.click(plot('Foundry'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Build' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('You cannot cover the materials'),
    );
  });
});

describe('§I1 — building things pays XP', () => {
  it('announces a level the build itself paid for', async () => {
    stubApi({ build: { ok: true, status: 200, body: { ...built, levelUp: levelUp() } } });
    renderHideout();

    await waitFor(() => expect(plot('Foundry')).toBeInTheDocument());
    fireEvent.click(plot('Foundry'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Build' }));

    const banner = await screen.findByRole('region', { name: 'Level up' });
    expect(banner).toHaveTextContent('LEVEL 2');
  });

  it('says nothing when the build did not cross a level', async () => {
    stubApi();
    renderHideout();

    await waitFor(() => expect(plot('Foundry')).toBeInTheDocument());
    fireEvent.click(plot('Foundry'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Build' }));

    await waitFor(() => expect(plot('Foundry')).toHaveAccessibleName(/level 1/));
    expect(screen.queryByRole('region', { name: 'Level up' })).not.toBeInTheDocument();
  });
});

function levelUp() {
  return { level: 2, levelsGained: 1, grants: playerLevelGrants(2) };
}
