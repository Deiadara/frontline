import { GAME_TIMEZONE } from '@frontline/shared';
import { useMe } from '../../lib/queries';

/**
 * The clock this player reads the game in.
 *
 * One hook, so every countdown, schedule and wall clock in the interface agrees, and so the day a
 * second screen needs it, nobody re-derives it from a different source and ends up an hour out.
 *
 * The default is the house clock rather than the browser's. That is the deliberate choice: this is
 * a shared world run out of Greece, the day boundaries the rules use are Athens midnights, and a
 * player who has not said otherwise should be looking at the same clock the rules are. Settings is
 * where they say otherwise.
 */
export function usePlayerZone(): string {
  const me = useMe();
  return me.data?.user.timezone ?? GAME_TIMEZONE;
}
