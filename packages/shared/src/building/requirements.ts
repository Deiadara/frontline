import { markAtLeast, type OfficerMark } from '../crew/marks.js';
import { levelCeilingFor, type BuildingKind } from './kinds.js';
import { notorietyTier } from '../economy/notoriety.js';
import type { OfficerRole } from '../roles.js';
import type { ModificationEffect } from './modifications.js';
import type { ModificationRarity } from '../modification-rarity.js';

/**
 * What a crew has to be before a modification will go into anything (maintainer rule, 2026-09-16).
 *
 * A card used to ask two things: a Scrapyard level and, past `ADVANCED_MODIFICATION_MAGNITUDE`, a
 * retrofit document. That made the whole catalogue a shopping list gated on one structure, so the
 * only question a player ever answered was "have I raised the yard yet". The maintainer's rule is
 * that the good cards should be **hard to get and worth getting**, and that a card asks for more
 * than one thing at a time.
 *
 * So every card now names four gates, and all of them have to hold:
 *
 * - the **structure's own level**, because a bracket bolted to a shed is a bracket on a shed;
 * - the **crew's level**, which is the one figure that says how far into the game this is;
 * - an **officer's mark**, in the chair whose trade the card belongs to (see {@link officerForEffect});
 * - and for the top two bands, the **document**, which was already there and is now one gate of four.
 *
 * The bands below are derived from the card's own `rarity` rather than authored per card. Ninety
 * cards with four hand-written numbers each is three hundred and sixty numbers nobody can hold in
 * their head, and the first retune would leave half of them inconsistent with their own word. The
 * word on the card *is* the promise: BASIC is something a district does for itself, MASTERPIECE is
 * a thing a crew builds toward. A card may still override any one of them where its content wants
 * something different.
 */

/** The gates a card carries. Every one of them has to hold. */
export interface ModificationRequirement {
  /** The level the structure this is going into must have reached. */
  buildingLevel: number;
  /** The crew's own level (§I1). */
  crewLevel: number;
  /**
   * The chair whose officer has to vouch for it, and the mark they have to hold.
   *
   * **Null for a BASIC card** (maintainer ruling, 2026-09-16). A bolt-on worth three per cent is
   * not worth sending somebody to the Bar for, and asking for a *particular* chair at the cheap
   * end decided a new crew's first modification by whichever role they happened to fill first,
   * which is arbitrary rather than strategic. The chairs start mattering at INTRICATE, which is
   * also where the numbers start being worth planning around.
   */
  officer: { role: OfficerRole; mark: OfficerMark } | null;
  /**
   * §D7: the rank the crew has to have bought, for the top two bands.
   *
   * Zero for BASIC and INTRICATE, which is "asks nothing": an early card is something a district
   * does for itself and a rank is not part of that decision. The good cards ask for one because
   * the notoriety ladder had nothing to gate past `Marked` and the maintainer's rule for these
   * bands is that they are hard to get and worth getting. It is a fourth *kind* of gate rather
   * than a fifth number of the same kind: building level, district level and a chair are all things a
   * crew grows into, and a rank is a thing it goes out and buys with what it has killed.
   */
  notoriety: number;
}

/**
 * The ladder, by the word on the card.
 *
 * Sized against what a district actually looks like at each point. A structure reaches level 5 in
 * the first evening and level 20 only at the end, and the crew's own level runs to the same sort of
 * horizon, so the four rows are roughly "tonight", "this week", "once you have a real crew" and
 * "the end of the game". The marks are the same shape: `D` is an ordinary hire off the Bar, `C+` is
 * somebody you went looking for, `B+` is the best person in the district.
 *
 * `buildingLevel` here is the number for a twenty-rung structure. What a *particular* structure
 * asks for goes through {@link levelWithinReach}, which never asks a plot for a rung it does not
 * have.
 */
