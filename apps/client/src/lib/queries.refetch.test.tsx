import { playerLevelGrants, type CrewResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from './api';

const launchMission = vi.hoisted(() => vi.fn());
const getMe = vi.hoisted(() => vi.fn());
const getCrew = vi.hoisted(() => vi.fn());
const deployToBattle = vi.hoisted(() => vi.fn());
const getActions = vi.hoisted(() => vi.fn());
const getBattles = vi.hoisted(() => vi.fn());
const buildAddon = vi.hoisted(() => vi.fn());
const startTech = vi.hoisted(() => vi.fn());
const getDistrict = vi.hoisted(() => vi.fn());
const placeVendorBid = vi.hoisted(() => vi.fn());
const getCrewStanding = vi.hoisted(() => vi.fn());
const reassignOfficer = vi.hoisted(() => vi.fn());
const releaseOfficer = vi.hoisted(() => vi.fn());
const startTraining = vi.hoisted(() => vi.fn());
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  launchMission,
  getMe,
  getCrew,
  deployToBattle,
  getActions,
  getBattles,
  buildAddon,
  startTech,
  getDistrict,
  placeVendorBid,
  getCrewStanding,
  reassignOfficer,
  releaseOfficer,
  startTraining,
}));

const { ApiRequestError } = await import('./api');
const {
  useActions,
  useBuildAddon,
  useCrew,
  useCrewStanding,
  useDeployToBattle,
  useDistrict,
  useLaunchMission,
  useMe,
  usePlaceVendorBid,
  useReassignOfficer,
  useReleaseOfficer,
  useStartTech,
  useStartTraining,
} = await import('./queries');
const { useSession } = await import('../store/session');

const LEVELLED = { level: 4, levelsGained: 1, grants: playerLevelGrants(4), unlocks: [] };

/**
 * Typed as `CrewResponse` on purpose. This mock stood for a year returning `{ assignees, unplaced }`
 * long after that shape was deleted, and every assertion here still passed, because they all count
 * calls rather than read the payload. A mock that cannot be wrong about the contract is a mock that
 * will be wrong about it eventually, so the annotation is the check.
 */
const EMPTY_CREW: CrewResponse = {
  level: 1,
  housing: { used: 0, capacity: 16 },
  officers: [],
};

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
  return renderHook(() => ({ launch: useLaunchMission(), me: useMe(), roster: useCrew() }), {
    wrapper,
  });
}

beforeEach(() => {
  launchMission.mockReset();
  getMe.mockReset().mockResolvedValue({ user: null, base: null });
  getCrew.mockReset().mockResolvedValue(EMPTY_CREW);
  deployToBattle.mockReset();
  getActions.mockReset().mockResolvedValue({ movements: [], missions: [] });
  getBattles.mockReset().mockResolvedValue({ coming: [], reports: [] });
  buildAddon.mockReset();
  startTech.mockReset();
  getDistrict.mockReset().mockResolvedValue({ district: { id: 'rustyard' } });
  placeVendorBid.mockReset();
  getCrewStanding.mockReset().mockResolvedValue({ crewSheet: {}, effects: {} });
  reassignOfficer.mockReset();
  releaseOfficer.mockReset();
  startTraining.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

/** The app's own defaults, so a missing poll cannot be papered over by a short `staleTime`. */
function screen<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(hook, { wrapper });
}

/**
 * MOU-280/MOU-368/MOU-381 pin *which* caches a refused launch names. This pins the outcome the
 * naming is for: that the screens actually go back to the server.
 *
 * Naming a key is not the same as re-reading it. An invalidation that marks the cache stale without
 * refetching it (`refetchType: 'none'`) satisfies every one of those tests and still leaves the HUD
 * and §G exactly as stale as before the fix: nothing here re-reads on its own, which is the whole
 * premise: no poll on `me`, no refetch on focus, and `GameScreen` never unmounts inside `/game`.
 */
describe('a refused launch that had already settled the board', () => {
  it('makes the HUD and the §G roster re-read the server, not just go stale', async () => {
    launchMission.mockRejectedValueOnce(
      new ApiRequestError(409, 'MISSION_NEEDS_OFFICER', 'needs an officer', LEVELLED),
    );
    const { result } = mountedScreen();
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCrew).toHaveBeenCalledTimes(1));

    result.current.launch.mutate({
      templateId: 'convoy-ambush',
      areaId: 'misc',
      force: { razors: 1 },
    });
    await waitFor(() => expect(result.current.launch.isError).toBe(true));

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getCrew).toHaveBeenCalledTimes(2));
  });
});

