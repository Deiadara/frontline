import { isAreaUnlocked, type GatedArea } from '@frontline/shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { LockedDoor } from '../components/ui/LockedDoor';
import { useMe } from '../lib/queries';
import { useUnlockFacts } from '../lib/unlocks';
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
 * the map with no explanation at all, which is the failure mode the maintainer named: a locked door has
 * to say what unlocks it.
 *
 * The facts come from `useMe`, which every screen behind `/game` has already resolved, so this
 * costs no request, and the door re-decides itself the moment a build finishes or an officer is
 * seated.
 *
 * ## This gate is the player's, not the server's
 *
 * Worth saying plainly, because the comment that used to sit here said the opposite: **no route on
 * the server checks any of this.** A crew below the level, without the structure or without the
 * hire can still call `POST /api/market/offers` by hand and it will work. That is a gap rather
 * than a design, and it is a real one for the doors that gate a system rather than a screen. It is
 * tolerable only because every one of these areas enforces its own rules anyway: the Lab already
 * refuses to work without a Head of Research, and the Scrapyard already refuses to build without a
 * Scrapyard. What a player skipping the gate gets is a screen, not a capability.
 */
export function RequireUnlock({ area, children }: { area: GatedArea; children: ReactNode }) {
  const facts = useUnlockFacts();
  if (facts === null) return null;
  if (!isAreaUnlocked(area, facts)) return <LockedDoor area={area} facts={facts} />;
  return <>{children}</>;
}
