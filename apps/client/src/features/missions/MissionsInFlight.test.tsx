import {
  MISC_AREA_ID,
  missionCompletesAt,
  type CrewResponse,
  type Mission,
  type MissionsResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionsPage } from './MissionsPage';
import { useSession } from '../../store/session';

/**
 * The crews out, as a stack down the left of the missions page.
 *
 * They used to be a strip of chips in the shell's chrome under the board, and the strip wrapped:
 * with two or three crews out the chips ran under the board's own tab row and covered it. The
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
      <MissionsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/crew')) return reply(crew);
    if (path.endsWith('/missions')) return reply(board);
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
