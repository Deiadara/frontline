import { readyCount } from '@frontline/shared';
import type {
  ActionsResponse,
  MoveUnitsRequest,
  RecallMoveRequest,
  BaseDetailResponse,
  ClaimFeatRequest,
  FeatsResponse,
  LeaderboardBoard,
  BattleMutationResponse,
  FactionMutationResponse,
  MessageMutationResponse,
  NotificationMutationResponse,
  SettingsResponse,
  MarketMutationResponse,
  LaunchMissionInput,
  LaunchMissionResponse,
  MeResponse,
  TrainUnitsResponse,
  BuildStructureResponse,
  ResearchResponse,
  TrainingResponse,
  CityResponse,
} from '@frontline/shared';
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ApiRequestError } from './api';
import {
  burnUpgrade,
  raiseGate,
  answerFactionInvite,
  createFaction,
  deleteMessage,
  disbandFaction,
  getLeaderboard,
  claimAllFeats,
  claimFeat,
  getCrewProfile,
  getFeats,
  getFactionProfile,
  editFactionDescription,
  editFactionIdentity,
  factionMemberAction,
  getFaction,
  getMessages,
  getNotifications,
  inviteToFaction,
  leaveFaction,
  readAllMessages,
  readAllNotifications,
  readMessage,
  readNotification,
  reinforceAlly,
  sendMessage,
  setNotificationSettings,
  fortifyLocation,
  upgradeLocation,
  getDistrict,
  getUnits,
  scoutDistrict,
  plantSleepers,
  recallSleepers,
  setGarrison,
  cancelTraining,
  increasePayroll,
  releaseOfficer,
  trainUnits,
  buildStructure,
  buyBuildBoost,
  buildAddon,
  clearModification,
  getScrapyard,
  getCrew,
  createOverseer,
  getOverseerChoices,
  getBar,
  getBase,
  getCity,
  getMe,
  getMissions,
  placeBid,
  sealBid,
  launchMission,
  renameDistrict,
  getResearch,
  getTraining,
  startTraining,
  getCrewStanding,
  getMarket,
  placeVendorBid,
  unlockBlueprint,
  reimagine,
  barterResources,
  buySupply,
  postOffer,
  withdrawOffer,
  acceptOffer,
  getBlackMarket,
  placeBlackMarketBid,
  getSettings,
  updateProfile,
  changePassword,
  getAdmin,
  mockBattleOnMe,
  setAdminFog,
  setAdminKnobs,
  grantAdmin,
  resetAdmin,
  buildVehicle,
  recallMission,
  reassignOfficer,
  startTech,
  getBattles,
  declareBattle,
  getActions,
  recallColumn,
  deployToBattle,
  layTrap,
  buyBattleBoost,
  getGarage,
  leadBattle,
  takeVehicles,
  upgradeNotoriety,
  cancelBuild,
  cancelResearch,
  cancelLocationUpgrade,
  cancelLocationFortify,
  recallScout,
  recallSpy,
  spyOn,
  moveUnits,
  quoteMove,
  recallMove,
  cancelGateRaise,
  cancelDrill,
} from './api';
import { useSession } from '../store/session';

/** Canonical react-query keys (see docs/SPEC-client.md). */
export const queryKeys = {
  me: ['me'] as const,
  overseerChoices: ['overseer-choices'] as const,
  city: ['city'] as const,
  base: (id: string) => ['base', id] as const,
  missions: ['missions'] as const,
  bar: ['bar'] as const,
  district: (id: string) => ['district', id] as const,
  units: ['units'] as const,
  research: ['research'] as const,
  crew: ['crew'] as const,
  training: ['training'] as const,
  crewStanding: ['crew-standing'] as const,
  market: ['market'] as const,
  blackMarket: ['black-market'] as const,
  settings: ['settings'] as const,
  admin: ['admin'] as const,
  garage: ['garage'] as const,
  scrapyard: ['scrapyard'] as const,
  battles: ['battles'] as const,
  actions: ['actions'] as const,
  faction: ['faction'] as const,
  feats: ['feats'] as const,
  leaderboard: (board: string, localOnly: boolean) => ['leaderboard', board, localOnly] as const,
  crewProfile: (id: string) => ['crew-profile', id] as const,
  factionProfile: (id: string) => ['faction-profile', id] as const,
  messages: ['messages'] as const,
  notifications: ['notifications'] as const,
};

/**
 * Refresh everything a level-up moved: the HUD, and the crew screen derived from the same level.
 *
 * `projectCrew` reads `base.level` for the bed count beside the roster, so a level-up moves it
 * server-side. Said in one place because the four sites that can cross a threshold (§I1: a mission
 * settling, a launch that settled one, a build, a raid) would otherwise each carry a copy of the
 * reason.
 *
 * Without it the cached roster stays authoritative for its whole `staleTime` and the screen keeps
 * quoting the ceiling the crew had before the level (MOU-381).
 */
function invalidateLevelSensitive(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  void queryClient.invalidateQueries({ queryKey: queryKeys.crew });
}

/**
 * Write a base a write route answered with over the district cache.
 *
 * The base writes answer with the whole settled district and none of them carries a clock, while
 * `BaseDetailResponse` does: `useServerClock` reads its `serverNow` against `dataUpdatedAt`, and
 * this write moves `dataUpdatedAt` to now. So the last read's clock is advanced by the time since
 * it arrived rather than copied, or every build countdown on the district would jump back by up to
 * a poll until the refetch behind this write landed. Nothing is written when the key has never
 * been read: there is nothing on screen to overwrite, and the caller's invalidation fetches it.
 *
 * Every caller invalidates the same key right after. A poll that left before the write answered
 * still resolves to the pre-write district, and `setQueryData` has no way to say "newer than
 * that"; invalidating cancels the read in flight and asks again. `useBurnUpgrade` says the same.
 */
function setBase(queryClient: QueryClient, baseId: string, base: BaseDetailResponse['base']): void {
  const key = queryKeys.base(baseId);
  const state = queryClient.getQueryState<BaseDetailResponse>(key);
  if (state?.data === undefined) return;
  const carried = Date.parse(state.data.serverNow) + (Date.now() - state.dataUpdatedAt);
  queryClient.setQueryData<BaseDetailResponse>(key, {
    base,
    serverNow: new Date(carried).toISOString(),
  });
}

/**
 * Write a board a market write answered with onto the cache entry the screen is reading it from.
 *
 * The market, the back room and the Bar are keyed by city (`['market', 'crossroads']`), and the
 * city a screen asked for is not something the mutation knows: the request bodies do not carry one
 * and the answer is the board the server chose. An exact `setQueryData(queryKeys.market, …)`
 * therefore wrote to the bare prefix, which no `useQuery` subscribes to, and every trade fell back
 * on the invalidation's round trip while the screen kept the pre-trade board. That flash is the
 * whole reason these writes carry a board at all.
 *
 * Matched on the board's own `cityId` rather than on the key's spelling, so both readings of one
 * room are written (a crew's own market is fetched bare, `['market', '']`, and by name from the
 * picker) and a board for a different city is left alone. The last part is load-bearing: every
 * write route answers with the crew's **home** board whichever city the write was made in
 * (`routes/market.ts` calls `board(base, now)` with no city), so a blind write would put one
 * city's barrow under another city's heading.
 *
 * Nothing is written for a city that has never been read, the way {@link setBase} does nothing for
 * an unread district: there is no screen to overwrite, and the caller's invalidation fetches it.
 */
