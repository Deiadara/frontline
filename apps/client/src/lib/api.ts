import {
  type BurnUpgradeRequest,
  type RaiseGateRequest,
  FactionResponseSchema,
  FactionMutationResponseSchema,
  MessagesResponseSchema,
  MessageMutationResponseSchema,
  NotificationsResponseSchema,
  NotificationMutationResponseSchema,
  type AdminResetRequest,
  type AnswerInviteRequest,
  type CreateFactionRequest,
  type LeaveFactionRequest,
  LeaderboardResponseSchema,
  ClaimAllResponseSchema,
  ClaimFeatResponseSchema,
  CrewProfileResponseSchema,
  FeatsResponseSchema,
  type ClaimFeatRequest,
  FactionProfileResponseSchema,
  type EditFactionDescriptionRequest,
  type LeaderboardBoard,
  type EditFactionIdentityRequest,
  type FactionMemberActionRequest,
  type SeatFactionMemberRequest,
  type InviteToFactionRequest,
  type NotificationSettingsRequest,
  type ReinforceRequest,
  type SendMessageRequest,
  ApiErrorSchema,
  ActionsResponseSchema,
  AutomationsResponseSchema,
  BattlesResponseSchema,
  BattleMutationResponseSchema,
  type DeclareBattleRequest,
  type DeployRequest,
  type LayTrapRequest,
  type BuyBattleBoostRequest,
  type LeadBattleRequest,
  type TakeVehiclesRequest,
  GarageResponseSchema,
  GarageMutationResponseSchema,
  type RecallColumnRequest,
  CrewResponseSchema,
  CrewMutationResponseSchema,
  AuthResponseSchema,
  BarResponseSchema,
  BaseDetailResponseSchema,
  CityMutationResponseSchema,
  DistrictDetailResponseSchema,
  MusterUnitsResponseSchema,
  UnitsResponseSchema,
  BuildStructureResponseSchema,
  BuildBoostResponseSchema,
  BuildAddonResponseSchema,
  ModificationSlotResponseSchema,
  ScrapyardResponseSchema,
  type BuyBuildBoostRequest,
  type BuildAddonRequest,
  type ClearModificationRequest,
  RenameDistrictResponseSchema,
  CityResponseSchema,
  CreateOverseerResponseSchema,
  OverseerChoicesResponseSchema,
  BidResponseSchema,
  LaunchMissionResponseSchema,
  MeResponseSchema,
  MissionsResponseSchema,
  ResearchResponseSchema,
  TrainingResponseSchema,
  CrewStandingResponseSchema,
  MarketResponseSchema,
  MarketMutationResponseSchema,
  ReimagineResponseSchema,
  BlackMarketResponseSchema,
  StackhouseResponseSchema,
  BlackMarketMutationResponseSchema,
  SettingsResponseSchema,
  AdminSnapshotSchema,
  AdminMutationResponseSchema,
  type UpgradeLocationRequest,
  type PlantSleepersRequest,
  type RecallSleepersRequest,
  type CancelMusterRequest,
  IncreasePayrollResponseSchema,
  ReleaseOfficerResponseSchema,
  type IncreasePayrollRequest,
  type UpgradeNotorietyRequest,
  type ReleaseOfficerRequest,
  type MusterUnitsRequest,
  type BuildStructureRequest,
  type RenameDistrictRequest,
  type CreateOverseerRequest,
  type BuySupplyRequest,
  type PlaceBidRequest,
  type SealBidRequest,
  type LaunchMissionInput,
  type SaveAutomationRequest,
  type LevelUp,
  type PartialResources,
  type LoginRequest,
  type RegisterRequest,
  type StartTrainingRequest,
  type StartTechRequest,
  type PlaceVendorBidRequest,
  type ReimagineRequest,
  type UnlockBlueprintRequest,
  type BarterRequest,
  type PostOfferRequest,
  type ClaimMarketRequest,
  type OfferActionRequest,
  type PlaceBlackMarketBidRequest,
  type PlaceStackhouseBetRequest,
  type TutorialSeenRequest,
  type UpdateProfileRequest,
  type ChangePasswordRequest,
  type AdminGrantRequest,
  type AdminKnobsRequest,
  type BuildVehicleRequest,
  type RecallMissionRequest,
  type ReassignOfficerRequest,
  type CancelBuildRequest,
  type CancelResearchRequest,
  type CancelLocationWorkRequest,
  type RecallSpyRequest,
  type MoveUnitsRequest,
  type RecallMoveRequest,
  DeployQuoteResponseSchema,
  FightLeaderQuoteResponseSchema,
  type FightLeaderQuoteRequest,
  MoveQuoteResponseSchema,
  type SpyRequest,
  type CancelGateRaiseRequest,
  type CancelDrillRequest,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
} from '@frontline/shared';
import { z } from 'zod';
import { useSession } from '../store/session';
import { askToWaste } from '../store/wasteConfirm';