/**
 * §A4: sending a column is a write to the Actions screen, whoever pressed the button.
 *
 * Deploying happens on the battle board and puts a row in `troop_movements`, which is the entire
 * content of the Actions screen. The battle mutations named `units`, `city` and the level-sensitive
 * keys and not `actions`, so a player who had opened Actions once held a cached list that no longer
 * had their newest column in it. `staleTime` is 30s and nothing refetches on mount, so the units
 * were off the roster on one screen and not on the road on the other: gone from the game as far as
 * anything visible was concerned, until the 5s poll happened to land.
 */
describe('a deploy made from the battle board', () => {
  it('makes the Actions screen re-read the column it just put on the road', async () => {
    deployToBattle.mockResolvedValueOnce({
      battles: { coming: [], reports: [] },
      base: { id: 'base-1' },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => ({ deploy: useDeployToBattle(), actions: useActions() }), {
      wrapper,
    });
    await waitFor(() => expect(getActions).toHaveBeenCalledTimes(1));

    result.current.deploy.mutate({
      battleId: 'battle-1',
      changes: { razors: 2 },
      perimeterChanges: {},
    });
    await waitFor(() => expect(result.current.deploy.isSuccess).toBe(true));

    await waitFor(() => expect(getActions).toHaveBeenCalledTimes(2));
  });
});

/**
 * The same rule, at the two doors that were still only invalidating on success.
 *
 * `queries.ts` writes the rule down at the top of itself: the game has no schedulers, so every
 * write route settles before it validates, and a refusal has therefore already banked production,
 * paid wages, possibly finished a project and possibly crossed a level. `POST /scrapyard/build`
 * calls `settled()` on its first line and refuses on its third; `POST /research/tech` calls
 * `settledPlayer` and then throws `RESEARCH_OPTION_LOCKED`.
 *
 * Both were `onSuccess` only, which means the screen kept the stockpile from *before* the settle in
 * exactly the moment a player looks hardest at it: they have just been told they cannot afford
 * something, and the caps they actually hold may now cover it.
 */
describe('a refused write that had already settled the crew', () => {
  it('makes the HUD re-read after a refused add-on build', async () => {
    buildAddon.mockRejectedValueOnce(
      new ApiRequestError(409, 'SCRAPYARD_REFUSED', 'You cannot cover that', LEVELLED),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => ({ build: useBuildAddon(), me: useMe() }), { wrapper });
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));

    result.current.build.mutate({ kind: 'upgrade', id: 'armour_2' });
    await waitFor(() => expect(result.current.build.isError).toBe(true));

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
  });

  it('makes the HUD re-read after a refused research start', async () => {
    startTech.mockRejectedValueOnce(
      new ApiRequestError(409, 'RESEARCH_OPTION_LOCKED', 'Locked', LEVELLED),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => ({ tech: useStartTech(), me: useMe() }), { wrapper });
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));

    result.current.tech.mutate({ techId: 'ballistics' });
    await waitFor(() => expect(result.current.tech.isError).toBe(true));

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
  });
});

/**
 * `GET /city/:id` is a settle, not a read.
 *
 * `routes/city.ts` runs `settleWorld` (movements, scouting runs, gates) and then `settleBase` on
 * its first two lines, so a fortification finishing, an upgrade landing, a column arriving and a
 * scout walking back in all happen *on this request*. The screen drawn from it has four countdowns
 * on it and no other query behind them, so with no interval the last thing a player saw was
 * whatever was true when they opened the street: a scout at zero read "Walking back in" until they
 * navigated away and came back.
 *
 * Timers rather than a real wait, and the assertion is that a *second* call happens: the mount's
 * own fetch would satisfy a test that only counted one.
 */
