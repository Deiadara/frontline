import type { MeResponse } from '@frontline/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attack, createOverseer, getBase, getCity, getMe, getMissions, launchMission } from './api';
import { useSession } from '../store/session';

/** Canonical react-query keys (see docs/SPEC-client.md). */
export const queryKeys = {
  me: ['me'] as const,
  city: ['city'] as const,
  base: (id: string) => ['base', id] as const,
  missions: ['missions'] as const,
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
  return useQuery({
    queryKey: queryKeys.missions,
    queryFn: getMissions,
    enabled: token !== null,
    refetchInterval: MISSION_POLL_MS,
  });
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