/** All endpoints live under this prefix (proxied to the API server in dev). */
export const API_BASE_URL = '/api';

/** A typed, non-2xx API failure surfaced from the shared error envelope. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /**
     * A level-up the refused call banked before refusing (MOU-280). The server settles lazily on
     * the write paths, so a rejection can be the only response that ever carries one.
     */
    readonly levelUp?: LevelUp | undefined,
    /** `WOULD_WASTE`: what the request would have thrown away, for the question put to the player. */
    readonly waste?: PartialResources | undefined,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * The code a request carries when the player said no to the waste warning.
 *
 * Its message is empty on purpose: the player has just answered a dialog, and nothing went wrong
 * that a red note under the button could add to. `ErrorNote` draws nothing for an empty refusal.
 */
export const WASTE_DECLINED = 'WASTE_DECLINED';

/**
 * A request that can credit more than the stores hold, asked about first (maintainer ruling,
 * 2026-09-28).
 *
 * Sent without the flag; a `WOULD_WASTE` refusal puts the server's figure to the player through
 * `askToWaste`, and a yes sends the same request again with `acceptWaste`. Here in the fetch layer
 * rather than on each screen, so every button that can waste asks the same question the same way
 * and a new one cannot forget to.
 */
async function mindingWaste<T>(send: (acceptWaste: true | undefined) => Promise<T>): Promise<T> {
  try {
    return await send(undefined);
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.code !== 'WOULD_WASTE' || !error.waste) {
      throw error;
    }
    if (!(await askToWaste(error.waste))) {
      throw new ApiRequestError(error.status, WASTE_DECLINED, '');
    }
    return send(true);
  }
}

/**
 * What every request carries besides its body.
 *
 * The session rides an httpOnly cookie the page never sees (`apps/server/src/auth/session.ts`), so
 * there is no credential to attach. `CSRF_HEADER` is what lets a write through with that cookie:
 * the server refuses one without it, because another site's form cannot set a header. Exported for
 * the live channel, which reads with `fetch` rather than through `apiFetch`.
 */
export function apiHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set('Content-Type', 'application/json');
  headers.set(CSRF_HEADER, CSRF_HEADER_VALUE);
  return headers;
}

/**
 * Cookies go to this origin and no other. The API is same-origin everywhere the game runs (the Vite
 * proxy in development, Caddy in production), so `same-origin`, fetch's own default, is spelled out
 * to say that the cookie is the credential. `include` would only differ for another origin, and
 * that is exactly where the session must not go.
 */
export const API_CREDENTIALS: RequestCredentials = 'same-origin';

/**
 * Typed fetch wrapper. Attaches the JSON and CSRF headers, validates every 2xx body with `schema`,
 * and turns non-2xx responses into a typed `ApiRequestError` (clearing the session on `401`).
 */
export async function apiFetch<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): Promise<z.infer<Schema>> {
  const { epoch } = useSession.getState();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: apiHeaders(init?.headers),
    credentials: API_CREDENTIALS,
  });

  if (!res.ok) {
    /*
     * A login lasts thirty days and is renewed while the player plays, as a fresh cookie on any
     * answer. A password change or "log out everywhere" hands this tab its only surviving session
     * the same way, and ends every other one.
     *
     * So a 401 signs the tab out only if no rotation has happened since this request left. A poll
     * that left before "log out everywhere" comes back 401 after the tab has already been handed
     * its new cookie; acting on it signed out the one session that was meant to survive.
     */
    if (res.status === 401 && useSession.getState().epoch === epoch) {
      useSession.getState().logout();
    }
    const parsed = ApiErrorSchema.safeParse(await res.json().catch(() => null));
    const { code, message } = parsed.success
      ? parsed.data.error
      : { code: 'UNKNOWN', message: res.statusText || 'Request failed' };
    throw new ApiRequestError(res.status, code, message, parsed.data?.levelUp, parsed.data?.waste);
  }

  return schema.parse(await readJson(res, path));
}

