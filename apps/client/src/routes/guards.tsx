import { areaUnlockLevel, type GatedArea } from '@frontline/shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { LockedDoor } from '../components/ui/LockedDoor';
import { useMe } from '../lib/queries';
import { useSession } from '../store/session';

/** Gate that requires an authenticated session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token);
  if (token === null) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

/** Gate for public-only routes (auth): bounce authenticated users into the game. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token);
  if (token !== null) return <Navigate to="/game" replace />;
  return <>{children}</>;
}

/** `/game` gate: an overseer must exist first. */
export function RequireOverseer({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.data) return null;
  if (!me.data.overseer) return <Navigate to="/overseer" replace />;
  return <>{children}</>;
}

/** `/overseer` gate: skip character select once an overseer exists. */
export function RequireNoOverseer({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me.data) return null;
  if (me.data.overseer) return <Navigate to="/game" replace />;
  return <>{children}</>;
}

/**
 * §I3: a screen that has not opened yet.
 *
 * Renders the door rather than redirecting. A `<Navigate>` here would bounce a player who typed the
 * URL, or who followed a link from a level-up announcement one refresh too early, straight back to
 * the map with no explanation at all, which is the failure mode the board named: a locked door has
 * to say what unlocks it.
 *
 * The level comes from `useMe`, which every screen behind `/game` has already resolved, so this
 * costs no request. The server enforces the same gate on the routes behind it; this is the half a
 * player can see.
 */
export function RequireLevel({ area, children }: { area: GatedArea; children: ReactNode }) {
  const me = useMe();
  if (!me.data) return null;
  const level = me.data.base?.level ?? 1;
  if (level < areaUnlockLevel(area)) return <LockedDoor area={area} level={level} />;
  return <>{children}</>;
}
