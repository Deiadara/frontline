import {
  ATTRIBUTE_NAMES,
  ATTRIBUTE_LABELS,
  ATTRIBUTES_BY_GROUP,
  MAX_ATTRIBUTE,
  clampAttribute,
  type AttributeGroup,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import { applyHoldBonus, noTerritoryEffects, type TerritoryEffects } from '../city/locations.js';
import { perksOf, type PerkBonus } from './perks.js';
import type { UnitTier, UnitTierStat } from '../units/tiers.js';
import type { BuildingKind } from '../building/kinds.js';
import type { OfficerRole } from '../roles.js';
import {
  IMPORTANCE_WEIGHT,
  importanceOf,
  officerScore,
  type AttributeImportance,
} from './importance.js';
import { RESOURCE_KEYS, type PartialResources } from '../resources.js';

/**
 * What the people you have actually change (GDD §B, §F2).
 *
 * Attributes were a sheet you read and nothing else. A crew could carry a Cryptography of 90 or a
 * Cryptography of 4 and the game played out identically, which makes the whole recruitment layer
 * theatre: the Bar asks you to judge a person, the judgement is never cashed, and the numbers on
 * the card are set dressing. This module is the cashing.
 *
 * ## The one lever
 *
 * Every effect lands in {@link CrewEffects}, which *is* `TerritoryEffects` with a handful of extra
 * channels. That is deliberate and it is the whole design: the battle engine, the roster, the city
 * view and the travel clock already read `TerritoryEffects`, so an attribute that writes into the
 * same struct is wired into every one of them without a single new parameter threaded through a
 * call chain. A second parallel bonus system would have to be plumbed into each consumer by hand,
 * and the plumbing is exactly where a bonus quietly stops applying.
 *
 * ## Best-of, not the sum and not the mean
 *
 * A crew's rating in an attribute is its **highest** among the Overseer and the officers. One
 * specialist is enough: you do not need every person in the room to read cipher traffic, you need
 * the one who can. A sum would make hiring anybody strictly better and turn the officer slots into
 * a headcount; a mean would make hiring a good engineer *worse* because they drag the crew's
 * Medicine average down. Best-of is the only one of the three where the interesting sentence
 * ("who is your best X?") is the sentence the rule asks.
 *
 * ## Magnitude
 *
 * One number, {@link EFFECT_SCALE}, converts a rating into its channel's units. At the recruitment
 * mean (15) an attribute is worth about 4; at the recruitment ceiling (40) about 10; at a fully
 * developed 100 it is 25. Nothing here is a multiplier on a multiplier, so a crew cannot stack
 * itself into absurdity, and the ceiling on any single channel is legible from the table below.
 */

/** Percent (or flat, for the flat channels) per point of the driving attribute. */
export const EFFECT_SCALE = 0.25;

/**
 * The channels an attribute can push on.
 *
 * The first fifteen are `TerritoryEffects` fields: attributes and captured ground push the same
 * levers, which is why holding a Fight Pit and hiring a brawler feel like the same kind of gain.
 * The rest are crew-only: they describe things a piece of ground cannot do for you.
 */
export const EFFECT_CHANNELS = [
  'defensePercent',
  'researchSpeedPercent',
  'buildSpeedPercent',
  'trainingSpeedPercent',
  'trainingCostPercent',
  'unitOffensePercent',
  'unitVitalityPercent',
  'unitMoraleFlat',
  'unitSpeedPercent',
  'unitStealthPercent',
  'lootCapacityPercent',
  'intimidationFlat',
  'travelSpeedPercent',
  'productionPercent',
  'storageCapacityPercent',
  'buildCostPercent',
  'wageDiscountPercent',
  'recruitPoolPercent',
  'intelYieldPercent',
  'intelResistancePercent',
  'casualtyRecoveryPercent',
  'cohesionPercent',
] as const;
export type EffectChannel = (typeof EFFECT_CHANNELS)[number];

/**
 * What a channel is called on a screen, and its unit.
 *
 * `flat` channels are added to a number the player already sees; the rest are percentages. Held
 * here so the profile does not have to guess a unit off a field name ending in `Flat`, which is a
 * naming convention and not a contract.
 */
export interface ChannelLabel {
  label: string;
  unit: 'percent' | 'flat';
}

export const CHANNEL_LABELS: Readonly<Record<EffectChannel, ChannelLabel>> = {
  defensePercent: { label: 'Holding your ground', unit: 'percent' },
  researchSpeedPercent: { label: 'Research speed', unit: 'percent' },
  buildSpeedPercent: { label: 'Build speed', unit: 'percent' },
  trainingSpeedPercent: { label: 'Training speed', unit: 'percent' },
  trainingCostPercent: { label: 'Off the cost of a unit', unit: 'percent' },
  unitOffensePercent: { label: 'What your people hit for', unit: 'percent' },
  unitVitalityPercent: { label: 'What they can take', unit: 'percent' },
  unitMoraleFlat: { label: 'Whether they hold', unit: 'flat' },
  unitSpeedPercent: { label: 'How fast they move', unit: 'percent' },
  unitStealthPercent: { label: 'Going unnoticed', unit: 'percent' },
  lootCapacityPercent: { label: 'What comes back on the truck', unit: 'percent' },
  intimidationFlat: { label: 'Being handed it instead', unit: 'flat' },
  travelSpeedPercent: { label: 'Time on the road', unit: 'percent' },
  productionPercent: { label: 'What the district makes', unit: 'percent' },
  storageCapacityPercent: { label: 'Room to keep it', unit: 'percent' },
  buildCostPercent: { label: 'Off the cost of a build', unit: 'percent' },
  wageDiscountPercent: { label: 'Off what an officer asks for', unit: 'percent' },
  recruitPoolPercent: { label: 'Who turns up at the bar', unit: 'percent' },
  intelYieldPercent: { label: 'What a scout brings back', unit: 'percent' },
  intelResistancePercent: { label: 'What theirs does not', unit: 'percent' },
  casualtyRecoveryPercent: { label: 'The ones the medics get back', unit: 'percent' },
  cohesionPercent: { label: 'Getting numbers to count', unit: 'percent' },
};

/** The crew-only channels: everything a `TerritoryEffects` does not already carry. */
export interface CrewOnlyEffects {
  /** Added to what the district's structures produce every hour. */
  productionPercent: number;
  /** Added to every storage ceiling. A quartermaster finds room nobody else saw. */
  storageCapacityPercent: number;
  /** Taken off what a structure costs to raise. */
  buildCostPercent: number;
  /** Taken off the weekly wage bill. People work cheaper for someone worth working for. */
  wageDiscountPercent: number;
  /** How much wider the Bar's nightly pool runs. */
  recruitPoolPercent: number;
  /** Taken off what the next `Increase Payroll` step costs. */
  payrollStepDiscountPercent: number;
  // `intelYieldPercent` used to live here. It is a `TerritoryEffects` channel now, because a
  // Watchtower and a Head Spy with a Logic of 80 buy the same thing and should land in one place.
  /** How much of *your* district a rival's scout fails to bring home. */
  intelResistancePercent: number;
  /** How much faster the wounded come back after a fight instead of staying dead. */
  casualtyRecoveryPercent: number;
  /**
   * How much of a large force can actually be brought to bear at once (§A5).
   *
   * The teamwork channel. Combat width (`battle/battlefield.ts`) means bodies past the frontage are
   * queuing rather than fighting, which is what stops "bring everything" being the whole game, and
   * this is the one thing that widens it. A crew that can co-ordinate gets more of a big force into
   * contact; a crew that cannot may as well have left half of them at home.
   *
   * Deliberately the *only* channel whose value depends on how many people you brought. A flat
   * offense bonus helps a stack of four exactly as much as a stack of four hundred; this one is
   * worth nothing at all until the ground is too narrow for the force standing on it.
   */
  cohesionPercent: number;
  /**
   * Flat points on every unit's evasion rating.
   *
   * The one defensive stat with no channel at all until §D5 wanted one: the map can buy vitality
   * and armour and offense, and nothing anywhere could buy the number that decides whether a hit
   * lands. Flat because evasion is a rating and a percentage of a rating of 10 is nothing, which
   * is the same argument `unitArmorPercent` makes on `TerritoryEffects`.
   *
   * Read by `battle/effects.ts` through the optional widening on its `territory` parameter, the
   * way `unitKindPercent` already is: a crew-only channel a piece of ground cannot grant.
   */
  unitEvasionFlat: number;
}

/**
 * The channels that only pay when something is true (board request).
 *
 * Kept together and named for their condition, so a consumer reading one is reminded that it has a
 * gate on it. Every one of them is folded like any other channel and then *applied* by whichever
 * system knows whether the condition holds: the battle engine knows whether an ally turned up, the
 * build queue knows which structure is being raised. Folding is unconditional, spending is not.
 */
export interface ConditionalCrewEffects {
  /** Offense, but only in a fight another crew's units are also standing in. */
  alliedOffensePercent: number;
  /** Defense, but only for a Gate, and only while it is the thing being hit. */
  gateDefensePercent: number;
  /** Defense, but only while every location in the district is yours. */
  wholeDistrictPercent: number;
  /** Per structure: taken off what that one costs to raise. */
  buildingCostPercent: Partial<Record<BuildingKind, number>>;
  /** Per unit id, per stat: one named unit is better at one thing. */
  unitKindPercent: Record<string, Partial<Record<UnitTierStat, number>>>;
  /** Added to everything that pays experience. */
  xpGainPercent: number;
  /**
   * Flat points one officer's perks put on *other* officers' sheets, per attribute.
   *
   * Two shapes. `flat` is unconditional; `atLeast` only pays for an officer who has already
   * reached `threshold` in that attribute under their own steam.
   */
  officerAttributeFlat: Partial<Record<AttributeName, number>>;
  officerAttributeAtLeast: Partial<Record<AttributeName, { flat: number; threshold: number }>>;
  /*
   * §D5: the channels that pay only while an officer is *leading* the fight.
   *
   * Folded off perks like everything else and spent by {@link leading}, which is called by whoever
   * knows whether an officer actually went. That is the same shape `alliedOffensePercent` has and
   * it is the whole reason these are conditional rather than ordinary: a perk that pays whether or
   * not its officer left the district is not a reason to send them anywhere.
   */
  /** Offense, for every friendly unit, while this crew's officer is leading. */
  leadOffensePercent: number;
  /** ...evasion, in flat points. */
  leadEvasionFlat: number;
  /** ...armour, in flat points. */
  leadArmorFlat: number;
  /** ...morale, in flat points. */
  leadMoraleFlat: number;
  /** A percentage more of whatever the fight pays out. */
  leadLootPercent: number;
  /** Time off the road, both to a battle and on a mission. */
  leadArrivalPercent: number;
}

export interface CrewEffects extends TerritoryEffects, CrewOnlyEffects, ConditionalCrewEffects {}

/**
 * The channels that hold a plain number, as opposed to a record keyed by resource, tier or
 * structure.
 *
 * Derived from the struct rather than listed, so a channel added tomorrow lands in the right half
 * on its own. Callers that fold a `Partial<Record<..., number>>` into a `CrewEffects` (the Lab's
 * technologies, the Garage) index through this: without it the compiler has to assume any key
 * might be one of the record-valued ones, and adding the fifth of those is what turned that
 * assignment into an error.
 */
export type NumericEffectChannel = {
  [K in keyof CrewEffects]: CrewEffects[K] extends number ? K : never;
}[keyof CrewEffects];

export function noCrewEffects(): CrewEffects {
  return {
    ...noTerritoryEffects(),
    productionPercent: 0,
    storageCapacityPercent: 0,
    buildCostPercent: 0,
    wageDiscountPercent: 0,
    recruitPoolPercent: 0,
    payrollStepDiscountPercent: 0,
    intelResistancePercent: 0,
    casualtyRecoveryPercent: 0,
    cohesionPercent: 0,
    unitEvasionFlat: 0,
    alliedOffensePercent: 0,
    gateDefensePercent: 0,
    wholeDistrictPercent: 0,
    buildingCostPercent: {},
    unitKindPercent: {},
    xpGainPercent: 0,
    officerAttributeFlat: {},
    officerAttributeAtLeast: {},
    leadOffensePercent: 0,
    leadEvasionFlat: 0,
    leadArmorFlat: 0,
    leadMoraleFlat: 0,
    leadLootPercent: 0,
    leadArrivalPercent: 0,
  };
}

/**
 * The perk-only channels, and when each one pays.
 *
 * Deliberately **not** in {@link EFFECT_CHANNELS}. That list means "channels an attribute pushes",
 * and the game holds an invariant that every one of them has exactly one attribute driving it, so
 * putting a conditional channel there would have meant either breaking the invariant or
 * reassigning an attribute away from the channel it already drives to make room. Neither is worth
 * doing to fit a display list.
 *
 * These come from perks and from nothing else, which is also what makes them the interesting half
 * of a hire: an attribute is a rating that rises with training, a conditional bonus is a thing a
 * particular person brought with them.
 */
export const CONDITIONAL_CHANNELS = [
  'alliedOffensePercent',
  'gateDefensePercent',
  'wholeDistrictPercent',
  'xpGainPercent',
  'leadOffensePercent',
  'leadEvasionFlat',
  'leadArmorFlat',
  'leadMoraleFlat',
  'leadLootPercent',
  'leadArrivalPercent',
] as const;
export type ConditionalChannel = (typeof CONDITIONAL_CHANNELS)[number];

/** What each is called, and the condition that has to hold before it is worth anything. */
export const CONDITIONAL_CHANNEL_LABELS: Readonly<
  Record<ConditionalChannel, { label: string; when: string }>
> = {
  alliedOffensePercent: {
    label: 'Fighting beside allies',
    when: 'In any fight another crew has also sent people to',
  },
  gateDefensePercent: {
    label: 'Holding the Gate',
    when: 'Only when your Gate is the thing being hit',
  },
  wholeDistrictPercent: {
    label: 'Holding the whole district',
    when: 'Only while every location in your district is yours',
  },
  xpGainPercent: {
    label: 'What the work teaches you',
    when: 'On everything that pays experience',
  },
  leadOffensePercent: {
    label: 'What the crew hits for behind them',
    when: 'Only in a fight this officer is leading',
  },
  leadEvasionFlat: {
    label: 'How often the crew is missed',
    when: 'Only in a fight this officer is leading',
  },
  leadArmorFlat: {
    label: 'What the crew is wearing',
    when: 'Only in a fight this officer is leading',
  },
  leadMoraleFlat: {
    label: 'Whether the crew holds',
    when: 'Only in a fight this officer is leading',
  },
  leadLootPercent: {
    label: 'What comes back off the ground',
    when: 'Only in a fight this officer is leading',
  },
  leadArrivalPercent: {
    label: 'Time on the road',
    when: 'Only when this officer is leading the column',
  },
};

export interface AttributeEffect {
  /** Where this attribute lands. */
  channel: EffectChannel;
  /**
   * One sentence, in the player's language, about what having it does. Not a formula: the
   * magnitude is on the screen next to it, and a sentence that restates the number teaches nothing.
   */
  summary: string;
}

/**
 * Every attribute, and the thing it changes.
 *
 * Exactly one channel each, on purpose. An attribute that pushed four levers a little would be
 * impossible to feel and impossible to shop for; an attribute that pushes one lever hard is a
 * reason to hire a specific person. Several attributes share a channel. That is fine and it is
 * how a channel gets deep: Resolve and Composure and Leadership all hold a line, and a crew with
 * all three holds it through anything.
 */
export const ATTRIBUTE_EFFECTS: Readonly<Record<AttributeName, AttributeEffect>> = {
  // Physical: what a body does when the plan stops working.
  strength: {
    channel: 'unitOffensePercent',
    summary: 'Doors, walls and people give way faster when somebody strong is leaning on them.',
  },
  stamina: {
    channel: 'travelSpeedPercent',
    summary: 'A crew that does not need to stop gets there while the road is still empty.',
  },
  dexterity: {
    channel: 'buildSpeedPercent',
    summary: 'Good hands finish the fiddly half of a build, which is most of a build.',
  },
  // Note: `organization` used to sit on this channel and now drives cohesion. Build speed keeps
  // `dexterity` and the Lab's Critical Path; a crew that wants faster builds hires hands.
  speed: {
    channel: 'unitSpeedPercent',
    summary: 'First to the ground, first off it. Half of surviving a raid is arriving early.',
  },
  reflexes: {
    channel: 'unitOffensePercent',
    summary: 'The half second before anyone has decided anything is the one that decides it.',
  },
  toughness: {
    channel: 'unitVitalityPercent',
    summary: 'Takes what the fight gives and is still standing when it is handed back.',
  },
  stealth: {
    channel: 'unitStealthPercent',
    summary: 'Nobody logs a raid they never noticed. Nobody sends anyone after it either.',
  },

  // Mental: the difference between a plan and a hope.
  organization: {
    channel: 'cohesionPercent',
    summary: 'Everyone knows where they are meant to be, so a big push arrives as one thing.',
  },
  analysis: {
    channel: 'researchSpeedPercent',
    summary: 'Reads the failure and knows which part of it was the interesting part.',
  },
  improvisation: {
    channel: 'researchSpeedPercent',
    summary: 'Gets a result out of the wrong equipment, which is the only equipment there is.',
  },
  logic: {
    channel: 'intelYieldPercent',
    summary: 'Takes three unrelated facts off a scout report and turns them into one answer.',
  },
  composure: {
    channel: 'unitMoraleFlat',
    summary: 'Somebody in the line is not panicking, and it spreads the same way panic does.',
  },
  resolve: {
    channel: 'unitMoraleFlat',
    summary: 'The crew does not back off the first time it goes badly. Or the second.',
  },
  intuition: {
    channel: 'intelYieldPercent',
    summary: 'Knows which of the things a scout brought back is the one that matters.',
  },
  strategy: {
    channel: 'unitOffensePercent',
    summary: 'Picks the fight that was already won before anyone walked into it.',
  },
  authority: {
    channel: 'wageDiscountPercent',
    summary: 'People take less to work under someone they would rather not disappoint.',
  },

  // Social: the crew is people, and people are a system.
  leadership: {
    channel: 'cohesionPercent',
    summary: 'Four hundred people doing one thing, because somebody is telling them what it is.',
  },
  charisma: {
    channel: 'recruitPoolPercent',
    summary: 'Word gets around. More people come to the bar to see who is hiring.',
  },
  communication: {
    channel: 'cohesionPercent',
    summary: 'The far side of the fight hears about it while it still matters.',
  },
  intimidation: {
    channel: 'intimidationFlat',
    summary: 'Some places hand it over rather than find out. That is a saved fight.',
  },
  negotiation: {
    channel: 'wageDiscountPercent',
    summary: 'Every wage is an opening number to somebody who has done this before.',
  },
  deception: {
    channel: 'intelResistancePercent',
    summary: 'A rival scout comes back with a full report of things that are not true.',
  },
  empathy: {
    // Shared with `negotiation`, which the module doc says is how a channel gets deep. It used to
    // drive the §H5 alignment hold; that mechanic is gone, and what empathy was actually buying
    // there (knowing what somebody wants before they say it) is the same thing that gets a wage
    // agreed below the asking price.
    channel: 'wageDiscountPercent',
    summary: 'Hears what somebody actually wants, which is rarely the number they opened with.',
  },
  diplomacy: {
    channel: 'recruitPoolPercent',
    summary: 'Talks to the crews you are not fighting, and their people hear where to go.',
  },

  // Technical: the district runs on somebody knowing how it works.
  engineering: {
    channel: 'productionPercent',
    summary: 'The line runs at the rate it was rated for instead of the rate it settled into.',
  },
  hacking: {
    channel: 'intelYieldPercent',
    summary: 'The Combine keeps better records about a place than anyone standing in it.',
  },
  fabrication: {
    channel: 'buildCostPercent',
    summary: 'Makes the part rather than buying it. The stockpile notices.',
  },
  medicine: {
    channel: 'casualtyRecoveryPercent',
    summary: 'Some of the people you were going to lose come back to work instead.',
  },
  cybernetics: {
    channel: 'trainingSpeedPercent',
    summary: 'A shunt and a good afternoon do what a fortnight of drilling used to.',
  },
  salvage: {
    channel: 'lootCapacityPercent',
    summary: 'Knows what in the wreck is worth the trip back, and gets it on the truck.',
  },
  demolition: {
    channel: 'defensePercent',
    summary: 'Your ground is mined, cratered and awkward. Attacking it is a decision.',
  },
  navigation: {
    channel: 'travelSpeedPercent',
    summary: 'There is always a shorter way through the undergrid and they already know it.',
  },
  chemistry: {
    channel: 'trainingCostPercent',
    summary: 'Propellant, stims and patch kits made in-house. A recruit costs less to field.',
  },
  logistics: {
    channel: 'storageCapacityPercent',
    summary: 'Finds room in a full warehouse. Twice.',
  },
  cryptography: {
    channel: 'intelResistancePercent',
    summary: 'Your traffic reads as noise, so a rival scouting you learns the weather.',
  },
};

/** Which attributes drive a channel. Derived: the table above is the only place they are paired. */
export function attributesDriving(channel: EffectChannel): AttributeName[] {
  return ATTRIBUTE_NAMES.filter((name) => ATTRIBUTE_EFFECTS[name].channel === channel);
}

/** How this attribute reads on a card: what it does, and what the rating is currently worth. */
export function effectLine(name: AttributeName, rating: number): string {
  const magnitude = contributionOf(rating);
  const unit = ATTRIBUTE_EFFECTS[name].channel.endsWith('Flat') ? '' : '%';
  return `${ATTRIBUTE_LABELS[name]} +${magnitude}${unit}`;
}

/** What one rating is worth on its channel, rounded to whole units. */
export function contributionOf(rating: number): number {
  return Math.round(rating * EFFECT_SCALE);
}

/**
 * How much of an attribute a person contributes when their seat does not use it.
 *
 * Not zero, deliberately. An officer is in the room and people talk: a chemist working the books
 * still notices the smell. Zero would also make one bad assignment catastrophic in a way the
 * player cannot see coming, and the point of the rule is to reward good assignment, not to punish
 * an early mistake into unrecoverability.
 */
export const OFF_DUTY_SHARE = 0.35;

/**
 * What share of a rating a seat actually puts to work, by how much that seat cares about the skill.
 *
 * The four weights of `IMPORTANCE_WEIGHT` over the top of the ladder, so an irreplaceable skill is
 * worth its whole rating and an insignificant one a quarter of it. This *is* the "these contribute
 * more towards the bonuses" rule: it is applied per skill, before best-of, so an officer in the
 * right chair beats a better officer in the wrong one.
 */
/**
 * What somebody on the bench contributes, per attribute (§C2).
 *
 * The *lowest* share a chair pays, deliberately, and not {@link OFF_DUTY_SHARE}.
 *
 * Off-duty was the obvious pick and it is wrong by a margin the arithmetic makes obvious: it is
 * 0.35 and `insignificant` is 0.25, so a benched officer would be worth **more** than a seated one
 * in every skill their chair does not care about. Since a crew's rating is the best-of across
 * everybody, that makes taking somebody out of their chair a way to raise the crew's numbers, and
 * a bench that is sometimes an upgrade is not a bench.
 *
 * At the insignificant share the promise holds in one direction with no exceptions: seating
 * somebody is never worse than leaving them on it, and is usually a great deal better.
 */
export const BENCH_SHARE = 0.25;

export const IMPORTANCE_SHARE: Readonly<Record<AttributeImportance, number>> = {
  insignificant: IMPORTANCE_WEIGHT.insignificant / IMPORTANCE_WEIGHT.irreplaceable,
  useful: IMPORTANCE_WEIGHT.useful / IMPORTANCE_WEIGHT.irreplaceable,
  essential: IMPORTANCE_WEIGHT.essential / IMPORTANCE_WEIGHT.irreplaceable,
  irreplaceable: 1,
};

/**
 * How far the band bonuses may lift what an officer is worth.
 *
 * The score has two halves and they are cashed in two different places, which is the whole reason
 * this is not double counting. The **base** half (rating times weight) is already spent, per skill,
 * as {@link IMPORTANCE_SHARE} above: paying it again here would be charging the same points twice.
 * The **bonus** half is the part nothing else expresses, and what it says is that a peak is worth
 * more than its linear value, so it is spent as an uplift on everything that officer contributes.
 *
 * Capped, because the bonus table is steep by design: a sheet of 100s in a well-chosen chair scores
 * several hundred bonus points, and an uncapped ratio would let one officer out-produce the rest of
 * the crew put together.
 */
export const MAX_PEAK_UPLIFT = 0.6;

/**
 * One person in the room, and which of their skills the seat they are in actually uses.
 *
 * `duties` is `null` for the Overseer, who is the player: they are not sitting in one of the
 * nineteen seats and everything they know is available to the crew all the time.
 *
 * Note what this is **not**: a role. Which attributes a seat uses is a server-side table for the
 * same reason the fit table is (§B8a): it overlaps what a role wants closely enough that
 * publishing it would be publishing half the hidden table. The mechanism lives here; the content
 * is passed in.
 */
export interface CrewMember {
  attributes: Attributes;
  /**
   * The perk ids this person brought with them (`crew/perks.ts`), nought to three.
   *
   * **Required, not optional**, and that is deliberate. It was optional so that a caller who only
   * cared about attributes could leave it out, and the cost of that convenience was immediate: the
   * server's `crewSheetsFor` built every officer without perks, the whole book silently applied to
   * nobody, and it compiled. An empty list has to be written down.
   */
  perks: readonly string[];
  /**
   * The chair they are in, or `null` for somebody who is in no chair at all.
   *
   * Two different people have no chair and they are not worth the same, which is what {@link
   * benched} is for. The Overseer is the player: not one of the nineteen seats, so every skill
   * they have counts in full. An officer on the bench is signed and unassigned: nothing counts in
   * full, because the chair is most of what an officer is worth.
   */
  role: OfficerRole | null;
  /**
   * On the books, in no chair (§C2, board request).
   *
   * Paid {@link OFF_DUTY_SHARE} of everything, the same share a seated officer gets in the skills
   * their own chair does not use. So a benched specialist is still worth something, and putting
   * them in the right chair is still worth a great deal more, which is the decision the bench
   * exists to let a player postpone rather than avoid.
   *
   * Only ever true when `role` is `null`, and the two together are what separate a benched officer
   * from the Overseer, who also has no chair and is paid in full.
   */
  benched?: boolean;
}

/**
 * The crew's effective sheet: the best rating anybody in the room has *in the job they are doing*.
 *
 * The Overseer is one of the people in the room, not a separate term. A player who has developed
 * their own Cryptography and hired nobody is as protected as one who hired a cryptographer, which
 * is what makes the Training tab worth opening.
 *
 * ## Where you put somebody is the decision
 *
 * An officer contributes their full rating in the attributes their seat actually uses
 * (`ROLE_DUTIES`) and {@link OFF_DUTY_SHARE} of it everywhere else. That one clause is what turns
 * nineteen role slots from a filing system into a puzzle: hiring a cryptographer is half the move,
 * and sitting them as Head Spy rather than as Fabricator is the other half. Before it, the two
 * assignments produced literally identical numbers and the §G screen was decoration.
 *
 * Best-of rather than a sum, for the reason at the top of this file, but best-of *after* the
 * discount, so a brilliant person in the wrong chair can genuinely be beaten by an ordinary one in
 * the right chair, which is the sentence the whole rule exists to make true.
 */
export function crewSheet(crew: readonly CrewMember[]): Attributes {
  const best = Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, 0])) as Attributes;
  for (const member of crew) {
    const uplift = peakUplift(member);
    for (const name of ATTRIBUTE_NAMES) {
      /*
       * Three cases, and the middle one is the bench.
       *
       * A seated officer is paid by how much their chair cares about the skill; the Overseer is
       * paid in full because they have no chair to be a poor fit for; a benched officer is paid
       * the off-duty share in everything, because they have no chair *yet*.
       */
      const share = member.benched
        ? BENCH_SHARE
        : member.role === null
          ? 1
          : IMPORTANCE_SHARE[importanceOf(member.role, name)];
      /*
       * Rounded and clamped, because this is an `Attributes` and that type is integers 0..100.
       *
       * Both halves are load-bearing and the rounding was a latent bug before any of this: the
       * off-duty discount produced fractions too, and the only reason nothing ever broke is that
       * the Overseer's own integer ratings usually won the best-of and hid them. `crewStanding`
       * puts this sheet on the wire, `AttributesSchema` rejects a non-integer, and the client's
       * query simply never resolves: the Overseer's own file sat on "Reading the file…" for ever
       * with no error in the console to say why.
       *
       * The clamp is the ceiling: the peak uplift is absorbed for a skill already at 100 and does
       * real work everywhere below it, which is almost the whole game, since the Bar's recruits
       * top out around 40 and a fully drilled 100 is the end of a long project.
       */
      const rating = Math.round(Math.min(MAX_ATTRIBUTE, member.attributes[name] * share * uplift));
      if (rating > best[name]) best[name] = rating;
    }
  }
  return best;
}