/**
 * The body of a 2xx, or an `ApiRequestError` explaining what arrived instead.
 *
 * `res.json()` throws a bare `SyntaxError` on anything that is not JSON, and every screen's error
 * branch is written for `ApiRequestError`: a captive portal, a proxy error page or a dev-server
 * misroute answering 200 with HTML therefore surfaced to the player as
 * "Unexpected token < in JSON at position 0", which tells them nothing and tells us less. The
 * status is the useful fact and it is already in hand, so it is kept.
 */
async function readJson(res: Response, path: string): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ApiRequestError(
      res.status,
      'BAD_RESPONSE',
      `${path} answered ${res.status} with something that is not JSON.`,
    );
  }
}

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

// --- one thin function per endpoint in docs/SPEC-server.md ---

export const register = (body: RegisterRequest) =>
  apiFetch('/auth/register', AuthResponseSchema, jsonBody(body));

export const login = (body: LoginRequest) =>
  apiFetch('/auth/login', AuthResponseSchema, jsonBody(body));

const OkSchema = z.object({ ok: z.literal(true) });

/**
 * Signs this browser out. The server drops the cookie, since the page cannot touch an httpOnly
 * one; the page forgets the session whether or not that answer arrives, so a player pressing Log
 * out is never left looking at the game.
 */
export async function signOut(): Promise<void> {
  try {
    await apiFetch('/auth/logout', OkSchema, jsonBody({}));
  } finally {
    useSession.getState().logout();
  }
}

/**
 * A call the server answers with a new session for this tab, ending every other one. Marked once it
 * lands, so the 401s that requests still in flight on the old session bring back are not taken for
 * this tab's own (see `apiFetch`).
 */
async function rotatingSession<T>(send: () => Promise<T>): Promise<T> {
  const answer = await send();
  useSession.getState().rotated();
  return answer;
}

export const getMe = () => apiFetch('/me', MeResponseSchema);

export const createOverseer = (body: CreateOverseerRequest) =>
  apiFetch('/overseer', CreateOverseerResponseSchema, jsonBody(body));

/** §F6: the four this account may pick from, and how much of the pool is left. */
export const getOverseerChoices = () =>
  apiFetch('/overseer/choices', OverseerChoicesResponseSchema);

/**
 * §A4: the map of a city and its holdings.
 *
 * `city` is left off for the crew's own, the way `getBar` and `getMarket` take it. The map's door
 * is looser than a room's, though: any city with ground drawn for it answers, held or not, because
 * looking at a city is how a player decides to take something in it (`routes/city.ts`).
 */
export const getCity = (city?: string) =>
  apiFetch(
    city === undefined ? '/city' : `/city?city=${encodeURIComponent(city)}`,
    CityResponseSchema,
  );

export const getBase = (id: string) => apiFetch(`/base/${id}`, BaseDetailResponseSchema);

export const buildStructure = (body: BuildStructureRequest) =>
  apiFetch('/base/build', BuildStructureResponseSchema, jsonBody(body));

export const renameDistrict = (body: RenameDistrictRequest) =>
  apiFetch('/base/district-name', RenameDistrictResponseSchema, jsonBody(body));

/** §B4: light the Generator's two-hour burn. */
export const buyBuildBoost = (body: BuyBuildBoostRequest) =>
  apiFetch('/base/boost', BuildBoostResponseSchema, jsonBody(body));

/**
 * §E: empty one of a structure's three brackets.
 *
 * Filling one is not a route any more (2026-09-16): the yard cuts a card for a named structure and
 * bolts it in on the same press, so `POST /base/modifications/fit` is gone and this is the only
 * half left.
 */
