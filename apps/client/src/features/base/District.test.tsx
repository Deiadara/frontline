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
  type BuildQueue,
  type BuildStructureRequest,
  type BuildStructureResponse,
  type MeResponse,
  startingTraining,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePanel } from './BasePanel';
import { DistrictScene } from './DistrictScene';
import { formatDuration } from './format';
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
    { id: 'b-nexus', kind: 'nexus', level: 1, modifications: [], damage: 0, fortification: 0 },
    {
      id: 'b-generator',
      kind: 'generator',
      level: 1,
      modifications: [],
      damage: 0,
      fortification: 0,
    },
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

/**
 * The district after the Quarters were ordered: what the server sends back on a successful build.
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

const BROKE = { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 };

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

/** The reports drawer starts closed: the district is the screen, not a document under it. */
const openReports = () => fireEvent.click(screen.getByTestId('reports-toggle'));

const plot = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });
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

describe('§A1: the district is a place, not a list', () => {
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
    /*
     * §A1/§I3: locked, and the accessible name carries the **whole** route rather than the first
     * rung of it. A screen reader gets exactly what the hover note draws: the Nexus level, the two
     * structures and the crew level, in the catalogue's order.
     */
    expect(plot('The Garage')).toHaveAccessibleName(/locked, needs/);
    expect(plot('The Garage')).toHaveAccessibleName(/The Nexus at 12/);
    expect(plot('The Garage')).toHaveAccessibleName(/The Scrapyard at 6/);
    expect(plot('The Garage')).toHaveAccessibleName(/Crew level 14/);
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
});