/**
 * What this officer's peaks are worth, as a multiplier on everything they contribute.
 *
 * See {@link MAX_PEAK_UPLIFT}: the band half of `officerScore` and nothing else, expressed against
 * the base half so it reads as "how much more than linear is this person worth". The Overseer gets
 * nothing, because they have no chair to be a good fit for.
 */
export function peakUplift(member: CrewMember): number {
  // No chair, no fit to be good at: true for the Overseer and for anybody on the bench.
  if (member.role === null) return 1;
  const { base, bonus } = officerScore(member.attributes, member.role);
  if (base <= 0) return 1;
  return 1 + Math.min(MAX_PEAK_UPLIFT, bonus / base);
}

/**
 * What a sheet is worth, as effects.
 *
 * Every channel reads "more is better", including the two that are reductions:
 * `trainingCostPercent` and `buildCostPercent` are how many percent comes *off* a price, so a
 * positive contribution is a saving on both. A channel that meant the opposite of its neighbours
 * would be a sign error waiting to be written, and a sign error here reads as a working feature.
 */
export function effectsOfSheet(sheet: Attributes): CrewEffects {
  const effects = noCrewEffects();
  for (const name of ATTRIBUTE_NAMES) {
    const channel = ATTRIBUTE_EFFECTS[name].channel;
    effects[channel] += contributionOf(sheet[name]);
  }
  return effects;
}

