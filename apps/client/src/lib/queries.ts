import type {
  BaseDetailResponse,
  BattleMutationResponse,
  SettingsResponse,
  MarketMutationResponse,
  WorkshopMutationResponse,
  LaunchMissionRequest,
  LaunchMissionResponse,
  MeResponse,
} from '@frontline/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { ApiRequestError } from './api';
import {
  assignPoint,
  fortifyLocation,
  upgradeLocation,
  getDistrict,
  getUnits,
  scoutDistrict,
  setGarrison,
  trainUnits,
  buildStructure,
  getAssignees,
  placeAssignees,
  reskillAssignees,
  createOverseer,
  getBar,
  getBase,
  getCity,
  getMe,
  getMissions,
  hireRecruit,
  negotiateWithRecruit,
  launchMission,
  renameFaction,
  getResearch,
  startResearch,
  getTraining,
  startTraining,
  getCrewStanding,
  getMarket,
  buyFromVendor,
  barterResources,
  buySupply,
  postOffer,
  withdrawOffer,
  acceptOffer,
  getBlackMarket,
  takeFromBlackMarket,
  getSettings,
  updateProfile,
  changePassword,
  getAdmin,
  setAdminKnobs,
  getWorkshop,
  fitUpgrade,
  buildVehicle,
  recallMission,
  reassignOfficer,
  startTech,
  getBattles,
  declareBattle,
  deployToBattle,
  layTrap,
  garrisonStructure,
  sacrificeInfamy,
} from './api';
import { useSession } from '../store/session';

/** Canonical react-query keys (see docs/SPEC-client.md). */
export const queryKeys = {
  me: ['me'] as const,
  city: ['city'] as const,
  base: (id: string) => ['base', id] as const,
  missions: ['missions'] as const,
  bar: ['bar'] as const,
  district: (id: string) => ['district', id] as const,
  units: ['units'] as const,
  research: ['research'] as const,
  assignees: ['assignees'] as const,
  training: ['training'] as const,
  crewStanding: ['crew-standing'] as const,
  market: ['market'] as const,
  blackMarket: ['black-market'] as const,
  settings: ['settings'] as const,
  admin: ['admin'] as const,
  workshop: ['workshop'] as const,
  battles: ['battles'] as const,
};

/**
 * Refresh everything a level-up moved: the HUD, and the §G layer derived from the same level.
 *
 * `projectAssignees` (`apps/server/src/assignees/roster.ts`) computes the whole assignee payload
 * from nothing but `base.level` — the pool (§G8), the per-officer cap (§G3) and the bonus curve
 * (§G7) — so every level-up invalidates it server-side. Said in one place because the four sites
 * that can cross a threshold (§I1: a mission settling, a launch that settled one, a build, a raid)
 * would otherwise each carry a copy of the reason.
 *
 * Without it the cached roster stays authoritative for its whole `staleTime`: the board announces
 * "Assignee pool 8", the player walks to §G inside the window and reads Unplaced 0 with every Place
 * button dead — handed people, then refused permission to place them (MOU-381).
 */
function invalidateLevelSensitive(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  void queryClient.invalidateQueries({ queryKey: queryKeys.assignees });
}

/**
 * ## Why a refused write still has to invalidate — `onSettled`, not `onSuccess`
 *
 * The game has no schedulers. Every clock in it settles on a *read*, and a write route reads
 * before it writes: `POST /base/build` runs `settleBase` on its first line and only then asks
 * whether the player can afford the order. So a refusal is not a no-op. By the time the 409 comes
 * back the server has already banked an hour of production, paid a wage week, possibly finished a
 * research project and possibly crossed a player level — `routes/base.ts` says so out loud by
 * putting a `levelUp` on the *error* payload.
 *
 * A mutation that only invalidates `onSuccess` therefore leaves the screen lying in exactly the
 * moment the player is most likely to look at it: they were told "you cannot afford that", the
 * stockpile on the HUD is the one from before the settle, and the caps they actually have may well
 * cover it. The fix is uniform — invalidate on `onSettled` (or `onError`), which fires down both
 * paths — and it is why the city, mission and battle writes were already written that way.
 *
 * The hooks below cite this note as "settle first, refuse second".
 */

