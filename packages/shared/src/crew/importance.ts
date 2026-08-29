import { ATTRIBUTE_NAMES, type AttributeName, type Attributes } from '../attributes.js';
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
 * The reward for a skill being genuinely *high* rather than merely present.
 *
 * The weights above are linear, so without this a hundred officers with 30 in everything would beat
 * the one specialist with a 100, and the game would be asking you to hire evenly. These bands are
 * what make a peak worth chasing: the jump from 49 to 50 in an irreplaceable skill is worth four
 * times what the same point is worth in an insignificant one, and the jump from 99 to 100 is worth
 * more again.
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
 * What each seat cares about. Anything a role does not list is `insignificant`.
 *
 * Listed as the exception rather than as all thirty-five per role: nineteen complete sheets is six
 * hundred and sixty-five rows nobody will read, and the shape of a job is what it singles out.
 *
 * **Exactly one `irreplaceable` per role**, checked at load below. It is the skill the chair is
 * *for*: a Head Spy who cannot move unseen is not a Head Spy who is a bit worse, they are somebody
 * else. Everything else is a matter of degree.
 */
export const ROLE_IMPORTANCE: Readonly<
  Record<OfficerRole, Readonly<Partial<Record<AttributeName, AttributeImportance>>>>
> = {
  head_spy: {
    stealth: 'irreplaceable',
    deception: 'essential',
    hacking: 'essential',
    logic: 'useful',
    intuition: 'useful',
    cryptography: 'useful',
  },
  lead_engineer: {
    engineering: 'irreplaceable',
    fabrication: 'essential',
    analysis: 'essential',
    cybernetics: 'useful',
    improvisation: 'useful',
    salvage: 'useful',
  },
  finance_officer: {
    strategy: 'irreplaceable',
    analysis: 'essential',
    logistics: 'essential',
    negotiation: 'useful',
    organization: 'useful',
    composure: 'useful',
  },
  head_of_growth: {
    charisma: 'irreplaceable',
    communication: 'essential',
    empathy: 'essential',
    diplomacy: 'useful',
    leadership: 'useful',
    intuition: 'useful',
  },
  field_commander: {
    leadership: 'irreplaceable',
    organization: 'essential',
    composure: 'essential',
    resolve: 'useful',
    strategy: 'useful',
    authority: 'useful',
  },
  head_of_research: {
    analysis: 'irreplaceable',
    intuition: 'essential',
    improvisation: 'essential',
    chemistry: 'useful',
    logic: 'useful',
    cryptography: 'useful',
  },
  wetware_chief: {
    cybernetics: 'irreplaceable',
    medicine: 'essential',
    engineering: 'essential',
    chemistry: 'useful',
    dexterity: 'useful',
    composure: 'useful',
  },
  fabricator: {
    fabrication: 'irreplaceable',
    engineering: 'essential',
    salvage: 'essential',
    dexterity: 'useful',
    improvisation: 'useful',
    logistics: 'useful',
  },
  salvager: {
    salvage: 'irreplaceable',
    navigation: 'essential',
    logistics: 'essential',
    stamina: 'useful',
    toughness: 'useful',
    intuition: 'useful',
  },
  right_hand: {
    authority: 'irreplaceable',
    leadership: 'essential',
    composure: 'essential',
    empathy: 'useful',
    intimidation: 'useful',
    diplomacy: 'useful',
  },
  cartographer: {
    navigation: 'irreplaceable',
    analysis: 'essential',
    resolve: 'essential',
    stamina: 'useful',
    intuition: 'useful',
    logic: 'useful',
  },
  trader: {
    negotiation: 'irreplaceable',
    charisma: 'essential',
    logistics: 'essential',
    deception: 'useful',
    diplomacy: 'useful',
    analysis: 'useful',
  },
  security_officer: {
    resolve: 'irreplaceable',
    reflexes: 'essential',
    toughness: 'essential',
    speed: 'useful',
    intimidation: 'useful',
    composure: 'useful',
  },
  chief_medic: {
    medicine: 'irreplaceable',
    chemistry: 'essential',
    composure: 'essential',
    empathy: 'useful',
    dexterity: 'useful',
    cybernetics: 'useful',
  },
  instructor_of_the_young: {
    communication: 'irreplaceable',
    diplomacy: 'essential',
    empathy: 'essential',
    intuition: 'useful',
    leadership: 'useful',
    composure: 'useful',
  },
  raid_boss: {
    intimidation: 'irreplaceable',
    strength: 'essential',
    toughness: 'essential',
    demolition: 'useful',
    resolve: 'useful',
    leadership: 'useful',
  },
  scout: {
    speed: 'irreplaceable',
    stealth: 'essential',
    navigation: 'essential',
    dexterity: 'useful',
    stamina: 'useful',
    reflexes: 'useful',
  },
  consigliere: {
    logic: 'irreplaceable',
    empathy: 'essential',
    deception: 'essential',
    strategy: 'useful',
    diplomacy: 'useful',
    composure: 'useful',
  },
  professor: {
    improvisation: 'irreplaceable',
    intuition: 'essential',
    diplomacy: 'essential',
    cryptography: 'useful',
    communication: 'useful',
    analysis: 'useful',
  },
};

/** How much this seat cares about that skill. Everything unlisted is insignificant. */
export function importanceOf(role: OfficerRole, attribute: AttributeName): AttributeImportance {
  return ROLE_IMPORTANCE[role][attribute] ?? 'insignificant';
}

/** The skills a seat rates above insignificant, in canonical order. */
export function skillsThatMatter(role: OfficerRole): readonly AttributeName[] {
  return ATTRIBUTE_NAMES.filter((name) => importanceOf(role, name) !== 'insignificant');
}

/**
 * How well one person fills one chair, as a single number.
 *
 * `base` is every skill's value times what the seat pays for it. `bonus` is the band table above,
 * paid per skill that clears a threshold. `total` is what the rest of the game reads; the two parts
 * are handed back separately because they answer different questions ("is this person good" against
 * "is this person *peaked*") and because `crew/effects.ts` uses the split.
 *
 * **Never shown to the player.** The borders say which skills matter and the standing figures say
 * what the crew is worth; a raw score on the screen would turn a judgement into a leaderboard.
 */
export interface OfficerScore {
  readonly base: number;
  readonly bonus: number;
  readonly total: number;
}

export function officerScore(attributes: Attributes, role: OfficerRole): OfficerScore {
  let base = 0;
  let bonus = 0;
  for (const name of ATTRIBUTE_NAMES) {
    const importance = importanceOf(role, name);
    const value = attributes[name];
    base += value * IMPORTANCE_WEIGHT[importance];
    bonus += bandFor(value).bonus[importance];
  }
  return { base, bonus, total: base + bonus };
}

/*
 * One irreplaceable skill per seat, and every named skill real.
 *
 * At load rather than in a test, because this table is authored by hand and the failure it guards
 * is silent: a role with two irreplaceable skills scores everybody higher in that chair for ever,
 * and a role with none has no skill it is actually for.
 */
for (const role of OFFICER_ROLES) {
  const entries = Object.entries(ROLE_IMPORTANCE[role]) as [AttributeName, AttributeImportance][];
  const irreplaceable = entries.filter(([, importance]) => importance === 'irreplaceable');
  if (irreplaceable.length !== 1) {
    throw new Error(
      `${role} has ${irreplaceable.length} irreplaceable skills, and needs exactly 1`,
    );
  }
  for (const [name] of entries) {
    if (!(ATTRIBUTE_NAMES as readonly string[]).includes(name)) {
      throw new Error(`${role} rates "${name}", which is not an attribute`);
    }
  }
}
