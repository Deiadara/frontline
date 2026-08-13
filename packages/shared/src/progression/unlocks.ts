import { PLAYER_LEVEL_MIN } from './curve.js';

/**
 * The level-unlock hook (GDD §I3).
 *
 * §I3 is `[TODO-LATER]`: the board files the catalogue separately. This is the extension point it
 * will be filed into and **not** a place to invent unlocks — `PLAYER_LEVEL_UNLOCKS` ships empty on
 * purpose, and every function here takes the catalogue as a defaulted parameter so a caller (or a
 * test) can supply its own without a module-level registry to mutate.
 */
export interface PlayerLevelUnlock {
  /** Stable identifier the unlocking system checks for, e.g. `reskilling`. */
  id: string;
  /** First level at which it is available. */
  level: number;
}

/** Empty by design — §I3's catalogue is the board's to file. */
export const PLAYER_LEVEL_UNLOCKS: readonly PlayerLevelUnlock[] = [];

/** Is `id` available to a player at `level`? Unknown ids are locked, never an error. */
export function isPlayerUnlockActive(
  id: string,
  level: number,
  catalogue: readonly PlayerLevelUnlock[] = PLAYER_LEVEL_UNLOCKS,
): boolean {
  const unlock = catalogue.find((entry) => entry.id === id);
  return unlock !== undefined && level >= unlock.level;
}

/**
 * What levelling from `fromLevel` to `toLevel` just opened up — the announcement a level-up shows.
 *
 * Half-open on the low side (`fromLevel` was already reached, so its unlocks are old news) and
 * inclusive on the high side. A multi-level award therefore reports every unlock it crossed.
 */
export function playerUnlocksBetween(
  fromLevel: number,
  toLevel: number,
  catalogue: readonly PlayerLevelUnlock[] = PLAYER_LEVEL_UNLOCKS,
): PlayerLevelUnlock[] {
  const from = Math.max(PLAYER_LEVEL_MIN, Math.trunc(fromLevel));
  const to = Math.trunc(toLevel);
  return catalogue
    .filter((entry) => entry.level > from && entry.level <= to)
    .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
}