/**
 * How often the missions page re-asks the server. Missions settle lazily on this read, so the
 * poll is what turns a finished countdown into a banked payout while the page is open — and the
 * countdown itself ticks locally in between, so this does not need to be a fast poll.
 */
const MISSION_POLL_MS = 15_000;

/** Same idea for research: the settle happens on the read, and the clock is minutes long. */
const RESEARCH_POLL_MS = 15_000;

/**
 * And for the district (§A1). The build queue settles on this read, so the poll is what turns a
 * finished countdown into a standing structure while the page is open.
 *
 * Faster than the other two because the bottom of the build tree is measured in *seconds* — a
 * fifteen-second poll would leave a twenty-second build looking stuck for most of its life, which
 * is the first thing a new player builds.
 */
const DISTRICT_POLL_MS = 5_000;

/** Authenticated session snapshot: user + overseer + base. */
export function useMe() {
  const token = useSession((s) => s.token);
  return useQuery({ queryKey: queryKeys.me, queryFn: getMe, enabled: token !== null });
}

/** City map: districts + public base summaries. */
export function useCity() {
  const token = useSession((s) => s.token);
  return useQuery({ queryKey: queryKeys.city, queryFn: getCity, enabled: token !== null });
}

/** Detail for a single owned base — the district, its queue and its stockpile (§A1). */
export function useBase(id: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.base(id ?? ''),
    queryFn: () => getBase(id ?? ''),
    enabled: id !== undefined,
    refetchInterval: DISTRICT_POLL_MS,
  });

  /*
   * A build lands on the *poll*, not on anything the player did, and the level it may have crossed
   * (§I1) moves the §G layer with it. Keyed on the queue shrinking rather than on the fetch, so a
   * poll that changed nothing costs nothing.
   */
  const queued = query.data?.base.buildQueue.length ?? 0;
  const previous = useRef(queued);
  useEffect(() => {
    const landed = queued < previous.current;
    previous.current = queued;
    if (landed) invalidateLevelSensitive(queryClient);
  }, [queued, queryClient]);

  return query;
}

/**
 * §A1 — name the faction.
 *
 * Writes the response into both caches rather than invalidating: the name is on the HUD, on the
 * district page and on the city map, and a player who has just typed it should not watch it flicker
 * back to the old one while a refetch lands.
 */
export function useRenameFaction(baseId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renameFaction,
    onSuccess: (data) => {
      if (baseId !== undefined) {
        queryClient.setQueryData<BaseDetailResponse>(queryKeys.base(baseId), { base: data.base });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.city });
    },
  });
}

/** The mission board and everything in flight (GDD §E3, §E4). */
export function useMissions() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.missions,
    queryFn: getMissions,
    enabled: token !== null,
    refetchInterval: MISSION_POLL_MS,
  });

  /*
   * A crew is paid by the *poll*, not by anything the player did, so nothing else on the client
   * knows the stockpile and the meters just moved — `me` is what the HUD reads, and a player
   * watching their own countdown land is exactly the case that never leaves this page.
   *
   * Keyed on the fetch rather than the payload: the server reports `justResolved` per request, so
   * the settling poll reports it and the next one reports none.
   *
   * The settle is also where a level is crossed (§I1), which moves the §G layer with it.
   */
  const settledAt = (query.data?.justResolved.length ?? 0) > 0 ? query.dataUpdatedAt : 0;
  useEffect(() => {
    if (settledAt === 0) return;
    invalidateLevelSensitive(queryClient);
  }, [settledAt, queryClient]);

  return query;
}