/**
 * The crew's effects: best-of on the attribute sheet, plus every perk in the room.
 *
 * The two halves compose differently and that is the design. Attributes are **best-of**, because a
 * rating is something the crew has and one specialist is enough. Perks **sum**, because a perk is
 * something a person brought and two people who each know a foundry manager know two of them.
 */
export function crewEffects(crew: readonly CrewMember[]): CrewEffects {
  const total = effectsOfSheet(crewSheet(crew));
  for (const member of crew) {
    for (const perk of perksOf(member.perks)) applyPerkBonus(total, perk.bonus);
  }
  return total;
}

/**
 * Folds one perk into a running total. Mutates `into`, like `applyHoldBonus`, which it delegates to.
 *
 * The delegation is the point: every channel the map can already push is pushed by the map's own
 * fold, so a perk and a location that grant the same thing cannot land differently. Only the
 * crew-only channels, which no location can grant, are handled here.
 */
export function applyPerkBonus(into: CrewEffects, bonus: PerkBonus): CrewEffects {
  switch (bonus.kind) {
    case 'production':
      into.productionPercent += bonus.percent;
      return into;
    case 'storage_capacity':
      into.storageCapacityPercent += bonus.percent;
      return into;
    case 'build_cost':
      into.buildCostPercent += bonus.percent;
      return into;
    case 'wage_discount':
      into.wageDiscountPercent += bonus.percent;
      return into;
    case 'payroll_step_discount':
      into.payrollStepDiscountPercent += bonus.percent;
      return into;
    case 'recruit_pool':
      into.recruitPoolPercent += bonus.percent;
      return into;
    case 'intel_resistance':
      into.intelResistancePercent += bonus.percent;
      return into;
    case 'casualty_recovery':
      into.casualtyRecoveryPercent += bonus.percent;
      return into;
    case 'cohesion':
      into.cohesionPercent += bonus.percent;
      return into;
    case 'allied_offense':
      into.alliedOffensePercent += bonus.percent;
      return into;
    case 'gate_defense':
      into.gateDefensePercent += bonus.percent;
      return into;
    case 'whole_district':
      into.wholeDistrictPercent += bonus.percent;
      return into;
    case 'building_cost':
      into.buildingCostPercent = {
        ...into.buildingCostPercent,
        [bonus.building]: (into.buildingCostPercent[bonus.building] ?? 0) + bonus.percent,
      };
      return into;
    case 'unit_kind':
      into.unitKindPercent = {
        ...into.unitKindPercent,
        [bonus.unitId]: {
          ...into.unitKindPercent[bonus.unitId],
          [bonus.stat]: (into.unitKindPercent[bonus.unitId]?.[bonus.stat] ?? 0) + bonus.percent,
        },
      };
      return into;
    case 'xp_gain':
      into.xpGainPercent += bonus.percent;
      return into;
    case 'lead_offense':
      into.leadOffensePercent += bonus.percent;
      return into;
    case 'lead_evasion':
      into.leadEvasionFlat += bonus.flat;
      return into;
    case 'lead_armor':
      into.leadArmorFlat += bonus.flat;
      return into;
    case 'lead_morale':
      into.leadMoraleFlat += bonus.flat;
      return into;
    case 'lead_loot':
      into.leadLootPercent += bonus.percent;
      return into;
    case 'lead_arrival':
      into.leadArrivalPercent += bonus.percent;
      return into;
    case 'officer_attribute':
      into.officerAttributeFlat = {
        ...into.officerAttributeFlat,
        [bonus.attribute]: (into.officerAttributeFlat[bonus.attribute] ?? 0) + bonus.flat,
      };
      return into;
    case 'officer_threshold': {
      // Two perks on the same attribute keep the *lower* bar and add their points: a crew that has
      // bought this twice should not find the second copy has raised the price of the first.
      const held = into.officerAttributeAtLeast[bonus.attribute];
      into.officerAttributeAtLeast = {
        ...into.officerAttributeAtLeast,
        [bonus.attribute]: {
          flat: (held?.flat ?? 0) + bonus.flat,
          threshold: Math.min(held?.threshold ?? bonus.threshold, bonus.threshold),
        },
      };
      return into;
    }
    default:
      applyHoldBonus(into, bonus);
      return into;
  }
}

