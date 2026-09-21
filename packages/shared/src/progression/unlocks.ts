import { z } from 'zod';
import { BUILDING_CATALOG, type BuildingKind } from '../building/kinds.js';
import { OFFICER_ROLE_LABELS, type OfficerRole } from '../roles.js';
import { PLAYER_LEVEL_MIN } from './curve.js';

/**
 * What opens the rest of the game (GDD §I3).
 *
 * §I3 shipped as an empty extension point for a long time, on the rule that the catalogue was the
 * board's to file rather than an agent's to invent. The maintainer filed it, and then filed it
 * again on 2026-09-19: nine screens behind a condition, and a run of milestones at the round
 * numbers that give a high level something to be *for*. This is that catalogue, and it is still
 * the only place an unlock is declared: a system that wants to know whether something is open asks
 * {@link isAreaUnlocked} or {@link isPlayerUnlockActive} rather than comparing a number of its own.
 *
 * Two kinds live here and the difference is worth keeping straight:
 *
 * - **Doors** ({@link GATED_AREAS}) are screens. They exist from the start, they are visible from
 *   the start, and what a condition buys is the right to walk through. A door that vanished until
 *   it opened would hide the shape of the game from the player who most needs to see it.
 * - **Milestones** are the round-number rewards. Every one of them bends a rule some other module
 *   already enforces, a daily limit, a broker's cut, rather than adding a system of its own, so a
 *   milestone is a constant moving, not a feature to keep alive.
 *
 * The 2026-09-19 change was to the first kind and it is worth naming, because the file no longer
 * does what its old title said. A door used to be a level and nothing else. Five of the nine still
 * are; the other four are a structure standing, a chair filled, a rank held and a programme
 * finished, and a level-up cannot announce any of those. See {@link AreaRequirement}.
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

/**
 * The nine screens behind a condition (§I3, widened by the maintainer on 2026-09-19).
 *
 * Four screens are **not** here and that is the point of the list: the City, the District, the
 * roster and the mission board are open from the first minute, because they are the loop. A new
 * crew can look at the city, look at what they hold, look at what they have and go and do
 * something with it, without a single door in the way.
 *
 * Everything else is a door, and what opens it is no longer always a level. See
 * {@link AREA_REQUIREMENTS}.
 */
export const GATED_AREAS = [
  'scrapyard',
  'training',
  'bar',
  'crew',
  'research',
  'faction',
  'market',
  'offers',
  'black_market',
] as const;
export type GatedArea = (typeof GATED_AREAS)[number];

/**
 * What opens a door.
 *
 * It used to be a level and nothing else, which made the catalogue a `Record<GatedArea, number>`
 * and every gate in the client a `<` against it. That shape could not say the things the game
 * actually wanted to say: the Scrapyard opens when you *build* the Scrapyard, the Archive opens
 * when somebody is sitting in the Head of Research's chair, and the fence opens on a reputation
 * rather than on a birthday.
 *
 * A union rather than an object of optional fields, so a door has exactly one condition and there
 * is no such thing as a half-filled requirement to handle. Adding a sixth kind is a variant here,
 * a line in {@link isAreaUnlocked} and a line in {@link describeAreaRequirement}, and the compiler
 * names both of them.
 */
export type AreaRequirement =
  /** Reach a player level (§I). */
  | { kind: 'level'; level: number }
  /** Have the structure standing, at any level. */
  | { kind: 'building'; building: BuildingKind }
  /** Have somebody in that chair. A benched officer does not count: the chair is the gate. */
  | { kind: 'officer'; role: OfficerRole }
  /** Hold a rank on the notoriety ladder (§D7). The wallet is a different number. */
  | { kind: 'notoriety'; rank: number }
  /** Have finished a programme in the Lab (§B9). */
  | { kind: 'research'; technology: string };

/**
 * The first rung of the Trader's track, which is what opens the district offers board.
 *
 * Named here rather than spelled inline, because two modules have to agree on it and they cannot
 * import each other: `research/tracks.ts` files the rung and this file gates the door on it. The
 * id is what `idOf('Getting On The Board')` produces, and `research/tracks.test.ts` holds the two
 * together so a rename cannot quietly shut the door for good.
 */
export const TECH_DISTRICT_OFFERS = 'tech_getting_on_the_board';