/** Send a crew out, then refresh the board and everything a returning crew may have paid into. */
export function useLaunchMission() {
  const queryClient = useQueryClient();
  // Typed on `ApiRequestError` rather than `Error`: a refused launch may still have settled the
  // board, and the level-up it banked rides out on the failure (MOU-280).
  return useMutation<LaunchMissionResponse, ApiRequestError, LaunchMissionRequest>({
    mutationFn: launchMission,
    /*
     * `onSettled`, not `onSuccess`: the launch settles the board before it validates, and that
     * settle is not rolled back when it then refuses. A refusal downstream of it has already moved
     * the stockpile, morale and the §D8 tally — and nothing else will re-observe them. `me` is
     * `staleTime: 30_000` with no poll and no refetch on focus, `GameScreen` never unmounts inside
     * `/game`, and the board's own `justResolved` rescue cannot fire because this very request
     * consumed the settlement. Refreshing only on success leaves the HUD contradicting the banner
     * beside it for as long as the player stays on the board (MOU-280).
     *
     * The refusals that never reached the settle pay two spare refetches for this; the checks that
     * can reject before it are the cheap ones, and a stale HUD is the more expensive mistake.
     */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      invalidateLevelSensitive(queryClient);
    },
  });
}

/** The Bar: today's roster plus the officers already on the books (GDD §H). */
export function useBar() {
  const token = useSession((s) => s.token);
  return useQuery({ queryKey: queryKeys.bar, queryFn: getBar, enabled: token !== null });
}

/**
 * Make an offer (§H7). The Bar is refetched either way — a counter-offer leaves the roster alone
 * but a signing moves caps, slots and the officer list all at once.
 */
export function useHireRecruit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: hireRecruit,
    // The Bar either way, and on a refusal as well as on a signing — see
    // "settle first, refuse second": `/bar` settles the crew’s pay and alignment before it
    // decides whether the hire can happen at all.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.bar }),
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    onSuccess: (data) => {
      if (!data.accepted) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      // A signing adds an officer, and the §G layer is who the officers *are*: the assignee screen
      // lists them and the mission board's §G6 picker offers them. Without this the cached roster
      // stays authoritative for its whole `staleTime`, so a player who hires their first officer
      // and walks straight to the board is told, on every hard card, to go and hire one.
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignees });
    },
  });
}

/**
 * One exchange of a wage negotiation (§H7).
 *
 * Deliberately does **not** invalidate the Bar. The conversation state comes back on the response
 * and the window renders it directly, so a refetch here would replace a live exchange with a
 * whole-roster reload mid-sentence. The Bar is refreshed when the hire actually lands, which is
 * `useHireRecruit`'s job.
 */
export function useNegotiate() {
  return useMutation({ mutationFn: negotiateWithRecruit });
}

/** Spend one of the §H6 points the player assigns by hand. */
export function useAssignPoint() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: assignPoint,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bar });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/**
 * The research page (GDD §B9). Polled for the same reason the missions page is: a project settles
 * lazily on this read, so the poll is what turns a finished clock into a discovered fact while the
 * page is open.
 */
export function useResearch() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.research,
    queryFn: getResearch,
    enabled: token !== null,
    refetchInterval: RESEARCH_POLL_MS,
  });

  // A landed project can move the Overseer's sheet (§F2) and morale (§F3), and neither of those is
  // read from here — `me` is what the HUD renders. Keyed on the fetch, not the payload: the server
  // reports `justDiscovered` per request, so the settling poll reports it and the next reports none.
  const settledAt = (query.data?.justDiscovered.length ?? 0) > 0 ? query.dataUpdatedAt : 0;
  useEffect(() => {
    if (settledAt === 0) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [settledAt, queryClient]);

  return query;
}

/** Put the crew on a project (§B9, §F2). Costs caps, so the HUD is refreshed with the page. */
export function useStartResearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startResearch,
    // `onSettled` — "settle first, refuse second", at the top of this file.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.research });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** The assignee layer: the pool, the placements and what each is worth (GDD §G). */
export function useAssignees() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.assignees,
    queryFn: getAssignees,
    enabled: token !== null,
  });
}

/**
 * §G2 placement and §G4 reskilling.
 *
 * Both invalidate the mission board as well as the §G screen: the assignee bonus is applied at
 * launch (§G5/§G7) and the §G6 gate turns on who is free, so moving people changes what the board
 * will quote and which runs it will accept.
 */
function useAssigneeWrite<Body>(mutationFn: (body: Body) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assignees });
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
    },
  });
}