/**
 * §D5: the leading channels, spent (buildings-and-combat patch).
 *
 * Called by whoever knows an officer actually went: the battle settler and the mission launcher.
 * Everything here is already folded into the struct by `applyPerkBonus`; this is the step that
 * moves it onto the channels the engine and the clock read, and it is a no-op for a crew that sent
 * nobody, which is what makes these perks a reason to send somebody.
 *
 * Additive onto whatever the ground and the sheet were already worth, like every other source in
 * this file: a `+6%` from a perk and a `+6%` from a held Fight Pit is `+12%`, not `+12.36%`.
 *
 * `leadLootPercent` is deliberately **not** folded here. It is spent by the settler against the
 * haul, which is a bundle of resources rather than a channel on a unit, and folding it into
 * `lootCapacityPercent` would quietly turn "more loot" into "a bigger truck".
 */
export function leading(effects: CrewEffects): CrewEffects {
  return {
    ...effects,
    unitOffensePercent: effects.unitOffensePercent + effects.leadOffensePercent,
    unitEvasionFlat: effects.unitEvasionFlat + effects.leadEvasionFlat,
    unitArmorPercent: effects.unitArmorPercent + effects.leadArmorFlat,
    unitMoraleFlat: effects.unitMoraleFlat + effects.leadMoraleFlat,
    travelSpeedPercent: effects.travelSpeedPercent + effects.leadArrivalPercent,
    missionSpeedPercent: effects.missionSpeedPercent + effects.leadArrivalPercent,
  };
}

