import {
  assigneeBonusPercent,
  createCommander,
  type AssigneesResponse,
  type HireRecruitResponse,
  type MissionsResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionsPage } from './MissionsPage';
import { queryKeys, useHireRecruit } from '../../lib/queries';
import { useSession } from '../../store/session';

/**
 * Where the mission board gets its officers from — the two ways that read goes wrong.
 *
 * §G6 makes `GET /assignees` a *gate* on this page and not a decoration: with no officer on the
 * card, every hard template is refused. So the board has to be right about the roster even when
 * the roster is not there — a read that failed, and a read that is simply out of date — because
 * both of those states have already been rendered to the player as "you have nobody" once.
 */

const NOW = '2026-08-13T12:00:00.000Z';

const board: MissionsResponse = {
  missions: [],
  justResolved: [],
  resources: { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 },
  activeLimit: 4,
  serverNow: NOW,
};

const staffed: AssigneesResponse = {
  level: 6,
  pool: 8,
  placed: 3,
  unplaced: 5,
  capPerOfficer: 3,
  maxBonusPercent: assigneeBonusPercent(3),
  canReskill: false,
  officers: [
    {
      officerId: 'off-1',
      name: 'Reza Malik',
      role: 'raid_boss',
      assignees: 3,
      bonusPercent: assigneeBonusPercent(3),
      nextBonusPercent: assigneeBonusPercent(4),
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

const card = (name: string): HTMLElement => {
  const article = screen.getByRole('heading', { name }).closest('article');
  if (!article) throw new Error(`no card for ${name}`);
  return article;
};

const deploy = (name: string) => within(card(name)).getByRole('button', { name: 'Deploy' });

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
      if (path.endsWith('/assignees'))
        return reply({ error: { code: 'UNKNOWN', message: 'x' } }, { ok: false });
      if (path.endsWith('/missions')) return reply(board);
      throw new Error(`unstubbed request: ${path}`);
    });

  /**
   * `retry: false` and no poll on this query, so a refused read is refused for the life of the
   * page. "Reading the roster…" then describes something that stopped happening — and the other
   * branch is worse: reading a failure as an empty roster is the §G6 lie MOU-248 already found,
   * telling a fully staffed player to go and hire the officers they have.
   */
  it('says the read failed rather than that the player has no officers', async () => {
    refuseTheRoster();
    renderBoard(appClient());

    // The sentence names no remedy, matching the §G screen. The one it used to name — "Reload to
    // try again" — was wrong: re-entering the page refetches, so a reload was never the only way.
    await within(card('Convoy Ambush')).findByText('Could not read your officers.');
    expect(screen.queryByText(/Hire one at the Bar/)).toBeNull();
    expect(screen.queryByText('Reading the roster…')).toBeNull();
    expect(screen.queryByText(/Reload/)).toBeNull();
    // The gate still holds: nothing may be sent out under a leader the page could not name.
    expect(deploy('Convoy Ambush')).toBeDisabled();
    // Easy work is unaffected — §G6 lets it go out on a delegation, roster or no roster.
    expect(deploy('Scrap Run')).toBeEnabled();
  });

  /**
   * The quiet half of the same lie. An easy card keeps its picker on a failed read, so it renders
   * "Nobody — assignees alone, slower" and nothing else: a stocked player reads that as an empty
   * roster and is silently denied the §G6 choice to put an officer on easy work for the §G5/§G7
   * bonus. The card has to say the roster is missing, not merely behave as though it were empty.
   */
  it('tells an easy card why its picker is short instead of leaving it unexplained', async () => {
    refuseTheRoster();
    renderBoard(appClient());

    const easy = within(card('Scrap Run'));
    await easy.findByText('Could not read your officers.');
    // The choice itself survives — the card still offers the delegation, it just cannot offer
    // officers, and the line above now says so.
    expect(easy.getByRole('combobox')).toBeTruthy();
  });
});

describe('a signing reaches the board', () => {
  const signed: HireRecruitResponse = {
    accepted: true,
    wage: 40,
    officer: createCommander('off-9', 'Reza Malik', 'raid_boss'),
    firstPayment: 12,
    resources: null,
  };

  /**
   * The Bar is where officers come from, and the mission board's §G6 picker is a *consumer* of
   * that list. Without this invalidation the cached roster stays authoritative for its whole
   * 30s `staleTime`, so a player who hires their first officer and walks straight to the board is
   * told, on all four hard cards, to go to the Bar and hire one.
   */
  it('refreshes the roster the §G6 picker reads', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/bar/hire')) return reply(signed);
      throw new Error(`unstubbed request: ${path}`);
    });
    const queryClient = appClient();
    queryClient.setQueryData(queryKeys.assignees, { ...staffed, officers: [] });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useHireRecruit(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ recruitId: 'r-1', role: 'raid_boss', offerWage: 40 });
    });

    await waitFor(() =>
      expect(queryClient.getQueryState(queryKeys.assignees)?.isInvalidated).toBe(true),
    );
  });
});
