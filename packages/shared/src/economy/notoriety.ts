import { z } from 'zod';

/**
 * Notoriety (GDD §D7): the rank a crew buys with its name.
 *
 * Infamy used to be one number doing two jobs, and it did neither well. It was the currency you
 * spent on contraband and sacrifices, and it was simultaneously the threshold every gate in the
 * game compared against. So spending made a crew worse at things that had nothing to do with the
 * purchase: buy a stimulant crate on Tuesday and the Colossus refuses to take your contract on
 * Wednesday, because the number that fell was also the number the roster was reading.
 *
 * The two jobs are now two fields.
 *
 * `infamy` is a wallet. It goes up when you kill people and take ground, down when you spend it,
 * and nothing reads it as a rank.
 *
 * `notoriety` is a rank. It is an index into the fourteen tiers below, it is bought once with
 * infamy, and it never falls. Every gate that used to compare points now compares tiers, so what a
 * crew is *allowed* to do is a thing they have earned and kept rather than a thing that evaporates
 * the next time they buy a syringe.
 */

/**
 * The fourteen words the street has for a crew, worst to best known.
 *
 * `Nobody` is where everybody starts and is not bought. `Nameless` at the far end is the joke the
 * ladder is built around: get famous enough for long enough and the city stops using a name for
 * you at all.
 */
export const NOTORIETY_TIERS = [
  'Nobody',
  'Unknown',
  'Ill-Reputed',
  'Back-Alley Rumored',
  'Whispered',
  'Marked',
  'Known Trouble',
  'Bad Omen',
  'Feared',
  'Dreaded',
  'Street Devil',
  'Scourge',
  'Nightmare',
  'Nameless',
] as const;
export const NotorietyTierSchema = z.enum(NOTORIETY_TIERS);
export type NotorietyTier = (typeof NOTORIETY_TIERS)[number];

/** A crew's rank, as an index into {@link NOTORIETY_TIERS}. Starts at 0 and never falls. */
export const NotorietySchema = z
  .number()
  .int()
  .min(0)
  .max(NOTORIETY_TIERS.length - 1)
  .default(0);

export const STARTING_NOTORIETY = 0;
export const MAX_NOTORIETY = NOTORIETY_TIERS.length - 1;

/**
 * What the first step off `Nobody` costs, and how much dearer each one after it is.
 *
 * The board set the shape: three hundred, then nine hundred, then two thousand seven hundred. A
 * clean tripling, which is what makes the early ladder feel like progress and the far end feel like
 * a rumour. `Nameless` at 300 x 3^12 is a number no crew is going to reach at current earn rates,
 * and that is a deliberate reading of the brief rather than an oversight: the last few rungs are
 * there to be seen from a distance, the way a Grepolis player can read the whole title list on day
 * one and know what the top of it means.
 */
export const NOTORIETY_FIRST_COST = 300;
export const NOTORIETY_COST_GROWTH = 3;

/**
 * The price of moving from `tier` to the one above it, or `null` at the top.
 *
 * Computed rather than tabulated so the two constants above are the only place the curve lives.
 */
export function notorietyUpgradeCost(tier: number): number | null {
  const at = clampNotoriety(tier);
  if (at >= MAX_NOTORIETY) return null;
  return NOTORIETY_FIRST_COST * NOTORIETY_COST_GROWTH ** at;
}

/** Total infamy spent to have reached `tier` from nothing. What the hover card calls "invested". */
export function notorietySpentTo(tier: number): number {
  let total = 0;
  for (let step = 0; step < clampNotoriety(tier); step += 1) {
    total += notorietyUpgradeCost(step) ?? 0;
  }
  return total;
}

export function clampNotoriety(tier: number): number {
  return Math.min(MAX_NOTORIETY, Math.max(0, Math.trunc(tier)));
}

export function notorietyTier(tier: number): NotorietyTier {
  return NOTORIETY_TIERS[clampNotoriety(tier)] as NotorietyTier;
}

/** The tier a name is called, by index. `null` past the top, which is what "no next rung" means. */
export function nextNotorietyTier(tier: number): NotorietyTier | null {
  const at = clampNotoriety(tier);
  return at >= MAX_NOTORIETY ? null : (NOTORIETY_TIERS[at + 1] as NotorietyTier);
}

/**
 * One line per tier, for the card that explains the ladder.
 *
 * Written as what the street is doing rather than as what the player has unlocked. A rank is a
 * social fact in this game, and a list of mechanical grants would make it a menu.
 */
export const NOTORIETY_BLURBS: Readonly<Record<NotorietyTier, string>> = {
  Nobody: 'Nobody has heard of you, which is its own kind of safety.',
  Unknown: 'A few people could describe you. None of them would bother.',
  'Ill-Reputed': 'Your name comes up, and never in a sentence anybody enjoys.',
  'Back-Alley Rumored': 'Stories about you have started, and half of them are wrong.',
  Whispered: 'People lower their voices. That is new.',
  Marked: 'The Combine has a file, and somebody senior has read it.',
  'Known Trouble': 'Doors are shut before you reach them. Some of them stay shut.',
  'Bad Omen': 'Crews call off work because you were seen in the district.',
  Feared: 'Nobody negotiates with you from a position they have not already conceded.',
  Dreaded: 'The word for you is used on children, and it works.',
  'Street Devil': 'What you are is no longer discussed as a person.',
  Scourge: 'Districts you have never entered plan around you.',
  Nightmare: 'The city does not argue about whether the stories are true.',
  Nameless: 'Nobody says it out loud any more. That is what the top of this looks like.',
};

/** Whether a crew's rank clears a gate. Every threshold in the game reads through this. */
export function meetsNotoriety(tier: number, required: number): boolean {
  return clampNotoriety(tier) >= clampNotoriety(required);
}

/** The tier a gate wants, by name, for a refusal a player can act on. */
export function notorietyRequirement(required: number): string {
  return notorietyTier(required);
}