/**
 * Everything one officer's perks put on *other* people's sheets, folded on its own.
 *
 * Fed only perk ids, so it never needs a sheet to compute and there is no circularity: a perk is
 * static data on a person, not a derived rating. That is what makes the lift below possible at all.
 */
export function peerLift(perkIds: readonly string[]): CrewEffects {
  const total = noCrewEffects();
  for (const perk of perksOf(perkIds)) applyPerkBonus(total, perk.bonus);
  return total;
}

/**
 * One officer's sheet, lifted by everybody else and by the ground (§B7, §A4).
 *
 * Three sources, and the rule that ties them together is **never yourself**. An officer's own
 * perks do not touch their own attributes: a perk that raised the number printed on the card it is
 * printed on is not a perk, it is a different number, and the board said so. Every one of these is
 * a thing a person does *for the people around them*.
 *
 * - `fromGround`, per attribute group, from held locations. Applies to everyone equally.
 * - `officerGroupFlat`, per attribute group, from the other officers' perks. This is the half that
 *   was doing nothing: eight perks folded into the channel and no consumer ever read it.
 * - `officerAttributeFlat`, per attribute, from the other officers' perks.
 * - `officerAttributeAtLeast`, the same but only where this officer has already cleared the bar
 *   under their own steam. Checked against `own` rather than against the running total, so two
 *   officers carrying the same perk cannot bootstrap each other over the line.
 */