export const clearModification = (body: ClearModificationRequest) =>
  apiFetch('/base/modifications/clear', ModificationSlotResponseSchema, jsonBody(body));

/** §B9: the Scrapyard's own page. */
export const getScrapyard = () => apiFetch('/scrapyard', ScrapyardResponseSchema);

export const buildAddon = (body: BuildAddonRequest) =>
  apiFetch('/scrapyard/build', BuildAddonResponseSchema, jsonBody(body));

export const getDistrict = (id: string) => apiFetch(`/city/${id}`, DistrictDetailResponseSchema);

/** §A4: plant a cell of Sleepers on ground this crew does not hold (`sleepers.ts`). */
export const plantSleepers = (body: PlantSleepersRequest) =>
  apiFetch('/city/sleepers', CityMutationResponseSchema, jsonBody(body));

/** ...and pull one back out. They walk home the leg they walked out. */
export const recallSleepers = (body: RecallSleepersRequest) =>
  apiFetch('/city/sleepers/recall', z.object({ ok: z.literal(true) }), jsonBody(body));

/** §A4: work a location you hold up one level. */
export const upgradeLocation = (body: UpgradeLocationRequest) =>
  apiFetch('/city/upgrade', CityMutationResponseSchema, jsonBody(body));

// --- declared battles and the §D7 sinks ---

export const getBattles = () => apiFetch('/battles', BattlesResponseSchema);

export const declareBattle = (body: DeclareBattleRequest) =>
  apiFetch('/battles/declare', BattleMutationResponseSchema, jsonBody(body));

export const deployToBattle = (body: DeployRequest) =>
  apiFetch('/battles/deploy', BattleMutationResponseSchema, jsonBody(body));

/**
 * What this column's road actually costs, answered by the server with nothing moved.
 *
 * The same body as the deploy and the same answer shape as `POST /actions/move/quote`, because it
 * is the same two questions: how long the march takes, and whether Terminus's line has a ride to
 * offer instead.
 *
 * It exists because the window could not work the first one out. `travelMinutesBetween` spends
 * three channels the server reads off `standingEffectsFor` and none of them is on `BattleView`:
 * `unitSpeedPercent` on the column's pace, `travelSpeedPercent` and `roadMinutesOff` on the clock.
 * A screen quoting the road from the catalogue alone therefore promised a longer journey than the
 * crew makes, and labelled it "at most" to stay honest about it. One request is cheaper than
 * teaching the client a fold it cannot see, and it is what the Move dialog already does.
 */
export const quoteDeploy = (body: DeployRequest) =>
  apiFetch('/battles/deploy/quote', DeployQuoteResponseSchema, jsonBody(body));

/** Who should lead a fight job with this force: every leader on the bench, best first. */
export const quoteFightLeaders = (body: FightLeaderQuoteRequest) =>
  apiFetch('/missions/leaders/quote', FightLeaderQuoteResponseSchema, jsonBody(body));

export const layTrap = (body: LayTrapRequest) =>
  apiFetch('/battles/trap', BattleMutationResponseSchema, jsonBody(body));

export const buyBattleBoost = (body: BuyBattleBoostRequest) =>
  apiFetch('/battles/boost', BattleMutationResponseSchema, jsonBody(body));

export const leadBattle = (body: LeadBattleRequest) =>
  apiFetch('/battles/lead', BattleMutationResponseSchema, jsonBody(body));

/** Names the rung the screen showed, so a second press cannot buy a second rank (`STALE_STATE`). */
export const upgradeNotoriety = (body: UpgradeNotorietyRequest) =>
  apiFetch('/battles/notoriety', BattleMutationResponseSchema, jsonBody(body));

export const getActions = () => apiFetch('/actions', ActionsResponseSchema);

/** §C2b: the Right Hand's standing orders, and what the ladder lets them do. */
export const getAutomations = () => apiFetch('/automations', AutomationsResponseSchema);
export const saveAutomation = (body: SaveAutomationRequest) =>
  apiFetch('/automations', AutomationsResponseSchema, jsonBody(body));

export const recallColumn = (body: RecallColumnRequest) =>
  apiFetch('/actions/recall', ActionsResponseSchema, jsonBody(body));

