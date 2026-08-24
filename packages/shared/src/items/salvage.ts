import { ITEM_CATALOG, ITEM_IDS, type ItemId, type ItemRarity } from './catalog.js';
import type { ItemCost } from './inventory.js';

/**
 * What a crew brings back that is not a number (§E5, items extension).
 *
 * Resources are the *wage* of a mission; items are the *find*. The difference matters: a payout a
 * player can predict is a chore, and one they cannot is a reason to keep sending people out. So
 * this is a roll, it is weighted hard against the exotic end, and a short scrap run essentially
 * never produces anything — the odds scale with how long the crew was out and how badly the work
 * could have gone.
 *
 * Deterministic from a seed the mission already carries, like everything else that resolves on the
 * server: the same run resolves the same way whoever asks and however many times.
 */

/** Below this many minutes a run is a courier job, and courier jobs do not turn things up. */
export const SALVAGE_MINIMUM_MINUTES = 20;

/** The longest run in the game is worth about this many rolls. */
export const SALVAGE_MAX_ROLLS = 3;

/** How likely each rarity is to be what a roll lands on. Sums to one. */
const RARITY_WEIGHT: Readonly<Record<ItemRarity, number>> = {
  common: 0.58,
  uncommon: 0.28,
  rare: 0.12,
  exotic: 0.02,
};

/**
 * How many chances at a find a run gets.
 *
 * One per half hour, capped — and a failed run gets half of them, rounded down, because a crew
 * that came back empty-handed still came back through the same streets.
 */
export function salvageRolls(totalMinutes: number, succeeded: boolean): number {
  if (totalMinutes < SALVAGE_MINIMUM_MINUTES) return 0;
  const rolls = Math.min(SALVAGE_MAX_ROLLS, Math.floor(totalMinutes / 30));
  return succeeded ? rolls : Math.floor(rolls / 2);
}

/** The chance any single roll produces anything at all. Most of them do not. */
export const SALVAGE_HIT_CHANCE = 0.45;

/**
 * What a run turned up.
 *
 * `random` is injected rather than taken from `Math.random` so the server can hand it a seeded
 * stream — a mission's outcome and its finds have to come from the same reproducible source, or
 * two reads of the same finished run disagree about what is in the satchel.
 */
export function rollSalvage(
  totalMinutes: number,
  succeeded: boolean,
  random: () => number,
): ItemCost {
  const found: ItemCost = {};
  for (let roll = 0; roll < salvageRolls(totalMinutes, succeeded); roll++) {
    if (random() > SALVAGE_HIT_CHANCE) continue;
    const id = pickByRarity(random);
    found[id] = (found[id] ?? 0) + 1;
  }
  return found;
}

/** One item, drawn against the rarity weights above. Blueprints are excluded: those are traded. */
function pickByRarity(random: () => number): ItemId {
  const target = random();
  let cumulative = 0;
  let chosenRarity: ItemRarity = 'common';
  for (const rarity of ['common', 'uncommon', 'rare', 'exotic'] as const) {
    cumulative += RARITY_WEIGHT[rarity];
    if (target <= cumulative) {
      chosenRarity = rarity;
      break;
    }
  }

  /*
   * Components and relics only.
   *
   * A blueprint found in a bin is a blueprint the Runner cannot sell you, and the Runner is the
   * reason the market has a clock on it. Keeping knowledge behind trade and parts behind work is
   * what makes the two systems need each other.
   */
  const pool = ITEM_IDS.filter(
    (id) => ITEM_CATALOG[id].rarity === chosenRarity && ITEM_CATALOG[id].kind !== 'blueprint',
  );
  const fallback = ITEM_IDS.filter((id) => ITEM_CATALOG[id].kind !== 'blueprint');
  const from = pool.length > 0 ? pool : fallback;
  return from[Math.min(from.length - 1, Math.floor(random() * from.length))] ?? 'scrap_servo';
}