export function liftOfficer(
  own: Attributes,
  fromPeers: Pick<
    CrewEffects,
    'officerGroupFlat' | 'officerAttributeFlat' | 'officerAttributeAtLeast'
  >,
  fromGround: TerritoryEffects['officerGroupFlat'],
): Attributes {
  const lifted = { ...own };

  // The ground's group lift and the peers' are the same kind of thing and are added, not maxed:
  // a Chapel and an Old Instructor are two different people helping, not one helping twice.
  const groupFlat = mergeCounts(fromGround, fromPeers.officerGroupFlat);
  for (const [group, flat] of Object.entries(groupFlat)) {
    if (!flat) continue;
    for (const name of ATTRIBUTES_BY_GROUP[group as AttributeGroup]) {
      lifted[name] = clampAttribute(lifted[name] + flat);
    }
  }

  for (const [name, flat] of Object.entries(fromPeers.officerAttributeFlat)) {
    if (!flat) continue;
    lifted[name as AttributeName] = clampAttribute(lifted[name as AttributeName] + flat);
  }

  for (const [name, rule] of Object.entries(fromPeers.officerAttributeAtLeast)) {
    if (!rule) continue;
    // Against the *unlifted* figure: what this perk pays for is somebody who was already good at
    // it, and reading the running total would let a group bonus carry somebody over the bar.
    if (own[name as AttributeName] < rule.threshold) continue;
    lifted[name as AttributeName] = clampAttribute(lifted[name as AttributeName] + rule.flat);
  }

  return lifted;
}

