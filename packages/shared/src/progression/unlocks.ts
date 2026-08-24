import { z } from 'zod';
import { PLAYER_LEVEL_MIN } from './curve.js';

/**
 * What levelling opens (GDD §I3).
 *
 * §I3 shipped as an empty extension point for a long time, on the rule that the catalogue was the
 * board's to file rather than an agent's to invent. The board filed it: four screens behind a
 * gentle early gate, and a run of milestones at the round numbers that give a high level something
 * to be *for*. This is that catalogue, and it is still the only place an unlock is declared: a
 * system that wants to know whether something is open asks {@link isPlayerUnlockActive} rather than
 * comparing a level to a number of its own.
 *
 * Two kinds live here and the difference is worth keeping straight:
 *
 * - **Doors** ({@link GATED_AREAS}) are screens. They exist from the start, they are visible from
 *   the start, and what a level buys is the right to walk through. A door that vanished until it
 *   opened would hide the shape of the game from the player who most needs to see it.
 * - **Milestones** are the round-number rewards. Every one of them bends a rule some other module
 *   already enforces, a daily limit, a broker's cut, rather than adding a system of its own, so a
 *   milestone is a constant moving, not a feature to keep alive.
 */

/**
 * Schema-first, like the grants beside it: an unlock now ships inside `LevelUpSchema`, so the
 * client parses it and there is no second declaration of the shape to drift.
 */
export const PlayerLevelUnlockSchema = z.object({
  /** Stable identifier the unlocking system checks for, e.g. `research`. */
  id: z.string().min(1),
  /** First level at which it is available. */
  level: z.number().int().positive(),
  /** What it is called on screen. */
  name: z.string().min(1),
  /** One sentence: what changes the moment it opens. */
  description: z.string().min(1),
});
export type PlayerLevelUnlock = z.infer<typeof PlayerLevelUnlockSchema>;

/** The four screens §I3 puts behind a level. */
export const GATED_AREAS = ['research', 'market', 'training', 'bar'] as const;
export type GatedArea = (typeof GATED_AREAS)[number];

/**
 * The level each door opens at.
 *
 * Deliberately shallow. These are not end-game content, they are the rest of the game, and a player
 * who cannot see the Bar for a week has been handed a smaller game rather than a paced one. Three,
 * five, seven and ten are all reachable inside a first session or two: the gate is there to stop a
 * brand-new crew being shown eleven screens at once, not to withhold anything.
 */
export const AREA_UNLOCK_LEVELS: Readonly<Record<GatedArea, number>> = {
  research: 3,
  market: 5,
  training: 7,
  bar: 10,
};

/** What each door is called and what is behind it, for the sign on the locked one. */
const AREA_COPY: Readonly<Record<GatedArea, { name: string; description: string }>> = {
  research: {
    name: 'The Archive',
    description: 'Projects that pay out long after they are started.',
  },
  market: {
    name: 'The Market',
    description: 'The Runner, the Broker, and a board other crews post to.',
  },
  training: {
    name: 'Drills',
    description: 'Hours spent on your own crew instead of on the city.',
  },
  bar: {
    name: 'The Bar',
    description: 'The room where officers are hired, shared with every crew in the city.',
  },
};

/**
 * The round-number rewards (§I3).
 *
 * Every one of these takes a limit that has stood since level one and moves it, which is the only
 * kind of reward that is worth reaching a big level for: a player at 40 does not need another
 * screen, they need the thing they have been doing every day to stop being rationed.
 *
 * The ladder is `MILESTONE_STEP` apart on purpose, 40, 50, 60, 70, so the pattern is legible from
 * the first one and a new rung is a row here plus the constant it bends. Anything added below 40
 * belongs on the doors above instead; the early game is already dense.
 */
export const MILESTONE_STEP = 10;
export const FIRST_MILESTONE_LEVEL = 40;

/** Level 40: two signings a day at the Bar instead of one. */
export const MILESTONE_SECOND_SIGNATURE = 'second_signature';
/** Level 50: two takes a day off the Black Market shelf instead of one. */
export const MILESTONE_STANDING_INVITATION = 'standing_invitation';
/** Level 60: the Broker stops taking half. */
export const MILESTONE_BROKERS_RESPECT = 'brokers_respect';
/** Level 70: the day's supply run is no longer bounded by what the district can hold. */
export const MILESTONE_DEEP_POCKETS = 'deep_pockets';

const MILESTONES: readonly PlayerLevelUnlock[] = [
  {
    id: MILESTONE_SECOND_SIGNATURE,
    level: 40,
    name: 'The Second Signature',
    description: 'You can sign two people a day at the Bar. Nobody else in the city can.',
  },
  {
    id: MILESTONE_STANDING_INVITATION,
    level: 50,
    name: 'A Standing Invitation',
    description: 'The back door is open twice a day for you.',
  },
  {
    id: MILESTONE_BROKERS_RESPECT,
    level: 60,
    name: "The Broker's Respect",
    description: 'He stops taking half. Every trade at his window is worth a third more.',
  },
  {
    id: MILESTONE_DEEP_POCKETS,
    level: 70,
    name: 'Deep Pockets',
    description: 'Your day of buying is no longer measured against what you can store.',
  },
];

/**
 * Everything level opens, doors first and then the ladder, each in level order.
 *
 * Built rather than written out, so {@link AREA_UNLOCK_LEVELS} stays the one statement of when a
 * screen opens. A door's id *is* its {@link GatedArea} id, which is what lets the client ask
 * `isPlayerUnlockActive(area, level)` with the same word it uses to route.
 */
export const PLAYER_LEVEL_UNLOCKS: readonly PlayerLevelUnlock[] = [
  ...GATED_AREAS.map((area) => ({
    id: area,
    level: AREA_UNLOCK_LEVELS[area],
    name: AREA_COPY[area].name,
    description: AREA_COPY[area].description,
  })),
  ...MILESTONES,
].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));

/** Is `id` available to a player at `level`? Unknown ids are locked, never an error. */
export function isPlayerUnlockActive(
  id: string,
  level: number,
  catalogue: readonly PlayerLevelUnlock[] = PLAYER_LEVEL_UNLOCKS,
): boolean {
  const unlock = catalogue.find((entry) => entry.id === id);
  return unlock !== undefined && level >= unlock.level;
}

/** The catalogue entry for `id`, or `undefined`. What a locked sign reads its copy off. */
export function findPlayerUnlock(
  id: string,
  catalogue: readonly PlayerLevelUnlock[] = PLAYER_LEVEL_UNLOCKS,
): PlayerLevelUnlock | undefined {
  return catalogue.find((entry) => entry.id === id);
}

/** The level a screen opens at. Screens are the one unlock the client routes on. */
export function areaUnlockLevel(area: GatedArea): number {
  return AREA_UNLOCK_LEVELS[area];
}

/**
 * What levelling from `fromLevel` to `toLevel` just opened up: the announcement a level-up shows.
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

/**
 * The next thing worth reaching, from where a player stands. `null` once the ladder runs out.
 *
 * The HUD's answer to "why am I levelling", which is a question the game had no answer to at all
 * while the catalogue was empty.
 */
export function nextPlayerUnlock(
  level: number,
  catalogue: readonly PlayerLevelUnlock[] = PLAYER_LEVEL_UNLOCKS,
): PlayerLevelUnlock | null {
  const at = Math.max(PLAYER_LEVEL_MIN, Math.trunc(level));
  return [...catalogue].sort((a, b) => a.level - b.level).find((entry) => entry.level > at) ?? null;
}
