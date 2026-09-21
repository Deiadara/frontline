import {
  type BurnUpgradeRequest,
  type RaiseGateRequest,
  FactionResponseSchema,
  FactionMutationResponseSchema,
  MessagesResponseSchema,
  MessageMutationResponseSchema,
  NotificationsResponseSchema,
  NotificationMutationResponseSchema,
  type AnswerInviteRequest,
  type CreateFactionRequest,
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
  type InviteToFactionRequest,
  type NotificationSettingsRequest,
  type ReinforceRequest,
  type SendMessageRequest,
  ApiErrorSchema,
  ActionsResponseSchema,
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
  TrainUnitsResponseSchema,
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
  BlackMarketMutationResponseSchema,
  SettingsResponseSchema,
  AdminSnapshotSchema,
  AdminMutationResponseSchema,
  type FortifyRequest,
  type UpgradeLocationRequest,
  type GarrisonRequest,
  type PlantSleepersRequest,
  type RecallSleepersRequest,
  type ScoutRequest,
  type CancelTrainingRequest,
  IncreasePayrollResponseSchema,
  ReleaseOfficerResponseSchema,
  type IncreasePayrollRequest,
  type UpgradeNotorietyRequest,
  type ReleaseOfficerRequest,
  type TrainUnitsRequest,
  type BuildStructureRequest,
  type RenameDistrictRequest,
  type CreateOverseerRequest,
  type BuySupplyRequest,
  type PlaceBidRequest,
  type SealBidRequest,
  type LaunchMissionInput,
  type LevelUp,
  type LoginRequest,
  type RegisterRequest,
  type StartTrainingRequest,
  type StartTechRequest,
  type PlaceVendorBidRequest,
  type ReimagineRequest,
  type UnlockBlueprintRequest,
  type BarterRequest,
  type PostOfferRequest,
  type OfferActionRequest,
  type PlaceBlackMarketBidRequest,
  type UpdateProfileRequest,
  type ChangePasswordRequest,
  type AdminFogRequest,
  type AdminGrantRequest,
  type AdminKnobsRequest,
  type BuildVehicleRequest,
  type RecallMissionRequest,
  type ReassignOfficerRequest,
  type CancelBuildRequest,
  type CancelResearchRequest,
  type CancelLocationWorkRequest,
  type RecallScoutRequest,
  type CancelGateRaiseRequest,
  type CancelDrillRequest,
} from '@frontline/shared';
import { z } from 'zod';
import { useSession } from '../store/session';

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
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Typed fetch wrapper. Attaches auth + JSON headers, validates every 2xx body
 * with `schema`, and turns non-2xx responses into a typed `ApiRequestError`
 * (clearing the session on `401`).
 */