function setBoard<Board extends { cityId: string }>(
  queryClient: QueryClient,
  key: readonly unknown[],
  board: Board,
): void {
  queryClient.setQueriesData<Board>({ queryKey: key }, (previous) =>
    previous?.cityId === board.cityId ? board : previous,
  );
}

/**
 * ## Why a refused write still has to invalidate: `onSettled`, not `onSuccess`
 *
 * The game has no schedulers. Every clock in it settles on a *read*, and a write route reads
 * before it writes: `POST /base/build` runs `settleBase` on its first line and only then asks
 * whether the player can afford the order. So a refusal is not a no-op. By the time the 409 comes
 * back the server has already banked an hour of production, paid a wage week, possibly finished a
 * research project and possibly crossed a player level: `routes/base.ts` says so out loud by
 * putting a `levelUp` on the *error* payload.
 *
 * A mutation that only invalidates `onSuccess` therefore leaves the screen lying in exactly the
 * moment the player is most likely to look at it: they were told "you cannot afford that", the
 * stockpile on the HUD is the one from before the settle, and the caps they actually have may well
 * cover it. The fix is uniform: invalidate on `onSettled` (or `onError`), which fires down both
 * paths, and it is why the city, mission and battle writes were already written that way.
 *
 * The hooks below cite this note as "settle first, refuse second".
 */

/**
 * How often the missions page re-asks the server. Missions settle lazily on this read, so the
 * poll is what turns a finished countdown into a banked payout while the page is open, and the
 * countdown itself ticks locally in between, so this does not need to be a fast poll.
 */
const MISSION_POLL_MS = 15_000;

/** Same idea for research: the settle happens on the read, and the clock is minutes long. */
const RESEARCH_POLL_MS = 15_000;

/**
 * And for the district (§A1). The build queue settles on this read, so the poll is what turns a
 * finished countdown into a standing structure while the page is open.
 *
 * Faster than the other two because the bottom of the build tree is measured in *seconds*: a
 * fifteen-second poll would leave a twenty-second build looking stuck for most of its life, which
 * is the first thing a new player builds.
 */
const DISTRICT_POLL_MS = 5_000;

/**
 * The two queries that are open on every screen: the HUD's own, and the map.
 *
 * These had no interval at all, and `/me`'s own documentation on the server describes it as "the
 * call the game shell polls", which is what it was written to be. The effect of the gap was that
 * the default screen was the deadest one in the game: a player standing on the city map saw a
 * stockpile frozen at whatever it read when the page loaded, an unread badge that never moved, and
 * no sign of an attack marching towards them, until they happened to click something.
 *
 * Five seconds, the same as the district, because `/me` settles the base on read: this poll is what
 * banks a finished build and moves the resource counter while nobody is clicking. It is also the
 * fallback path for everything the live channel (`lib/live.ts`) delivers in about a second, and
 * that is the order of the two: the channel is for latency, the poll is for correctness. React
 * Query does not run intervals in a hidden tab, so a backgrounded game costs nothing.
 */
const SHELL_POLL_MS = 5_000;

/** Authenticated session snapshot: user + overseer + base. */
export function useMe() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: getMe,
    enabled: token !== null,
    refetchInterval: SHELL_POLL_MS,
  });
}

/** City map: districts + public base summaries. */
export function useCity() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.city,
    queryFn: getCity,
    enabled: token !== null,
    refetchInterval: SHELL_POLL_MS,
  });
}

/** Detail for a single owned base: the district, its queue and its stockpile (§A1). */
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
 * §A1: name the district.
 *
 * Writes the response into both caches rather than invalidating: the name is on the HUD, on the
 * district page and on the city map, and a player who has just typed it should not watch it flicker
 * back to the old one while a refetch lands.
 */
export function useRenameDistrict(baseId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: renameDistrict,
    onSuccess: (data) => {
      if (baseId !== undefined) {
        setBase(queryClient, baseId, data.base);
        void queryClient.invalidateQueries({ queryKey: queryKeys.base(baseId) });
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
   * knows the stockpile and the meters just moved: `me` is what the HUD reads, and a player
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
  return useMutation<LaunchMissionResponse, ApiRequestError, LaunchMissionInput>({
    mutationFn: launchMission,
    /*
     * `onSettled`, not `onSuccess`: the launch settles the board before it validates, and that
     * settle is not rolled back when it then refuses. A refusal downstream of it has already moved
     * the stockpile, morale and the §D8 tally, and nothing else will re-observe them. `me` is
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

/**
 * How often the Bar re-asks the server.
 *
 * The Bar used to be a read of a roster that only this crew could change, so it had no poll at
 * all. It is an auction now: every table on the screen is one other crews are bidding into, and a
 * leading bid that is ten minutes stale is worse than no figure, because a player will bid against
 * it. Ten seconds, and the countdowns tick locally off `useServerClock` in between.
 */
const BAR_POLL_MS = 10_000;

/**
 * The Bar: tonight's tables plus the officers already on the books (GDD §H).
 *
 * `city` is part of the key, so walking into another city's room is a different cache entry rather
 * than the same one overwritten: a player flicking between two rooms gets each back instantly and
 * neither poll clobbers the other's tables.
 */
export function useBar(city?: string) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: [...queryKeys.bar, city ?? ''],
    queryFn: () => getBar(city),
    enabled: token !== null,
    refetchInterval: BAR_POLL_MS,
  });
}

/**
 * §H7: a bid, open or sealed.
 *
 * Both routes answer with the table as it now stands, which the window renders straight away, and
 * both then invalidate: the response covers one auction and the screen shows eight, so the rest of
 * the room, the table counter and the payroll book all come from the refetch. `me` goes with it
 * because the Bar settles yesterday's auctions on read, and a settle that signed somebody has
 * moved the crew and the stockpile behind the HUD.
 *
 * `onSettled` rather than `onSuccess`: `/bar` settles before it refuses, so a refusal has usually
 * changed something too. See "settle first, refuse second" above.
 */
function bidMutation(mutationFn: typeof placeBid) {
  return function useBidMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn,
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.bar });
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      },
    });
  };
}

export const usePlaceBid = bidMutation(placeBid);
export const useSealBid = bidMutation(sealBid);

/**
 * §H7: let an officer go.
 *
 * Frees their slice of the book and charges `DISMISSAL_WEEKS` of it in caps on the spot, so both
 * the Bar and the stockpile move: everything that reads either is invalidated.
 */