export const MODIFICATION_REQUIREMENT_BANDS: Readonly<
  Record<
    ModificationRarity,
    { buildingLevel: number; crewLevel: number; mark: OfficerMark | null; notoriety: number }
  >
> = {
  /*
   * Five, not two, because five is the honest number: the first bracket on any structure opens at
   * `MODIFICATION_SLOT_LEVELS[0]`, so a BASIC card printing "level 2" was printing a gate that was
   * never the binding one. A requirement line that is not the reason you are refused is worse than
   * no line at all.
   */
  basic: { buildingLevel: 5, crewLevel: 2, mark: null, notoriety: 0 },
  intricate: { buildingLevel: 7, crewLevel: 8, mark: 'D', notoriety: 0 },
  /*
   * The ranks are `Known Trouble` and `Feared`, the sixth and eighth rungs.
   *
   * Both sit *above* `Marked`, which is where every other notoriety gate in the game stopped, and
   * that is the point: the ladder's top half gated nothing, so a crew that bought it had changed a
   * word on a chip. Six and eight rather than the top two rungs, because a gate has to be a thing
   * a crew reaches while it still has the game left to play: `notorietyUpgradeCost` triples every
   * step, so the twelfth rung is a different order of magnitude from the eighth.
   */
  advanced: { buildingLevel: 12, crewLevel: 15, mark: 'C+', notoriety: 6 },
  masterpiece: { buildingLevel: 17, crewLevel: 22, mark: 'B+', notoriety: 8 },
};

/**
 * The level a band asks of a structure that cannot climb that far (maintainer call, 2026-09-18).
 *
 * The bands above are written against a twenty-rung structure and two structures stop at ten
 * (`BUILDING_LEVEL_CEILINGS` in `kinds.ts`). Read literally that made ADVANCED and MASTERPIECE
 * dead in the Garage and the Infirmary: twenty-eight card and structure pairs asked for level 12
 * or 17 on a plot whose last rung is 10, four of them on the Garage's own bench and three on the
 * Infirmary's. Nothing refused them at authoring time, so the bench listed all seven and printed
 * "The Garage has to reach level 12" under a structure that stops at 10.
 *
 * The rule is the ceiling rather than the two ids, so the next structure to get a ceiling is
 * handled the day it gets one and a ceiling that moves takes its bands with it. On a ten-rung
 * structure the top two bands both land on 10: a player gets the early bands on the way up and
 * then both of the top two when the structure maxes, which is the maintainer's shape. The band
 * below is untouched, because its number was already within reach.
 *
 * A per-card `requires.buildingLevel` override goes through this too. An override past the host's
 * ceiling is the same dead pair written by hand.
 */
function levelWithinReach(asked: number, kind: BuildingKind): number {
  return Math.min(asked, levelCeilingFor(kind));
}

/**
 * Which chair a card's trade belongs to, read off the channel it pays into.
 *
 * The maintainer's ruling was "the trade's own officer", and the trade is the effect rather than
 * the structure: a card that takes time off research asks the Head of Research whichever building
 * it is bolted to, and a card that widens the payroll asks the Head of Finance. Reading it off the
 * structure instead would have asked the same person for every card in a building, which is one
 * requirement wearing eleven names.
 *
 * The chair being **empty is a refusal**, and that is the point: the gate is a reason to fill a
 * chair rather than a number that ticks up on its own.
 */
export const OFFICER_FOR_EFFECT: Readonly<Record<ModificationEffect, OfficerRole>> = {
  production_percent: 'salvager',
  build_cost_reduction: 'finance_officer',
  build_time_reduction: 'lead_engineer',
  storage_percent: 'trader',
  defense_percent: 'security_officer',
  faction_xp_percent: 'consigliere',
  research_time_reduction: 'head_of_research',
  housing_percent: 'head_of_growth',
  payroll_percent: 'finance_officer',
  raid_loot_percent: 'raid_boss',
  training_time_reduction: 'instructor_of_the_young',
  training_supplies_reduction: 'wetware_chief',
};

