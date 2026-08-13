import { z } from 'zod';
import {
  ATTRIBUTE_NAMES,
  clampAttribute,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import type { ReputationLabel } from '../economy/reputation.js';

/**
 * What a character wants and what they will do to get it (GDD §H4), and how much they currently
 * agree with the crew holding them (§H5).
 *
 * §H4 makes willingness to join a judgement *the character* makes about *your group's reputation
 * word* — so both halves of that judgement live on the character, and the only thing read off the
 * crew is the §D8 label. Nothing here touches the hidden role table (§B8a): every input is a
 * number or word the player can already see.
 */

/** What drives them (§H4). One per character. */
export const AMBITIONS = [
  'wealth',
  'power',
  'revenge',
  'justice',
  'knowledge',
  'belonging',
  'notoriety',
] as const;
export const AmbitionSchema = z.enum(AMBITIONS);
export type Ambition = z.infer<typeof AmbitionSchema>;

/** How far they will go for it (§H4). One per character. */
export const MORAL_COMPASSES = ['idealist', 'pragmatist', 'opportunist', 'ruthless'] as const;
export const MoralCompassSchema = z.enum(MORAL_COMPASSES);
export type MoralCompass = z.infer<typeof MoralCompassSchema>;

/**
 * How one trait of character reads a reputation word. `drawnTo` and `repelledBy` are disjoint
 * subsets of `REPUTATION_LABELS`; every other label leaves them indifferent.
 */
export interface DispositionSpec {
  label: string;
  description: string;
  drawnTo: readonly ReputationLabel[];
  repelledBy: readonly ReputationLabel[];
}

export const AMBITION_SPECS: Readonly<Record<Ambition, DispositionSpec>> = {
  wealth: {
    label: 'Wealth',
    description: 'Money first. Everything else is a story people tell about the money.',
    drawnTo: ['Opportunist', 'Collaborator', 'Respected'],
    repelledBy: ['Revolutionary', 'Reckless'],
  },
  power: {
    label: 'Power',
    description: 'Wants to be the one deciding, and does not much mind about what.',
    drawnTo: ['Revolutionary', 'Feared', 'Respected'],
    repelledBy: ['Collaborator', 'Cautious'],
  },
  revenge: {
    label: 'Revenge',
    description: 'Carries a list. Every job is measured against how far down it gets them.',
    drawnTo: ['Anti-systemic', 'Hostile', 'Feared'],
    repelledBy: ['Collaborator', 'Cautious'],
  },
  justice: {
    label: 'Justice',
    description: 'Believes the arrangement is wrong and that wrongs are supposed to be answered.',
    drawnTo: ['Revolutionary', 'Anti-systemic', 'Honorable'],
    repelledBy: ['Treacherous', 'Collaborator'],
  },
  knowledge: {
    label: 'Knowledge',
    description: 'Here for what the work teaches them. Corpses teach nothing.',
    drawnTo: ['Cautious', 'Honorable', 'Respected'],
    repelledBy: ['Reckless', 'Feared'],
  },
  belonging: {
    label: 'Belonging',
    description: 'Wants a crew that holds together and holds its word.',
    drawnTo: ['Cautious', 'Honorable', 'Respected'],
    repelledBy: ['Treacherous', 'Reckless'],
  },
  notoriety: {
    label: 'Notoriety',
    description: 'Wants the street to say the name. Does not care how the sentence ends.',
    drawnTo: ['Hostile', 'Reckless', 'Feared'],
    // Being merely well thought of is the one outcome they have no use for.
    repelledBy: ['Cautious', 'Collaborator', 'Respected'],
  },
};

export const MORAL_COMPASS_SPECS: Readonly<Record<MoralCompass, DispositionSpec>> = {
  idealist: {
    label: 'Idealist',
    description: 'There is a right way to do this, and they would rather lose doing it.',
    drawnTo: ['Revolutionary', 'Anti-systemic', 'Honorable'],
    repelledBy: ['Treacherous', 'Collaborator', 'Opportunist'],
  },
  pragmatist: {
    label: 'Pragmatist',
    description: 'Takes the working option. Distrusts anyone who never counts the cost.',
    drawnTo: ['Cautious', 'Opportunist', 'Respected'],
    repelledBy: ['Revolutionary', 'Reckless'],
  },
  opportunist: {
    label: 'Opportunist',
    description: 'Loyal to whichever way the money and the leverage are pointing today.',
    drawnTo: ['Opportunist', 'Collaborator', 'Feared'],
    repelledBy: ['Revolutionary', 'Honorable'],
  },
  ruthless: {
    label: 'Ruthless',
    description: 'Squeamishness is a tax. They have never paid it.',
    drawnTo: ['Hostile', 'Treacherous', 'Feared'],
    repelledBy: ['Cautious', 'Honorable', 'Respected'],
  },
};

/** The pair every character carries (§H4). */
export const DispositionSchema = z.object({
  ambition: AmbitionSchema,
  moralCompass: MoralCompassSchema,
});
export type Disposition = z.infer<typeof DispositionSchema>;

/** Both halves of §H4 agreeing is the strongest reading either direction can produce. */
export const STANCE_MIN = -2;
export const STANCE_MAX = 2;

function opinionOf(spec: DispositionSpec, reputation: ReputationLabel): number {
  if (spec.drawnTo.includes(reputation)) return 1;
  if (spec.repelledBy.includes(reputation)) return -1;
  return 0;
}

/**
 * §H4 — what this character makes of your group's reputation word, `-2`..`+2`.
 *
 * Their ambition and their moral compass each read the word independently and the two are summed,
 * so a character can be drawn to what you do and appalled by how you do it and come out neutral.
 */
export function reputationStance(
  { ambition, moralCompass }: Disposition,
  reputation: ReputationLabel,
): number {
  return (
    opinionOf(AMBITION_SPECS[ambition], reputation) +
    opinionOf(MORAL_COMPASS_SPECS[moralCompass], reputation)
  );
}

/**
 * Whether this character's two halves can ever object to the *same* word (§H4).
 *
 * Refusing to join takes both of them at once, so a character whose ambition and moral compass are
 * repelled by disjoint sets of reputations will hear any crew out, however the street reads. The
 * Bar deliberately seats a few of these every day — see `BAR_OPEN_DOOR_FLOOR` — because otherwise
 * an unlucky roll can leave a crew with nobody willing to talk to them at all.
 */
export function hearsAnyCrewOut({ ambition, moralCompass }: Disposition): boolean {
  const against = new Set<ReputationLabel>(MORAL_COMPASS_SPECS[moralCompass].repelledBy);
  return !AMBITION_SPECS[ambition].repelledBy.some((label) => against.has(label));
}

/**
 * §H5 — the alignment meter, 0..100. Starts neutral: a character who has just signed has an
 * opinion of your *reputation*, not yet of the work.
 */
export const ALIGNMENT_MIN = 0;
export const ALIGNMENT_MAX = 100;
export const ALIGNMENT_START = 50;
export const AlignmentSchema = z.number().min(ALIGNMENT_MIN).max(ALIGNMENT_MAX);

/** §H5 — at or below this they threaten to leave. */
export const ALIGNMENT_LEAVE_THRESHOLD = 20;
/** §H5 — at or above this they start earning skill bonuses. */
export const ALIGNMENT_BONUS_THRESHOLD = 75;

export const ALIGNMENT_BANDS = ['leaving', 'unsettled', 'settled', 'devoted'] as const;
export type AlignmentBand = (typeof ALIGNMENT_BANDS)[number];

export const ALIGNMENT_BAND_LABELS: Readonly<Record<AlignmentBand, string>> = {
  leaving: 'Threatening to walk',
  unsettled: 'Unsettled',
  settled: 'Settled',
  devoted: 'Devoted',
};

export function alignmentBand(alignment: number): AlignmentBand {
  if (alignment <= ALIGNMENT_LEAVE_THRESHOLD) return 'leaving';
  if (alignment >= ALIGNMENT_MAX - 5) return 'devoted';
  if (alignment >= ALIGNMENT_BONUS_THRESHOLD) return 'settled';
  return 'unsettled';
}

/** §H5 — "too low → they threaten to leave". The one place that reading is decided. */
export function threatensToLeave(alignment: number): boolean {
  return alignment <= ALIGNMENT_LEAVE_THRESHOLD;
}

/** Alignment points that buy one attribute point of bonus. */
export const ALIGNMENT_POINTS_PER_BONUS = 5;
/** §H5 — "bonuses to *some* skills": the few they are already best at, not the whole sheet. */
export const ALIGNMENT_BONUS_ATTRIBUTES = 3;

/** §H5 — how large the bonus is at this alignment. Zero below the threshold, `+5` at 100. */
export function alignmentSkillBonus(alignment: number): number {
  if (alignment < ALIGNMENT_BONUS_THRESHOLD) return 0;
  return Math.floor((alignment - ALIGNMENT_BONUS_THRESHOLD) / ALIGNMENT_POINTS_PER_BONUS);
}

/**
 * Which attributes the §H5 bonus lands on: the ones they are already strongest at, ties broken by
 * canonical attribute order so the set is stable for a given sheet.
 */
export function alignmentBonusAttributes(attributes: Attributes): AttributeName[] {
  return [...ATTRIBUTE_NAMES]
    .sort(
      (a, b) =>
        attributes[b] - attributes[a] || ATTRIBUTE_NAMES.indexOf(a) - ATTRIBUTE_NAMES.indexOf(b),
    )
    .slice(0, ALIGNMENT_BONUS_ATTRIBUTES);
}

/**
 * §H5 — the sheet as it actually performs, with the alignment bonus folded in.
 *
 * A read-time view, never persisted: storing it would bake today's alignment into the character
 * and double-count the bonus the next time they drift.
 */
export function alignedAttributes(attributes: Attributes, alignment: number): Attributes {
  const bonus = alignmentSkillBonus(alignment);
  if (bonus === 0) return { ...attributes };
  const boosted = { ...attributes };
  for (const name of alignmentBonusAttributes(attributes)) {
    boosted[name] = clampAttribute(boosted[name] + bonus);
  }
  return boosted;
}

/**
 * Where a character's alignment is heading, given what they make of your reputation (§H4, §H5).
 * A stance of `0` sits at the neutral start, so an indifferent officer never drifts at all.
 *
 * The step is exactly `(ALIGNMENT_MAX - ALIGNMENT_START) / STANCE_MAX`, which is what keeps the
 * meter honest: the strongest §H4 reading either direction can produce heads for the end of the
 * bar rather than for some interior value. At `20` the reachable range was `10..90`, which left
 * `devoted` (`>= 95`) and the top of the skill-bonus scale states no live path could enter — the
 * band cuts are written against `ALIGNMENT_MAX`, a schema bound, and only coincide with the
 * reachable bound at this step. `alignmentReachesEveryBand` in the tests pins that.
 */
export const ALIGNMENT_PER_STANCE = (ALIGNMENT_MAX - ALIGNMENT_START) / STANCE_MAX;

export function alignmentTarget(stance: number): number {
  return Math.min(
    ALIGNMENT_MAX,
    Math.max(ALIGNMENT_MIN, ALIGNMENT_START + ALIGNMENT_PER_STANCE * stance),
  );
}

/**
 * How long it takes an officer to move half the way to their target opinion. Days, not ticks —
 * like the §D8 reputation drift, alignment settles continuously so nothing has to be scheduled.
 */
export const ALIGNMENT_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * §H5 — settles alignment towards `target` over `elapsedMs`. Never moves on a backwards clock,
 * and is exactly idempotent for a zero-length step, so calling it on every read is safe.
 */
export function settleAlignment(current: number, target: number, elapsedMs: number): number {
  const elapsed = Math.max(0, elapsedMs);
  const remaining = Math.pow(0.5, elapsed / ALIGNMENT_HALF_LIFE_MS);
  return target + (current - target) * remaining;
}