export const usePlaceAssignees = () => useAssigneeWrite(placeAssignees);
export const useReskillAssignees = () => useAssigneeWrite(reskillAssignees);

/** Mint an overseer + starting base from a preset, then prime the caches. */
export function useCreateOverseer() {
  const queryClient = useQueryClient();
  const setUser = useSession((s) => s.setUser);
  return useMutation({
    mutationFn: createOverseer,
    onSuccess: (data) => {
      setUser(data.user);
      queryClient.setQueryData<MeResponse>(queryKeys.me, (previous) => ({
        user: data.user,
        overseer: data.overseer,
        base: data.base,
        // Character select does not learn whether this build has a bench, so the priming write
        // carries whatever `/me` already said rather than asserting `false` and hiding the door
        // until the next poll.
        admin: previous?.admin ?? false,
      }));
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.city });
    },
  });
}

/**
 * Raise one structure in the hideout (GDD §A1, §D3).
 *
 * The response already carries the whole settled base, so it is written straight into the base
 * cache rather than waiting for a refetch — the village, the stockpile and the level all moved on
 * this one call. `me` is invalidated because the HUD reads its resources from there.
 */
export function useBuildStructure(baseId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: buildStructure,
    onSuccess: (data) => {
      if (baseId !== undefined) {
        queryClient.setQueryData<BaseDetailResponse>(queryKeys.base(baseId), { base: data.base });
      }
    },
    // `onSettled`, not `onSuccess` — "settle first, refuse second", at the top of this file. A build
    // refuses has still banked an hour of production and can have crossed a level on the way to
    // the refusal, which the route says out loud by putting a `levelUp` on the *error*.
    onSettled: () => invalidateLevelSensitive(queryClient),
    onError: () => {
      if (baseId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.base(baseId) });
      }
    },
  });
}

/**
 * The city writes (GDD §A4).
 *
 * All five refresh the same three things, because all five can move them: the map (ownership and
 * fog), the district that was touched, and the crew itself (its army, its stockpile, its level).
 * Said once rather than five times — the reason is identical every time.
 */
function useCityWrite<Body, Result>(
  mutationFn: (body: Body) => Promise<Result>,
  baseId: string | undefined,
  districtOf: (body: Body) => string | null,
) {
  const queryClient = useQueryClient();
  return useMutation<Result, ApiRequestError, Body>({
    mutationFn,
    onSettled: (_result, _error, body) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.city });
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      const districtId = districtOf(body);
      if (districtId !== null) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.district(districtId) });
      }
      if (baseId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.base(baseId) });
      }
      invalidateLevelSensitive(queryClient);
    },
  });
}

/** One district's places, who holds them, and what they are worth. */
export function useDistrict(districtId: string | undefined) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.district(districtId ?? ''),
    queryFn: () => getDistrict(districtId ?? ''),
    enabled: token !== null && districtId !== undefined,
  });
}

export const useScout = () => useCityWrite(scoutDistrict, undefined, (body) => body.districtId);

export const useSetGarrison = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(setGarrison, baseId, () => districtId ?? null);

export const useFortify = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(fortifyLocation, baseId, () => districtId ?? null);

/** §A4 — work a location up a level. Same write path as fortifying; same invalidations. */
export const useUpgradeLocation = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(upgradeLocation, baseId, () => districtId ?? null);

/**
 * The unit roster (GDD §A5). Polled for the same reason the district page is: a training batch
 * lands on this read, so the poll is what turns a finished clock into units while the page is open.
 */
export function useUnits() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.units,
    queryFn: getUnits,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/** Put a batch on the bench. Costs resources, so the HUD refreshes with the roster. */
export function useTrainUnits(baseId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: trainUnits,
    // `onSettled` — "settle first, refuse second". "You cannot afford that" is the most
    // common answer this route gives, and it is exactly the answer after which the stockpile on
    // screen is wrong.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      if (baseId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.base(baseId) });
      }
    },
  });
}

/**
 * The Training tab (§F2). Polled, because a session finishes on the server's clock and the point
 * of the screen is watching an hour run down — the same reason the roster and the district poll.
 */