export function useReleaseOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: releaseOfficer,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bar });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew });
      // …and the fold, which is a different fact from the roster. `crewSheetsFor` builds
      // `/overseer/me` out of everybody on the books, so somebody leaving takes their best-of
      // ratings, their perks and the lift those perks put on every peer's sheet out with them.
      // `crewStanding` has no poll and a 30s `staleTime`, so without this the "what the crew is
      // buying" ledger goes on quoting a channel the departed officer was the only source of.
      void queryClient.invalidateQueries({ queryKey: queryKeys.crewStanding });
      // …and the district, which is a *different* copy of the base. `BasePanel` prefers
      // `queryKeys.base(id)` over the one on `/me`, and its Reports drawer prints the payroll
      // book and the caps this just moved: without this the two screens disagree until the
      // district's own poll catches up. Prefix-matched because the mutation has no base id.
      void queryClient.invalidateQueries({ queryKey: ['base'] });
    },
  });
}

/** §H7: buy one more step of standing payroll at the Nexus. Costs caps, so the HUD refreshes. */
export function useIncreasePayroll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: increasePayroll,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bar });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      // The district's own copy of the base, which prints the book and the caps this just spent.
      // See the note in `useReleaseOfficer`.
      void queryClient.invalidateQueries({ queryKey: ['base'] });
    },
  });
}

/**
 * The research page (GDD §C). Polled for the same reason the missions page is: a rung settles
 * lazily on this read, so the poll is what turns a finished clock into a finished programme while
 * the page is open.
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

  /*
   * A landed rung pays the player XP and can cross a level (§I1), and neither is read from here:
   * `me` is what the HUD renders.
   *
   * The signal is the finished count *growing*. The response used to carry a per-request "this is
   * what just landed" flag and does not any more, so the transition is the only thing left that
   * says a settlement happened on this read rather than on an earlier one. The first payload after
   * a mount sets the baseline and invalidates nothing: a page opening is not a rung landing.
   */
  const finished = query.data?.technologies.filter((rung) => rung.known).length ?? null;
  const lastFinished = useRef<number | null>(null);
  useEffect(() => {
    if (finished === null) return;
    const previous = lastFinished.current;
    lastFinished.current = finished;
    if (previous !== null && finished > previous) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    }
  }, [finished, queryClient]);

  return query;
}

/** The crew: who is in which chair, and everything about them (GDD §C1, §C2). */
export function useCrew() {
  const token = useSession((s) => s.token);
  return useQuery({ queryKey: queryKeys.crew, queryFn: getCrew, enabled: token !== null });
}

/**
 * §F6: the characters this account is offered.
 *
 * Not cached across a reload and never stale for long: the pool is shared, so a character in these
 * four can be taken by somebody else while the screen is open. `staleTime: 0` means the next mount
 * asks again, which is what makes the "somebody else is already that person" refusal rare rather
 * than routine.
 */
export function useOverseerChoices() {
  return useQuery({
    queryKey: queryKeys.overseerChoices,
    queryFn: getOverseerChoices,
    staleTime: 0,
    /*
     * §F6: an empty offer is a wait, not an answer.
     *
     * Thirty characters, four held per offer and a hold that outlives the tab it was drawn for, so
     * eight people signing up at once can leave the ninth with nothing to be offered. Measured on a
     * hosted server: two of five registrations found the pool empty behind a previous burst. The
     * screen has no button in that state and the holds ahead of it lapse on their own, so it asks
     * again rather than leaving a player on an empty grid until they think to reload.
     */
    refetchInterval: (query) => (query.state.data?.choices.length === 0 ? 15_000 : false),
  });
}

/** Mint an overseer and a starting base from a preset, then prime the caches. */
export function useCreateOverseer() {
  const queryClient = useQueryClient();
  const setUser = useSession((s) => s.setUser);
  return useMutation({
    mutationFn: createOverseer,
    /*
     * §F6: a refused pick means the offer on screen is out of date.
     *
     * The pool is shared, so the one character a player has just pressed can be taken between the
     * screen rendering and the press landing. Without this the dead card stays selected, the same
     * refusal comes back on every further press, and the only way out is a reload: the screen is
     * showing four characters, one of whom no longer exists, and has no way to learn that.
     */
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.overseerChoices });
    },
    onSuccess: (data) => {
      /*
       * The offer is spent, so it comes out of the cache rather than sitting there stale.
       *
       * `GET /overseer/choices` refuses a crew that already has somebody (409), because since an
       * offer became a hold it is no longer free to ask. A cached offer left behind is a query
       * that can refetch on a window focus during navigation and answer with that refusal, on a
       * screen whose failure branch is the one a player cannot get past.
       */
      queryClient.removeQueries({ queryKey: queryKeys.overseerChoices });
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
 * cache rather than waiting for a refetch: the village, the stockpile and the level all moved on
 * this one call. `me` is invalidated because the HUD reads its resources from there.
 */
export function useBuildStructure(baseId: string | undefined) {
  return useBaseOrder(buildStructure, baseId);
}

/**
 * Call an order off inside its first tenth (maintainer request, 2026-09-12). Ninety percent of what it
 * took comes back and the parts come back whole, so the same caches the order moved move again.
 */
export function useCancelBuild(baseId: string | undefined) {
  return useBaseOrder(cancelBuild, baseId);
}

function useBaseOrder<TArgs>(
  mutationFn: (args: TArgs) => Promise<BuildStructureResponse>,
  baseId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation<BuildStructureResponse, ApiRequestError, TArgs>({
    mutationFn,
    onSuccess: (data) => {
      if (baseId !== undefined) setBase(queryClient, baseId, data.base);
    },
    // `onSettled`, not `onSuccess`: "settle first, refuse second", at the top of this file. A build
    // refuses has still banked an hour of production and can have crossed a level on the way to
    // the refusal, which the route says out loud by putting a `levelUp` on the *error*.
    //
    // The district on both paths too. It used to be re-read only on a refusal, which left the
    // written base alone against a poll already in flight: see `setBase`.
    onSettled: () => {
      invalidateLevelSensitive(queryClient);
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
 * Said once rather than five times: the reason is identical every time.
 */
function useCityWrite<Body, Result>(
  mutationFn: (body: Body) => Promise<Result>,
  baseId: string | undefined,
  districtOf: (body: Body) => string | null,
  /** Anything else this particular write makes stale. Empty for almost all of them. */
  alsoStale: readonly (readonly unknown[])[] = [],
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
      for (const key of alsoStale) void queryClient.invalidateQueries({ queryKey: key });
      invalidateLevelSensitive(queryClient);
    },
  });
}

/**
 * One district's places, who holds them, and what they are worth.
 *
 * Polled on the district cadence, and it is the read with the most standing on it: `GET /city/:id`
 * runs `settleWorld` and `settleBase` on its first two lines, so a fortification finishing, an
 * upgrade landing, a column arriving and a scout walking back in all happen *on this request*.
 * Without an interval nothing ever made it again, and the screen has four live countdowns drawn
 * off the payload: a scout at zero read "Walking back in" until the player navigated away, and a
 * finished upgrade kept its clock at `0s left` beside a location still at the old level.
 */
export function useDistrict(districtId: string | undefined) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.district(districtId ?? ''),
    queryFn: () => getDistrict(districtId ?? ''),
    enabled: token !== null && districtId !== undefined,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

export const useScout = () => useCityWrite(scoutDistrict, undefined, (body) => body.districtId);

export const useSetGarrison = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(setGarrison, baseId, () => districtId ?? null);

/**
 * §A4: plant a cell, and pull one back out (`sleepers.ts`).
 *
 * Planting is a city write like garrisoning: it moves units off the roster and changes what the
 * district looks like, so the same invalidations apply. The Monitor is added to both, because a
 * cell appears there the moment it is sent and leaves it when it is recalled, and that page is
 * the only place a player can see one at all.
 */
export const usePlantSleepers = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(plantSleepers, baseId, () => districtId ?? null, [queryKeys.actions]);

export function useRecallSleepers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recallSleepers,
    /*
     * `onSettled`, not `onSuccess`: this route answers with an acknowledgement rather than the
     * new state, and a refused recall can still have landed every other walk on the way past.
     * The roster is in the list because a cell that finishes its walk home rejoins it.
     */
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.actions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.city });
    },
  });
}

