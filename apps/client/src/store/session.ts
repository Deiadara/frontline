import type { User } from '@frontline/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * What to tear down besides the token when a session ends.
 *
 * A hook rather than a direct call: the session store is imported by `api.ts`, which is imported by
 * every query, so importing the query client here would close a cycle. The app registers this once
 * at boot; a test or a story that never registers it simply logs out without a cache to clear.
 */
let onLogout: (() => void) | undefined;

/** Registers the teardown above. Called once, from the app entry point. */
export function onSessionEnd(teardown: () => void): void {
  onLogout = teardown;
}

/** localStorage key holding the persisted auth token. */
export const TOKEN_STORAGE_KEY = 'frontline.token';

interface SessionState {
  token: string | null;
  user: User | null;
  /** Establish a session after a successful login/register. */
  login: (token: string, user: User) => void;
  /** Refresh the authenticated user (e.g. after `GET /api/me` on boot). */
  setUser: (user: User) => void;
  /** Tear down the session (manual logout or a `401` from the API). */
  logout: () => void;
}

/**
 * Session store. Only `token` is persisted (see `partialize`); `user` is
 * rehydrated by refetching `GET /api/me` on boot. Server-owned data
 * (overseer, base, city) lives in react-query, never here.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => {
        set({ token: null, user: null });
        // Everything the *previous* account fetched is still in the query cache under keys that
        // are not scoped to a user: `me`, `city`, `units`, `battles`. Log out and log in as
        // somebody else in the same tab without reloading and the new player is shown the old
        // one's stockpile, base and roster until each query happens to refetch. Nulling the token
        // is not enough; the data has to go with it.
        //
        // Called through a setter the store does not own so that this module keeps no import of
        // the query client: `main.tsx` registers it once at boot.
        onLogout?.();
      },
    }),
    {
      name: TOKEN_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token }),
    },
  ),
);
