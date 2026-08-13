import type {
  BaseDetailResponse,
  LaunchMissionRequest,
  LaunchMissionResponse,
  MeResponse,
} from '@frontline/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ApiRequestError } from './api';
import {
  assignPoint,
  attack,
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
  launchMission,
  getResearch,
  startResearch,
} from './api';
import { useSession } from '../store/session';

/** Canonical react-query keys (see docs/SPEC-client.md). */
export const queryKeys = {
  me: ['me'] as const,
  city: ['city'] as const,
  base: (id: string) => ['base', id] as const,
  missions: ['missions'] as const,
  bar: ['bar'] as const,
  research: ['research'] as const,
  assignees: ['assignees'] as const,
};

/**
 * How often the missions page re-asks the server. Missions settle lazily on this read, so the
 * poll is what turns a finished countdown into a banked payout while the page is open — and the
 * countdown itself ticks locally in between, so this does not need to be a fast poll.
 */
const MISSION_POLL_MS = 15_000;

/** Same idea for research: the settle happens on the read, and the clock is minutes long. */
const RESEARCH_POLL_MS = 15_000;

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

/** Detail for a single owned base. */
export function useBase(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.base(id ?? ''),
    queryFn: () => getBase(id ?? ''),
    enabled: id !== undefined,
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
   */
  const settledAt = (query.data?.justResolved.length ?? 0) > 0 ? query.dataUpdatedAt : 0;
  useEffect(() => {
    if (settledAt === 0) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
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
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bar });
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
    onSuccess: () => {
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
      queryClient.setQueryData<MeResponse>(queryKeys.me, {
        user: data.user,
        overseer: data.overseer,
        base: data.base,
      });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
  });
}

/** Resolve a battle and refresh everything its rewards touched. */
export function useAttack(baseId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: attack,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.city });
      if (baseId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.base(baseId) });
      }
    },
  });
}
