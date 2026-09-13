import {
  MISC_AREA_ID,
  makeAttributes,
  missionCompletesAt,
  type CrewResponse,
  type Mission,
  type MissionLeader,
  type MissionsResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionsPage } from './MissionsPage';
import { useSession } from '../../store/session';

/**
 * The crews out, as a stack down the left of the missions page.
 *
 * They used to be a strip of chips in the shell's chrome under the board, and the strip wrapped:
 * with two or three crews out the chips ran under the maintainer's own tab row and covered it. The
 * stack replaces it, and two things about it are worth a test rather than a glance. It is sorted by
 * when each crew is *home*, not by when it left, because the server hands missions back in launch
 * order and a day-long expedition launched first sat on top for a day while short runs landed
 * underneath it. And it is a scroller of its own, so a long stack grows inside its box rather than
 * pushing the board down the page, which is the bug in a different coat.
 */

const NOW = '2026-08-13T12:00:00.000Z';
const minutesAgo = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

/** A crew out, with the clock frozen the way the server freezes it at launch. */
function out(
  id: string,
  templateId: string,
  launchedMinutesAgo: number,
  durationMinutes: number,
): Mission {
  return {
    id,
    baseId: 'base-1',
    templateId,
    areaId: MISC_AREA_ID,
    payPercent: 0,
    xp: 240,
    force: { razors: 1 },
    vehicles: {},
    pricedMinutes: 0,
    startedAt: minutesAgo(launchedMinutesAgo),
    travelMinutes: 5,
    durationMinutes,
    officerId: null,
    overseerLed: false,
    lost: {},
    found: {},
    reported: true,
    status: 'active',
    outcome: null,
    rewards: {},
    spoils: {},
    resolvedAt: null,
    recalledAt: null,
    pagePrize: null,
    pageWon: null,
  };
}

/*
 * Launched in this order, landing in the opposite one: the first out is a long expedition, the
 * last out is a short run. A stack in launch order and a stack in landing order are the same three
 * names reversed, which is what makes this fixture able to tell them apart.
 */
const EXPEDITION = out('m-long', 'deep-expedition', 30, 24 * 60);
const RUN = out('m-mid', 'foundry-raid', 20, 120);
const ERRAND = out('m-short', 'scrap-run', 10, 3);

const board: MissionsResponse = {
  missions: [EXPEDITION, RUN, ERRAND],
  justResolved: [],
  resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
  activeLimit: 3,
  areas: [],
  army: { razors: 6 },
  serverNow: NOW,
  leaders: [],
  unledRule: 'free',
  level: 12,
};

const crew: CrewResponse = { officers: [], bench: [], serverNow: NOW } as unknown as CrewResponse;

const fetchMock = vi.fn();
const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Whichever board this test is running against. Reset to the stack above for every one of them. */
let served: MissionsResponse = board;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  served = board;
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/crew')) return reply(crew);
    if (path.endsWith('/missions')) return reply(served);
    if (path.endsWith('/me')) return reply({});
    throw new Error(`unstubbed request: ${path}`);
  });
  useSession.setState({ token: 'token' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the crews in flight, stacked down the left', () => {
  it('has a fixture whose launch order is not its landing order, or it proves nothing', () => {
    const byLaunch = board.missions.map((mission) => mission.id);
    const byLanding = [...board.missions]
      .sort((a, b) => missionCompletesAt(a).getTime() - missionCompletesAt(b).getTime())
      .map((mission) => mission.id);
    expect(byLaunch).not.toEqual(byLanding);
  });

  it('lists every crew out, soonest home first', async () => {
    renderPage();
    const stack = await screen.findByRole('list', { name: 'Crews in flight' });
    const names = within(stack)
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');
    expect(names).toHaveLength(3);
    // Scrap Run lands in minutes, the sweep in an hour or two, the expedition tomorrow.
    expect(names[0]).toMatch(/Scrap Run/);
    expect(names[1]).toMatch(/Foundry Raid/);
    expect(names[2]).toMatch(/Deep Expedition/);
  });

  it('is a scroller of its own rather than a list that pushes the board down', async () => {
    renderPage();
    const stack = await screen.findByRole('list', { name: 'Crews in flight' });
    // jsdom lays nothing out, so the property under test is the one the layout hangs off: the
    // list is the element that scrolls, and it is allowed to be shorter than its contents.
    expect(stack.className).toMatch(/overflow-y-auto/);
    expect(stack.className).toMatch(/min-h-0/);
  });
});

