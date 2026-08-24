import {
  ATTRIBUTE_NAMES,
  MAX_RECRUITMENT_ATTRIBUTE,
  OFFICER_ROLES,
  TRAIT_IDS,
  applyTraitBonuses,
  type AttributeName,
  type Attributes,
  type OfficerRole,
  type TraitId,
} from '@frontline/shared';
import { attributeWeightsOf } from '../roles/requirements.js';
import { createRng, gaussian, randomInt, sample, weightedSample, type Rng } from './rng.js';

/**
 * Recruitment rolls (GDD §B2, §B2a).
 *
 * The board's three numbers: a character averages 15-20, a good attribute sits around 30, a bad
 * one around 10. Nothing reaches 40: the 40..100 band is what progression is for.
 *
 * Shape of a roll: every attribute is drawn around the mean, then one role's affinity template
 * lifts 3-5 of them toward 30 and 1-3 unrelated ones are pushed down toward 10. The template is
 * read from the hidden requirement table, which is exactly why generation is server-side.
 * `generateCharacter` deliberately does not report which role shaped the roll. That would be a
 * fit hint, and B8 forbids those.
 *
 * Not reporting the role is not enough on its own, though: if the lifted attributes were simply
 * the role's heaviest ones, the sheet would *be* the table, one row at a time (B8 void by
 * construction). So a strength is not a lookup: one of them comes from outside the template
 * entirely, and the rest are *drawn* over the weights rather than taken in order. What survives
 * is a tendency: the affinity is still genuinely the recruit's best role, but the player cannot
 * prove which role that is, and cannot recompute the fit that would tell them. Selling that
 * certainty is the §B9 research task's job (W7).
 */

/**
 * The base band sits at 18 rather than lower so that B2a's weakness push is *visible from the
 * sheet*: the natural minimum of 34 draws has to land clear above the pushed attribute, or the
 * lowest rating a player sees is only an unlucky base roll and the push changes nothing anyone
 * can observe. Measured over 20k rolls, reading the 4th-lowest of 34 as the natural tail (above
 * the 1-3 pushed ones):
 *
 *   N(15, 3.5) -> tail 10.27, sheet mean 16.47, lowest 7.65: tail sits *at* the ~10 push
 *   N(18, 2.5) -> tail 13.94, sheet mean 18.94, lowest 9.25: tail sits ~4 clear of it
 *
 * Both means are inside B2's 15-20 band; only the second lets B2's "a bad one ~10" read as ~10
 * off the sheet.
 */
const BASE_MEAN = 18;
const BASE_STD_DEV = 2.5;
const BASE_FLOOR = 5;

const STRENGTH_MEAN = 30;
const STRENGTH_STD_DEV = 2.5;
const MIN_STRENGTHS = 3;
const MAX_STRENGTHS = 5;
/**
 * How many of a roll's strengths are drawn from outside the affinity's template (B8).
 *
 * Exactly one, and the count is the whole design. It is what stops the lifted set from being a
 * template subset the player can read back as a table row. Measured over 3000 rolls, verbatim
 * template rows per 20-recruit roster against the affinity's share of best fit:
 *
 *   0 off-template -> 6.89 rows/roster, best fit 0.93   (the MOU-184 bug: the table, for free)
 *   1 off-template -> 0.17 rows/roster, best fit 0.76   (both bars clear)
 *   2 off-template -> 0.01 rows/roster, best fit 0.44   (the roll stops meaning anything)
 *
 * A second one buys almost no further secrecy and costs most of the signal the roll exists to
 * carry, so one is not a compromise between the two bars. It is the only setting that clears
 * both. `generate.test.ts` asserts each bound; the full analysis is in the MOU-186 thread.
 */
const OFF_TEMPLATE_STRENGTHS = 1;

/**
 * The off-template count has a legal ceiling. `pickStrengths` draws `count - OFF_TEMPLATE_STRENGTHS`
 * attributes from the template, so once the off-template count reaches `count` a roll can lift
 * nothing on-template at all: the affinity contributed nothing, on a sheet that still looks
 * ordinary and passes every distribution floor below. `OFF_TEMPLATE_STRENGTHS < MIN_STRENGTHS` is
 * exactly the guarantee that at least one strength stays on-template, and raising it past that has
 * to fail here, at import, rather than quietly in the numbers.
 */
