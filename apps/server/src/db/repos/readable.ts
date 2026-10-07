/**
 * Every row this build can read, with a warning for each one it cannot (bug pass, 2026-10-06).
 *
 * The readers that list rows for everybody feed the Bar, the leaderboard, the world clock and
 * boot, and the first unreadable row threw for all of them: one player's row was everybody's
 * outage. The row itself still fails loudly wherever it is read on its own.
 */
export function readableRows<Row extends { id: string }, T>(
  rows: readonly Row[],
  what: string,
  read: (row: Row) => T,
): T[] {
  return rows.flatMap((row) => {
    try {
      return [read(row)];
    } catch (error) {
      console.warn(`${what} ${row.id}: not readable by this build, skipping`, error);
      return [];
    }
  });
}
