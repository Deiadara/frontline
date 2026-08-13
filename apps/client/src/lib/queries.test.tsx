import { playerLevelGrants } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api';

// Only the launch is stubbed: the hook's siblings still import the real module.
const launchMission = vi.hoisted(() => vi.fn());
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  launchMission,
}));

const { ApiRequestError } = await import('./api');
const { queryKeys, useLaunchMission } = await import('./queries');

const LEVELLED = { level: 4, levelsGained: 1, grants: playerLevelGrants(4) };

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(() => useLaunchMission(), { wrapper }),
    /** Which caches the hook asked react-query to refetch, order-independent. */
    invalidated: () => invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey)),
  };
}

/** Both caches the HUD and the board are read from — the whole point of the refresh. */
const BOTH = [JSON.stringify(queryKeys.missions), JSON.stringify(queryKeys.me)];

beforeEach(() => {
  launchMission.mockReset();
});

/**
 * MOU-280/MOU-368 — `POST /missions` settles the board *before* it validates, and the settle is not
 * rolled back when the request is then refused. So a refusal downstream of that settle has already
 * moved the stockpile, morale and the §D8 tally, and may have crossed a level.
 *
 * Nothing else re-observes it: `me` is `staleTime: 30_000` with no poll and no refetch on focus
 * (`main.tsx`), the board's own `justResolved` rescue cannot fire because this very request
 * consumed the settlement, and `GameScreen` never unmounts inside `/game`. The refusal is therefore
 * the only chance the HUD gets to catch up.
 */
describe('a refused launch that had already settled the board', () => {
  it('still refreshes the board and the HUD it just moved', async () => {
    launchMission.mockRejectedValueOnce(
      new ApiRequestError(409, 'MISSION_NEEDS_OFFICER', 'needs an officer', LEVELLED),
    );
    const { result, invalidated } = harness();

    result.current.mutate({ templateId: 'convoy-ambush' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated()).toEqual(expect.arrayContaining(BOTH));
  });

  /*
   * The level-up is the loud half, but not the common one: a settle that pays a crew without
   * crossing a threshold moves the stockpile just the same, and that refusal carries no `levelUp`
   * at all. Gating the refresh on the banner would leave exactly that case stale.
   */
  it('refreshes them even when the settle crossed no level', async () => {
    launchMission.mockRejectedValueOnce(
      new ApiRequestError(409, 'MISSIONS_AT_CAPACITY', 'every crew is out'),
    );
    const { result, invalidated } = harness();

    result.current.mutate({ templateId: 'scrap-run' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated()).toEqual(expect.arrayContaining(BOTH));
  });

  it('still refreshes both when the launch is accepted', async () => {
    launchMission.mockResolvedValueOnce({ missions: [] });
    const { result, invalidated } = harness();

    result.current.mutate({ templateId: 'scrap-run' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated()).toEqual(expect.arrayContaining(BOTH));
  });
});
