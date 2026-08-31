import {
  MISC_AREA_ID,
  missionOffers,
  templateTimings,
  createCommander,
  type CrewResponse,
  type HireRecruitResponse,
  type MissionsResponse,
  makeAttributes,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionsPage } from './MissionsPage';
import { queryKeys, useHireRecruit } from '../../lib/queries';
import { useSession } from '../../store/session';

/**
 * Where the mission board gets its officers from: the two ways that read goes wrong.
 *
 * §G6 makes `GET /crew` a *gate* on this page and not a decoration: with no officer on the
 * card, every hard template is refused. So the board has to be right about the roster even when
 * the roster is not there, a read that failed, and a read that is simply out of date, because
 * both of those states have already been rendered to the player as "you have nobody" once.
 */

const NOW = '2026-08-13T12:00:00.000Z';

const board: MissionsResponse = {
  missions: [],
  justResolved: [],
  resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
  activeLimit: 2,
  areas: [
    {
      id: MISC_AREA_ID,
      name: 'Miscellaneous Missions',
      blurb: 'Work that belongs to nobody.',
      difficulty: 1,
      payPercent: 0,
      offers: missionOffers(MISC_AREA_ID).map((template) => ({
        templateId: template.id,
        name: template.name,
        brief: template.brief,
        kind: template.kind,
        difficulty: template.difficulty,
        stance: template.stance,
        travelMinutes: templateTimings(template).travelMinutes,
        durationMinutes: template.durationMinutes,
        totalMinutes: templateTimings(template).totalMinutes,
        rewards: template.spoils,
        payoutSlots: 40,
        xp: 240,
        failedXp: 48,
      })),
      activeMissionId: null,
    },
  ],
  army: { razors: 4 },
  serverNow: NOW,
};

/** The first job on the miscellaneous board, whatever it happens to be. */
function anyOffer() {
  const offer = board.areas[0]?.offers[0];
  if (!offer) throw new Error('fixture error: the miscellaneous board offers nothing');
  return offer;
}

/** Open the send window for it: the one place the roster is read on this screen now. */
async function openSend(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId(`send-${anyOffer().templateId}`));
  return screen.getByRole('dialog');
}

const staffed: CrewResponse = {
  level: 6,
  housing: { used: 0, capacity: 8 },
  officers: [
    {
      officerId: 'off-1',
      name: 'Reza Malik',
      role: 'raid_boss',
      attributes: makeAttributes(15),
      perks: [],
      weeklyWage: 40,
      injuredUntil: null,
    },
  ],
};

const fetchMock = vi.fn();

const reply = (body: unknown, { ok = true, status = 500 } = {}) =>
  Promise.resolve({
    ok,
    status: ok ? 200 : status,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function renderBoard(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MissionsPage />
    </QueryClientProvider>,
  );
}

/** The app's own client: it never retries a read, which is what makes a failed roster permanent. */
const appClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the board cannot read the roster', () => {
  const refuseTheRoster = () =>
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/crew'))
        return reply({ error: { code: 'UNKNOWN', message: 'x' } }, { ok: false });
      if (path.endsWith('/missions')) return reply(board);
      throw new Error(`unstubbed request: ${path}`);
    });

  /**
   * `retry: false` and no poll on this query, so a refused read is refused for the life of the
   * page. "Reading the roster…" then describes something that stopped happening, and the other
   * branch is worse: reading a failure as an empty roster is the §G6 lie MOU-248 already found,
   * telling a fully staffed player to go and hire the officers they have.
   */
  it('says the read failed rather than that the player has no officers', async () => {
    refuseTheRoster();
    renderBoard(appClient());

    // The sentence names no remedy, matching the §G screen. The one it used to name: "Reload to
    // try again": was wrong: re-entering the page refetches, so a reload was never the only way.
    const dialog = await openSend();
    await within(dialog).findByText('Could not read your officers.');
    expect(screen.queryByText(/Hire one at the Bar/)).toBeNull();
    expect(screen.queryByText('Reading the roster…')).toBeNull();
    expect(screen.queryByText(/Reload/)).toBeNull();
    // A message *or* the picker, never both: a dropdown with no options under its own error line
    // is a dead control, and a visual defect on a bar that forbids them.
    expect(within(dialog).queryByTestId('send-leader')).toBeNull();
  });

  /**
   * The other half of the same lie, and the one that is quiet. Reading a failure as an empty
   * roster silently denies a stocked player the §G6 choice to put an officer on easy work for the
   * §G5/§G7 bonus, with nothing on screen to say why the option is missing.
   */
  it('never reads a failed roster as an empty one', async () => {
    refuseTheRoster();
    renderBoard(appClient());

    const dialog = await openSend();
    await within(dialog).findByText('Could not read your officers.');
    expect(within(dialog).queryByText(/Nobody on your books/)).toBeNull();
  });
});

describe('a signing reaches the board', () => {
  const signed: HireRecruitResponse = {
    accepted: true,
    wage: 40,
    officer: createCommander('off-9', 'Reza Malik', 'raid_boss'),
    payroll: {
      capacity: 300,
      committed: 40,
      available: 260,
      purchasedSteps: 0,
      nextStepCost: 500,
      stepSize: 30,
    },
  };

  /**
   * The Bar is where officers come from, and the mission board's §G6 picker is a *consumer* of
   * that list. Without this invalidation the cached roster stays authoritative for its whole
   * 30s `staleTime`, so a player who hires their first officer and walks straight to the board is
   * told, on all four hard cards, to go to the Bar and hire one.
   */
  /**
   * The §G list the Crew screen and the mission board's officer picker both read.
   *
   * Two claims, and the first is the one a player feels: the officer is *in the cached list* the
   * moment the hire lands, so the Crew screen shows them without waiting for a round trip. The
   * second is that the list is still reconciled against the server afterwards, because the counts
   * beside it are the server's arithmetic.
   */
  it('puts the new officer in the crew list at once, and still reconciles it', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/bar/hire')) return reply(signed);
      throw new Error(`unstubbed request: ${path}`);
    });
    const queryClient = appClient();
    queryClient.setQueryData(queryKeys.crew, { ...staffed, officers: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useHireRecruit(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recruitId: 'r-1', role: 'raid_boss', offerWage: 40 });
    });

    const cached = queryClient.getQueryData<CrewResponse>(queryKeys.crew);
    expect(cached?.officers.map((officer) => officer.officerId)).toEqual(['off-9']);
    expect(cached?.officers[0]?.name).toBe('Reza Malik');

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.crew)?.isInvalidated).toBe(true),
    );
  });
});