export function useTraining() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.training,
    queryFn: getTraining,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/**
 * Put somebody through an hour.
 *
 * The response *is* the refreshed board, so the tab does not re-derive anything — but the sheet it
 * just moved is also what the Overseer's profile is drawn from, and what every effect in the game
 * is computed from, so both of those are dropped too.
 */
export function useStartTraining() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startTraining,
    onSuccess: (training) => {
      queryClient.setQueryData(queryKeys.training, training);
      void queryClient.invalidateQueries({ queryKey: queryKeys.crewStanding });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** The Overseer and what the crew's sheet is currently buying. */
export function useCrewStanding() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.crewStanding,
    queryFn: getCrewStanding,
    enabled: token !== null,
  });
}

/**
 * The market. Polled, because the Runner's hours turn over on the server's clock and somebody
 * else's listing can appear or vanish between two glances at the board.
 */
export function useMarket() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.market,
    queryFn: getMarket,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/**
 * Every market write in one hook factory.
 *
 * All five answer with the whole refreshed board, so the cache is *set* rather than invalidated —
 * a refetch would show the pre-trade board for a moment, which on a screen where two players are
 * both acting is the one thing that makes a market feel broken. The stockpile moved too, so the
 * HUD and anything priced in resources are dropped.
 */
function marketMutation<TArgs>(mutationFn: (args: TArgs) => Promise<MarketMutationResponse>) {
  return function useMarketMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn,
      onSuccess: (response) => {
        queryClient.setQueryData(queryKeys.market, response.market);
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workshop });
        void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      },
    });
  };
}

export const useBuyFromVendor = marketMutation(buyFromVendor);
export const useBarter = marketMutation(barterResources);
/** The supply run — caps into materials, inside the day's ration. */
export const useBuySupply = marketMutation(buySupply);
export const usePostOffer = marketMutation(postOffer);
export const useWithdrawOffer = marketMutation(withdrawOffer);
export const useAcceptOffer = marketMutation(acceptOffer);

/**
 * The back room.
 *
 * Polled on the same cadence as the front of the market and for a sharper version of the same
 * reason: the shelf is shared with the whole city, so a slot can be emptied and refilled by
 * somebody else while a player is reading it. Seeing that happen is the feature.
 */
export function useBlackMarket() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.blackMarket,
    queryFn: getBlackMarket,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/**
 * Taking something off the shelf.
 *
 * The response is the whole refreshed shelf, so it is set rather than invalidated — a refetch would
 * flash the pre-purchase board. The satchel and the HUD both moved (a blueprint landed, infamy was
 * spent), so `me` and the workshop are dropped.
 */
export function useTakeFromBlackMarket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: takeFromBlackMarket,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.blackMarket, response.blackMarket);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workshop });
    },
  });
}

/** The player's own record. Not polled: nobody else can change it. */
export function useSettings() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: getSettings,
    enabled: token !== null,
  });
}

/**
 * The two Settings writes.
 *
 * Both answer with the whole record, so both set the cache — and both drop `me`, because the
 * username on the HUD and the clock every countdown is drawn in come from it.
 */
function settingsMutation<TArgs>(mutationFn: (args: TArgs) => Promise<SettingsResponse>) {
  return function useSettingsMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn,
      onSuccess: (settings) => {
        queryClient.setQueryData(queryKeys.settings, settings);
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      },
    });
  };
}

/**
 * The battle board (§A4). Polled, because it is the one screen with a *deadline* on it.
 *
 * Declared fights resolve lazily on this read, so the poll is what turns a passed mark into a
 * report while somebody is sitting on the page. It is also the read that keeps the deployment
 * countdown honest: the cutoff is one second before the mark, and a stale board would keep a
 * shut window looking open.
 */
export function useBattles() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.battles,
    queryFn: getBattles,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/**
 * Every write on the battle board answers with the whole board plus the caller's crew.
 *
 * Both go into the cache rather than being invalidated, because both were computed by the server
 * from the same post-write state — and a refetch would put a second round trip between pressing
 * the button and seeing the units leave the roster. The city goes stale too: a resolution can
 * change who holds half the map.
 */
