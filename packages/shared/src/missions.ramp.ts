import {
  MISSION_MAX_DURATION_MINUTES,
  TRAVEL_BAND_MINUTES,
  missionTimings,
  type MissionTimings,
} from './missions.js';

/**
 * The opening hour's clock (maintainer, 2026-09-23).
 *
 * The board's shortest job is thirteen minutes door to door and its longest is a day, which is the
 * right spread for a crew with a district to run and the wrong one for somebody who has just
 * picked a face. A player's first three runs are now measured in minutes, and the board opens out
 * from there over the first six levels.
 *
 * ## Three bands and then the game
 *
 * | when                          | door to door | what it pays     |
 * | ----------------------------- | ------------ | ---------------- |
 * | the first three runs          | 1 to 3 min   | twice the clock  |
 * | after that, to level 3        | 3 to 10 min  | half again       |
 * | levels 4 to 6                 | 10 to 30 min | the clock        |
 * | level 7 and up                | the board    | the board        |
 *
 * The pay column is the part that needs saying. Everything in this game is paid off its clock
 * (`rewardScale`), so compressing a forty-five minute job into two minutes would pay two minutes
 * of loot and the opening would be poorer than it is today rather than faster. The first two bands
 * carry a premium to cancel that: the maintainer's rule is about double, then half again, then the
 * clock alone. It is spent through `payPercent`, the same premium the ground and the crew's level
 * are already quoted in, so it is frozen on the row at launch and a run already out keeps it.
 *
 * ## Why the band is a ceiling on *level* as well as a count
 *
 * Band one is keyed on runs rather than levels, and on its own that would hand a level twenty crew
 * three double-paying two-minute jobs if they had somehow never taken one. `earlyMissionRamp`
 * answers null above the last band's level before it looks at the count, so the ramp is unreachable
 * once a crew is out of the opening, whatever their history.
 */

/** How many completed runs the first band covers. */
export const EARLY_RAMP_RUNS = 3;

/** The level each of the later bands runs up to, inclusive. */
export const EARLY_RAMP_SECOND_LEVEL = 3;
export const EARLY_RAMP_THIRD_LEVEL = 6;

export interface EarlyRampBand {
  /** Which band this is: 1 is the first three runs, 3 is the last one before the open board. */
  step: 1 | 2 | 3;
  /** The shortest a job in this band runs, door to door. */
  minMinutes: number;
  /** The longest. The board's own longest job prices here; its shortest prices at the floor. */
  maxMinutes: number;
  /**
   * Percentage points added to the card's pay premium, on top of the ground's and the level's.
   *
   * 100 doubles the haul, 50 adds half again, 0 leaves the clock to speak for itself. See
   * `scaledSpoils`, which reads a premium as `1 + percent / 100`.
   */
  payPercent: number;
}

export const EARLY_RAMP_BANDS: readonly EarlyRampBand[] = [
  { step: 1, minMinutes: 1, maxMinutes: 3, payPercent: 100 },
  { step: 2, minMinutes: 3, maxMinutes: 10, payPercent: 50 },
  { step: 3, minMinutes: 10, maxMinutes: 30, payPercent: 0 },
];

/**
 * The longest a job can be door to door, which is what a template's own clock is measured against.
 *
 * Derived rather than written down: the ceiling moves if the catalogue's longest run or the
 * furthest travel band ever moves, and a hardcoded 1560 would silently stop being the top of the
 * scale the day either of them did.
 */
export const MISSION_CEILING_MINUTES =
  MISSION_MAX_DURATION_MINUTES + 2 * TRAVEL_BAND_MINUTES.furthest;

/**
 * Which band a crew is in, or null once they are out of the opening.
 *
 * @param level the crew's level.
 * @param missionsDone how many runs they have finished, ever (the `missions_done` tally).
 */
export function earlyMissionRamp(level: number, missionsDone: number): EarlyRampBand | null {
  // The level ceiling first: see the note above on why the count alone is not enough.
  if (level > EARLY_RAMP_THIRD_LEVEL) return null;
  if (missionsDone < EARLY_RAMP_RUNS) return EARLY_RAMP_BANDS[0] ?? null;
  if (level <= EARLY_RAMP_SECOND_LEVEL) return EARLY_RAMP_BANDS[1] ?? null;
  return EARLY_RAMP_BANDS[2] ?? null;
}

/**
 * A job's own clock, remapped into the band.
 *
 * Logarithmic rather than linear, and the reason is the spread: totals run from thirteen minutes
 * to a day, so a linear share would put every job but the two longest within a rounding error of
 * the band's floor and the board would read as one duration repeated. On a log scale the thirteen
 * minute job lands about a third of the way up the band and the day-long one at the top, which is
 * the ordering a player reads off the board today, compressed.
 *
 * Monotonic in the input, so a longer job is never dealt a shorter clock than a shorter one.
 */
export function rampedTotalMinutes(totalMinutes: number, band: EarlyRampBand): number {
  const share =
    Math.log1p(Math.max(0, Math.min(totalMinutes, MISSION_CEILING_MINUTES))) /
    Math.log1p(MISSION_CEILING_MINUTES);
  const span = band.maxMinutes - band.minMinutes;
  return Math.max(band.minMinutes, Math.round(band.minMinutes + span * share));
}

/**
 * The band's clock, split back into a road and a job so the card can still say both.
 *
 * The template's own proportion is kept, so a furthest-band job still reads as mostly travel and a
 * close one as mostly work. The road is clamped so the job itself is never squeezed below a
 * minute: a mission's clock is stored in whole minutes and a zero-minute job would settle on the
 * tick it launched.
 */
export function rampedTimings(timings: MissionTimings, band: EarlyRampBand): MissionTimings {
  const total = rampedTotalMinutes(timings.totalMinutes, band);
  const scale = timings.totalMinutes > 0 ? total / timings.totalMinutes : 0;
  const road = Math.min(
    Math.round(timings.travelMinutes * scale),
    Math.max(0, Math.floor((total - 1) / 2)),
  );
  return missionTimings({ travelMinutes: road, durationMinutes: total - 2 * road });
}