/**
 * Territory and crew, added.
 *
 * Additive rather than multiplicative: two +20% sources are +40%, not +44%. Multiplicative
 * stacking is where a strategy game's numbers stop being explainable, and a player who cannot
 * explain the number cannot plan against it.
 */
export function combineEffects(territory: TerritoryEffects, crew: CrewEffects): CrewEffects {
  const total: CrewEffects = {
    ...crew,
    perHour: mergeCounts(crew.perHour, territory.perHour),
    resourceYieldPercent: mergeCounts(crew.resourceYieldPercent, territory.resourceYieldPercent),
    officerGroupFlat: mergeCounts(crew.officerGroupFlat, territory.officerGroupFlat),
    unitTierPercent: mergeTierCounts(crew.unitTierPercent, territory.unitTierPercent),
  };
  for (const key of Object.keys(territory) as (keyof TerritoryEffects)[]) {
    // The record-valued channels are merged above; everything else is a plain number, and
    // enumerating rather than listing is what stops a channel added tomorrow from being dropped
    // here in silence. It works: `unitTierPercent` was added later and this loop is what refused
    // to compile until it had been given a merge of its own.
    if (isRecordChannel(key)) continue;
    total[key] = territory[key] + crew[key];
  }
  return total;
}

/**
 * The channels that are not plain numbers, and so cannot be added by the loop in `combineEffects`.
 *
 * A `Set` rather than a chain of `===`, because the list has grown twice and a fourth entry
 * appended to a boolean chain is how one of them quietly stops being skipped.
 */