/**
 * Who took a run out, and what the ones that came back brought with them.
 *
 * `/me` answers with nothing in this file, which is the state these assertions are for: the
 * Overseer's name has to arrive on the board that carried the run. It used to be read off the
 * session snapshot, so every Overseer-led row said `The Overseer` until a second query landed,
 * while the picker two panels away was already showing the name the player chose.
 */

const ROOK: MissionLeader = {
  id: 'ov-1',
  name: 'Rook',
  kind: 'overseer',
  arrivalPercent: 0,
  attributes: makeAttributes(22),
  held: 'run',
  heldUntil: null,
};

const REZA: MissionLeader = {
  id: 'off-1',
  name: 'Reza Malik',
  kind: 'officer',
  arrivalPercent: 0,
  attributes: makeAttributes(30),
  held: 'run',
  heldUntil: null,
};

/** A run that has come home, with what it kept and what it did not. */
function home(
  id: string,
  templateId: string,
  fields: Partial<Mission> & Pick<Mission, 'outcome'>,
): Mission {
  return {
    ...out(id, templateId, 500, 60),
    status: 'resolved',
    resolvedAt: minutesAgo(30),
    force: { razors: 3, scavengers: 1 },
    rewards: { scrap: 40 },
    spoils: { scrap: 40 },
    ...fields,
  };
}

const led: MissionsResponse = {
  ...board,
  leaders: [ROOK, REZA],
  missions: [
    { ...out('m-overseer', 'scrap-run', 10, 30), overseerLed: true },
    { ...out('m-officer', 'scrap-run', 10, 40), officerId: 'off-1' },
    out('m-alone', 'scrap-run', 10, 50),
    // Somebody who was let go while their crew was still on the road. The run remembers them; the
    // list of who may lead the *next* one does not, and cannot.
    { ...out('m-gone', 'scrap-run', 10, 60), officerId: 'off-vanished' },
  ],
};

describe('who was in charge of a run', () => {
  it('names the Overseer off the board rather than waiting for the session to load', async () => {
    served = led;
    renderPage();
    const row = await screen.findByTestId('mission-leader-m-overseer');
    expect(row).toHaveTextContent('Rook');
    expect(row).not.toHaveTextContent('The Overseer');
  });

  it('names the officer who led it', async () => {
    served = led;
    renderPage();
    expect(await screen.findByTestId('mission-leader-m-officer')).toHaveTextContent('Reza Malik');
  });

  it('says so when nobody led it', async () => {
    served = led;
    renderPage();
    expect(await screen.findByTestId('mission-leader-m-alone')).toHaveTextContent(
      'Nobody leading them',
    );
  });

  it('keeps the line for an officer who has since left the crew', async () => {
    served = led;
    renderPage();
    expect(await screen.findByTestId('mission-leader-m-gone')).toHaveTextContent(
      'Somebody off the books',
    );
  });
});