describe('§D3: building and upgrading consume materials, and take time', () => {
  it('quotes the catalogue cost and the clock, then sends the order', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    fireEvent.click(plot('The Quarters'));

    const cost = buildingCost('quarters', 1, base.buildings);
    expect(within(dialog()).getByText(String(cost.oil))).toBeInTheDocument();
    // The clock is what makes this a queue rather than a purchase, so it has to be quoted.
    // Asserted on the duration rather than on the label beside it: the label is wording and has
    // already been reworded once, and a gate that only ever saw the word "Build time" would have
    // stayed green through a window that quoted no clock at all.
    expect(
      within(dialog()).getByText(
        formatDuration(buildingBuildSeconds('quarters', 1, base.buildings)),
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));
    await waitFor(() => expect(buildBody()).toEqual({ kind: 'quarters' }));
  });

  it('shows the order in the queue, from the response and without a refetch', async () => {
    stubApi();
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toHaveAccessibleName(/vacant plot/));
    fireEvent.click(plot('The Quarters'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));

    // The plot says it is being worked on, not that it is standing, which it is not.
    await waitFor(() => expect(plot('The Quarters')).toHaveAccessibleName(/under construction/));
    openReports();
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

  /**
   * A refusal is not a no-op, so it may not leave the screen showing what was true before it.
   *
   * `POST /base/build` runs `settleBase` on its first line and only then asks whether the order can
   * be given: by the time a 409 comes back the server has banked an hour of production, paid a wage
   * week and may have crossed a player level: the route puts a `levelUp` on the *error* for
   * exactly that reason. A mutation that only invalidates `onSuccess` therefore tells the player
   * "you cannot afford that" over a stockpile that has since moved, possibly past the price.
   *
   * Counted in reads of `/me`, because `/me` is what the HUD's stockpile is drawn from and a refetch
   * of it is the whole observable effect.
   */
  it('refreshes what the settle banked even when the order is refused', async () => {
    stubApi({
      build: { ok: false, status: 409, body: { error: { code: 'NO_FUNDS', message: 'Short' } } },
    });
    renderDistrict();

    await waitFor(() => expect(plot('The Quarters')).toBeInTheDocument());
    const before = fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/me')).length;

    fireEvent.click(plot('The Quarters'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Queue build' }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([path]) => String(path).endsWith('/me')).length,
      ).toBeGreaterThan(before),
    );
  });

  it('explains a plot the Nexus is holding down instead of offering it', async () => {
    stubApi();
    renderDistrict();

    // The Generator is level 1 and so is the Nexus: §A1's ceiling, not a money problem.
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

    expect(within(dialog()).getByText(/NEEDS THE NEXUS AT 12/)).toBeInTheDocument();
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

describe('§A1: the grid and what the district makes', () => {
  it('reports draw against supply, and calls a brownout what it is', async () => {
    stubApi();
    renderDistrict();

    // Nexus 1 draws 4; one Generator level supplies 26. Comfortable, and reported as such.
    await waitFor(() => expect(screen.getByTestId('reports-toggle')).toBeInTheDocument());
    openReports();
    await waitFor(() => expect(screen.getByTestId('power-balance')).toHaveTextContent('4 / 26'));
    expect(screen.getByText(/spare\. The lights are on/)).toBeInTheDocument();
  });

  it('shows the Generator burning fuel with nothing yet producing it', async () => {
    stubApi();
    renderDistrict();

    // The only rate a brand-new district has is the fuel going the wrong way.
    await waitFor(() => expect(screen.getByTestId('reports-toggle')).toBeInTheDocument());
    openReports();
    await waitFor(() => expect(screen.getByTestId('production')).toBeInTheDocument());
    expect(within(screen.getByTestId('production')).getByText(/^-/)).toBeInTheDocument();
  });
});

describe('§I1: building things pays XP', () => {
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

/**
 * Somebody else's district, on the city screen.
 *
 * The same scene, drawn read-only. Two things have to hold and neither is visible in a screenshot:
 * a plot on another crew's ground must not be a control. There is nothing there for you to order,
 * and an empty lot must not be drawn at all, because a survey flag on land you do not own reads as
 * an invitation to build on it.
 */
describe("a neighbour's district (§A4)", () => {
  const theirs = [
    { id: 'n1', kind: 'nexus' as const, level: 6, modifications: [], damage: 0, fortification: 0 },
    { id: 'n2', kind: 'gate' as const, level: 4, modifications: [], damage: 0, fortification: 0 },
  ];

  const renderTheirs = () =>
    render(
      <DistrictScene
        buildings={theirs}
        queue={[]}
        playerLevel={20}
        selected={null}
        onSelect={() => undefined}
        readOnly
      />,
    );

  it('draws what is standing, and nothing that is not', () => {
    renderTheirs();
    expect(screen.getByTestId('plot-nexus')).toBeInTheDocument();
    expect(screen.getByTestId('plot-gate')).toBeInTheDocument();
    // The Quarters are not built here, so there is no plot to show for them.
    expect(screen.queryByTestId('plot-quarters')).not.toBeInTheDocument();
  });

  it('offers no control over ground that is not yours', () => {
    // The *behaviour*, not the ARIA role. Asserting the role alone passed against an element that
    // had been given `role="img"` and kept its handler: the mutation kept the attribute and kept
    // the control, which is exactly the bug the test was written to catch.
    const onSelect = vi.fn();
    render(
      <DistrictScene
        buildings={theirs}
        queue={[]}
        playerLevel={20}
        selected={null}
        onSelect={onSelect}
        readOnly
      />,
    );

    const plot = screen.getByTestId('plot-nexus');
    fireEvent.click(plot);
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    // A caption on somebody else's building: still drawn, and not a button.
    expect(screen.queryByRole('button', { name: /^The Nexus,/ })).not.toBeInTheDocument();
  });

  /**
   * The name plate is a real `<button>`, which is the whole reason it replaced a traced polygon.
   *
   * A `<polygon role="button">` gets none of a button's behaviour: Enter and Space had to be
   * handled by hand, and forgetting one of them produced a district playable only with a mouse.
   * What is asserted here is therefore the element itself: a `button` needs no `tabindex`, no key
   * handler and no `aria-pressed` shim to be operable, and the browser cannot forget half of it.
   */
  it('makes every plate a real button, so the keyboard works without being reimplemented', () => {
    const onSelect = vi.fn();
    render(
      <DistrictScene
        buildings={theirs}
        queue={[]}
        playerLevel={20}
        selected={null}
        onSelect={onSelect}
      />,
    );

    const plot = screen.getByTestId('plot-nexus');
    expect(plot.tagName).toBe('BUTTON');
    expect(plot).not.toHaveAttribute('tabindex');
    fireEvent.click(plot);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  /**
   * The map and the dialog answer the same question (§A1).
   *
   * A prerequisite sitting in the build queue counts as met: `isUnlockedForQueue` is what the plot
   * dialog and the server route both read, and for a while the map read the standing district
   * instead. A player who had already paid for the Nexus level that opens a plot was shown a
   * padlock and a note listing the rung they had just bought, over a dialog offering to build it.
   */
  it('stops calling a plot locked once its prerequisite is in the queue', () => {
    const standing = [
      {
        id: 'n1',
        kind: 'nexus' as const,
        level: 3,
        modifications: [],
        damage: 0,
        fortification: 0,
      },
      {
        id: 'n2',
        kind: 'scrapyard' as const,
        level: 3,
        modifications: [],
        damage: 0,
        fortification: 0,
      },
    ];
    const draw = (queue: BuildQueue) =>
      render(
        <DistrictScene
          buildings={standing}
          queue={queue}
          playerLevel={20}
          selected={null}
          onSelect={() => undefined}
        />,
      );

    // The Gate wants the Nexus at 4 and a Scrapyard at 3. One rung short, it is locked.
    const shut = draw([]);
    expect(shut.getByTestId('plot-gate')).toHaveAccessibleName(/locked/);
    shut.unmount();

    // With that rung ordered, it is not: even though nothing has finished building.
    const queued = draw([
      {
        id: 'q1',
        kind: 'nexus',
        level: 4,
        startedAt: new Date().toISOString(),
        durationSeconds: 600,
      },
    ]);
    expect(queued.getByTestId('plot-gate')).toHaveAccessibleName(/vacant plot/);
  });

  /** §I3: a locked plate is still a control, and hovering it says what is in the way. */
  it('explains a locked plot on hover rather than being a dead square', async () => {
    render(
      <DistrictScene
        buildings={[
          { id: 'n1', kind: 'nexus', level: 1, modifications: [], damage: 0, fortification: 0 },
        ]}
        queue={[]}
        playerLevel={1}
        selected={null}
        onSelect={() => undefined}
      />,
    );

    const garage = screen.getByTestId('plot-garage');
    fireEvent.mouseEnter(garage);
    await waitFor(() => expect(screen.getByText('Not yet. You need:')).toBeInTheDocument());
    expect(screen.getByText('The Nexus at 12')).toBeInTheDocument();
    expect(screen.getByText('Crew level 14')).toBeInTheDocument();
  });

  it('still opens the dialog on your own district, which is the control case', () => {
    render(
      <DistrictScene
        buildings={theirs}
        queue={[]}
        playerLevel={20}
        selected={null}
        onSelect={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: /^The Nexus,/ })).toBeInTheDocument();
  });
});