/**
 * What this card asks for in `kind`, the structure it is going into.
 *
 * The host is a parameter rather than the card's own `building`, because a card fits more than one
 * structure (`ModificationSpec.fits`) and the structures do not all reach the same level: see
 * {@link levelWithinReach}. A caller that means the card's home says `spec.building`, which is a
 * sentence rather than a default nobody notices is the wrong one.
 */
export function modificationRequirement(
  spec: {
    rarity: ModificationRarity;
    effect: ModificationEffect;
    requires?: Partial<ModificationRequirement>;
  },
  kind: BuildingKind,
): ModificationRequirement {
  const band = MODIFICATION_REQUIREMENT_BANDS[spec.rarity];
  const mark = spec.requires?.officer?.mark ?? band.mark;
  return {
    buildingLevel: levelWithinReach(spec.requires?.buildingLevel ?? band.buildingLevel, kind),
    crewLevel: spec.requires?.crewLevel ?? band.crewLevel,
    notoriety: spec.requires?.notoriety ?? band.notoriety,
    officer:
      mark === null
        ? null
        : { role: spec.requires?.officer?.role ?? OFFICER_FOR_EFFECT[spec.effect], mark },
  };
}

/**
 * A unit card's trade, read off the stat it moves most.
 *
 * The same ruling as the structures, applied to the other bench: a plate asks the person whose
 * trade is keeping people alive, a sight asks the one whose trade is hitting things. Read off the
 * largest entry rather than off a hand-authored field, so a card retuned from armour to speed asks
 * a different officer without anybody having to remember to move a second number.
 */
export const OFFICER_FOR_UNIT_STAT: Readonly<Record<string, OfficerRole>> = {
  offense: 'raid_boss',
  penetration: 'raid_boss',
  range: 'lead_engineer',
  vitality: 'chief_medic',
  armor: 'security_officer',
  // The Scout's chair went on 2026-09-22. Speed is the Cartographer's trade (every road in the
  // game is on that track) and evasion the Field Commander's, whose sheet is what a line does
  // when it is shot at.
  evasion: 'field_commander',
  speed: 'cartographer',
  stealth: 'master_of_whispers',
  morale: 'field_commander',
  intimidation: 'field_commander',
  lootCapacity: 'salvager',
};

/** The default chair for a unit card whose stats name nothing in the table above. */
export const OFFICER_FOR_UNIT_FALLBACK: OfficerRole = 'fabricator';

/** The structure a unit card's `buildingLevel` is read against, named once for both readers. */
export const UNIT_MODIFICATION_HOST: BuildingKind = 'gauntlet';

/**
 * What a unit card asks for, in the same four gates a structure card asks.
 *
 * `buildingLevel` is read against the **Gauntlet**, which is the structure a unit's kit belongs to
 * the way a production card belongs to the Greenhouse. Everything else is the same ladder, so a
 * MASTERPIECE plate and a MASTERPIECE pump are the same distance away.
 *
 * Against {@link UNIT_MODIFICATION_HOST}'s ceiling like any other host, so a Gauntlet that is one
 * day given a short ladder does not strand the top of the unit bench.
 */
export function unitModificationRequirement(spec: {
  rarity: ModificationRarity;
  effect: Readonly<Record<string, unknown>>;
  requires?: Partial<ModificationRequirement>;
}): ModificationRequirement {
  const band = MODIFICATION_REQUIREMENT_BANDS[spec.rarity];
  const mark = spec.requires?.officer?.mark ?? band.mark;
  const loudest = Object.entries(spec.effect)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return {
    buildingLevel: levelWithinReach(
      spec.requires?.buildingLevel ?? band.buildingLevel,
      UNIT_MODIFICATION_HOST,
    ),
    crewLevel: spec.requires?.crewLevel ?? band.crewLevel,
    notoriety: spec.requires?.notoriety ?? band.notoriety,
    officer:
      mark === null
        ? null
        : {
            role:
              spec.requires?.officer?.role ??
              (loudest
                ? (OFFICER_FOR_UNIT_STAT[loudest[0]] ?? OFFICER_FOR_UNIT_FALLBACK)
                : OFFICER_FOR_UNIT_FALLBACK),
            mark,
          },
  };
}