export const useFortify = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(fortifyLocation, baseId, () => districtId ?? null);

/** §A4: work a location up a level. Same write path as fortifying; same invalidations. */
export const useUpgradeLocation = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(upgradeLocation, baseId, () => districtId ?? null);

/*
 * Changing your mind on the ground (maintainer request, 2026-09-12). The same write path as the
 * orders they undo, so the district, the crew and the map are re-read exactly as they were when
 * the work was started; the stockpile moved both times.
 */
export const useCancelLocationUpgrade = (
  baseId: string | undefined,
  districtId: string | undefined,
) => useCityWrite(cancelLocationUpgrade, baseId, () => districtId ?? null);

export const useCancelLocationFortify = (
  baseId: string | undefined,
  districtId: string | undefined,
) => useCityWrite(cancelLocationFortify, baseId, () => districtId ?? null);

/**
 * Turn the scout round. The unit is empty (a crew has one scout out at a time), so the district
 * to re-read is the one the caller is looking at rather than one named in the request.
 */
export const useRecallScout = (districtId: string | undefined) =>
  useCityWrite(recallScout, undefined, () => districtId ?? null);

/**
 * Spying (2026-09-22). The board and the Monitor both draw the job, so both go stale with it;
 * the base does too, since the caps came off it.
 */
export const useSpy = (baseId: string | undefined, districtId: string | undefined) =>
  useCityWrite(spyOn, baseId, () => districtId ?? null, [queryKeys.battles, queryKeys.actions]);