/**
 * What each door wants.
 *
 * The levels are deliberately shallow where they are still levels. These are not end-game content,
 * they are the rest of the game, and a player who cannot see the Bar for a week has been handed a
 * smaller game rather than a paced one.
 *
 * The four that are not levels are the interesting ones, because each is a gate a player opens by
 * *doing the thing the screen is about*, which a number can never be:
 *
 * - **Scrapyard** opens by building the Scrapyard. A door to a structure that gates on owning the
 *   structure is the one gate that needs no explaining at all.
 * - **Research** opens on hiring a Head of Research, which the Lab already refuses to work
 *   without (`no_head_of_research`). The screen was reachable and useless; now it arrives with the
 *   person who makes it work.
 * - **District Offers** opens on the Trader's first programme, so the board other crews post to is
 *   something a crew decides to get into rather than something that appears.
 * - **The Black Market** opens at notoriety rank 3, because the fence deals on reputation. A crew
 *   nobody has heard of does not get shown the back room.
 */
export const AREA_REQUIREMENTS: Readonly<Record<GatedArea, AreaRequirement>> = {
  scrapyard: { kind: 'building', building: 'scrapyard' },
  training: { kind: 'level', level: 3 },
  bar: { kind: 'level', level: 5 },
  crew: { kind: 'level', level: 5 },
  research: { kind: 'officer', role: 'head_of_research' },
  faction: { kind: 'level', level: 10 },
  market: { kind: 'level', level: 15 },
  offers: { kind: 'research', technology: TECH_DISTRICT_OFFERS },
  black_market: { kind: 'notoriety', rank: 3 },
};

/** What each door is called and what is behind it, for the sign on the locked one. */
const AREA_COPY: Readonly<Record<GatedArea, { name: string; description: string }>> = {
  scrapyard: {
    name: 'The Scrapyard',
    description: 'Where the traps, the fittings and the building work are made.',
  },
  training: {
    name: 'Drills',
    description: 'Hours spent on your own crew instead of on the city.',
  },
  bar: {
    name: 'The Bar',
    description: 'The room where officers are hired, shared with every crew in the city.',
  },
  crew: {
    name: 'The Crew',
    description: 'Who you have signed, what chair they sit in, and what they are worth.',
  },
  research: {
    name: 'The Archive',
    description: 'Projects that pay out long after they are started.',
  },
  faction: {
    name: 'The Faction',
    description: 'The people you fight beside, and the table they sit at.',
  },
  market: {
    name: 'The Market',
    description: 'The Runner and the Broker, and what they will take off your hands.',
  },
  offers: {
    name: 'District Offers',
    description: 'The board other crews post to, and the one you post to back.',
  },
  black_market: {
    name: 'The Black Market',
    description: 'The back room, where infamy buys what scrap cannot.',
  },
};

/**
 * Everything the game has to know about a crew to answer "is this door open".
 *
 * Deliberately a flat bag of facts rather than the `Base` itself. `progression/` sits near the
 * bottom of this package and a `Base` carries half of it, so taking the whole record would turn a
 * leaf into a module that imports the economy, the Lab and the building catalogue. Five fields is
 * also the honest interface: these are the only things any door reads, and a caller that has to
 * assemble them can see at a glance what the gates are made of.
 */
export interface UnlockFacts {
  /** Player level (§I). */
  level: number;
  /** Structures standing, by kind. Levels do not matter: every building gate is "is it there". */
  buildings: readonly BuildingKind[];
  /** The chairs that are filled. The bench is not a chair, so a benched officer is not here. */
  officers: readonly OfficerRole[];
  /** Notoriety rank (§D7), which only ever rises. Not the infamy wallet. */
  notoriety: number;
  /** Finished programmes, by technology id (§B9). */
  technologies: readonly string[];
}

/** A crew on its first minute: level one, nothing built, nobody hired, nothing researched. */
export function noUnlocks(): UnlockFacts {
  return { level: PLAYER_LEVEL_MIN, buildings: [], officers: [], notoriety: 0, technologies: [] };
}

/** Is this door open to a crew with these facts? */
export function isAreaUnlocked(area: GatedArea, facts: UnlockFacts): boolean {
  const requirement = AREA_REQUIREMENTS[area];
  switch (requirement.kind) {
    case 'level':
      return facts.level >= requirement.level;
    case 'building':
      return facts.buildings.includes(requirement.building);
    case 'officer':
      return facts.officers.includes(requirement.role);
    case 'notoriety':
      return facts.notoriety >= requirement.rank;
    case 'research':
      return facts.technologies.includes(requirement.technology);
  }
}

/** What this door wants, for a caller that would rather read the condition than the answer. */
export function areaRequirement(area: GatedArea): AreaRequirement {
  return AREA_REQUIREMENTS[area];
}