function battleMutation<TArgs>(mutationFn: (args: TArgs) => Promise<BattleMutationResponse>) {
  return function useBattleMutation() {
    const queryClient = useQueryClient();
    return useMutation<BattleMutationResponse, ApiRequestError, TArgs>({
      mutationFn,
      onSuccess: (result) => {
        queryClient.setQueryData(queryKeys.battles, result.battles);
      },
      // Settled rather than success: these routes settle before they validate, so a refusal can
      // still have banked a resolved fight, a levelled crew and a district that changed hands.
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.city });
        void queryClient.invalidateQueries({ queryKey: queryKeys.units });
        invalidateLevelSensitive(queryClient);
      },
    });
  };
}

export const useDeclareBattle = battleMutation(declareBattle);
export const useDeployToBattle = battleMutation(deployToBattle);
export const useLayTrap = battleMutation(layTrap);
export const useGarrisonStructure = battleMutation(garrisonStructure);
export const useSacrificeInfamy = battleMutation(sacrificeInfamy);

export const useUpdateProfile = settingsMutation(updateProfile);
export const useChangePassword = settingsMutation(changePassword);

/**
 * The admin bench, or `null` when this build does not have one.
 *
 * A 404 is the *answer*, not a failure: `routes/admin.ts` refuses to admit the bench exists when
 * admin mode is off. Swallowing exactly that one status keeps the screen and the nav entry off
 * without every caller having to know the convention — and every other status still throws, so a
 * broken bench in a build that should have one is still visibly broken.
 */
export function useAdmin() {
  const token = useSession((s) => s.token);
  // Asked only when `/me` has already said the bench exists. Probing for it and treating the 404
  // as the answer worked, but it meant a production build fired a failing request on every page
  // and left a red line in every player's console.
  const me = useMe();
  return useQuery({
    queryKey: queryKeys.admin,
    queryFn: getAdmin,
    enabled: token !== null && me.data?.admin === true,
    retry: false,
  });
}

/** Turning a knob. Everything on screen may have moved, so the whole cache is dropped. */
export function useAdminKnobs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setAdminKnobs,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.admin, response.admin);
      // Deliberately everything. A knob can move the district, the level, the stockpile and the
      // infamy in one call, and enumerating what each combination touched is a list that would go
      // stale the first time a knob is added.
      void queryClient.invalidateQueries();
    },
  });
}

/** The workshop and the yard. */
export function useWorkshop() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.workshop,
    queryFn: getWorkshop,
    enabled: token !== null,
  });
}

function workshopMutation<TArgs>(mutationFn: (args: TArgs) => Promise<WorkshopMutationResponse>) {
  return function useWorkshopMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn,
      onSuccess: (response) => {
        queryClient.setQueryData(queryKeys.workshop, response.workshop);
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        // A fitted upgrade changes every unit's sheet, and the roster is where a player looks to
        // see whether it did.
        void queryClient.invalidateQueries({ queryKey: queryKeys.units });
        void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      },
    });
  };
}

export const useFitUpgrade = workshopMutation(fitUpgrade);
export const useBuildVehicle = workshopMutation(buildVehicle);

/** §E — turn a crew around. The board answers with the whole refreshed set of runs. */
export function useRecallMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recallMission,
    onSuccess: (missions) => {
      queryClient.setQueryData(queryKeys.missions, missions);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** §C2 — move an officer into a different position. */
export function useReassignOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reassignOfficer,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.assignees, response.assignees);
      void queryClient.invalidateQueries({ queryKey: queryKeys.bar });
      void queryClient.invalidateQueries({ queryKey: queryKeys.training });
    },
  });
}

/**
 * Start a standing programme at the Lab.
 *
 * The response is the whole refreshed Archive, so it is set rather than invalidated — and the
 * stockpile, the satchel and every screen that reads a crew effect moved with it.
 */
export function useStartTech() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startTech,
    onSuccess: (research) => {
      queryClient.setQueryData(queryKeys.research, research);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crewStanding });
    },
  });
}
