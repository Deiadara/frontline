import {
  ATTRIBUTE_NAMES,
  MAX_RECRUITMENT_ATTRIBUTE,
  OFFICER_ROLES,
  TRAIT_IDS,
  applyTraitBonuses,
  type AttributeName,
  type Attributes,
  type TraitId,
} from '@frontline/shared';
import { weightedAttributesOf } from '../roles/requirements.js';
import { createRng, gaussian, randomInt, sample, type Rng } from './rng.js';

/**
 * Recruitment rolls (GDD §B2, §B2a).
 *
 * The board's three numbers: a character averages 15-20, a good attribute sits around 30, a bad
 * one around 10. Nothing reaches 40 — the 40..100 band is what progression is for.
 *
 * Shape of a roll: every attribute is drawn around the mean, then one role's affinity template
 * lifts 3-5 of them toward 30 and 1-3 unrelated ones are pushed down toward 10. The template is
 * read from the hidden requirement table, which is exactly why generation is server-side.
 * `generateCharacter` deliberately does not report which role shaped the roll — that would be a
 * fit hint, and B8 forbids those.
 */

const BASE_MEAN = 15;
const BASE_STD_DEV = 3.5;
const BASE_FLOOR = 5;

const STRENGTH_MEAN = 30;
const STRENGTH_STD_DEV = 2.5;
const MIN_STRENGTHS = 3;
const MAX_STRENGTHS = 5;

const WEAKNESS_MEAN = 10;
const WEAKNESS_STD_DEV = 1.5;
const WEAKNESS_FLOOR = 4;
const MIN_WEAKNESSES = 1;
const MAX_WEAKNESSES = 3;

/** Chance a generated character carries a trait (B7 — *some* characters have one). */
const TRAIT_CHANCE = 0.35;

export interface GeneratedCharacter {
  attributes: Attributes;
  traits: TraitId[];
}

/** Round onto the scale and hold the recruitment ceiling (B2a). */
function atRecruitment(value: number, floor: number): number {
  return Math.min(MAX_RECRUITMENT_ATTRIBUTE, Math.max(floor, Math.round(value)));
}

function rollAttributes(rng: Rng): Attributes {
  const sheet = Object.fromEntries(
    ATTRIBUTE_NAMES.map((name) => [
      name,
      atRecruitment(gaussian(rng, BASE_MEAN, BASE_STD_DEV), BASE_FLOOR),
    ]),
  ) as Attributes;

  const affinity = OFFICER_ROLES[randomInt(rng, 0, OFFICER_ROLES.length - 1)];
  if (!affinity) throw new Error('no officer roles to draw an affinity from');
  const strengths = weightedAttributesOf(affinity).slice(
    0,
    randomInt(rng, MIN_STRENGTHS, MAX_STRENGTHS),
  );
  for (const name of strengths) {
    sheet[name] = atRecruitment(gaussian(rng, STRENGTH_MEAN, STRENGTH_STD_DEV), BASE_FLOOR);
  }

  const eligible = ATTRIBUTE_NAMES.filter((name) => !strengths.includes(name));
  for (const name of sample(rng, eligible, randomInt(rng, MIN_WEAKNESSES, MAX_WEAKNESSES))) {
    sheet[name] = atRecruitment(gaussian(rng, WEAKNESS_MEAN, WEAKNESS_STD_DEV), WEAKNESS_FLOOR);
  }

  return sheet;
}

function rollTraits(rng: Rng): TraitId[] {
  if (rng() >= TRAIT_CHANCE) return [];
  const trait = TRAIT_IDS[randomInt(rng, 0, TRAIT_IDS.length - 1)];
  return trait ? [trait] : [];
}

/** Roll one recruitable character. Same seed, same character. */
export function generateCharacter(seed: number): GeneratedCharacter {
  const rng = createRng(seed);
  const rolled = rollAttributes(rng);
  const traits = rollTraits(rng);

  // A trait's bonus lands on top of the roll but still cannot break the recruitment ceiling.
  const boosted = applyTraitBonuses(rolled, traits);
  const attributes = Object.fromEntries(
    ATTRIBUTE_NAMES.map((name: AttributeName) => [
      name,
      Math.min(MAX_RECRUITMENT_ATTRIBUTE, boosted[name]),
    ]),
  ) as Attributes;

  return { attributes, traits };
}
