import { blurredCount, INTEL_PERCENT_PER_GRAIN } from '../crew/effects.js';
import { findUnit, type Army } from '../units/index.js';

/**
 * What the other side can see of what you have moved up (GDD §A4/§F2, battle rework).
 *
 * The board's rule is that **a deployment is not public**. Both crews know a fight is coming and
 * where, that is what a declaration is, and neither knows what the other has walked onto the
 * ground. The only way to find out is to be good at finding out: scouts, Signals, the research track
 * of the same name, anybody in the room with Logic or Intuition. The only way to stop them is to be good at not being
 * found: cryptography, deception, and units that are hard to see in the first place.
 *
 * It reuses the §F2 channels the city view already reads (`intelYieldPercent` against
 * `intelResistancePercent`, coarsened by `blurredCount`) rather than opening a second intelligence
 * system beside them. A crew that invested in reading a rival's garrison reads their deployment with
 * the same investment, which is the version a player can reason about.
 *
 * The one thing this adds is the **third term**: what you deployed is part of how hidden it is.
 * Ghosts and Sleepers moved up quietly are genuinely harder to count than the same number of
 * Juggernauts, and that is a reason to bring them beyond what they do in the line.
 */

/** How much a force's own average stealth is worth as counter-intelligence, in percentage points. */
export const STEALTH_TO_RESISTANCE = 0.5;

/**
 * Blur at or above which a watcher is told nothing at all rather than a rounded number.
 *
 * Eight grains' worth (`INTEL_PERCENT_PER_GRAIN`). Past this the coarsening is so wide that the
 * number carries no information but still *reads* like information, and a figure a player will plan
 * against and be wrong about is worse than a blank. A blank is honest: you do not know.
 */
export const INTEL_BLACKOUT_PERCENT = INTEL_PERCENT_PER_GRAIN * 8;

const total = (force: Army): number =>
  Object.values(force).reduce((sum, count) => sum + Math.max(0, count), 0);

/**
 * One unit's stealth as the crew that owns it actually fields it, 0..100.
 *
 * Injected rather than read off the catalogue here, and that is the whole of the fix. This module
 * used to take `findUnit(id).stats.stealth`, the **printed** figure, so a Ghost carrying two
 * stealth cards hid a deployment exactly as well as a Ghost carrying none, and the crew's
 * `unitStealthPercent` (perks, held ground, the Signals track) bought nothing at all on the one
 * screen the module's own doc sells it on: "units that are hard to see in the first place".
 *
 * The engine has read the fitted sheet since the loadout rework (`battle/effects.ts` folds
 * `upgradedStats` then the channel), so the two halves of the game disagreed about the same unit:
 * the line fought a Ghost on 68 stealth while the intel system counted it at 30.
 */
export type UnitStealthReader = (unitId: string) => number;

const printedStealth: UnitStealthReader = (unitId) => findUnit(unitId)?.stats.stealth ?? 0;

/**
 * The average stealth of what is standing there, 0..100. Zero for an empty ground.
 *
 * `stealthOf` defaults to the printed sheet, which is right for a caller that has no loadouts in
 * hand (the catalogue tests) and wrong for the game: see {@link UnitStealthReader}.
 */
export function forceStealth(force: Army, stealthOf: UnitStealthReader = printedStealth): number {
  let weighted = 0;
  let units = 0;
  for (const [unitId, count] of Object.entries(force)) {
    if (count <= 0 || !findUnit(unitId)) continue;
    weighted += count * stealthOf(unitId);
    units += count;
  }
  return units === 0 ? 0 : weighted / units;
}

export interface DeploymentIntelInput {
  /** The §F2 counter-intelligence of whoever moved the force up. */
  resistancePercent: number;
  /** ...and the reading of whoever is trying to count it. */
  yieldPercent: number;
  /** The force itself: see the module note on why its own sheet is the third term. */
  force: Army;
  /**
   * How stealthy each of those units actually is, fittings and channel included.
   *
   * Optional so a caller with no loadouts still gets the printed figure rather than a zero, which
   * is the honest fallback: a reading that quietly treated every unit as invisible-proof would be
   * worse than one measured off the catalogue.
   */
  stealthOf?: UnitStealthReader;
}

/**
 * How badly a watcher's count of this force is coarsened, in percentage points.
 *
 * Never negative: a crew that out-reads its rival sees the exact number, and nothing lets it see
 * *more* than the exact number.
 */
export function deploymentBlurPercent(input: DeploymentIntelInput): number {
  const hidden =
    input.resistancePercent + forceStealth(input.force, input.stealthOf) * STEALTH_TO_RESISTANCE;
  return Math.max(0, hidden - input.yieldPercent);
}

/**
 * The size a rival's deployment appears to be, or `null` when it cannot be made out at all.
 *
 * Coarsened rather than falsified: the rule `blurredCount` was written under, and the reason a
 * scout says "about forty" instead of an invented forty-three.
 */
export function observedForceSize(force: Army, blurPercent: number): number | null {
  if (blurPercent >= INTEL_BLACKOUT_PERCENT) return null;
  return blurredCount(total(force), blurPercent);
}

/** One line about how good the reading is, for the deployment screen. */
export function intelQualityLine(blurPercent: number): string {
  if (blurPercent >= INTEL_BLACKOUT_PERCENT) return 'Nothing. They are running dark.';
  if (blurPercent <= 0) return 'Counted, one by one.';
  if (blurPercent < INTEL_PERCENT_PER_GRAIN * 3) return 'A good count, give or take.';
  return 'A rough count. Nobody would swear to it.';
}
