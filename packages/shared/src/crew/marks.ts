import { z } from 'zod';

/**
 * The mark an officer gets for a role (board brief, 2026-09-03).
 *
 * A role already scores a sheet, server-side: the weighted mean of the attributes that role cares
 * about, a number the player has never seen. A mark is that number said out loud,
 * on a scale a player can read at a glance and compare between two people without doing arithmetic.
 *
 * ## What a mark is and is not
 *
 * It is a **threshold and a label**. Research reads it to decide whether a track may be progressed,
 * and the officer card shows it. It is deliberately coarse: twenty one bands over the whole
 * trainable range, so a mark moves rarely and means something when it does.
 *
 * It is **not** what any bonus is computed from. Every effect an officer has reads the underlying
 * score, so training one attribute moves the payout immediately even when the letter does not
 * budge. A player who trains for an afternoon should see the number they care about move; a player
 * who trains for a week should see the letter move.
 *
 * ## Why the scale is anchored where it is
 *
 * The floor is the worst score a **real** officer can produce, not the zero a sheet of zeroes would
 * give: the point of the bottom of a scale is that somebody is standing on it. Measured over 142,500
 * generated officer-and-role combinations across the whole calibre band the Bar offers, the lowest
 * was 10.23 (a Scout) and the recruitment median was 20.77. So the floor is 10, and a fresh recruit
 * lands around F+ with the whole ladder still ahead of them.
 *
 * The ceiling is 100 rather than the best *recruitable* score of 35.85, because attributes train to
 * 100 and a scale that topped out at what the Bar hands you would put every trained officer at S+
 * within a week and stop saying anything. Twenty one equal bands over [10, 100] puts S+ at 95.7 and
 * above, which is the "small margin under the maximum" the brief asks for: reachable, and only by
 * somebody who has been worked on for a long time.
 *
 * The scale lives in shared and the *weights* do not. A mark is a hint and is allowed on the wire;
 * the role requirement table is server-side only (B8/B8a, and see `roles/hidden-table.leak.test.ts`).
 * Nothing here can reconstruct it: this converts a score the server computed, and a client with no
 * weights cannot produce a score to convert. The scorer itself is named nowhere in this package,
 * which a scan enforces.
 */

/** Lowest to highest. Twenty one bands. */
export const OFFICER_MARKS = [
  'F-',
  'F',
  'F+',
  'E-',
  'E',
  'E+',
  'D-',
  'D',
  'D+',
  'C-',
  'C',
  'C+',
  'B-',
  'B',
  'B+',
  'A-',
  'A',
  'A+',
  'S-',
  'S',
  'S+',
] as const;

export const OfficerMarkSchema = z.enum(OFFICER_MARKS);
export type OfficerMark = z.infer<typeof OfficerMarkSchema>;

/**
 * The worst score a real officer can produce in a role.
 *
 * Measured, not chosen: see the note above. Written as a constant rather than recomputed at load
 * because the measurement is over the generator and the whole requirement table, which is a
 * server-side thing this module must not import.
 */
export const OFFICER_MARK_FLOOR = 10;

/** The top of the trainable range, which is where every attribute caps. */
export const OFFICER_MARK_CEILING = 100;

/** How wide one band is. */
export const OFFICER_MARK_BAND = (OFFICER_MARK_CEILING - OFFICER_MARK_FLOOR) / OFFICER_MARKS.length;

/** Where a mark sits on the ladder, 0 for `F-`. */
export function markIndex(mark: OfficerMark): number {
  return OFFICER_MARKS.indexOf(mark);
}

/**
 * The mark for a role fit score, as the server computes it.
 *
 * Clamped at both ends: a score under the measured floor is still `F-` rather than an error, and
 * the ceiling belongs to `S+` rather than falling off the end of the array.
 */
export function markFromPoints(points: number): OfficerMark {
  const above = Math.max(0, points - OFFICER_MARK_FLOOR);
  const band = Math.floor(above / OFFICER_MARK_BAND);
  return OFFICER_MARKS[Math.min(OFFICER_MARKS.length - 1, band)]!;
}

/** Whether a mark clears a requirement. Used by research gating. */
export function markAtLeast(mark: OfficerMark, required: OfficerMark): boolean {
  return markIndex(mark) >= markIndex(required);
}
