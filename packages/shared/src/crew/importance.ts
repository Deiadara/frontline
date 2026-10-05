import {
  ATTRIBUTE_NAMES,
  MAX_ATTRIBUTE,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import { OFFICER_ROLES, type OfficerRole } from '../roles.js';

/**
 * How much each skill matters to the seat somebody is sitting in (§C2).
 *
 * ## What this replaces
 *
 * A seat used to use four skills at full value and everything else at a flat discount, which made
 * every officer two numbers: the ones that counted and the ones that did not. Four tiers instead,
 * so a sheet reads as a shape rather than a pass mark, and so a person can be a *good enough* fit
 * for a chair without being the intended one.
 *
 * ## This table is public, and it did not used to be
 *
 * GDD §B8/§B8a says which skills a role wants is server-side only, and the game was built that way:
 * the server's hidden hiring table is unshipped, and a leak test fails if it reaches the client.
 * The board's decision is that **this** table is shown, as the gold, silver and blue borders on an
 * officer's sheet, because a player who cannot see which skills a chair rewards cannot make the
 * decision the chairs exist to offer.
 *
 * The hiring table is a different table and is still hidden: what a role *wants in a candidate at
 * the Bar* remains the thing you learn by trying. What is published here is what a seat **puts to
 * work once somebody is in it**, which is the half a player has to be able to plan against.
 */

export const ATTRIBUTE_IMPORTANCES = [
  'insignificant',
  'useful',
  'essential',
  'irreplaceable',
] as const;
export type AttributeImportance = (typeof ATTRIBUTE_IMPORTANCES)[number];

export const IMPORTANCE_LABELS: Readonly<Record<AttributeImportance, string>> = {
  insignificant: 'Insignificant',
  useful: 'Useful',
  essential: 'Essential',
  irreplaceable: 'Irreplaceable',
};

/**
 * What one point of a skill is worth to the seat, by how much the seat cares about it.
 *
 * A flat ladder, 1 to 4, and flat on purpose: a player adding up why one officer scores more than
 * another should be doing arithmetic they can hold in their head.
 */
export const IMPORTANCE_WEIGHT: Readonly<Record<AttributeImportance, number>> = {
  insignificant: 1,
  useful: 2,
  essential: 3,
  irreplaceable: 4,
};

/**
 * The reward for a skill being genuinely *high* rather than merely present, on a **job**.
 *
 * A job's leader fit (`missions.leading.ts`) reads these: the weights above are linear, so without
 * them a leader with 30 in everything would beat the specialist with a 100. A chair no longer reads
 * them (maintainer, 2026-09-30): a seat wants every tag brought up to its tier rather than one peak,
 * which is {@link seatPoints} below.
 *
 * Read per skill, against that skill's own value, and paid once for each skill that reaches a band.
 */
export interface SkillBonusBand {
  /** Inclusive floor of the band. */
  readonly from: number;
  /** Inclusive ceiling. */
  readonly to: number;
  readonly bonus: Readonly<Record<AttributeImportance, number>>;
}

export const SKILL_BONUS_BANDS: readonly SkillBonusBand[] = [
  { from: 0, to: 24, bonus: { insignificant: 0, useful: 0, essential: 0, irreplaceable: 0 } },
  { from: 25, to: 49, bonus: { insignificant: 1, useful: 2, essential: 3, irreplaceable: 4 } },
  { from: 50, to: 74, bonus: { insignificant: 3, useful: 6, essential: 9, irreplaceable: 16 } },
  { from: 75, to: 99, bonus: { insignificant: 9, useful: 12, essential: 18, irreplaceable: 32 } },
  {
    from: 100,
    to: 100,
    bonus: { insignificant: 18, useful: 24, essential: 36, irreplaceable: 64 },
  },
];

/** The band a skill's value falls in. Values outside 0..100 are clamped into the ends. */
export function bandFor(value: number): SkillBonusBand {
  const found = SKILL_BONUS_BANDS.find((band) => value >= band.from && value <= band.to);
  if (found) return found;
  return value < 0 ? SKILL_BONUS_BANDS[0]! : SKILL_BONUS_BANDS[SKILL_BONUS_BANDS.length - 1]!;
}

/**
 * A seat a person can be graded in: one of the officer chairs, or the Overseer's own.
 *
 * The Overseer sits in no chair and cannot be moved, benched or let go, but has a grade read the
 * same way an officer's is (maintainer, 2026-10-04), off the tags under `overseer` below. That
 * grade is what sizes the Overseer's one passive (`overseerLift` in `passives.ts`).
 */
export type Seat = OfficerRole | 'overseer';

/** Every seat, the officer chairs first and the Overseer last. */
export const SEATS: readonly Seat[] = [...OFFICER_ROLES, 'overseer'];

/**
 * What each seat cares about. Anything a seat does not list is `insignificant`.
 *
 * **One irreplaceable, two essential and four useful in every seat** (maintainer, 2026-10-04),
 * checked at load below. The irreplaceable skill is the one the chair is *for*: a Master of
 * Whispers who cannot move unseen is somebody else. The two essentials are the ones the
 * Overseer's passive lifts beside it.
 *
 * The tags only grade the seat. Since 2026-10-04 an officer's skills reach the crew through their
 * chair's one passive, sized by the grade, and never as a per-skill bonus on a shared sheet.
 */
export const ROLE_IMPORTANCE: Readonly<
  Record<Seat, Readonly<Partial<Record<AttributeName, AttributeImportance>>>>
> = {
  master_of_whispers: {
    stealth: 'irreplaceable',
    deception: 'essential',
    signals: 'essential',
    logic: 'useful',
    intuition: 'useful',
    cryptography: 'useful',
    communication: 'useful',
  },
  engineer: {
    engineering: 'irreplaceable',
    craft: 'essential',
    analysis: 'essential',
    improvisation: 'useful',
    salvage: 'useful',
    cybernetics: 'useful',
    organization: 'useful',
  },
  fixer: {
    strategy: 'irreplaceable',
    analysis: 'essential',
    negotiation: 'essential',
    logistics: 'useful',
    organization: 'useful',
    deception: 'useful',
    composure: 'useful',
  },
  steward: {
    charisma: 'irreplaceable',
    communication: 'essential',
    empathy: 'essential',
    diplomacy: 'useful',
    leadership: 'useful',
    organization: 'useful',
    logistics: 'useful',
  },
  field_commander: {
    leadership: 'irreplaceable',
    strategy: 'essential',
    composure: 'essential',
    organization: 'useful',
    resolve: 'useful',
    authority: 'useful',
    communication: 'useful',
  },
  researcher: {
    analysis: 'irreplaceable',
    intuition: 'essential',
    encyclopedia: 'essential',
    logic: 'useful',
    chemistry: 'useful',
    cryptography: 'useful',
    improvisation: 'useful',
  },
  salvager: {
    salvage: 'irreplaceable',
    craft: 'essential',
    logistics: 'essential',
    improvisation: 'useful',
    dexterity: 'useful',
    engineering: 'useful',
    navigation: 'useful',
  },
  right_hand: {
    authority: 'irreplaceable',
    leadership: 'essential',
    composure: 'essential',
    empathy: 'useful',
    intimidation: 'useful',
    diplomacy: 'useful',
    organization: 'useful',
  },
  cartographer: {
    navigation: 'irreplaceable',
    analysis: 'essential',
    stamina: 'essential',
    logistics: 'useful',
    intuition: 'useful',
    logic: 'useful',
    speed: 'useful',
  },
  trader: {
    negotiation: 'irreplaceable',
    charisma: 'essential',
    analysis: 'essential',
    deception: 'useful',
    diplomacy: 'useful',
    logistics: 'useful',
    empathy: 'useful',
  },
  veteran: {
    organization: 'irreplaceable',
    resolve: 'essential',
    logistics: 'essential',
    toughness: 'useful',
    medicine: 'useful',
    strength: 'useful',
    chemistry: 'useful',
  },
  raid_boss: {
    intimidation: 'irreplaceable',
    strength: 'essential',
    toughness: 'essential',
    reflexes: 'useful',
    resolve: 'useful',
    improvisation: 'useful',
    leadership: 'useful',
  },
  professor: {
    improvisation: 'irreplaceable',
    communication: 'essential',
    encyclopedia: 'essential',
    intuition: 'useful',
    analysis: 'useful',
    diplomacy: 'useful',
    cryptography: 'useful',
  },
  overseer: {
    authority: 'irreplaceable',
    leadership: 'essential',
    strategy: 'essential',
    charisma: 'useful',
    intimidation: 'useful',
    negotiation: 'useful',
    composure: 'useful',
  },
};

/** How much this seat cares about that skill. Everything unlisted is insignificant. */
export function importanceOf(role: Seat, attribute: AttributeName): AttributeImportance {
  return ROLE_IMPORTANCE[role][attribute] ?? 'insignificant';
}

/** The skills a seat rates above insignificant, in canonical order. */
export function skillsThatMatter(role: Seat): readonly AttributeName[] {
  return ATTRIBUTE_NAMES.filter((name) => importanceOf(role, name) !== 'insignificant');
}

// --- the seat: how well one person fills one chair ---

/**
 * The rating each tag wants reached in its seat (maintainer, 2026-09-30): the irreplaceable skill
 * at 75, the essentials at 50, the useful ones at 25.
 *
 * "You get the most out of having the essential above 25 and irreplaceable above 50, rather than
 * just getting irreplaceable to 75 and then leaving the rest lower, with the same total attribute
 * points." Below its tier a point in a tagged skill is worth {@link TIER_SHORTFALL_RATIO} times what
 * it is worth above it, so a skill left behind costs more than the same points piled on the peak
 * earn. An untagged skill has no tier and counts at a flat, small rate.
 */
export const IMPORTANCE_TIER: Readonly<Record<AttributeImportance, number>> = {
  insignificant: 0,
  useful: 25,
  essential: 50,
  irreplaceable: 75,
};

/**
 * What a tag asks of a skill, in a sentence (maintainer, 2026-09-30).
 *
 * The one line the crew sheet and the training board both print on a tagged row, so the target a
 * player trains toward is written in one place. It also said how much of the skill reached the
 * crew, until skills stopped reaching the crew except through a chair's grade (2026-10-04).
 */
export function describeImportance(importance: AttributeImportance): string {
  const tier = IMPORTANCE_TIER[importance];
  return tier === 0
    ? `${IMPORTANCE_LABELS[importance]}. Counts for a little in this chair's grade`
    : `${IMPORTANCE_LABELS[importance]}. This chair wants it at ${tier} or better: a point short of ${tier} costs the grade more than a point past it earns`;
}

/**
 * How much more a point is worth short of its tier than past it.
 *
 * Two and a half, which is the smallest round figure that keeps every shortfall ahead of every
 * surplus with room to spare: the cheapest point short of a tier (a useful skill, 3.6 seat weight)
 * still beats the dearest point past one (the irreplaceable skill, 1.9), so no allocation that
 * leaves a tagged skill under its tier can beat one that does not. `importance.test.ts` searches
 * allocations to hold that.
 */
export const TIER_SHORTFALL_RATIO = 2.5;

/**
 * What each skill weighs in the seat's score.
 *
 * The tags keep the 2, 3 and 4 of {@link IMPORTANCE_WEIGHT}. The twenty eight untagged skills weigh
 * a tenth each, 2.8 between them, so they still move the score ("don't delete the fact that
 * insignificant attributes still contribute to the overall") without ever being worth a point that
 * a tag wants.
 */
export const SEAT_WEIGHT: Readonly<Record<AttributeImportance, number>> = {
  insignificant: 0.1,
  useful: 2,
  essential: 3,
  irreplaceable: 4,
};

/**
 * The power the weighted tier score is raised to, so the seat's points sit where the marks were
 * measured.
 *
 * The tier curve is concave and pinned at 0 and 100, so it reads every sheet higher than a plain
 * weighted mean does: about eight points on a fresh recruit, which is two marks. Raising the score
 * to 1.3 puts a recruit's points back where `OFFICER_MARK_FLOOR` and the band widths were measured
 * (a median of about 20 across all chairs, 26 in the chair they were shaped for) and leaves 0 and
 * 100 where they are. It is monotone, so the best allocation of a fixed budget is the same one.
 */
export const SEAT_POINTS_CURVE = 1.3;

/**
 * One skill's rating as the seat counts it, 0 to 100.
 *
 * Two straight pieces that meet at the tier: steep below it, shallow above, with the slopes set
 * so that 0 stays 0 and 100 stays 100. Continuous, so a point never jumps; no ceiling below 100,
 * so a point past the tier always earns something.
 */
export function tierValue(value: number, importance: AttributeImportance): number {
  const clamped = Math.max(0, Math.min(MAX_ATTRIBUTE, value));
  const tier = IMPORTANCE_TIER[importance];
  if (tier === 0) return clamped;
  const below = MAX_ATTRIBUTE / (tier + (MAX_ATTRIBUTE - tier) / TIER_SHORTFALL_RATIO);
  const above = below / TIER_SHORTFALL_RATIO;
  return clamped <= tier ? clamped * below : tier * below + (clamped - tier) * above;
}

/**
 * How well one person fills one chair: the seat's points, 0 to 100.
 *
 * What an officer's mark is read from, and what every chair's passive scales with (`passives.ts`),
 * with the Master of Whispers' intel and the Right Hand's lift. The weighted mean of {@link tierValue} over every
 * skill, raised to {@link SEAT_POINTS_CURVE}.
 *
 * Public, like the tags it reads: a player can see which skills a seat wants and at what tier, so
 * the arithmetic that turns them into a mark hides nothing the borders do not already say. What a
 * role wants in a *candidate* at the Bar is a different, hidden table on the server.
 */
export function seatPoints(attributes: Attributes, role: Seat): number {
  let total = 0;
  let weight = 0;
  for (const name of ATTRIBUTE_NAMES) {
    const importance = importanceOf(role, name);
    total += SEAT_WEIGHT[importance] * tierValue(attributes[name], importance);
    weight += SEAT_WEIGHT[importance];
  }
  const mean = total / weight / MAX_ATTRIBUTE;
  return MAX_ATTRIBUTE * mean ** SEAT_POINTS_CURVE;
}

/*
 * One irreplaceable, two essential and four useful skills per seat, and every named skill real.
 *
 * At load rather than in a test, because this table is authored by hand and the failure it guards
 * is silent: a seat with an extra tag scores everybody differently in that chair for ever, and the
 * Overseer's passive lifts whichever skills are tagged irreplaceable and essential.
 */
const TAGS_PER_SEAT: Readonly<Record<Exclude<AttributeImportance, 'insignificant'>, number>> = {
  irreplaceable: 1,
  essential: 2,
  useful: 4,
};
for (const role of SEATS) {
  const entries = Object.entries(ROLE_IMPORTANCE[role]) as [AttributeName, AttributeImportance][];
  for (const [importance, wanted] of Object.entries(TAGS_PER_SEAT)) {
    const count = entries.filter(([, tag]) => tag === importance).length;
    if (count !== wanted) {
      throw new Error(`${role} has ${count} ${importance} skills, and needs exactly ${wanted}`);
    }
  }
  for (const [name] of entries) {
    if (!(ATTRIBUTE_NAMES as readonly string[]).includes(name)) {
      throw new Error(`${role} rates "${name}", which is not an attribute`);
    }
  }
}