export const releaseOfficer = (body: ReleaseOfficerRequest) =>
  apiFetch('/bar/release', ReleaseOfficerResponseSchema, jsonBody(body));

export const increasePayroll = (body: IncreasePayrollRequest) =>
  apiFetch('/bar/payroll', IncreasePayrollResponseSchema, jsonBody(body));

export const getUnits = () => apiFetch('/units', UnitsResponseSchema);

export const musterUnits = (body: MusterUnitsRequest) =>
  apiFetch('/units/muster', MusterUnitsResponseSchema, jsonBody(body));

export const cancelMuster = (body: CancelMusterRequest) =>
  mindingWaste((acceptWaste) =>
    apiFetch('/units/cancel', MusterUnitsResponseSchema, jsonBody({ ...body, acceptWaste })),
  );

export const getMissions = (city?: string) =>
  apiFetch(
    city === undefined ? '/missions' : `/missions?city=${encodeURIComponent(city)}`,
    MissionsResponseSchema,
  );

export const launchMission = (body: LaunchMissionInput) =>
  apiFetch('/missions', LaunchMissionResponseSchema, jsonBody(body));

/**
 * The Bar, in whichever city was asked for.
 *
 * `city` is left off for the crew's own, which is what the server answers a bare read with: a query
 * string naming the city a player has never left would be noise on every request the screen makes.
 */
export const getBar = (city?: string) =>
  apiFetch(
    city === undefined ? '/bar' : `/bar?city=${encodeURIComponent(city)}`,
    BarResponseSchema,
  );

/**
 * §H7: an open bid on one of tonight's tables.
 *
 * Refused with an ordinary `AppError` when the table has sealed, when the crew is already at its
 * table cap, or when the amount does not clear the leader by the increment. The reason is the
 * server's own sentence, so the screen prints it rather than guessing which of the three it was.
 */
export const placeBid = (body: PlaceBidRequest) =>
  apiFetch('/bar/bid', BidResponseSchema, jsonBody(body));

/** §H7: the one secret final value a crew may lock in the last half hour. It cannot be changed. */
export const sealBid = (body: SealBidRequest) =>
  apiFetch('/bar/seal', BidResponseSchema, jsonBody(body));

export const getResearch = () => apiFetch('/research', ResearchResponseSchema);

export const startTech = (body: StartTechRequest) =>
  apiFetch('/research/tech', ResearchResponseSchema, jsonBody(body));

export const getCrew = () => apiFetch('/crew', CrewResponseSchema);

export const getTraining = () => apiFetch('/training', TrainingResponseSchema);

export const startTraining = (body: StartTrainingRequest) =>
  apiFetch('/training', TrainingResponseSchema, jsonBody(body));

export const getCrewStanding = () => apiFetch('/overseer/me', CrewStandingResponseSchema);

/**
 * The market, in whichever city was asked for.
 *
 * `city` is left off for the crew's own, which is what the server answers a bare read with: see
 * `getBar`, which carries the same rule for the same reason.
 */
export const getMarket = (city?: string) =>
  apiFetch(
    city === undefined ? '/market' : `/market?city=${encodeURIComponent(city)}`,
    MarketResponseSchema,
  );

/**
 * A bid on one of the Runner's lots. Every line on the barrow is an auction now: the highest
 * bidder when he packs up takes one and pays what they bid, so there is no buying, only bidding.
 * Refused in the server's own words when he is out, the lot is gone, the crew is already leading,
 * the figure does not clear the leader by the step, or the caps are not there.
 */
export const placeVendorBid = (body: PlaceVendorBidRequest) =>
  apiFetch('/market/bid', MarketMutationResponseSchema, jsonBody(body));

/** §D10: spend one of every page and take the finished document. Answers with the inventory. */
export const unlockBlueprint = (body: UnlockBlueprintRequest) =>
  apiFetch('/blueprints/unlock', MarketMutationResponseSchema, jsonBody(body));

/** §G2: the Reimagining trade. The body is the three pages the player put in the sockets. */
export const reimagine = (body: ReimagineRequest) =>
  apiFetch('/blueprints/reimagine', ReimagineResponseSchema, jsonBody(body));

