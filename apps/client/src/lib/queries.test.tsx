import { playerLevelGrants } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api';

// Only the two calls under test are stubbed: the hooks' siblings still import the real module.
const launchMission = vi.hoisted(() => vi.fn());
const getMissions = vi.hoisted(() => vi.fn());
const buildStructure = vi.hoisted(() => vi.fn());
const attackPlace = vi.hoisted(() => vi.fn());
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  launchMission,
  getMissions,
  buildStructure,
  attackPlace,
}));

const { ApiRequestError } = await import('./api');
const { queryKeys, useAttackPlace, useBuildStructure, useLaunchMission, useMissions } =
  await import('./queries');
const { useSession } = await import('../store/session');

const LEVELLED = { level: 4, levelsGained: 1, grants: playerLevelGrants(4) };

function harness<T>(hook: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    ...renderHook(hook, { wrapper }),
    /** Which caches the hook asked react-query to refetch, order-independent. */
    invalidated: () => invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey)),
  };
}

/** Both caches the HUD and the board are read from — the whole point of the refresh. */
const BOTH = [JSON.stringify(queryKeys.missions), JSON.stringify(queryKeys.me)];

/** Both halves a crossed level moves: the HUD's resources, and the §G layer derived from the level. */
const LEVEL_SENSITIVE = [JSON.stringify(queryKeys.me), JSON.stringify(queryKeys.assignees)];

beforeEach(() => {
  launchMission.mockReset();
  getMissions.mockReset();
  buildStructure.mockReset();
  attackPlace.mockReset();
  useSession.setState({ token: 'session-token', user: null });
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
    const { result, invalidated } = harness(useLaunchMission);

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
    const { result, invalidated } = harness(useLaunchMission);

    result.current.mutate({ templateId: 'scrap-run' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated()).toEqual(expect.arrayContaining(BOTH));
  });

  it('still refreshes both when the launch is accepted', async () => {
    launchMission.mockResolvedValueOnce({ missions: [] });
    const { result, invalidated } = harness(useLaunchMission);

    result.current.mutate({ templateId: 'scrap-run' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated()).toEqual(expect.arrayContaining(BOTH));
  });
});

/**
 * MOU-381 — a level-up invalidates the §G layer exactly as surely as it invalidates the HUD.
 *
 * `projectAssignees` (`apps/server/src/assignees/roster.ts`) derives the whole payload from nothing
 * but `base.level`: the pool (§G8), the per-officer cap (§G3) and the bonus curve (§G7). Nothing on
 * the client said so. The board announces "Assignee pool 8" off the settling response, and for the
 * rest of the 30s `staleTime` the cached roster keeps answering with the level before it — so the
 * player walks to §G, reads Unplaced 0, and finds every Place button disabled (`canPlace = !atCap &&
 * unplaced > 0`). Told they were handed people, then refused permission to place them.
 */
describe('a level-up refreshes the §G layer it moved', () => {
  /** The settling read: a crew came home on it, and its XP crossed a threshold (§I1). */
  const settledWithLevel = { missions: [], justResolved: [{ id: 'm-1' }], levelUp: LEVELLED };

  it('refreshes the roster when a settling poll crosses a level', async () => {
    getMissions.mockResolvedValue(settledWithLevel);
    const { result, invalidated } = harness(useMissions);

    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() => expect(invalidated()).toContain(JSON.stringify(queryKeys.assignees)));
  });

  /**
   * The same layer, reached the other way. A launch settles the board before it validates, so the
   * crossing can ride out on the *refusal* (MOU-280) — and that is the loudest case of all, because
   * `MissionsPage` renders the banner straight off `error.levelUp`. The grants it prints have to be
   * grants §G will honour.
   */
  it('refreshes it when a refused launch announces the level its settle banked', async () => {
    launchMission.mockRejectedValueOnce(
      new ApiRequestError(409, 'MISSION_NEEDS_OFFICER', 'needs an officer', LEVELLED),
    );
    const { result, invalidated } = harness(useLaunchMission);

    result.current.mutate({ templateId: 'convoy-ambush' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidated()).toContain(JSON.stringify(queryKeys.assignees));
  });

  /*
   * The other half of the contract. This effect is keyed on a crew actually coming home, so an
   * ordinary poll has to leave both caches alone — otherwise the fix is really "refetch §G every
   * fifteen seconds for the life of the page", which is a different change wearing this one's name.
   */
  it('leaves both alone on a poll that settled nothing', async () => {
    getMissions.mockResolvedValue({ missions: [], justResolved: [] });
    const { result, invalidated } = harness(useMissions);

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(invalidated()).toEqual([]);
  });

  /*
   * The other two thresholds §I1 pays out on. Both are plain mutations, so each is pinned on its
   * own call rather than on the shared helper: an edit that inlines one back to a single key has to
   * go red here, which it does not when only the helper's body is observed. Both halves are named
   * because either inlining is a real regression — dropping `assignees` is MOU-381, and dropping
   * `me` leaves a build's spent caps on screen for the whole 30s `staleTime` (MOU-280's class:
   * no poll on `me`, no refetch on focus, and `GameScreen` never unmounts inside `/game`). Two
   * blocks rather than one table because the two hooks return different payloads, and a table would
   * have to erase that difference to hold them both.
   */
  it('refreshes the roster and the HUD after a build that crossed one', async () => {
    buildStructure.mockResolvedValueOnce({ base: {}, levelUp: LEVELLED });
    const { result, invalidated } = harness(() => useBuildStructure('base-1'));

    result.current.mutate({} as never);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated()).toEqual(expect.arrayContaining(LEVEL_SENSITIVE));
  });

  it('refreshes the roster, the map and the HUD after taking a place', async () => {
    attackPlace.mockResolvedValueOnce({ result: {}, captured: true, returned: {}, base: {} });
    const { result, invalidated } = harness(() => useAttackPlace('base-1', 'rustyard'));

    result.current.mutate({} as never);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated()).toEqual(expect.arrayContaining(LEVEL_SENSITIVE));
    // §A4 — a place changing hands moves the map, the district and this crew's own units.
    expect(invalidated()).toEqual(
      expect.arrayContaining([
        JSON.stringify(queryKeys.city),
        JSON.stringify(queryKeys.units),
        JSON.stringify(queryKeys.district('rustyard')),
      ]),
    );
  });
});