if (OFF_TEMPLATE_STRENGTHS >= MIN_STRENGTHS) {
  throw new Error(
    `off-template count is degenerate: OFF_TEMPLATE_STRENGTHS (${OFF_TEMPLATE_STRENGTHS}) must ` +
      `stay below MIN_STRENGTHS (${MIN_STRENGTHS}), or a roll can lift no on-template attribute`,
  );
}

const WEAKNESS_MEAN = 10;
const WEAKNESS_STD_DEV = 1.5;
const WEAKNESS_FLOOR = 4;
const MIN_WEAKNESSES = 1;
const MAX_WEAKNESSES = 3;

/** Chance a generated character carries a trait (B7: *some* characters have one). */
const TRAIT_CHANCE = 0.35;

export interface GeneratedCharacter {
  attributes: Attributes;
  traits: TraitId[];
}

/**
 * A roll together with the role that shaped it: server-internal, and deliberately *not* what
 * `generateCharacter` hands back, because the affinity is precisely the fit hint B8 forbids. It
 * exists so tests can measure how much of the affinity survives into a sheet a player can see.
 */
export interface ShapedRoll extends GeneratedCharacter {
  affinity: OfficerRole;
}

/** Round onto the scale and hold the recruitment ceiling (B2a). */
function atRecruitment(value: number, floor: number): number {
  return Math.min(MAX_RECRUITMENT_ATTRIBUTE, Math.max(floor, Math.round(value)));
}

/**
 * Which attributes a roll lifts. Most are drawn over the affinity's template: heavier weights
 * come up more often, but one comes from outside it, so the lifted set is never the template's
 * own membership and cannot be read back as one.
 */
function pickStrengths(rng: Rng, affinity: OfficerRole): AttributeName[] {
  const template = attributeWeightsOf(affinity);
  const named = new Set<AttributeName>(template.map(([name]) => name));
  const offTemplate = ATTRIBUTE_NAMES.filter((name) => !named.has(name));

  const count = randomInt(rng, MIN_STRENGTHS, MAX_STRENGTHS);
  return [
    ...sample(rng, offTemplate, OFF_TEMPLATE_STRENGTHS),
    ...weightedSample(rng, template, count - OFF_TEMPLATE_STRENGTHS),
  ];
}

function rollAttributes(rng: Rng, affinity: OfficerRole): Attributes {
  const sheet = Object.fromEntries(
    ATTRIBUTE_NAMES.map((name) => [
      name,
      atRecruitment(gaussian(rng, BASE_MEAN, BASE_STD_DEV), BASE_FLOOR),
    ]),
  ) as Attributes;

  const strengths = pickStrengths(rng, affinity);
  for (const name of strengths) {
    // The better of the two: a lift marks an attribute as strong, so it must never pull one down.
    const lifted = atRecruitment(gaussian(rng, STRENGTH_MEAN, STRENGTH_STD_DEV), BASE_FLOOR);
    sheet[name] = Math.max(sheet[name], lifted);
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

/** Roll one recruitable character, keeping the affinity. Same seed, same character. */
export function rollRecruit(seed: number): ShapedRoll {
  const rng = createRng(seed);
  const affinity = OFFICER_ROLES[randomInt(rng, 0, OFFICER_ROLES.length - 1)];
  if (!affinity) throw new Error('no officer roles to draw an affinity from');

  const rolled = rollAttributes(rng, affinity);
  const traits = rollTraits(rng);

  // A trait's bonus lands on top of the roll but still cannot break the recruitment ceiling.
  const boosted = applyTraitBonuses(rolled, traits);
  const attributes = Object.fromEntries(
    ATTRIBUTE_NAMES.map((name: AttributeName) => [
      name,
      Math.min(MAX_RECRUITMENT_ATTRIBUTE, boosted[name]),
    ]),
  ) as Attributes;

  return { attributes, traits, affinity };
}

/** Roll one recruitable character. Same seed, same character. */
export function generateCharacter(seed: number): GeneratedCharacter {
  const { attributes, traits } = rollRecruit(seed);
  return { attributes, traits };
}