export async function apiFetch<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init?: RequestInit,
): Promise<z.infer<Schema>> {
  const { token } = useSession.getState();
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    if (res.status === 401) useSession.getState().logout();
    const parsed = ApiErrorSchema.safeParse(await res.json().catch(() => null));
    const { code, message } = parsed.success
      ? parsed.data.error
      : { code: 'UNKNOWN', message: res.statusText || 'Request failed' };
    throw new ApiRequestError(res.status, code, message, parsed.data?.levelUp);
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

export const getMe = () => apiFetch('/me', MeResponseSchema);

export const createOverseer = (body: CreateOverseerRequest) =>
  apiFetch('/overseer', CreateOverseerResponseSchema, jsonBody(body));

/** §F6: the four this account may pick from, and how much of the pool is left. */
export const getOverseerChoices = () =>
  apiFetch('/overseer/choices', OverseerChoicesResponseSchema);

export const getCity = () => apiFetch('/city', CityResponseSchema);

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

export const scoutDistrict = (body: ScoutRequest) =>
  apiFetch('/city/scout', CityMutationResponseSchema, jsonBody(body));

export const setGarrison = (body: GarrisonRequest) =>
  apiFetch('/city/garrison', CityMutationResponseSchema, jsonBody(body));

/** §A4: plant a cell of Sleepers on ground this crew does not hold (`sleepers.ts`). */
export const plantSleepers = (body: PlantSleepersRequest) =>
  apiFetch('/city/sleepers', CityMutationResponseSchema, jsonBody(body));

/** ...and pull one back out. They walk home the leg they walked out. */
export const recallSleepers = (body: RecallSleepersRequest) =>
  apiFetch('/city/sleepers/recall', z.object({ ok: z.literal(true) }), jsonBody(body));

export const fortifyLocation = (body: FortifyRequest) =>
  apiFetch('/city/fortify', CityMutationResponseSchema, jsonBody(body));

/** §A4: work a location you hold up one level. */
export const upgradeLocation = (body: UpgradeLocationRequest) =>
  apiFetch('/city/upgrade', CityMutationResponseSchema, jsonBody(body));

// --- declared battles and the §D7 sinks ---

export const getBattles = () => apiFetch('/battles', BattlesResponseSchema);

export const declareBattle = (body: DeclareBattleRequest) =>
  apiFetch('/battles/declare', BattleMutationResponseSchema, jsonBody(body));

export const deployToBattle = (body: DeployRequest) =>
  apiFetch('/battles/deploy', BattleMutationResponseSchema, jsonBody(body));

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

export const recallColumn = (body: RecallColumnRequest) =>
  apiFetch('/actions/recall', ActionsResponseSchema, jsonBody(body));

export const releaseOfficer = (body: ReleaseOfficerRequest) =>
  apiFetch('/bar/release', ReleaseOfficerResponseSchema, jsonBody(body));

export const increasePayroll = (body: IncreasePayrollRequest) =>
  apiFetch('/bar/payroll', IncreasePayrollResponseSchema, jsonBody(body));

export const getUnits = () => apiFetch('/units', UnitsResponseSchema);

export const trainUnits = (body: TrainUnitsRequest) =>
  apiFetch('/units/train', TrainUnitsResponseSchema, jsonBody(body));

export const cancelTraining = (body: CancelTrainingRequest) =>
  apiFetch('/units/cancel', TrainUnitsResponseSchema, jsonBody(body));

export const getMissions = () => apiFetch('/missions', MissionsResponseSchema);

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

export const buySupply = (body: BuySupplyRequest) =>
  apiFetch('/market/supply', MarketMutationResponseSchema, jsonBody(body));

export const barterResources = (body: BarterRequest) =>
  apiFetch('/market/barter', MarketMutationResponseSchema, jsonBody(body));

export const postOffer = (body: PostOfferRequest) =>
  apiFetch('/market/offer', MarketMutationResponseSchema, jsonBody(body));

export const withdrawOffer = (body: OfferActionRequest) =>
  apiFetch('/market/withdraw', MarketMutationResponseSchema, jsonBody(body));

export const acceptOffer = (body: OfferActionRequest) =>
  apiFetch('/market/accept', MarketMutationResponseSchema, jsonBody(body));

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

export const getSettings = () => apiFetch('/settings', SettingsResponseSchema);

export const updateProfile = (body: UpdateProfileRequest) =>
  apiFetch('/settings/profile', SettingsResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const changePassword = (body: ChangePasswordRequest) =>
  apiFetch('/settings/password', SettingsResponseSchema, jsonBody(body));

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
export const resetAdmin = () => apiFetch('/admin/reset', AdminMutationResponseSchema, jsonBody({}));

/** Show or hide one district on the Console's fog of war. */
export const setAdminFog = (body: AdminFogRequest) =>
  apiFetch('/admin/fog', AdminMutationResponseSchema, jsonBody(body));

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

export const leaveFaction = () =>
  apiFetch('/factions/leave', FactionMutationResponseSchema, jsonBody({}));

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
  apiFetch('/base/cancel', BuildStructureResponseSchema, jsonBody(body));

export const cancelResearch = (body: CancelResearchRequest) =>
  apiFetch('/research/cancel', ResearchResponseSchema, jsonBody(body));

export const cancelLocationUpgrade = (body: CancelLocationWorkRequest) =>
  apiFetch('/city/cancel-upgrade', CityMutationResponseSchema, jsonBody(body));

export const cancelLocationFortify = (body: CancelLocationWorkRequest) =>
  apiFetch('/city/cancel-fortify', CityMutationResponseSchema, jsonBody(body));

/** A journey pays back time rather than caps: the scout walks home the distance covered. */
export const recallScout = (body: RecallScoutRequest) =>
  apiFetch('/city/scout/recall', CityMutationResponseSchema, jsonBody(body));

export const cancelGateRaise = (body: CancelGateRaiseRequest) =>
  apiFetch('/city/gate/cancel', CityResponseSchema, jsonBody(body));

export const cancelDrill = (body: CancelDrillRequest) =>
  apiFetch('/training/cancel', TrainingResponseSchema, jsonBody(body));

/** §D5c: burn a fitted modification. It is destroyed, not returned to the shelf. */
export const burnUpgrade = (body: BurnUpgradeRequest) =>
  apiFetch<typeof UnitsResponseSchema>('/units/burn', UnitsResponseSchema, {
    method: 'POST',
    body: JSON.stringify(body),
  });