describe('the district screen, which settles on its own read', () => {
  it('re-asks the server while the page is open', async () => {
    vi.useFakeTimers();
    try {
      const { result } = screen(() => useDistrict('rustyard'));
      await vi.waitFor(() => expect(getDistrict).toHaveBeenCalledTimes(1));
      expect(result.current).toBeDefined();
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(getDistrict.mock.calls.length).toBeGreaterThanOrEqual(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * `POST /market/bid` closes every finished visit before it looks at the bid.
 *
 * `settleVendorAuctions` runs on the route's second line, outside the transaction and ahead of
 * every refusal `placeVendorBid` can give. So "you are already leading this lot" is an answer given
 * after the server has handed lots over, taken the caps for them and put the goods in a satchel,
 * and the HUD beside the refusal is quoting the tin from before all of that.
 */
describe('a refused bid at the barrow', () => {
  it('makes the HUD re-read the caps the close just spent', async () => {
    placeVendorBid.mockRejectedValueOnce(
      new ApiRequestError(409, 'MARKET_REFUSED', 'You are already leading this lot'),
    );
    const { result } = screen(() => ({ bid: usePlaceVendorBid(), me: useMe() }));
    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(1));

    result.current.bid.mutate({ lineId: 'l1', amount: 1300 });
    await waitFor(() => expect(result.current.bid.isError).toBe(true));

    await waitFor(() => expect(getMe).toHaveBeenCalledTimes(2));
  });
});

/**
 * The crew fold is a different fact from the roster, and three writes move it.
 *
 * `crewSheetsFor` builds `/overseer/me` out of everybody on the books: a seated officer is paid
 * their full rating in the attributes their chair uses, a benched one the off-duty share of
 * everything, and a departed one takes their perks and the lift those perks put on every peer's
 * sheet with them. `crewStanding` has no poll and a 30s `staleTime`, so nothing else re-reads it.
 */
describe('the writes that change what the crew is buying', () => {
  it('re-reads the fold after an officer takes a different chair', async () => {
    reassignOfficer.mockResolvedValueOnce({ crew: EMPTY_CREW });
    const { result } = screen(() => ({
      move: useReassignOfficer(),
      standing: useCrewStanding(),
    }));
    await waitFor(() => expect(getCrewStanding).toHaveBeenCalledTimes(1));

    result.current.move.mutate({ officerId: 'off-1', role: 'professor' });
    await waitFor(() => expect(result.current.move.isSuccess).toBe(true));

    await waitFor(() => expect(getCrewStanding).toHaveBeenCalledTimes(2));
  });

  it('re-reads the fold after somebody is let go', async () => {
    releaseOfficer.mockResolvedValueOnce({ bar: {}, base: {}, fee: 1140 });
    const { result } = screen(() => ({
      release: useReleaseOfficer(),
      standing: useCrewStanding(),
    }));
    await waitFor(() => expect(getCrewStanding).toHaveBeenCalledTimes(1));

    result.current.release.mutate({ officerId: 'off-1' });
    await waitFor(() => expect(result.current.release.isSuccess).toBe(true));

    await waitFor(() => expect(getCrewStanding).toHaveBeenCalledTimes(2));
  });

  /**
   * And the roster, which is the third copy of the sheet an hour moves: `CrewPage`'s officer
   * window prints `AttributeSheet` straight off `useCrew`, which has no poll either.
   */
  it('re-reads the roster after an hour on the bench', async () => {
    startTraining.mockResolvedValueOnce({ serverNow: '2026-09-09T00:00:00.000Z', subjects: [] });
    const { result } = screen(() => ({ train: useStartTraining(), roster: useCrew() }));
    await waitFor(() => expect(getCrew).toHaveBeenCalledTimes(1));

    result.current.train.mutate({ subjectId: 'off-1', attribute: 'composure' });
    await waitFor(() => expect(result.current.train.isSuccess).toBe(true));

    await waitFor(() => expect(getCrew).toHaveBeenCalledTimes(2));
  });
});
