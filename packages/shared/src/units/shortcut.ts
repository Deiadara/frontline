import type { Army } from './muster.js';
import { findUnit } from './catalog.js';

/**
 * SHORTCUT (the Cartographer, maintainer 2026-10-09): any journey she is part of takes half the
 * time. Taken off the **final** figure, after every other cut and the rail's clock included, so it
 * is the last word on a road rather than another percentage summed into one.
 */
export const SHORTCUT_SHARE = 0.5;

/** Whether anybody in this force carries SHORTCUT. */
export function travelsWithShortcut(force: Army): boolean {
  return Object.entries(force).some(
    ([unitId, count]) => (count ?? 0) > 0 && findUnit(unitId)?.shortcut === true,
  );
}

/** A journey's final clock for this force, in whatever unit it was given. Unrounded. */
export function withShortcut(time: number, force: Army): number {
  return travelsWithShortcut(force) ? time * SHORTCUT_SHARE : time;
}

/** The same, for a clock kept in whole minutes: rounded, and never below one when it was above. */
export function shortcutMinutes(minutes: number, force: Army): number {
  if (!travelsWithShortcut(force) || minutes <= 0) return minutes;
  return Math.max(1, Math.round(minutes * SHORTCUT_SHARE));
}