/** Moving units between places (2026-09-22): the road, the roster, the city and the base all move. */
export function useMoveUnits() {
  const queryClient = useQueryClient();
  return useMutation<ActionsResponse, ApiRequestError, MoveUnitsRequest>({
    mutationFn: moveUnits,
    onSettled: () => {
      for (const key of [queryKeys.actions, queryKeys.units, queryKeys.city, queryKeys.battles]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      invalidateLevelSensitive(queryClient);
    },
  });
}

export function useRecallMove() {
  const queryClient = useQueryClient();
  return useMutation<ActionsResponse, ApiRequestError, RecallMoveRequest>({
    mutationFn: recallMove,
    onSettled: () => {
      for (const key of [queryKeys.actions, queryKeys.units, queryKeys.city]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** The clock a move would run to, re-read as the picker changes. Nothing is moved. */
export function useMoveQuote(body: MoveUnitsRequest | null) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: ['move-quote', body] as const,
    queryFn: () => quoteMove(body!),
    enabled: token !== null && body !== null,
    staleTime: 10_000,
  });
}

export const useRecallSpy = (districtId: string | undefined) =>
  useCityWrite(recallSpy, undefined, () => districtId ?? null, [
    queryKeys.battles,
    queryKeys.actions,
  ]);

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
  return useBenchMutation(trainUnits, baseId);
}

/** §A5: take a batch back off it, inside its window. Pays resources back, so the same refresh. */
export function useCancelTraining(baseId: string | undefined) {
  return useBenchMutation(cancelTraining, baseId);
}

function useBenchMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<TrainUnitsResponse>,
  baseId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation<TrainUnitsResponse, ApiRequestError, TArgs>({
    mutationFn,
    // `onSettled`: "settle first, refuse second". "You cannot afford that" is the most
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
 * of the screen is watching an hour run down: the same reason the roster and the district poll.
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
 * The response *is* the refreshed board, so the tab does not re-derive anything, but the sheet it
 * just moved is also what the Overseer's profile is drawn from, and what every effect in the game
 * is computed from, so both of those are dropped too.
 *
 * And the roster, which is the third copy of that sheet: `CrewPage`'s officer window prints
 * `AttributeSheet` straight off `useCrew`, and an hour that raised Composure by three left that
 * window showing the number from before the session. `useCrew` has no poll, so nothing else was
 * ever going to correct it.
 */
export function useStartTraining() {
  return useTrainingWrite(startTraining);
}

/** Take a drill off the board inside its first tenth: the day's session comes back whole. */
export function useCancelDrill() {
  return useTrainingWrite(cancelDrill);
}

function useTrainingWrite<TArgs>(mutationFn: (args: TArgs) => Promise<TrainingResponse>) {
  const queryClient = useQueryClient();
  return useMutation<TrainingResponse, ApiRequestError, TArgs>({
    mutationFn,
    onSuccess: (training) => queryClient.setQueryData(queryKeys.training, training),
    // `onSettled`: `POST /training` settles the board before it refuses, so a refusal has still
    // finished whatever hour was running. The board itself is dropped as well as written, so a
    // poll already in flight cannot land the pre-write board on top of the response.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.training });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crewStanding });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew });
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
export function useMarket(city?: string) {
  const token = useSession((s) => s.token);
  return useQuery({
    // The city is in the key so two markets are two cache entries: see `useBar`, which is keyed the
    // same way for the same reason.
    queryKey: [...queryKeys.market, city ?? ''],
    queryFn: () => getMarket(city),
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/**
 * Every market write in one hook factory.
 *
 * All five answer with the whole refreshed board, so the cache is *set* rather than invalidated:
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
        setBoard(queryClient, queryKeys.market, response.market);
        // Dropped as well as set: a 5s poll that left before the trade answered would otherwise
        // land the pre-trade board on top of it. See `usePlaceVendorBid`.
        void queryClient.invalidateQueries({ queryKey: queryKeys.market });
        void queryClient.invalidateQueries({ queryKey: queryKeys.me });
        void queryClient.invalidateQueries({ queryKey: queryKeys.scrapyard });
        void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      },
    });
  };
}

/**
 * A bid on a lot at the barrow. The answer is the whole board with the lot's table moved.
 *
 * The one market write that also needs `onSettled`, and the only one: `POST /market/bid` calls
 * `settleVendorAuctions` on its second line, *outside* the transaction and before
 * `placeVendorBid` decides anything. So "you are already leading this lot", "that does not clear
 * the leader" and "you cannot cover that" are all answers given after the server has closed every
 * finished visit, handed the lots over, taken the caps for them and put the goods in the inventory.
 * Refreshing only on success left the HUD quoting the pre-close tin. See "settle first, refuse
 * second" at the top of this file; the Bar's `bidMutation` is the same shape for the same reason.
 */
export function usePlaceVendorBid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: placeVendorBid,
    onSuccess: (response) => {
      setBoard(queryClient, queryKeys.market, response.market);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scrapyard });
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
    },
  });
}
/**
 * §D10: assemble a blueprint out of the pages the inventory is holding.
 *
 * A market mutation like the rest, because a blueprint is assembled *out of the inventory*: the same
 * payload carries the pages that were spent and the document that arrived, so the Blueprints page
 * and the inventory behind it cannot disagree about what happened.
 */
export const useUnlockBlueprint = marketMutation(unlockBlueprint);
/**
 * §G2: the three pages the player put in the machine, for one they do not have.
 *
 * Not folded into `marketMutation` because the answer carries more than the board: the panel says
 * what went and what came back, and that report is the only place a player ever learns which page
 * they got. Dropping it would leave the inventory silently one page richer.
 */
export function useReimagine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reimagine,
    onSuccess: (response) => {
      setBoard(queryClient, queryKeys.market, response.market);
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export const useBarter = marketMutation(barterResources);
/** The supply run: caps into materials, inside the day's ration. */
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
export function useBlackMarket(city?: string) {
  const token = useSession((s) => s.token);
  return useQuery({
    // The city is in the key so two rooms are two cache entries, the way `useMarket` and `useBar`
    // are keyed: without it, switching city would show the previous city's crates until the
    // refetch landed, and a crate is a lot somebody may be about to bid on.
    queryKey: [...queryKeys.blackMarket, city ?? ''],
    queryFn: () => getBlackMarket(city),
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/**
 * Saying a number on one of the fence's lots.
 *
 * The response is the whole refreshed shelf, so it is set first: a refetch alone would flash the
 * board from before the bid. It is dropped as well, so a poll already in flight cannot land that
 * board on top of the response.
 *
 * Everything downstream is dropped too, and still is now that a bid spends nothing: the same read
 * settles last night's lots, so the very request that writes a number can be the one that hands
 * this crew a crate it won overnight. That moves the ledger, the inventory and the yard (`me`), and
 * the battle board and the roster with them, because contraband is what `BattleView.boosts` lists
 * and a crate can put units on the roster.
 */
export function usePlaceBlackMarketBid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: placeBlackMarketBid,
    onSuccess: (response) => {
      setBoard(queryClient, queryKeys.blackMarket, response.blackMarket);
      void queryClient.invalidateQueries({ queryKey: queryKeys.blackMarket });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scrapyard });
      void queryClient.invalidateQueries({ queryKey: queryKeys.battles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
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
 * Both answer with the whole record, so both set the cache, and both drop `me`, because the
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
 * Warms the caches for the screens behind the standing bar and the bottom nav.
 *
 * The pattern every client-side game UI ends up at, and the reason is the same everywhere: a screen
 * that fetches on mount shows a spinner for as long as the round trip takes, *every time* a player
 * opens it, and a player opens Battles and Missions dozens of times a session. Fetching them once
 * when the session comes up means the click is instant and the request the click would have made
 * has already happened while the player was reading something else.
 *
 * `prefetchQuery` rather than a `useQuery` per screen: it fills the same cache the screen's own hook
 * reads, so nothing renders here, nothing re-renders when it lands, and the screen's hook takes over
 * (including its polling) the moment it mounts. A prefetch that fails is dropped on the floor
 * deliberately: the screen's own hook will ask again and *that* is the request whose failure the
 * player should be told about.
 *
 * Not everything: the boards that take a district or a base id are not knowable until the player
 * picks one, and prefetching all twelve would be twelve requests for one that gets read.
 *
 * `ready` is the caller saying there is a district to read these against. Every endpoint below
 * needs one, so running this during overseer selection is eight requests that can only fail, and a
 * failed prefetch leaves an error in the cache for the screen's own hook to open on.
 */
export function usePrefetchScreens(ready: boolean): void {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (token === null || !ready) return;
    const warm: [readonly unknown[], () => Promise<unknown>][] = [
      [queryKeys.battles, getBattles],
      [queryKeys.missions, getMissions],
      [queryKeys.units, getUnits],
      [queryKeys.crew, getCrew],
      [queryKeys.actions, getActions],
      [queryKeys.research, getResearch],
      [queryKeys.messages, getMessages],
      [queryKeys.notifications, getNotifications],
    ];
    for (const [queryKey, queryFn] of warm) {
      void queryClient.prefetchQuery({ queryKey, queryFn, staleTime: 10_000 });
    }
  }, [token, ready, queryClient]);
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
 * from the same post-write state, and a refetch would put a second round trip between pressing
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
        /*
         * The crew, too. §D7 writes spend infamy and buy ranks, and the wallet is on the HUD: a
         * response that carried the post-write crew and was thrown away left the standing bar
         * quoting the old number until the `me` refetch landed a round trip later. The invalidation
         * below still runs and still wins; this is what the player sees in the meantime.
         */
        queryClient.setQueryData<MeResponse>(queryKeys.me, (previous) =>
          previous ? { ...previous, base: result.base } : previous,
        );
      },
      // Settled rather than success: these routes settle before they validate, so a refusal can
      // still have banked a resolved fight, a levelled crew and a district that changed hands.
      onSettled: () => {
        // The board itself, though it was just written: a 5s poll that left before the write
        // answered would otherwise land the pre-write board on top of it. See `useBurnUpgrade`.
        void queryClient.invalidateQueries({ queryKey: queryKeys.battles });
        void queryClient.invalidateQueries({ queryKey: queryKeys.city });
        void queryClient.invalidateQueries({ queryKey: queryKeys.units });
        /*
         * The road, too. Deploying writes a `troop_movements` row, and that row is the whole
         * content of the Actions screen: leaving the key out meant a player who had opened Actions
         * once kept a cached list without the column they had just sent. Between `staleTime: 30s`
         * and nothing refetching on mount, the units were off the roster on one screen and not on
         * the road on the other until the 5s poll happened to land.
         */
        void queryClient.invalidateQueries({ queryKey: queryKeys.actions });
        invalidateLevelSensitive(queryClient);
      },
    });
  };
}

/**
 * §A4: what the crew has on the road.
 *
 * Polled, and for the same reason the missions rail is: a column lands on the server's clock, and
 * the whole value of the screen is watching the number come down.
 */
export function useActions() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.actions,
    queryFn: getActions,
    enabled: token !== null,
    refetchInterval: 5000,
  });
}

/** Turn one around. Units go back onto the roster, so the roster and the HUD go stale with it. */
export function useRecallColumn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recallColumn,
    onSuccess: (data) => queryClient.setQueryData(queryKeys.actions, data),
    // The same "settle first, refuse second" contract: a refused recall can still have landed
    // every other column on the way past, so the road is re-read on both paths rather than only
    // being overwritten on the happy one.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.battles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.actions });
      invalidateLevelSensitive(queryClient);
    },
  });
}