/**
 * The level a door opens at, or `null` when a level is not what opens it.
 *
 * The nav prints `Lv 5` under a shut door and has nothing to print under the other four, which is
 * what the `null` is for. {@link describeAreaRequirement} is the line for those.
 */
export function areaUnlockLevel(area: GatedArea): number | null {
  const requirement = AREA_REQUIREMENTS[area];
  return requirement.kind === 'level' ? requirement.level : null;
}

/** The short caption under a shut door: three or four words, no full stop. */
export function areaLockCaption(area: GatedArea): string {
  const requirement = AREA_REQUIREMENTS[area];
  switch (requirement.kind) {
    case 'level':
      return `Lv ${requirement.level}`;
    case 'building':
      return 'Build it';
    case 'officer':
      return 'Hire one';
    case 'notoriety':
      return `Rank ${requirement.rank}`;
    case 'research':
      return 'Research';
  }
}

/** One sentence on the sign: what a player has to go and do. */
export function describeAreaRequirement(area: GatedArea): string {
  const requirement = AREA_REQUIREMENTS[area];
  switch (requirement.kind) {
    case 'level':
      return `Reach level ${requirement.level}.`;
    case 'building':
      // The catalogue names carry their own article ("The Scrapyard"), and a capital T in the
      // middle of a sentence reads as a typo rather than as a proper noun.
      return `Build ${BUILDING_CATALOG[requirement.building].name.replace(/^The /, 'the ')} in your district.`;
    case 'officer':
      return `Hire a ${OFFICER_ROLE_LABELS[requirement.role]} at the Bar and sit them in the chair.`;
    case 'notoriety':
      return `Buy rank ${requirement.rank} on the notoriety ladder.`;
    case 'research':
      return 'Finish the first programme on the Trader track in the Lab.';
  }
}

/** What each door is called, for a sign or a level-up announcement. */
export function areaName(area: GatedArea): string {
  return AREA_COPY[area].name;
}

/** One sentence on what is behind the door. */
export function areaDescription(area: GatedArea): string {
  return AREA_COPY[area].description;
}

/** The doors a level opens, which are the only ones a level-up has anything to say about. */
const LEVEL_GATED_AREAS: readonly GatedArea[] = GATED_AREAS.filter(
  (area) => AREA_REQUIREMENTS[area].kind === 'level',
);

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

/** Level 40: a third auction at the Bar at once, instead of two. */
export const MILESTONE_SECOND_SIGNATURE = 'second_signature';
/** Level 50: two takes a day off the Black Market shelf instead of one. */
export const MILESTONE_STANDING_INVITATION = 'standing_invitation';
/** Level 60: the Broker stops taking half. */
export const MILESTONE_BROKERS_RESPECT = 'brokers_respect';
/** Level 70: the day's supply run is no longer bounded by what the district can hold. */
export const MILESTONE_DEEP_POCKETS = 'deep_pockets';
/** Level 80: a third crew out at once, in a third area (§E). */
export const MILESTONE_THIRD_CREW = 'third_crew';

const MILESTONES: readonly PlayerLevelUnlock[] = [
  {
    id: MILESTONE_SECOND_SIGNATURE,
    level: 40,
    name: 'The Second Signature',
    description: 'You can bid on three people at once at the Bar. Nobody else in the city can.',
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
  {
    id: MILESTONE_THIRD_CREW,
    level: 80,
    name: 'A Third Crew',
    description: 'Three jobs running at once, in three different parts of the city.',
  },
];

/**
 * Everything level opens, doors first and then the ladder, each in level order.
 *
 * Built rather than written out, so {@link AREA_REQUIREMENTS} stays the one statement of when a
 * screen opens. A door's id *is* its {@link GatedArea} id, which is what lets the client ask
 * `isPlayerUnlockActive(area, level)` with the same word it uses to route.
 *
 * Only the doors a *level* opens are here, which is five of the nine. The other four are opened by
 * a structure, a hire, a rank and a programme, and a level-up has nothing true to say about any of
 * them: announcing "you have unlocked the Scrapyard" at level 4 to a crew that has not built one
 * would be a lie told by the one screen whose whole job is telling a player what just changed.
 */
export const PLAYER_LEVEL_UNLOCKS: readonly PlayerLevelUnlock[] = [
  ...LEVEL_GATED_AREAS.map((area) => ({
    id: area,
    // Safe by construction: `LEVEL_GATED_AREAS` is filtered on exactly this variant.
    level: areaUnlockLevel(area) ?? PLAYER_LEVEL_MIN,
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
