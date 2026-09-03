import { GAME_TIMEZONE, formatClock, nextDayBoundary } from '@frontline/shared';
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

/**
 * When today's ration, roster and shelf turn over, on this player's clock.
 *
 * The boundary itself is not the player's to choose: every daily reset in the game is keyed on an
 * *Athens* date (`dayInZone`), because a shared world needs a shared day. What is the player's is
 * where that instant lands on the clock they are reading, and for anyone outside Athens it is not
 * midnight. Several screens used to say "midnight" flatly, which was wrong for them by the offset.
 *
 * `now` only picks which day's boundary is meant, so the answer is the same string all day and
 * changes only when a zone moves its clocks. Screens holding a server clock should pass it; the
 * rest can let it default, because being a few minutes out cannot change the answer.
 */
export function useDayResetClock(now: Date = new Date()): string {
  return formatClock(nextDayBoundary(now), usePlayerZone());
}
