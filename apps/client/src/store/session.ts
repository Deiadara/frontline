import type { User } from '@frontline/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useViewedCity } from './viewedCity';

/**
 * What to tear down besides the session when it ends.
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

/** localStorage key holding whether this browser is signed in. Never a token. */
export const SESSION_STORAGE_KEY = 'frontline.session';

/**
 * Where the token itself used to live, before it moved into an httpOnly cookie (security pass,
 * 2026-09-30). Cleared on boot so a token written by an older build does not sit in storage for
 * a month where any script on the page could read it.
 */
const LEGACY_TOKEN_KEY = 'frontline.token';
try {
  localStorage.removeItem(LEGACY_TOKEN_KEY);
} catch {
  // Storage blocked outright (a private window): there is nothing in it to clear.
}

interface SessionState {
  /**
   * Whether this browser holds a session, as far as the page knows.
   *
   * The session is an httpOnly cookie the page cannot read, so this is a remembered fact and not a
   * credential: set on sign-in, cleared on sign-out and on any `401`. A stale `true` costs one
   * request, which the server refuses and which clears it.
   */
  signedIn: boolean;
  /**
   * Counts the times the server has handed this tab a new session (a password change, "log out
   * everywhere"). A `401` to a request sent before the latest one was about the session that
   * ended, not this one (see `apiFetch`). Not persisted: it only has to tell apart requests from
   * the same page load.
   */
  epoch: number;
  user: User | null;
  /** Establish a session after a successful login/register. */
  login: (user: User) => void;
  /** The server rotated this tab's session: the requests still in flight carry the old one. */
  rotated: () => void;
  /** Refresh the authenticated user (e.g. after `GET /api/me` on boot). */
  setUser: (user: User) => void;
  /**
   * Tear down the session on this page (a `401`, or after the server cleared the cookie). To sign
   * out, call `signOut` in `lib/api.ts`: only the server can drop an httpOnly cookie.
   */
  logout: () => void;
}

/**
 * Session store. Only `signedIn` is persisted (see `partialize`); `user` is rehydrated by
 * refetching `GET /api/me` on boot. Server-owned data (overseer, base, city) lives in react-query,
 * never here.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      signedIn: false,
      epoch: 0,
      user: null,
      login: (user) => set({ signedIn: true, user }),
      rotated: () => set((state) => ({ epoch: state.epoch + 1 })),
      setUser: (user) => set({ user }),
      logout: () => {
        set({ signedIn: false, user: null });
        // Everything the *previous* account fetched is still in the query cache under keys that
        // are not scoped to a user: `me`, `city`, `units`, `battles`. Log out and log in as
        // somebody else in the same tab without reloading and the new player is shown the old
        // one's stockpile, base and roster until each query happens to refetch. Ending the session
        // is not enough; the data has to go with it.
        //
        // Called through a setter the store does not own so that this module keeps no import of
        // the query client: `main.tsx` registers it once at boot.
        onLogout?.();
        // Where the previous crew was standing goes with their data. The city they were looking at
        // is one of two cities *they* had ground in, and the next player in this tab may have
        // neither: leaving it behind would open the new session on somebody else's map and send
        // every room read to a city whose door is shut to them. Imported directly rather than
        // through the hook above, because that store holds nothing this module could close a cycle
        // on.
        useViewedCity.getState().forget();
      },
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ signedIn: state.signedIn }),
      // Only a real `true` counts. A hand-edited or half-written value must not sign anybody in.
      merge: (persisted, current) => ({
        ...current,
        signedIn: (persisted as { signedIn?: unknown } | undefined)?.signedIn === true,
      }),
    },
  ),
);
