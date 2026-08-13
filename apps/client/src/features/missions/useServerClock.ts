import { useEffect, useState } from 'react';

/**
 * A once-a-second clock, corrected to the server's.
 *
 * Every countdown on the missions page reads from this rather than from `Date.now()`. The server
 * decides when a mission lands (see `apps/server/src/missions/resolve.ts`), so a machine whose
 * clock is skewed — or nudged forward by a player hoping to land a mission early — must still be
 * shown the real remaining time. `serverNow` and the moment the response arrived give the offset.
 *
 * Pass `serverNow`/`receivedAt` as undefined before the first response and the clock is simply
 * the local one, which is the right fallback for a page that has nothing to count down yet.
 */
export function useServerClock(
  serverNow: string | undefined,
  receivedAt: number | undefined,
): Date {
  const offsetMs =
    serverNow !== undefined && receivedAt !== undefined && receivedAt > 0
      ? Date.parse(serverNow) - receivedAt
      : 0;

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return new Date(tick + offsetMs);
}