// Every market write that can put goods into the stores asks before it wastes any.
const marketWrite = <Body extends object>(path: string, body: Body) =>
  mindingWaste((acceptWaste) =>
    apiFetch(path, MarketMutationResponseSchema, jsonBody({ ...body, acceptWaste })),
  );

export const buySupply = (body: BuySupplyRequest) => marketWrite('/market/supply', body);

export const barterResources = (body: BarterRequest) => marketWrite('/market/barter', body);

// Posting only takes goods out, into escrow: what the listing brings in waits for a claim.
export const postOffer = (body: PostOfferRequest) =>
  apiFetch('/market/offer', MarketMutationResponseSchema, jsonBody(body));

export const withdrawOffer = (body: OfferActionRequest) => marketWrite('/market/withdraw', body);

export const acceptOffer = (body: OfferActionRequest) => marketWrite('/market/accept', body);

/** Goods the board is holding for this crew (`MarketClaim`), into the stores. */
export const claimMarketGoods = (body: ClaimMarketRequest) => marketWrite('/market/claim', body);

/**
 * The back room. Its own endpoint, because it spends infamy rather than the stockpile.
 *
 * `city` the way `getMarket` and `getBar` take it: a crew may stand in the back room of any city it
 * holds ground in, and the server refuses a city it holds none in.
 */
export const getBlackMarket = (city?: string) =>
  apiFetch(
    city === undefined ? '/black-market' : `/black-market?city=${encodeURIComponent(city)}`,
    BlackMarketResponseSchema,
  );

export const placeBlackMarketBid = (body: PlaceBlackMarketBidRequest) =>
  apiFetch('/black-market/bid', BlackMarketMutationResponseSchema, jsonBody(body));

/** The Stackhouse's book: the fights this crew may bet on, and its one bet riding. */
export const getStackhouse = () => apiFetch('/black-market/stackhouse', StackhouseResponseSchema);

export const placeStackhouseBet = (body: PlaceStackhouseBetRequest) =>
  apiFetch('/black-market/stackhouse/bet', StackhouseResponseSchema, jsonBody(body));

export const getSettings = () => apiFetch('/settings', SettingsResponseSchema);