export const useDeclareBattle = battleMutation(declareBattle);
export const useDeployToBattle = battleMutation(deployToBattle);
export const useLayTrap = battleMutation(layTrap);
export const useBuyBattleBoost = battleMutation(buyBattleBoost);
export const useLeadBattle = battleMutation(leadBattle);
export const useUpgradeNotoriety = battleMutation(upgradeNotoriety);

export const useUpdateProfile = settingsMutation(updateProfile);
export const useChangePassword = settingsMutation(changePassword);

/**
 * The admin console, or `null` when this build does not have one.
 *
 * A 404 is the *answer*, not a failure: `routes/admin.ts` refuses to admit the console exists when
 * admin mode is off. Swallowing exactly that one status keeps the screen and the nav entry off
 * without every caller having to know the convention, and every other status still throws, so a
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

/** A grant moves the inventory and the Lab's finished rungs, and the yard reads both: drop it all. */
export function useAdminGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: grantAdmin,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.admin, response.admin);
      void queryClient.invalidateQueries();
    },
  });
}

/**
 * Clean slate: the crew reset, and the character with it.
 *
 * The whole cache goes, and it has to: this is the one mutation that can make `/me` answer with no
 * overseer, and every screen behind `/game` is drawn from a crew that no longer exists. Keeping
 * any of it would leave the picker rendering over a stale district.
 */
export function useAdminReset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resetAdmin,
    onSuccess: () => {
      queryClient.clear();
    },
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

/** The console's mock fight. Everything invalidated, like a knob: a declaration moves the board, the map and the shell's mark. */
export function useAdminMockBattle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mockBattleOnMe,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.admin, response.admin);
      void queryClient.invalidateQueries();
    },
  });
}

/**
 * The Console's fog of war. Everything is invalidated on success for the same reason the knobs
 * are: what the city, the board and the battles show all follows from what is visible.
 */
export function useAdminFog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setAdminFog,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.admin, response.admin);
      // Deliberately everything. A knob can move the district, the level, the stockpile and the
      // infamy in one call, and enumerating what each combination touched is a list that would go
      // stale the first time a knob is added.
      void queryClient.invalidateQueries();
    },
  });
}

/** §B9: the Scrapyard, on its own page and its own key. */
export function useScrapyard() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.scrapyard,
    queryFn: getScrapyard,
    enabled: token !== null,
  });
}

export function useBuildAddon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: buildAddon,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.scrapyard, response.scrapyard);
      setBase(queryClient, response.base.id, response.base);
    },
    // `onSettled`: "settle first, refuse second", at the top of this file. `POST /scrapyard/build`
    // calls `settled()` on its first line and refuses on its third, so a "you cannot cover that"
    // has already banked production and wages: the stockpile the player is being measured against
    // is not the one on their screen.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scrapyard });
      // A built refit changes every unit's sheet, and the roster is where a player looks for it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      // The inventory is read off the market payload, and every build moves it: a refit spends its
      // parts and a trap lands in the bag. Without this the Inventory and the Blueprints page kept
      // quoting the pre-build counts until the next poll.
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      // The district that was just written, against a poll already in flight (see `setBase`).
      // Prefix-matched: the id is only on the success payload.
      void queryClient.invalidateQueries({ queryKey: ['base'] });
    },
  });
}

/**
 * §B4 and §E: the three writes the district's own dialog makes.
 *
 * All three answer with the whole refreshed base, so the cache is written rather than invalidated:
 * a slot that has just been emptied must not flicker back to full while a refetch is in the air.
 */
function districtMutation<TArgs, TResponse extends { base: BaseDetailResponse['base'] }>(
  mutationFn: (args: TArgs) => Promise<TResponse>,
) {
  return function useDistrictMutation(baseId: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn,
      onSuccess: (response) => {
        if (baseId !== undefined) setBase(queryClient, baseId, response.base);
      },
      // `onSettled`, not `onSuccess`: see the note at the top of this file. Every one of these
      // routes settles the district before it decides, so a refusal has still banked production.
      // The district is re-read on both paths: see `setBase` for why the written one is dropped.
      onSettled: () => {
        invalidateLevelSensitive(queryClient);
        if (baseId !== undefined) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.base(baseId) });
        }
      },
    });
  };
}

export const useBuyBuildBoost = districtMutation(buyBuildBoost);
export const useClearModification = districtMutation(clearModification);

/** §B11: the Garage, on its own page and its own key. */
export function useGarage() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.garage,
    queryFn: getGarage,
    enabled: token !== null,
  });
}

export function useBuildVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: buildVehicle,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.garage, response.garage);
      // The stockpile moved, and the battle screen quotes what is in the yard.
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.battles });
      /*
       * And the units bench, which is where a machine is actually built.
       *
       * `POST /garage/build` calls `queueVehicle` (`apps/server/src/units/training.ts`) and that
       * pushes the order onto `base.trainingQueue`: the same queue a batch of Razors goes on,
       * sharing its length cap and the district's beds, with `settleTraining` the thing that later
       * puts the machine in the fleet. The roster's "On the bench 1 / 12" and the district's bed
       * count are therefore both a poll behind, and neither poll runs: this button is on the
       * Garage, so neither screen is mounted, and 30s of `staleTime` covers the walk to either.
       *
       * The district is prefix-matched because the id is not on this response.
       */
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: ['base'] });
    },
  });
}

export const useTakeVehicles = battleMutation(takeVehicles);

/** §E: turn a crew around. The board answers with the whole refreshed set of runs. */
export function useRecallMission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recallMission,
    onSuccess: (missions) => {
      queryClient.setQueryData(queryKeys.missions, missions);
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/**
 * §C2: move an officer into a different position.
 *
 * `crewStanding` with the rest, because a chair is not decoration: `crewSheet` pays somebody their
 * full rating only in the attributes the seat they are sitting in actually uses, and
 * `benchedMember` pays the off-duty share of everything. Taking a chair therefore moves every
 * channel of the fold `/overseer/me` reports, and that query has no poll and a 30s `staleTime`, so
 * the crew effects page kept the pre-move numbers for as long as the player stayed inside `/game`.
 */
export function useReassignOfficer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reassignOfficer,
    onSuccess: (response) => queryClient.setQueryData(queryKeys.crew, response.crew),
    // `onSettled`: the route settles the crew before it decides, so a refusal has still moved the
    // books. The roster is dropped as well as written (a poll in flight would otherwise land the
    // pre-move roster on top of it), and `me` with it: the chair an officer sits in is folded into
    // the effects the HUD quotes.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crew });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.bar });
      void queryClient.invalidateQueries({ queryKey: queryKeys.training });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crewStanding });
    },
  });
}

