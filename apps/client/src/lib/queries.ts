import type { MeResponse } from '@frontline/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  assignPoint,
  attack,
  createOverseer,
  getBar,
  getBase,
  getCity,
  getMe,
  getMissions,
  hireRecruit,
  launchMission,
} from './api';
import { useSession } from '../store/session';

/** Canonical react-query keys (see docs/SPEC-client.md). */
export const queryKeys = {
  me: ['me'] as const,
  city: ['city'] as const,
  base: (id: string) => ['base', id] as const,
  missions: ['missions'] as const,
  bar: ['bar'] as const,
};

/**
 * How often the missions page re-asks the server. Missions settle lazily on this read, so the
 * poll is what turns a finished countdown into a banked payout while the page is open — and the
 * countdown itself ticks locally in between, so this does not need to be a fast poll.
 */
const MISSION_POLL_MS = 15_000;

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
  return useMutation({
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
      if (data.accepted) void queryClient.invalidateQueries({ queryKey: queryKeys.me });
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