export const updateProfile = (body: UpdateProfileRequest) =>
  apiFetch('/settings/profile', SettingsResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const changePassword = (body: ChangePasswordRequest) =>
  rotatingSession(() => apiFetch('/settings/password', SettingsResponseSchema, jsonBody(body)));

/** Ends every session this account has open except this tab's, which is handed a new cookie. */
export const logoutEverywhere = () =>
  rotatingSession(() => apiFetch('/auth/logout-all', OkSchema, jsonBody({})));

/** Records opening tutorial cards as shown. Skip is this call carrying every step. */
export const markTutorialSeen = (body: TutorialSeenRequest) =>
  apiFetch('/settings/tutorial', SettingsResponseSchema, jsonBody(body));

/**
 * The admin console.
 *
 * A 404 here is not an error state to show, it is the answer "there is no bench in this build":
 * see `routes/admin.ts`. The hook that calls it turns that one status into `null` rather than
 * letting the screen render a failure a player was never meant to know about.
 */
export const getAdmin = () => apiFetch('/admin', AdminSnapshotSchema);

export const setAdminKnobs = (body: AdminKnobsRequest) =>
  apiFetch('/admin/knobs', AdminMutationResponseSchema, jsonBody(body));

/** The Console's grants: documents, pages, parts and rungs for testing the yard at any stage. */
export const grantAdmin = (body: AdminGrantRequest) =>
  apiFetch('/admin/grant', AdminMutationResponseSchema, jsonBody(body));

/** §Console: this crew back to its first second, character included. */
/** Clean slate. `successorId` is who leads the old life's faction after it (`canNameSuccessor`). */
export const resetAdmin = (successorId?: string) =>
  apiFetch(
    '/admin/reset',
    AdminMutationResponseSchema,
    jsonBody({ successorId } satisfies AdminResetRequest),
  );

/** The console's mock: somebody else in the city calls a fight on the reviewer's ground. */
export const mockBattleOnMe = () =>
  apiFetch('/admin/mock-battle', AdminMutationResponseSchema, jsonBody({}));

// §B11: the yard has its own page now.
export const getGarage = () => apiFetch('/garage', GarageResponseSchema);

export const buildVehicle = (body: BuildVehicleRequest) =>
  apiFetch('/garage/build', GarageMutationResponseSchema, jsonBody(body));

export const takeVehicles = (body: TakeVehiclesRequest) =>
  apiFetch('/battles/vehicles', BattleMutationResponseSchema, jsonBody(body));

export const recallMission = (body: RecallMissionRequest) =>
  apiFetch('/missions/recall', MissionsResponseSchema, jsonBody(body));

export const reassignOfficer = (body: ReassignOfficerRequest) =>
  apiFetch('/crew/reassign', CrewMutationResponseSchema, jsonBody(body));

// --- factions, messages and notifications (maintainer request) ---

export const getFaction = () => apiFetch('/factions', FactionResponseSchema);

export const createFaction = (body: CreateFactionRequest) =>
  apiFetch('/factions', FactionMutationResponseSchema, jsonBody(body));

export const editFactionIdentity = (body: EditFactionIdentityRequest) =>
  apiFetch('/factions/identity', FactionMutationResponseSchema, jsonBody(body));

export const editFactionDescription = (body: EditFactionDescriptionRequest) =>
  apiFetch('/factions/description', FactionMutationResponseSchema, jsonBody(body));

export const inviteToFaction = (body: InviteToFactionRequest) =>
  apiFetch('/factions/invite', FactionMutationResponseSchema, jsonBody(body));

export const answerFactionInvite = (body: AnswerInviteRequest) =>
  apiFetch('/factions/answer', FactionMutationResponseSchema, jsonBody(body));

/** Walking out. A leader may name `successorId` to lead after them; without one it disbands. */
export const leaveFaction = (successorId?: string) =>
  apiFetch(
    '/factions/leave',
    FactionMutationResponseSchema,
    jsonBody({ successorId } satisfies LeaveFactionRequest),
  );

/**
 * The standings (§J9). A GET with the board and the scope in the query string, because it is a
 * read and a player should be able to sit on it with the browser's own refresh.
 */
export const getLeaderboard = (board: LeaderboardBoard, localOnly: boolean) =>
  apiFetch(
    `/leaderboard?board=${board}&localOnly=${localOnly ? 'true' : 'false'}`,
    LeaderboardResponseSchema,
  );

/**
 * A crew's file, by crew id or by owner id (maintainer request, 2026-09-11). Public: the same page for
 * you and for everybody else, so it takes whichever id the link that led here happened to hold.
 */
export const getCrewProfile = (id: string) =>
  apiFetch(`/crews/${encodeURIComponent(id)}`, CrewProfileResponseSchema);

/**
 * A faction's file, by faction id (maintainer request, 2026-09-12). Public: the same page for the table
 * you sit at and for the one across the city, so every badge in the game has somewhere to click to.
 */
export const getFactionProfile = (id: string) =>
  apiFetch(`/factions/${encodeURIComponent(id)}/profile`, FactionProfileResponseSchema);

/** The feats screen: progress only, joined to the catalogue the client already has. */
export const getFeats = () => apiFetch('/feats', FeatsResponseSchema);

export const claimFeat = (body: ClaimFeatRequest) =>
  apiFetch('/feats/claim', ClaimFeatResponseSchema, jsonBody(body));

/** The whole backlog in one write. See the route: one press per rung runs into the write limiter. */
export const claimAllFeats = () =>
  apiFetch('/feats/claim-all', ClaimAllResponseSchema, jsonBody({}));

export const disbandFaction = () =>
  apiFetch('/factions/disband', FactionMutationResponseSchema, jsonBody({}));

export const factionMemberAction = (body: FactionMemberActionRequest) =>
  apiFetch('/factions/member', FactionMutationResponseSchema, jsonBody(body));

export const seatFactionMember = (body: SeatFactionMemberRequest) =>
  apiFetch('/factions/seat', FactionMutationResponseSchema, jsonBody(body));

export const reinforceAlly = (body: ReinforceRequest) =>
  apiFetch('/factions/reinforce', FactionMutationResponseSchema, jsonBody(body));

export const getMessages = () => apiFetch('/messages', MessagesResponseSchema);

export const sendMessage = (body: SendMessageRequest) =>
  apiFetch('/messages', MessageMutationResponseSchema, jsonBody(body));

export const readMessage = (body: { id: string }) =>
  apiFetch('/messages/read', MessageMutationResponseSchema, jsonBody(body));

export const readAllMessages = () =>
  apiFetch('/messages/read-all', MessageMutationResponseSchema, jsonBody({}));

export const deleteMessage = (body: { id: string }) =>
  apiFetch('/messages/delete', MessageMutationResponseSchema, jsonBody(body));

/** Stop, or start again, taking letters from one player (maintainer, 2026-10-02). */
export const blockSender = (body: { userId: string; blocked: boolean }) =>
  apiFetch('/messages/block', MessageMutationResponseSchema, jsonBody(body));

export const getNotifications = () => apiFetch('/notifications', NotificationsResponseSchema);

export const readNotification = (body: { id: string }) =>
  apiFetch('/notifications/read', NotificationMutationResponseSchema, jsonBody(body));

export const readAllNotifications = () =>
  apiFetch('/notifications/read-all', NotificationMutationResponseSchema, jsonBody({}));

export const setNotificationSettings = (body: NotificationSettingsRequest) =>
  apiFetch('/notifications/settings', NotificationMutationResponseSchema, jsonBody(body));

/** §B7: raise the gate on a district this crew has taken whole. */
export const raiseGate = (body: RaiseGateRequest) =>
  apiFetch<typeof CityResponseSchema>('/city/gate', CityResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });

/*
 * Changing your mind (maintainer request, 2026-09-12; `time/cancel.ts` in the shared package).
 *
 * Seven writes, one rule: inside the first tenth of a thing's own clock it can be called off, and
 * a spend called off comes back at ninety percent. Each answers with the same shape its start
 * counterpart does, so the caches the start wrote are the caches the cancel writes.
 */
export const cancelBuild = (body: CancelBuildRequest) =>
  mindingWaste((acceptWaste) =>
    apiFetch('/base/cancel', BuildStructureResponseSchema, jsonBody({ ...body, acceptWaste })),
  );

export const cancelResearch = (body: CancelResearchRequest) =>
  mindingWaste((acceptWaste) =>
    apiFetch('/research/cancel', ResearchResponseSchema, jsonBody({ ...body, acceptWaste })),
  );

export const cancelLocationUpgrade = (body: CancelLocationWorkRequest) =>
  mindingWaste((acceptWaste) =>
    apiFetch(
      '/city/cancel-upgrade',
      CityMutationResponseSchema,
      jsonBody({ ...body, acceptWaste }),
    ),
  );

/** Spying (2026-09-22): one place, one tier, the caps taken at the send. */
export const spyOn = (body: SpyRequest) =>
  apiFetch('/city/spy', CityMutationResponseSchema, jsonBody(body));

/** The runners walk home without a report. The caps stay spent. */
export const recallSpy = (body: RecallSpyRequest) =>
  apiFetch('/city/spy/recall', CityMutationResponseSchema, jsonBody(body));

/** Moving units between the crew's own places (2026-09-22). */
export const moveUnits = (body: MoveUnitsRequest) =>
  apiFetch('/actions/move', ActionsResponseSchema, jsonBody(body));

export const quoteMove = (body: MoveUnitsRequest) =>
  apiFetch('/actions/move/quote', MoveQuoteResponseSchema, jsonBody(body));

export const recallMove = (body: RecallMoveRequest) =>
  apiFetch('/actions/move/recall', ActionsResponseSchema, jsonBody(body));

export const cancelGateRaise = (body: CancelGateRaiseRequest) =>
  mindingWaste((acceptWaste) =>
    apiFetch('/city/gate/cancel', CityResponseSchema, jsonBody({ ...body, acceptWaste })),
  );

export const cancelDrill = (body: CancelDrillRequest) =>
  apiFetch('/training/cancel', TrainingResponseSchema, jsonBody(body));

/** §D5c: burn a fitted modification. It is destroyed, not returned to the shelf. */
export const burnUpgrade = (body: BurnUpgradeRequest) =>
  apiFetch<typeof UnitsResponseSchema>('/units/burn', UnitsResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