/**
 * Start a standing programme at the Lab.
 *
 * The response is the whole refreshed Archive, so it is set rather than invalidated, and the
 * stockpile, the inventory and every screen that reads a crew effect moved with it.
 */
export function useStartTech() {
  return useLabWrite(startTech);
}

/** Take the running project off the bench inside its first tenth; ninety percent comes back. */
export function useCancelResearch() {
  return useLabWrite(cancelResearch);
}

function useLabWrite<TArgs>(mutationFn: (args: TArgs) => Promise<ResearchResponse>) {
  const queryClient = useQueryClient();
  return useMutation<ResearchResponse, ApiRequestError, TArgs>({
    mutationFn,
    onSuccess: (research) => {
      queryClient.setQueryData(queryKeys.research, research);
    },
    // `onSettled`, same rule: `POST /research/tech` settles the player and only then throws
    // `RESEARCH_OPTION_LOCKED`, so a refusal can have finished the previous project and crossed a
    // level on the way past.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.research });
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.crewStanding });
    },
  });
}

// --- factions, messages and notifications (maintainer request) ---

/**
 * The faction screen.
 *
 * Polled on the same interval as the district, because it carries other people's battles and other
 * people's armies: both move without this player doing anything, and a roster that only refreshed
 * on a click would show an ally's army as it was when the tab was opened.
 */
export function useFaction() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.faction,
    queryFn: getFaction,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

/**
 * Every faction write, through one hook.
 *
 * All of them answer with the whole refreshed screen, so the cache is *set* rather than
 * invalidated: the response is already the truth and a refetch would be a second round trip to
 * learn what the first one said. `me` is invalidated alongside, because joining or leaving changes
 * the badge the HUD draws and the tag beside a name.
 */
function useFactionMutation<TInput>(
  mutationFn: (input: TInput) => Promise<FactionMutationResponse>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => queryClient.setQueryData(queryKeys.faction, response.faction),
    // `onSettled`, not `onSuccess`: "settle first, refuse second", at the top of this file.
    // `POST /factions/reinforce` settles the base and only then asks whether the fight is still
    // open, and "they are already through the gate" is the answer it gives most often.
    onSettled: () => {
      // The screen that was just written, against a poll already in flight. See `useBurnUpgrade`.
      void queryClient.invalidateQueries({ queryKey: queryKeys.faction });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      // A reinforcement takes units off the roster and puts a column on the road.
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.actions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.battles });
    },
  });
}

export const useCreateFaction = () => useFactionMutation(createFaction);
export const useEditFactionIdentity = () => useFactionMutation(editFactionIdentity);
export const useEditFactionDescription = () => useFactionMutation(editFactionDescription);
export const useDisbandFaction = () => useFactionMutation(() => disbandFaction());

/**
 * The standings.
 *
 * Keyed by board and scope, so switching tabs or ticking the box is a cache hit the second time
 * and never shows one board's rows under the other's heading. `placeholderData` keeps the previous
 * board on screen while the next one loads, which is what stops the page collapsing to nothing on
 * every click.
 */
/**
 * Re-read the crew, on demand.
 *
 * For the one caller that has to refresh `/me` without writing anything: the roster notices a
 * training batch land on its own clock, and the settle that stood the unit up also paid the §I1
 * experience for it. Both readings have to move together or the meter at the top of the screen
 * announces the experience up to a poll after the unit appeared. A hook rather than a
 * `useQueryClient` at the call site, so every invalidation in this app is still declared in this
 * file and a screen that mocks this module gets it for free.
 */
export function useRefreshCrew(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [queryClient]);
}

/** A crew's file. Keyed by whichever id the link carried; the server answers to both. */
export function useCrewProfile(id: string | undefined) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.crewProfile(id ?? ''),
    queryFn: () => getCrewProfile(id ?? ''),
    enabled: token !== null && id !== undefined,
  });
}

/**
 * The feats screen.
 *
 * Refetched on the same live nudges as the rest of the crew: almost everything a feat counts is
 * something that also moves the district, so `base` is the kind that matters. See `live.ts`.
 */
export function useFeats() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.feats,
    queryFn: getFeats,
    enabled: token !== null,
  });
}

/**
 * The mutation key a single feat claim is filed under, so that {@link useClaimingFeats} can find
 * every press still unanswered rather than only the newest.
 */
const FEAT_CLAIM_KEY = ['feats', 'claim'] as const;

/**
 * A claim answer's board, folded onto the board already on screen so that nothing collected
 * un-collects.
 *
 * Two CLAIM presses in quick succession are two writes in flight at once, and nothing makes their
 * answers come back in the order they were sent: they are separate requests over a multiplexed
 * connection, and the first one pays out more stores than the second whenever it hands over a page
 * or a level. Each answer carries the whole board as the server saw it inside its own transaction,
 * so the first press's answer, arriving last, is a board from before the second feat was
 * collected. Written in as it stands, it puts a live CLAIM button back on a rung the player has
 * already collected, and leaves it there until the invalidation's read of the board lands.
 *
 * Collecting is one way: `crew_feats` rows are insert-only (see `db/repos/feats.ts`), and
 * `featState` reports `claimed` for anything with a row. So a rung this tab has already seen
 * collected cannot legitimately go back, and keeping the collected rows it already has is enough
 * to make the two answers safe to apply in either order. The counts are recomputed from the merged
 * rows rather than taken from either board, so the ledger and the collect-all button agree with
 * the rungs under them.
 */
function foldClaimsForward(
  previous: FeatsResponse | undefined,
  answer: FeatsResponse,
): FeatsResponse {
  const collected = new Map(
    (previous?.progress ?? [])
      .filter((one) => one.state === 'claimed')
      .map((one) => [one.id, one] as const),
  );
  if (collected.size === 0) return answer;

  // The older answer's own row, not a patched copy of the newer one: it is what the server said
  // about that rung when it was collected, clamped figure and all.
  const progress = answer.progress.map((one) =>
    one.state === 'claimed' ? one : (collected.get(one.id) ?? one),
  );
  return {
    ...answer,
    progress,
    ready: readyCount(progress),
    claimed: progress.filter((one) => one.state === 'claimed').length,
  };
}

/**
 * Which feats have a claim in flight, across every press still waiting for an answer.
 *
 * Read off the mutation cache rather than off the hook, because the page runs one mutation
 * observer for a board of two hundred buttons and an observer only ever reports its newest
 * mutation. Pressing a second CLAIM therefore dropped the first rung out of its pending state
 * while its own write was still on the wire: the button came back, live and pressable, and a
 * second press on it earned an `already_claimed` refusal for a feat that was being collected
 * correctly.
 */