describe('what a returned crew came back with (§E5)', () => {
  const returned: MissionsResponse = {
    ...board,
    leaders: [ROOK, REZA],
    missions: [
      // A fight that cost bodies, one that cost none, one nobody survived to report, and a
      // standard run, which is the kind that never draws the line at all.
      home('r-mauled', 'foundry-raid', {
        outcome: 'failure',
        overseerLed: true,
        lost: { razors: 2 },
        rewards: {},
        spoils: {},
      }),
      home('r-clean', 'foundry-raid', { outcome: 'success', officerId: 'off-1' }),
      home('r-silent', 'foundry-raid', {
        outcome: 'failure',
        lost: { razors: 3, scavengers: 1 },
        reported: false,
        rewards: {},
        spoils: {},
      }),
      home('r-errand', 'scrap-run', { outcome: 'success' }),
    ],
  };

  /** The collapsed row for a crew, opened into its report. */
  async function openReport(id: string) {
    fireEvent.click(await screen.findByTestId(`mission-open-${id}`));
    return screen.findByTestId(`mission-report-${id}`);
  }

  /**
   * The row is three things now (maintainer, 2026-09-12), and the point of the change is what is *not*
   * on it: an assertion that only checked the window would pass on a row that still printed all
   * four lines underneath it.
   */
  it('says only which job, what it paid and whether it worked', async () => {
    served = returned;
    renderPage();
    const row = (await screen.findByTestId('mission-open-r-clean')).closest('li');
    expect(row).toHaveTextContent('Foundry Raid');
    expect(row).toHaveTextContent('Success');
    expect(row).toHaveTextContent('40');
    expect(screen.queryByTestId('mission-leader-r-clean')).toBeNull();
    expect(screen.queryByTestId('mission-losses-r-clean')).toBeNull();
  });

  it('says who came home and who did not, by name and count', async () => {
    served = returned;
    renderPage();
    const report = await openReport('r-mauled');
    const line = within(report).getByTestId('mission-losses-r-mauled');
    expect(line).toHaveTextContent('Home: Razors 1, Scavengers 1');
    expect(line).toHaveTextContent('Lost: Razors 2');
    // And who took them into it, which is the other half of a report on a fight.
    expect(within(report).getByTestId('mission-leader-r-mauled')).toHaveTextContent('Rook');
    // The force that went, which the row never carried at all.
    expect(report).toHaveTextContent('Razors 3, Scavengers 1');
  });

  it('answers the question outright when a fight cost nobody', async () => {
    served = returned;
    renderPage();
    const report = await openReport('r-clean');
    expect(within(report).getByTestId('mission-losses-r-clean')).toHaveTextContent(
      'Everybody came home',
    );
  });

  /**
   * A report is a document, so it answers the casualty question on every run it is drawn for.
   * The row used to gate that line on the run having been a fight, which is the right call on a
   * row trying to stay to three lines and the wrong one in the window behind it.
   */
  it('answers it on a standard run too, where the row never asked', async () => {
    served = returned;
    renderPage();
    const report = await openReport('r-errand');
    expect(within(report).getByTestId('mission-losses-r-errand')).toHaveTextContent(
      'Everybody came home',
    );
  });

  /**
   * The silent row is one sentence and nothing else, and it opens nothing. An outcome tag beside
   * an empty haul would be the game answering a question nobody survived to ask, and there is no
   * report to open: nobody came back to write one.
   */
  it('says only that nobody came back when there was no report, and opens no window', async () => {
    served = returned;
    renderPage();
    expect(await screen.findByTestId('mission-silent-r-silent')).toHaveTextContent(
      'Nobody came back',
    );
    expect(screen.queryByTestId('mission-open-r-silent')).toBeNull();
    expect(screen.queryByTestId('mission-losses-r-silent')).toBeNull();
    expect(screen.queryByTestId('mission-leader-r-silent')).toBeNull();
    const row = screen.getByTestId('mission-silent-r-silent').closest('li');
    expect(row).not.toHaveTextContent('Lost');
    expect(row).not.toHaveTextContent('Success');
  });
});

/**
 * A crew that is still out is a door to the Actions tab, where the road is drawn.
 *
 * The recall X sits beside that door rather than inside it: an anchor with a button in it is
 * invalid, and a press on the X must call the crew back rather than navigate.
 */
describe('a crew in flight', () => {
  it('links the row to the Actions tab without swallowing the recall control', async () => {
    // Launched on the tick this board was read, so the recall window is still open and there is
    // a control to place. Every other crew in this file left long enough ago to have shut it.
    served = { ...board, missions: [{ ...out('m-fresh', 'deep-expedition', 0, 24 * 60) }] };
    renderPage();

    const track = await screen.findByTestId('mission-track-m-fresh');
    expect(track).toHaveAttribute('href', '/game/actions');
    expect(track).toHaveTextContent('Deep Expedition');

    // Beside the door, not inside it: an anchor with a button in it is invalid, and the press has
    // to call the crew back rather than navigate.
    const recall = await screen.findByTestId('recall-mission-m-fresh');
    expect(track.contains(recall)).toBe(false);
  });
});