/** Which of a card's gates this crew does not clear, in the order a player should read them. */
export const REQUIREMENT_REFUSALS = [
  'building_too_low',
  'crew_too_low',
  /** §D7: the street has not heard enough about this crew to hand them the good drawings. */
  'crew_unknown',
  'no_officer',
  'officer_too_green',
] as const;
export type RequirementRefusal = (typeof REQUIREMENT_REFUSALS)[number];

/**
 * Whether the crew clears every gate, and the first one it does not.
 *
 * Order is deliberate and is the order a player can act on: raise the building, play on, hire
 * somebody, then train the somebody you hired. Answering with the hardest one first would send a
 * player to the Bar for a card that their level was going to refuse anyway.
 */
export function requirementRefusal(input: {
  requirement: ModificationRequirement;
  buildingLevel: number;
  crewLevel: number;
  /** The mark held by the officer in the required chair, or null when nobody is in it. */
  officerMark: OfficerMark | null;
  /** §D7: the rank the crew has bought. Defaulted so a caller with no economy in hand still reads. */
  notoriety?: number;
}): RequirementRefusal | null {
  const { requirement, buildingLevel, crewLevel, officerMark } = input;
  if (buildingLevel < requirement.buildingLevel) return 'building_too_low';
  if (crewLevel < requirement.crewLevel) return 'crew_too_low';
  // Before the chair, because a rank is the cheaper thing to check and the harder thing to fix:
  // filling a chair is one hire, and a rank is a campaign.
  if ((input.notoriety ?? 0) < requirement.notoriety) return 'crew_unknown';
  // A BASIC card asks nobody: see `ModificationRequirement.officer`.
  if (requirement.officer === null) return null;
  if (officerMark === null) return 'no_officer';
  if (!markAtLeast(officerMark, requirement.officer.mark)) return 'officer_too_green';
  return null;
}

/**
 * Every gate a card asks for, as lines a screen prints (maintainer request, 2026-09-16).
 *
 * Written here rather than in the card that draws them, because the same four lines appear on the
 * bench, in the district's slot picker and on the unit page, and three copies of a sentence is
 * three sentences that drift. The role is named rather than the person: which chair is the fact a
 * player can act on, and who is in it is on another screen.
 */
export function describeModificationRequirement(
  requirement: ModificationRequirement,
  input: { buildingName: string; roleLabel: string },
): string[] {
  return [
    `${input.buildingName} at level ${requirement.buildingLevel}`,
    `District level ${requirement.crewLevel}`,
    ...(requirement.notoriety > 0 ? [`Known as ${notorietyTier(requirement.notoriety)}`] : []),
    ...(requirement.officer === null
      ? []
      : [`${input.roleLabel} at ${requirement.officer.mark} or better`]),
  ];
}

/** The one line that says why the yard will not cut it, in the player's words. */
export function describeModificationRequirementRefusal(
  reason: RequirementRefusal,
  input: { requirement: ModificationRequirement; buildingName: string; roleLabel: string },
): string {
  switch (reason) {
    case 'building_too_low':
      return `${input.buildingName} has to reach level ${input.requirement.buildingLevel}`;
    case 'crew_too_low':
      return `Your district has to reach level ${input.requirement.crewLevel}`;
    case 'crew_unknown':
      return `The street has to know you as ${notorietyTier(input.requirement.notoriety)}`;
    case 'no_officer':
      return `Nobody is sitting as ${input.roleLabel}`;
    case 'officer_too_green':
      return `Your ${input.roleLabel} has to hold ${input.requirement.officer?.mark ?? 'the mark'}`;
  }
}
