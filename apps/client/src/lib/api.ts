import {
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
  type FortifyStructureRequest,
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
  type FitModificationRequest,
  RenameDistrictResponseSchema,
  CityResponseSchema,
  CreateOverseerResponseSchema,
  HireRecruitResponseSchema,
  NegotiateResponseSchema,
  LaunchMissionResponseSchema,
  MeResponseSchema,
  MissionsResponseSchema,
  ResearchResponseSchema,
  TrainingResponseSchema,
  CrewStandingResponseSchema,
  MarketResponseSchema,
  MarketMutationResponseSchema,
  BlackMarketResponseSchema,
  BlackMarketMutationResponseSchema,
  SettingsResponseSchema,
  AdminSnapshotSchema,
  AdminMutationResponseSchema,
  WorkshopResponseSchema,
  WorkshopMutationResponseSchema,
  StartResearchResponseSchema,
  type FortifyRequest,
  type UpgradeLocationRequest,
  type GarrisonRequest,
  type ScoutRequest,
  type CancelTrainingRequest,
  IncreasePayrollResponseSchema,
  ReleaseOfficerResponseSchema,
  type FitSlotRequest,
  type IncreasePayrollRequest,
  type ReleaseOfficerRequest,
  type TrainUnitsRequest,
  type BuildStructureRequest,
  type RenameDistrictRequest,
  type CreateOverseerRequest,
  type BuySupplyRequest,
  type HireRecruitRequest,
  type NegotiateRequest,
  type LaunchMissionInput,
  type LevelUp,
  type LoginRequest,
  type RegisterRequest,
  type StartResearchRequest,
  type StartTrainingRequest,
  type StartTechRequest,
  type BuyFromVendorRequest,
  type BarterRequest,
  type PostOfferRequest,
  type OfferActionRequest,
  type TakeBlackMarketRequest,
  type UpdateProfileRequest,
  type ChangePasswordRequest,
  type AdminKnobsRequest,
  type FitUpgradeRequest,
  type BuildVehicleRequest,
  type RecallMissionRequest,
  type ReassignOfficerRequest,
} from '@frontline/shared';
import type { z } from 'zod';
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

  return schema.parse(await res.json());
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

export const getCity = () => apiFetch('/city', CityResponseSchema);

export const getBase = (id: string) => apiFetch(`/base/${id}`, BaseDetailResponseSchema);

export const buildStructure = (body: BuildStructureRequest) =>
  apiFetch('/base/build', BuildStructureResponseSchema, jsonBody(body));

export const renameDistrict = (body: RenameDistrictRequest) =>
  apiFetch('/base/district-name', RenameDistrictResponseSchema, jsonBody(body));

/** §B4: light the Generator's two-hour burn. */
export const buyBuildBoost = (body: BuyBuildBoostRequest) =>
  apiFetch('/base/boost', BuildBoostResponseSchema, jsonBody(body));

/** §E: fill one of a structure's three slots, and empty one again. */
export const fitModification = (body: FitModificationRequest) =>
  apiFetch('/base/modifications/fit', ModificationSlotResponseSchema, jsonBody(body));

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

export const fortifyStructure = (body: FortifyStructureRequest) =>
  apiFetch('/battles/fortify', BattleMutationResponseSchema, jsonBody(body));

export const buyBattleBoost = (body: BuyBattleBoostRequest) =>
  apiFetch('/battles/boost', BattleMutationResponseSchema, jsonBody(body));

export const leadBattle = (body: LeadBattleRequest) =>
  apiFetch('/battles/lead', BattleMutationResponseSchema, jsonBody(body));

export const upgradeNotoriety = () =>
  apiFetch('/battles/notoriety', BattleMutationResponseSchema, jsonBody({}));

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

export const fitSlot = (body: FitSlotRequest) =>
  apiFetch('/units/loadout', UnitsResponseSchema, jsonBody(body));

export const getMissions = () => apiFetch('/missions', MissionsResponseSchema);

export const launchMission = (body: LaunchMissionInput) =>
  apiFetch('/missions', LaunchMissionResponseSchema, jsonBody(body));

export const getBar = () => apiFetch('/bar', BarResponseSchema);

export const hireRecruit = (body: HireRecruitRequest) =>
  apiFetch('/bar/hire', HireRecruitResponseSchema, jsonBody(body));

export const negotiateWithRecruit = (body: NegotiateRequest) =>
  apiFetch('/bar/negotiate', NegotiateResponseSchema, jsonBody(body));

export const getResearch = () => apiFetch('/research', ResearchResponseSchema);

export const startResearch = (body: StartResearchRequest) =>
  apiFetch('/research', StartResearchResponseSchema, jsonBody(body));
export const startTech = (body: StartTechRequest) =>
  apiFetch('/research/tech', ResearchResponseSchema, jsonBody(body));

export const getCrew = () => apiFetch('/crew', CrewResponseSchema);

export const getTraining = () => apiFetch('/training', TrainingResponseSchema);

export const startTraining = (body: StartTrainingRequest) =>
  apiFetch('/training', TrainingResponseSchema, jsonBody(body));

export const getCrewStanding = () => apiFetch('/overseer/me', CrewStandingResponseSchema);

export const getMarket = () => apiFetch('/market', MarketResponseSchema);

export const buyFromVendor = (body: BuyFromVendorRequest) =>
  apiFetch('/market/buy', MarketMutationResponseSchema, jsonBody(body));

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

/** The back room. Its own endpoint, because it spends infamy rather than the stockpile. */
export const getBlackMarket = () => apiFetch('/black-market', BlackMarketResponseSchema);

export const takeFromBlackMarket = (body: TakeBlackMarketRequest) =>
  apiFetch('/black-market/take', BlackMarketMutationResponseSchema, jsonBody(body));

export const getSettings = () => apiFetch('/settings', SettingsResponseSchema);

export const updateProfile = (body: UpdateProfileRequest) =>
  apiFetch('/settings/profile', SettingsResponseSchema, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const changePassword = (body: ChangePasswordRequest) =>
  apiFetch('/settings/password', SettingsResponseSchema, jsonBody(body));

/**
 * The admin bench.
 *
 * A 404 here is not an error state to show, it is the answer "there is no bench in this build":
 * see `routes/admin.ts`. The hook that calls it turns that one status into `null` rather than
 * letting the screen render a failure a player was never meant to know about.
 */
export const getAdmin = () => apiFetch('/admin', AdminSnapshotSchema);

export const setAdminKnobs = (body: AdminKnobsRequest) =>
  apiFetch('/admin/knobs', AdminMutationResponseSchema, jsonBody(body));

export const getWorkshop = () => apiFetch('/workshop', WorkshopResponseSchema);

export const fitUpgrade = (body: FitUpgradeRequest) =>
  apiFetch('/workshop/fit', WorkshopMutationResponseSchema, jsonBody(body));

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

// --- factions, messages and notifications (board request) ---

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
