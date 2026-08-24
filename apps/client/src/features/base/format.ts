/**
 * Durations as the district page says them (GDD §A1).
 *
 * Build times span four orders of magnitude: twenty seconds at the bottom of the tree, most of a
 * working day at the top, so a single unit is wrong at one end whichever one is picked. Two
 * significant units is the readable compromise: `45s`, `7m 12s`, `5h 48m`.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/**
 * A countdown against the server's clock, in the same two-unit form.
 *
 * Rounded **up**, unlike {@link formatDuration}: a bar that reads `0s` for a whole second while the
 * thing it is counting has not landed is the one case where a player is looking straight at it.
 */
export function formatRemaining(ms: number): string {
  return formatDuration(Math.ceil(Math.max(0, ms) / 1000));
}

/**
 * A per-hour production rate, signed and rounded to one decimal.
 *
 * Signed because the Generator's fuel burn makes net oil the one rate that can be negative, and a
 * bare `-2.4` next to `+18` is the whole story of a district that is running its lights on credit.
 */
export function formatRate(perHour: number): string {
  const rounded = Math.round(perHour * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}/h`;
}