export function useClaimingFeats(): ReadonlySet<string> {
  const claiming = useMutationState({
    filters: { mutationKey: FEAT_CLAIM_KEY, status: 'pending' },
    select: (mutation) => (mutation.state.variables as ClaimFeatRequest | undefined)?.featId,
  });
  return useMemo(
    () => new Set(claiming.filter((featId): featId is string => featId !== undefined)),
    [claiming],
  );
}

/**
 * Collecting one.
 *
 * Invalidates `me` as well as the feats list, because a claim pays into the stockpile, the roster
 * and sometimes a level, all of which the shell draws from `/me`, and because the badge on the
 * bottom bar is a field on that response.
 */
export function useClaimFeat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: FEAT_CLAIM_KEY,
    mutationFn: claimFeat,
    /*
     * The board the server just sent, written straight into the cache.
     *
     * Without this the screen flickered on every collect, and the cause was not a render: the
     * response already carries the refreshed `feats` payload, and this hook was throwing it away
     * and waiting for the `invalidateQueries` round trip below to fetch the same thing again. In
     * the window between the two the cache still held the *pre-claim* board, so the rung fell back
     * out of its pending state and drew CLAIM again for a frame or two before flipping to
     * Collected. Taking the payload the server already paid for closes the window entirely; the
     * invalidation stays because `me`, the roster and the stores still have to be re-read.
     *
     * Folded rather than written over the top: see {@link foldClaimsForward} for the second press.
     */
    onSuccess: (response) => {
      queryClient.setQueryData<FeatsResponse>(queryKeys.feats, (previous) =>
        foldClaimsForward(previous, response.feats),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.feats });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      // The inventory and the back room, because a feat can pay in pages, parts and one-time
      // boosts. Neither screen polls, so without these a reward lands in a store the player is
      // looking at and does not appear until something else happens to refresh it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.blackMarket });
    },
  });
}

/**
 * Collecting everything at once.
 *
 * Shares the mutation's invalidations with `useClaimFeat`, because it moves exactly the same
 * stores. Separate hooks rather than one taking an optional id: the two answer with different
 * shapes, and a caller that had to narrow the response would be doing the branching this avoids.
 */
export function useClaimAllFeats() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: claimAllFeats,
    /** The same anti-flicker as {@link useClaimFeat}, and the same fold: this button and a single
        CLAIM can be in flight together, and the board of whichever answers first must survive the
        other one landing on top of it. */
    onSuccess: (response) => {
      queryClient.setQueryData<FeatsResponse>(queryKeys.feats, (previous) =>
        foldClaimsForward(previous, response.feats),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.feats });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.market });
      void queryClient.invalidateQueries({ queryKey: queryKeys.blackMarket });
    },
  });
}

/** A faction's file, as anybody reads it. Keyed by faction id. */
export function useFactionProfile(id: string | undefined) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.factionProfile(id ?? ''),
    queryFn: () => getFactionProfile(id ?? ''),
    enabled: token !== null && id !== undefined,
  });
}

export function useLeaderboard(board: LeaderboardBoard, localOnly: boolean) {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.leaderboard(board, localOnly),
    queryFn: () => getLeaderboard(board, localOnly),
    enabled: token !== null,
    /*
     * The previous answer holds the screen, but only while it is an answer to the same question.
     *
     * The key carries the board as well as the scope, and `(previous) => previous` handed back the
     * *other board's* rows across a key change: pressing Factions lit the Factions tab, hid the
     * player search, and left the ranked player table and "You are #3" on screen until the faction
     * request landed. `LeaderboardResponse` is a union discriminated on `board`, so the page
     * narrowed on the stale payload and drew the wrong table under the right tab.
     *
     * Kept for the scope toggle, which is the same board asked a narrower question and is what
     * this is for: that one still swaps without the sheet blanking.
     */
    placeholderData: (previous) => (previous?.board === board ? previous : undefined),
  });
}
export const useInviteToFaction = () => useFactionMutation(inviteToFaction);
export const useAnswerFactionInvite = () => useFactionMutation(answerFactionInvite);
export const useLeaveFaction = () => useFactionMutation(() => leaveFaction());
export const useFactionMemberAction = () => useFactionMutation(factionMemberAction);
export const useReinforceAlly = () => useFactionMutation(reinforceAlly);

export function useMessages() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.messages,
    queryFn: getMessages,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

function useMessageMutation<TInput>(
  mutationFn: (input: TInput) => Promise<MessageMutationResponse>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.messages, response.messages);
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
      // The HUD badge is on `/me`, so reading a message has to move it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });
}

export const useSendMessage = () => useMessageMutation(sendMessage);
export const useReadMessage = () => useMessageMutation(readMessage);
export const useReadAllMessages = () => useMessageMutation(() => readAllMessages());
export const useDeleteMessage = () => useMessageMutation(deleteMessage);

export function useNotifications() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: getNotifications,
    enabled: token !== null,
    refetchInterval: DISTRICT_POLL_MS,
  });
}

function useNotificationMutation<TInput>(
  mutationFn: (input: TInput) => Promise<NotificationMutationResponse>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (response) => {
      queryClient.setQueryData(queryKeys.notifications, response.notifications);
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

export const useReadNotification = () => useNotificationMutation(readNotification);
export const useReadAllNotifications = () => useNotificationMutation(() => readAllNotifications());
export const useNotificationSettings = () => useNotificationMutation(setNotificationSettings);

/**
 * §B7: raise a captured gate.
 *
 * Invalidates the city, which is where the gate is drawn, and `/me`, which carries the stockpile
 * the order was just paid out of. Both, because a screen that shows the new level beside the old
 * caps is a screen that looks like the order was free.
 */
export function useRaiseGate() {
  return useGateWrite(raiseGate);
}

/** Call the level being raised off inside its first tenth. Same two caches, moved back. */
export function useCancelGateRaise() {
  return useGateWrite(cancelGateRaise);
}

function useGateWrite<TArgs>(mutationFn: (args: TArgs) => Promise<CityResponse>) {
  const queryClient = useQueryClient();
  return useMutation<CityResponse, ApiRequestError, TArgs>({
    mutationFn,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.city });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/**
 * §D5c: burn a fitted modification.
 *
 * Invalidates the units screen, which holds both the brackets and the shelf, and `/me`, whose
 * `fittedUpgrades` is the same fact from the district's side.
 */
export function useBurnUpgrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: burnUpgrade,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.units });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      // The Scrapyard's rows read `owned` off the same stock a burn just shrank. Without this the
      // bench kept showing the burned card as Built for the 30s `staleTime`, the one direction
      // `useBuildAddon` (which does invalidate `units`) did not cover.
      void queryClient.invalidateQueries({ queryKey: queryKeys.scrapyard });
    },
  });
}
