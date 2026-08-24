import {
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  storageCapacity,
  UNIT_IDS,
  type Army,
  type Building,
  type Resources,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * `UNLOCKED=true` — the whole game, standing, on the seeded dev account.
 *
 * A design pass cannot judge what it cannot see, and almost everything interesting here is behind
 * twenty levels of Nexus: the late structures, the units they authorise, a stockpile with enough
 * digits to break the HUD's layout. Playing to it takes days; without it a reviewer looks at the
 * first hour and calls that the game.
 *
 * So this is a **sandbox switch**, not a cheat. Off unless the environment says otherwise, it only
 * ever touches the seeded dev account, and it is applied on every boot rather than only at creation
 * — a flag you have to delete the database to try is a flag nobody tries.
 *
 * It deliberately fabricates nothing the rules could not produce: every value below is one the game
 * would eventually reach, so what a reviewer looks at is the real end-game rather than a mock of it.
 * Research is pointedly left alone for that reason — facts are *discovered*, and writing them in
 * would be inventing a state the mechanic does not have.
 */

/** Level 20 is the ceiling the game actually has, so "end-game" means exactly this. */
export const UNLOCKED_LEVEL = 20;

/** Every structure standing at the ceiling, so no plot is empty and none is mid-curve. */
export function maxedBuildings(): Building[] {
  return BUILDING_KINDS.map((kind) => ({
    id: `unlocked-${kind}`,
    kind,
    level: BUILDING_MAX_LEVEL,
    modifications: [],
    // Intact and ungarrisoned. The sandbox shows the end-game, and a district that opens
    // pre-damaged would be showing a siege nobody laid.
    damage: 0,
    garrisons: 0,
  }));
}

/**
 * How full the stockpile is left, as a share of what a level-20 Apothecary holds.
 *
 * Just under the ceiling on purpose. The first version of this handed out a flat 900,000 of
 * everything, which is roughly twenty times what the rules allow a district to store — so every
 * capacity bar in the HUD pinned to full and went red, and the end-game a reviewer was shown was
 * one permanently screaming that it was overflowing. Near-full is the interesting state and a real
 * one: the bars read as nearly-there, the warning copy is one raid away, and nothing on screen is a
 * number the game could not have produced.
 */
export const UNLOCKED_FULLNESS = 0.86;

/** A real end-game stockpile: near the ceiling the maxed Apothecary actually sets. */
export function unlockedResources(buildings: readonly Building[]): Resources {
  const near = Math.round(storageCapacity(buildings) * UNLOCKED_FULLNESS);
  return { caps: near, food: near, oil: near, scrap: near, highQualityMetal: near };
}

/** A dozen of every unit, so every roster card renders and supply reads like a real army. */
export function fullArmy(): Army {
  return Object.fromEntries(UNIT_IDS.map((id) => [id, 12]));
}

export interface SandboxSummary {
  applied: boolean;
  baseId?: string;
}

/**
 * Raises the seeded dev account to the end-game state, in place.
 *
 * Idempotent: it writes the same values every boot, so restarting with the flag on is a no-op after
 * the first time — and turning the flag *off* leaves the account where the switch left it rather
 * than rolling progress back, because an unlock that un-unlocks is a data-loss bug wearing a
 * feature's clothes.
 */
export function applyUnlockedSandbox(repos: Repositories, username: string): SandboxSummary {
  const user = repos.users.findByUsername(username);
  if (!user) return { applied: false };
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) return { applied: false };

  const buildings = maxedBuildings();
  repos.bases.updateProgression(base.id, UNLOCKED_LEVEL, { xpIntoLevel: 0 });
  repos.bases.updateResources(base.id, unlockedResources(buildings));
  repos.bases.updateDistrict(base.id, buildings, []);
  repos.bases.updateArmy(base.id, fullArmy(), []);
  return { applied: true, baseId: base.id };
}
