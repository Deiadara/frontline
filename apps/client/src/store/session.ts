import type { User } from '@frontline/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: TOKEN_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token }),
    },
  ),
);
