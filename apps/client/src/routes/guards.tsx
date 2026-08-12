import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
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
