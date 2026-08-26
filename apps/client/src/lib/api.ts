import {
  ApiErrorSchema,
  ActionsResponseSchema,
  BattlesResponseSchema,
  BattleMutationResponseSchema,
  type DeclareBattleRequest,
  type DeployRequest,
  type FortifyStructureRequest,
  type LayTrapRequest,
  type BuyBattleBoostRequest,
  type RecallColumnRequest,
  AssigneesMutationResponseSchema,
  AssigneesResponseSchema,
  AssignPointResponseSchema,
  AuthResponseSchema,
  BarResponseSchema,
  BaseDetailResponseSchema,
  CityMutationResponseSchema,
  DistrictDetailResponseSchema,
  TrainUnitsResponseSchema,
  UnitsResponseSchema,
  BuildStructureResponseSchema,
  RenameFactionResponseSchema,
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
  type AssignPointRequest,
  type PlaceAssigneesRequest,
  type ReskillRequest,
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
  type RenameFactionRequest,
  type CreateOverseerRequest,
  type BuySupplyRequest,
  type HireRecruitRequest,
  type NegotiateRequest,
  type LaunchMissionRequest,
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

export const renameFaction = (body: RenameFactionRequest) =>
  apiFetch('/base/faction', RenameFactionResponseSchema, jsonBody(body));

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

export const launchMission = (body: LaunchMissionRequest) =>
  apiFetch('/missions', LaunchMissionResponseSchema, jsonBody(body));

export const getBar = () => apiFetch('/bar', BarResponseSchema);

export const hireRecruit = (body: HireRecruitRequest) =>
  apiFetch('/bar/hire', HireRecruitResponseSchema, jsonBody(body));

export const negotiateWithRecruit = (body: NegotiateRequest) =>
  apiFetch('/bar/negotiate', NegotiateResponseSchema, jsonBody(body));

export const assignPoint = (body: AssignPointRequest) =>
  apiFetch('/bar/assign-point', AssignPointResponseSchema, jsonBody(body));

export const getResearch = () => apiFetch('/research', ResearchResponseSchema);

export const startResearch = (body: StartResearchRequest) =>
  apiFetch('/research', StartResearchResponseSchema, jsonBody(body));
export const startTech = (body: StartTechRequest) =>
  apiFetch('/research/tech', ResearchResponseSchema, jsonBody(body));

export const getAssignees = () => apiFetch('/assignees', AssigneesResponseSchema);

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

export const buildVehicle = (body: BuildVehicleRequest) =>
  apiFetch('/workshop/vehicle', WorkshopMutationResponseSchema, jsonBody(body));

export const recallMission = (body: RecallMissionRequest) =>
  apiFetch('/missions/recall', MissionsResponseSchema, jsonBody(body));

export const reassignOfficer = (body: ReassignOfficerRequest) =>
  apiFetch('/assignees/reassign', AssigneesMutationResponseSchema, jsonBody(body));

export const placeAssignees = (body: PlaceAssigneesRequest) =>
  apiFetch('/assignees/place', AssigneesMutationResponseSchema, jsonBody(body));

export const reskillAssignees = (body: ReskillRequest) =>
  apiFetch('/assignees/reskill', AssigneesMutationResponseSchema, jsonBody(body));
