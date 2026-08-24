import { playerLevelGrants } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api';

const launchMission = vi.hoisted(() => vi.fn());
const getMe = vi.hoisted(() => vi.fn());
const getAssignees = vi.hoisted(() => vi.fn());
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  launchMission,
  getMe,
  getAssignees,
}));

const { ApiRequestError } = await import('./api');
const { useAssignees, useLaunchMission, useMe } = await import('./queries');
const { useSession } = await import('../store/session');

const LEVELLED = { level: 4, levelsGained: 1, grants: playerLevelGrants(4), unlocks: [] };

/**
 * The app's own query defaults, copied from `main.tsx`. They are the reason this file exists: a
 * `staleTime` long enough to outlive the moment is what turns a missed refresh into a screen that
 * keeps answering with the level before it.
 */
function mountedScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => ({ launch: useLaunchMission(), me: useMe(), roster: useAssignees() }), {
    wrapper,
  });
}

beforeEach(() => {
  launchMission.mockReset();
  getMe.mockReset().mockResolvedValue({ user: null, base: null });
  getAssignees.mockReset().mockResolvedValue({ assignees: [], unplaced: 0 });
  useSession.setState({ token: 'session-token', user: null });
});

/**
 * MOU-280/MOU-368/MOU-381 pin *which* caches a refused launch names. This pins the outcome the
 * naming is for: that the screens actually go back to the server.
 *
 * Naming a key is not the same as re-reading it. An invalidation that marks the cache stale without
 * refetching it (`refetchType: 'none'`) satisfies every one of those tests and still leaves the HUD
 * and §G exactly as stale as before the fix — nothing here re-reads on its own, which is the whole
 * premise: no poll on `me`, no refetch on focus, and `GameScreen` never unmounts inside `/game`.
 */
describe('a refused launch that had already settled the board', () => {
  it('makes the HUD and the §G roster re-read the server, not just go stale', async () => {
    launchMission.mockRejectedValueOnce(
      new ApiRequestError(409, 'MISSION_NEEDS_OFFICER', 'needs an officer', LEVELLED),
    );
    const { result } = mountedScreen();
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getAssignees).toHaveBeenCalledTimes(1));

    result.current.launch.mutate({ templateId: 'convoy-ambush' });
    await waitFor(() => expect(result.current.launch.isError).toBe(true));

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getAssignees).toHaveBeenCalledTimes(2));
  });
});
