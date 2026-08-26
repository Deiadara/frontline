import {
  ATTRIBUTE_NAMES,
  ATTRIBUTE_LABELS,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import { noTerritoryEffects, type TerritoryEffects } from '../city/locations.js';
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
  'alignmentHoldPercent',
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
  alignmentHoldPercent: { label: 'Keeping the ones you have', unit: 'percent' },
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
  /** How much of the §H5 drift away from you is held off. */
  alignmentHoldPercent: number;
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
}

export interface CrewEffects extends TerritoryEffects, CrewOnlyEffects {}

export function noCrewEffects(): CrewEffects {
  return {
    ...noTerritoryEffects(),
    productionPercent: 0,
    storageCapacityPercent: 0,
    buildCostPercent: 0,
    wageDiscountPercent: 0,
    recruitPoolPercent: 0,
    alignmentHoldPercent: 0,
    intelResistancePercent: 0,
    casualtyRecoveryPercent: 0,
    cohesionPercent: 0,
  };
}

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
    channel: 'alignmentHoldPercent',
    summary: 'Notices which one of them is about to walk, in time to ask why.',
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
  duties: readonly AttributeName[] | null;
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
    for (const name of ATTRIBUTE_NAMES) {
      const onDuty = member.duties === null || member.duties.includes(name);
      const rating = onDuty ? member.attributes[name] : member.attributes[name] * OFF_DUTY_SHARE;
      if (rating > best[name]) best[name] = rating;
    }
  }
  return best;
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

/** The crew's effects: best-of across everyone in the seat they are sitting in, then cashed. */
export function crewEffects(crew: readonly CrewMember[]): CrewEffects {
  return effectsOfSheet(crewSheet(crew));
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
  };
  for (const key of Object.keys(territory) as (keyof TerritoryEffects)[]) {
    // The three record-valued channels are merged above; everything else is a plain number, and
    // enumerating rather than listing is what stops a channel added tomorrow from being dropped
    // here in silence.
    if (key === 'perHour' || key === 'resourceYieldPercent' || key === 'officerGroupFlat') continue;
    total[key] = territory[key] + crew[key];
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
