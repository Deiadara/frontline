import {
  ApiErrorSchema,
  AssigneesMutationResponseSchema,
  AssigneesResponseSchema,
  AssignPointResponseSchema,
  AuthResponseSchema,
  BarResponseSchema,
  BaseDetailResponseSchema,
  BattleResponseSchema,
  BuildStructureResponseSchema,
  CityResponseSchema,
  CreateOverseerResponseSchema,
  HireRecruitResponseSchema,
  LaunchMissionResponseSchema,
  MeResponseSchema,
  MissionsResponseSchema,
  ResearchResponseSchema,
  StartResearchResponseSchema,
  type AssignPointRequest,
  type PlaceAssigneesRequest,
  type ReskillRequest,
  type BattleRequest,
  type BuildStructureRequest,
  type CreateOverseerRequest,
  type HireRecruitRequest,
  type LaunchMissionRequest,
  type LoginRequest,
  type RegisterRequest,
  type StartResearchRequest,
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
    throw new ApiRequestError(res.status, code, message);
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

export const attack = (body: BattleRequest) =>
  apiFetch('/battle', BattleResponseSchema, jsonBody(body));

export const getMissions = () => apiFetch('/missions', MissionsResponseSchema);

export const launchMission = (body: LaunchMissionRequest) =>
  apiFetch('/missions', LaunchMissionResponseSchema, jsonBody(body));

export const getBar = () => apiFetch('/bar', BarResponseSchema);

export const hireRecruit = (body: HireRecruitRequest) =>
  apiFetch('/bar/hire', HireRecruitResponseSchema, jsonBody(body));

export const assignPoint = (body: AssignPointRequest) =>
  apiFetch('/bar/assign-point', AssignPointResponseSchema, jsonBody(body));

export const getResearch = () => apiFetch('/research', ResearchResponseSchema);

export const startResearch = (body: StartResearchRequest) =>
  apiFetch('/research', StartResearchResponseSchema, jsonBody(body));
export const getAssignees = () => apiFetch('/assignees', AssigneesResponseSchema);

export const placeAssignees = (body: PlaceAssigneesRequest) =>
  apiFetch('/assignees/place', AssigneesMutationResponseSchema, jsonBody(body));

export const reskillAssignees = (body: ReskillRequest) =>
  apiFetch('/assignees/reskill', AssigneesMutationResponseSchema, jsonBody(body));