type RecordChannel = 'perHour' | 'resourceYieldPercent' | 'officerGroupFlat' | 'unitTierPercent';

const RECORD_CHANNELS = new Set<string>([
  'perHour',
  'resourceYieldPercent',
  'officerGroupFlat',
  'unitTierPercent',
] satisfies RecordChannel[]);

/**
 * A predicate rather than a bare `has`, so the `continue` in `combineEffects` *narrows*: everything
 * past it is one of the plain-number channels and the compiler knows it. A boolean check would
 * leave `total[key] = territory[key] + crew[key]` adding two union types and failing to build.
 */
function isRecordChannel(key: keyof TerritoryEffects): key is RecordChannel {
  return RECORD_CHANNELS.has(key);
}

/** Adds two `{ tier: { stat: number } }` maps: `mergeCounts`, one level further down. */
function mergeTierCounts(
  a: TerritoryEffects['unitTierPercent'],
  b: TerritoryEffects['unitTierPercent'],
): TerritoryEffects['unitTierPercent'] {
  const total: TerritoryEffects['unitTierPercent'] = { ...a };
  for (const tier of Object.keys(b) as UnitTier[]) {
    total[tier] = mergeCounts(total[tier] ?? {}, b[tier] ?? {});
  }
  return total;
}

/** Adds two sparse `{ key: number }` maps. The record-valued effect channels all merge this way. */
function mergeCounts<T extends Record<string, number | undefined>>(a: T, b: T): T {
  const total: Record<string, number | undefined> = { ...a };
  for (const key of Object.keys(b)) {
    total[key] = (total[key] ?? 0) + (b[key] ?? 0);
  }
  return total as T;
}

/** A multiplier from a percentage channel, floored so no stack can take an output to zero. */
export function speedMultiplier(percent: number): number {
  return Math.max(0.25, 1 + percent / 100);
}

/** Nothing a crew can do makes anything free. */
export const MAX_CREW_DISCOUNT = 60;

/**
 * A price with a percentage taken off it.
 *
 * Floored at one of each resource the price asked for, never at zero: a cost that rounds away
 * turns a structure into a free action, and a player who can raise a Nexus for nothing has no
 * economy left to play.
 */
export function discounted(cost: PartialResources, percent: number): PartialResources {
  const off = Math.min(MAX_CREW_DISCOUNT, Math.max(0, percent)) / 100;
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = cost[key];
      if (amount === undefined) return [];
      return [[key, Math.max(1, Math.round(amount * (1 - off)))] as const];
    }),
  );
}

/**
 * A count as somebody else's counter-intelligence lets you see it.
 *
 * The holder's Cryptography and Deception blur what a scout brings back; the reader's Logic,
 * Intuition and Hacking cut through it. Only the difference matters, so a crew that has invested
 * in reading sees a well-protected place the way an unprotected one looks to everybody.
 *
 * Coarsening rather than lying: the number reported is the true count rounded to a grain, so it is
 * never further from the truth than half a grain and never systematically high or low. A blurred
 * report says "about forty", which is what a scout actually comes back with, instead of a
 * fabricated forty-three that a player would plan against and be wrong.
 */
export const INTEL_PERCENT_PER_GRAIN = 8;

export function blurredCount(exact: number, blurPercent: number): number {
  const grain = 1 + Math.floor(Math.max(0, blurPercent) / INTEL_PERCENT_PER_GRAIN);
  if (grain <= 1) return exact;
  return Math.round(exact / grain) * grain;
}

/**
 * §F2: the ones the medics get back.
 *
 * A share of a force's dead come off the casualty list before it is applied. Whole units only,
 * rounded down, so a chief medic on a small skirmish saves nobody and on a real fight saves a
 * squad, which is roughly how a field hospital works. Capped well under half: medicine changes
 * how bad a loss is, and is not allowed to make a fight free.
 */
export const MAX_CASUALTY_RECOVERY = 40;

export function recoverCasualties(
  losses: Readonly<Record<string, number>>,
  recoveryPercent: number,
): Record<string, number> {
  const share = Math.min(MAX_CASUALTY_RECOVERY, Math.max(0, recoveryPercent)) / 100;
  if (share === 0) return { ...losses };
  return Object.fromEntries(
    Object.entries(losses).map(([unitId, dead]) => [unitId, dead - Math.floor(dead * share)]),
  );
}
