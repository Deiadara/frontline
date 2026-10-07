import type { ChairLead } from './leading.js';
import {
  ATTRIBUTES_BY_GROUP,
  SPY_DEFENCE_ATTRIBUTES,
  clampAttribute,
  type AttributeGroup,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import { applyHoldBonus, noTerritoryEffects, type TerritoryEffects } from '../city/locations.js';
import type { EnvLabelId } from '../city/labels.js';
import { perksOf, type PerkBonus } from './perks.js';
import type { UnitTier, UnitTierStat } from '../units/tiers.js';
import type { BuildingKind } from '../building/kinds.js';
import { OFFICER_ROLE_LABELS, type OfficerRole } from '../roles.js';
import {
  SEATS,
  importanceOf,
  seatPoints,
  type AttributeImportance,
  type Seat,
} from './importance.js';
import { seatedPassivePercent, type ChairPassive } from './passives.js';
import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import { softCap } from '../battle/soft-cap.js';

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
 * ## Chairs, not the best person in the room
 *
 * Until 2026-10-04 a crew's rating in each attribute was its highest anywhere in the room, and
 * every attribute pushed a channel here. The maintainer replaced that: an officer gives only what
 * their chair gives (`passives.ts`), sized by how well they fill it, and the only skills still read
 * across the whole room are Signals and Cryptography, which guard the crew against spies
 * (`spying/spying.ts`). What lands here from people is their perks, which sum: two people who each
 * know a foundry manager know two of them.
 */

/**
 * The channels an attribute can push on, and the two spy channels, which none does.
 *
 * The first fifteen are `TerritoryEffects` fields: attributes and captured ground push the same
 * levers, which is why holding a Fight Pit and hiring a brawler feel like the same kind of gain.
 * The rest are crew-only: they describe things a piece of ground cannot do for you.
 *
 * `intelYieldPercent` and `intelResistancePercent` have had no attribute behind them since the
 * maintainer ruled that the officer side of spying is the Master of Whispers' grade alone
 * (2026-10-01). Perks and held ground still pay them, so they stay on the list; the crew effects
 * page leaves them out, since how hard a crew is to read is not a public figure (the same day).
 */
export const EFFECT_CHANNELS = [
  'defensePercent',
  'researchSpeedPercent',
  'buildSpeedPercent',
  'musterSpeedPercent',
  'musterCostPercent',
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
  'intelYieldPercent',
  'intelResistancePercent',
  'casualtyRecoveryPercent',
  'cohesionPercent',
] as const;
export type EffectChannel = (typeof EFFECT_CHANNELS)[number];

/**
 * The channels no browser is sent (maintainer, 2026-10-01: "these are not public values"). How hard
 * a crew is to read, either way round, stays on the server, which still spends both in the spy
 * contest; the crew's standing leaves them out of the map it sends, and no screen draws them.
 */
export const PRIVATE_CHANNELS: ReadonlySet<string> = new Set<EffectChannel>([
  'intelYieldPercent',
  'intelResistancePercent',
]);

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
  // Points off the clock, added to the cards' and the Generator's (2026-10-01), and
  // printed as points (maintainer ruling P7-A, 2026-10-02): the sum is joined with the
  // structure's and curved, so "+153% off the research clock" was more than the whole clock.
  researchSpeedPercent: { label: 'Points off the research clock', unit: 'flat' },
  buildSpeedPercent: { label: 'Points off the build clock', unit: 'flat' },
  musterSpeedPercent: { label: 'Muster speed', unit: 'percent' },
  musterCostPercent: { label: 'Off the cost of a unit', unit: 'percent' },
  unitOffensePercent: { label: 'What your people hit for', unit: 'percent' },
  unitVitalityPercent: { label: 'What they can take', unit: 'percent' },
  unitMoraleFlat: { label: 'Whether they hold', unit: 'flat' },
  unitSpeedPercent: { label: 'How fast they move', unit: 'percent' },
  unitStealthPercent: { label: 'Going unnoticed', unit: 'percent' },
  lootCapacityPercent: { label: 'What comes back on the truck', unit: 'percent' },
  // What the engine does with it (`intimidate`): the shakiest of the other side freeze and never
  // fire. It said "being handed it instead", and nothing in the game hands anything over.
  intimidationFlat: { label: 'Their line freezing', unit: 'flat' },
  // Taken off the clock (`roadMinutes`), so the card's `+9%` has to read as time saved.
  travelSpeedPercent: { label: 'Off the time on the road', unit: 'percent' },
  productionPercent: { label: 'What the district makes', unit: 'percent' },
  storageCapacityPercent: { label: 'Room to keep it', unit: 'percent' },
  buildCostPercent: { label: 'Points off the cost of a build', unit: 'flat' },
  // Once, at signing (`committedWage`); a running contract is never re-priced.
  wageDiscountPercent: { label: 'Off wages agreed at signing', unit: 'percent' },
  // Spy points and medic points, not percentages: the spy contest adds the first two to a chair's
  // fit (`spying/spying.ts`), and the medics' points go through a curve (`casualtyRecoveryShare`).
  // Named as the points the perk cards print, since a perk or a held place is all that pays them.
  intelYieldPercent: { label: 'Spy points on every job', unit: 'flat' },
  intelResistancePercent: { label: 'Points against their spies', unit: 'flat' },
  casualtyRecoveryPercent: { label: 'Medic points (who walks home)', unit: 'flat' },
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
  /** Taken off what the next `Increase Payroll` step costs. */
  payrollStepDiscountPercent: number;
  // `missionCapsPercent`, `intelResistancePercent` and `casualtyRecoveryPercent` used to live
  // here. They are `TerritoryEffects` channels now (2026-10-07), because Reliquary's ground pays
  // each of them and a perk and a location buying the same thing should land in one place, the
  // way `intelYieldPercent` moved before them.
  /**
   * Whether a unit the Infirmary brought back still carries its share of the haul.
   *
   * What comes home is carried by the units that **survived** the fight, and a unit the medics
   * recover was dead at the moment the packs were counted, so by default it carries nothing. The
   * Veteran's `recovered_carry_loot` rung (Carry Both) is the one thing that turns this on: the party that
   * brings a body back brings the pack with it.
   *
   * A switch rather than a percentage, and crew-only: no piece of ground grants it, so it is not a
   * `TerritoryEffects` channel. Ored in the folds like the other switches, and false in
   * {@link noCrewEffects}, so a consumer reads it without knowing whether the rung exists.
   */
  recoveredCarryLoot: boolean;
  /**
   * How much of a large force can actually be brought to bear at once (§A5).
   *
   * The teamwork channel. Combat width (`battle/battlefield.ts`) means units past the frontage are
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
  /**
   * The whole-number grants research can make (`research/tracks.ts`), on top of what a level
   * gives: another crew out on a job at once, another fight called at once. Flat and small,
   * because each one is a door rather than a dial.
   */
  missionSlotsFlat: number;
  declarationsFlat: number;
  /** §D7: names a crew may burn on one fight, on top of the one everybody gets. */
  battleBoostsFlat: number;
  /** Places in the training queue, on top of `TRAINING_QUEUE_SLOTS` (`crew/training.ts`). */
  trainingQueueFlat: number;
  /** Spy jobs out at once, on top of `SPY_BASE_PARTIES` (`spying/spying.ts`). */
  spyPartiesFlat: number;
}

/**
 * The channels that only pay when something is true (maintainer request).
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
  /** Per structure: levels the bill is discounted *down* the curve. See `building_credit`. */
  buildingCreditLevels: Partial<Record<BuildingKind, number>>;
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
   * §D5: the channels that pay only while one of the crew's officers is *leading* the fight.
   *
   * Folded off perks like everything else and spent by {@link leading}, which is called by whoever
   * knows whether an officer actually went. That is the same shape `alliedOffensePercent` has and
   * it is the whole reason these are conditional rather than ordinary: a perk that pays whether or
   * not anybody left the district is not a reason to send somebody anywhere.
   *
   * The condition is the crew's and not the carrier's, which is the one thing to hold on to when
   * writing copy for these. Nothing in the struct records who carried a perk into it, and the
   * settler spends the whole fold the moment a leader is named, so a bonus sitting on the officer
   * who stayed behind pays the column that went. Say "any of your officers" on a chip, never
   * "this officer": see `describePerkBonus` and {@link CONDITIONAL_CHANNEL_LABELS}.
   */
  /** Offense, for every friendly unit, while one of this crew's officers is leading. */
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
  /**
   * The rungs that pay only while the officer in one particular chair leads (`crew/leading.ts`).
   *
   * A list rather than a channel, because which of them pay depends on who is named and on what
   * is being fought, and the fold is built before either is known. `chairLeadsFor` reads it;
   * `leadingAs` and `officerSheetBonusFor` spend it.
   */
  chairLeads: ChairLead[];
  /**
   * The rungs a chair's officer teaches everybody else in the room (`chair_teaches`).
   *
   * A list for the reason `chairLeads` is one: whether it pays depends on who is sitting in that
   * chair and who is being taught, and the fold is built before either is known.
   * `liftedOfficerSheet` on the server spends it, per officer.
   */
  chairTeaches: ChairTeaching[];
  /**
   * The seat's points of whoever is working each chair, on their lifted sheet (2026-10-04).
   *
   * What every chair's passive is sized by (`passives.ts`), read where the passive is spent: the
   * payroll book, the unit slots, the road, the market, the Scrapyard and the rest. Absent for an
   * empty chair, which pays nothing. Only the people fold writes it, so a merge with any other
   * fold leaves it as it was.
   */
  chairPoints: Partial<Record<OfficerRole, number>>;
  /**
   * Reliquary's two crew-wide lists off the control rows (2026-10-07), filled by the server's
   * standing fold and spent by the engine. `pamphletUnits` are the unit ids pinned on every
   * Pamphlet Wall the crew holds: those units fight the crew at `PAMPHLET_PENALTY_PERCENT` less.
   * `ignoredLabels` are the ground labels the crew's units shrug off: `noisy` while a Tolling
   * Tower it holds is switched on. Lists so two sources merge end to end like `chairLeads`.
   */
  pamphletUnits: string[];
  ignoredLabels: EnvLabelId[];
}

/** One rung's lesson, filed under the chair whose track it sits on. */
export interface ChairTeaching {
  role: OfficerRole;
  attributes: Partial<Record<AttributeName, number>>;
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
    payrollStepDiscountPercent: 0,
    recoveredCarryLoot: false,
    cohesionPercent: 0,
    unitEvasionFlat: 0,
    alliedOffensePercent: 0,
    gateDefensePercent: 0,
    wholeDistrictPercent: 0,
    buildingCostPercent: {},
    buildingCreditLevels: {},
    unitKindPercent: {},
    xpGainPercent: 0,
    officerAttributeFlat: {},
    missionSlotsFlat: 0,
    declarationsFlat: 0,
    battleBoostsFlat: 0,
    trainingQueueFlat: 0,
    spyPartiesFlat: 0,
    officerAttributeAtLeast: {},
    leadOffensePercent: 0,
    leadEvasionFlat: 0,
    leadArmorFlat: 0,
    leadMoraleFlat: 0,
    leadLootPercent: 0,
    leadArrivalPercent: 0,
    chairLeads: [],
    chairTeaches: [],
    chairPoints: {},
    pamphletUnits: [],
    ignoredLabels: [],
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
    label: 'Holding a district whole',
    when: 'Only while you hold every location in at least one district',
  },
  xpGainPercent: {
    label: 'What the work teaches you',
    when: 'On everything that pays experience',
  },
  // The five below say "one of your officers" rather than "this officer" on purpose: the fold is
  // the crew's, and any officer taking the column turns all of them on. See the doc on
  // `ConditionalCrewEffects`.
  leadOffensePercent: {
    label: 'What the crew hits for behind them',
    when: 'Only in a fight one of your officers is leading',
  },
  leadEvasionFlat: {
    label: 'How often the crew is missed',
    when: 'Only in a fight one of your officers is leading',
  },
  leadArmorFlat: {
    label: 'What the crew is wearing',
    when: 'Only in a fight one of your officers is leading',
  },
  leadMoraleFlat: {
    label: 'Whether the crew holds',
    when: 'Only in a fight one of your officers is leading',
  },
  leadLootPercent: {
    label: 'What comes back off the ground',
    // A fight pays it only on a raid, out of the victim's stockpile (maintainer, 2026-10-06).
    when: 'Only on a raid or a run one of your officers is leading',
  },
  leadArrivalPercent: {
    label: 'Off the time on the road',
    when: 'Only when one of your officers is leading the column',
  },
};

/** What an attribute is, in one sentence of the player's language. */
export interface AttributeEffect {
  /**
   * One sentence about what having it is like. Not a formula: since 2026-10-04 a skill reaches the
   * crew only through the grade of a chair that weighs it ({@link attributeUse} names them).
   */
  summary: string;
}

/** Every attribute, and the line the training board and the Bar print for it. */
export const ATTRIBUTE_EFFECTS: Readonly<Record<AttributeName, AttributeEffect>> = {
  strength: {
    summary: 'Doors, walls and people give way faster when somebody strong is leaning on them.',
  },
  stamina: {
    summary: 'A crew that does not need to stop gets there while the road is still empty.',
  },
  dexterity: {
    summary: 'Good hands finish the fiddly half of a build, which is most of a build.',
  },
  speed: {
    summary: 'First to the ground, first off it. Half of surviving a raid is arriving early.',
  },
  reflexes: {
    summary: 'The half second before anyone has decided anything is the one that decides it.',
  },
  toughness: {
    summary: 'Takes what the fight gives and is still standing when it is handed back.',
  },
  stealth: {
    summary: 'Nobody logs a raid they never noticed. Nobody sends anyone after it either.',
  },
  organization: {
    summary: 'Everyone knows where they are meant to be, so a big push arrives as one thing.',
  },
  analysis: {
    summary: 'Reads the failure and knows which part of it was the interesting part.',
  },
  improvisation: {
    summary: 'Gets a result out of the wrong equipment, which is the only equipment there is.',
  },
  logic: {
    summary:
      'In the Master of Whispers\u2019 chair, takes three unrelated facts off a spy report and turns them into one answer.',
  },
  composure: {
    summary: 'Somebody in the line is not panicking, and it spreads the same way panic does.',
  },
  resolve: {
    summary: 'The crew does not back off the first time it goes badly. Or the second.',
  },
  intuition: {
    summary:
      'In the Master of Whispers\u2019 chair, knows which of the things the runners brought back is the one that matters.',
  },
  strategy: {
    summary:
      'Picks the ground that was already held before anyone walked onto it. Mined, cratered and awkward, and attacking it is a decision.',
  },
  authority: {
    summary: 'People do the work for someone they would rather not disappoint.',
  },
  leadership: {
    summary: 'Four hundred people doing one thing, because somebody is telling them what it is.',
  },
  charisma: {
    summary: 'Recruits work harder when somebody they want to impress is watching.',
  },
  communication: {
    summary: 'The far side of the fight hears about it while it still matters.',
  },
  intimidation: {
    summary:
      'The shakiest people on the other side freeze before the first shot, and stay frozen. Every one is a gun not pointed at you.',
  },
  negotiation: {
    summary: 'Every wage is an opening number to somebody who has done this before.',
  },
  deception: {
    summary:
      'In the Master of Whispers\u2019 chair, sends a rival spy home with a full report of things that are not true.',
  },
  empathy: {
    summary: 'Hears what somebody actually wants, which is rarely the number they opened with.',
  },
  diplomacy: {
    summary: 'Talks to the crews you are not fighting, and keeps them talking.',
  },
  engineering: {
    summary: 'The line runs at the rate it was rated for instead of the rate it settled into.',
  },
  signals: {
    summary:
      'Runs the net, so a rival listening in hears static; in the Master of Whispers\u2019 chair, reads the traffic on everybody else\u2019s.',
  },
  craft: {
    summary: 'Makes the part rather than buying it, and mends the one that broke.',
  },
  medicine: {
    summary: 'Knows which of the people on the floor can still be saved, and saves them.',
  },
  cybernetics: {
    summary: 'A shunt and a good afternoon do what a fortnight of drilling used to.',
  },
  salvage: {
    summary: 'Knows what in the wreck is worth the trip back, and gets it on the truck.',
  },
  encyclopedia: {
    summary:
      'Has read about this before, in something that was about something else. Knows which of the dead ends is not one.',
  },
  navigation: {
    summary: 'There is always a shorter way through the undergrid and they already know it.',
  },
  chemistry: {
    summary:
      'Propellant, stims and patch kits made in-house, by somebody who knows what they are mixing.',
  },
  logistics: {
    summary: 'Finds room in a full warehouse. Twice.',
  },
  cryptography: {
    summary: 'Your traffic reads as noise, so a rival spying on you learns the weather.',
  },
};

/** The seats that weigh an attribute, irreplaceable first, so a hover names who wants it most. */
export function seatsWeighing(name: AttributeName): Seat[] {
  const order: AttributeImportance[] = ['irreplaceable', 'essential', 'useful'];
  return order.flatMap((tag) => SEATS.filter((seat) => importanceOf(seat, name) === tag));
}

/**
 * One short line on what an attribute is good for, the same on every screen that lists one: the
 * Training tab, the crew's sheets, the officer window and the Bar.
 *
 * Since 2026-10-04 a skill does two things at most: it grades the chairs that weigh it, and
 * Signals and Cryptography, on anybody in the room, guard the crew against spies.
 */
export function attributeUse(name: AttributeName): string {
  const seats = seatsWeighing(name).map((seat) =>
    seat === 'overseer' ? 'the Overseer' : `the ${OFFICER_ROLE_LABELS[seat]}`,
  );
  const grades =
    seats.length === 0
      ? 'No chair grades it.'
      : `Grades ${seats.length === 1 ? seats[0] : `${seats.slice(0, -1).join(', ')} and ${seats.at(-1)}`}.`;
  // The two skills everybody in the room still gives, chair or no chair (`spying/spying.ts`).
  const guards = (SPY_DEFENCE_ATTRIBUTES as readonly AttributeName[]).includes(name);
  return guards ? `Guards your crew against spies. ${grades}` : grades;
}

/**
 * One person in the room: their sheet, the perks they brought, and their chair.
 *
 * `role` is `null` for the Overseer, who is the player and sits in no chair. An officer on the
 * bench is never a `CrewMember` at all (maintainer, 2026-09-28): the server leaves them out of the
 * room (`officerIsWorking`).
 */
export interface CrewMember {
  attributes: Attributes;
  /**
   * The perk ids this person brought with them (`crew/perks.ts`), nought to three. Required, so a
   * caller that built the room without them cannot compile.
   */
  perks: readonly string[];
  role: OfficerRole | null;
  /**
   * Seated within the last `CHAIR_SETTLE_HOURS` (`passives.ts`): their perks count and their
   * chair's passive does not yet. Absent reads as settled.
   */
  settling?: boolean;
}

/**
 * What the people in the room put on the crew's channels: every perk, summed.
 *
 * Attributes used to land here too, best-of across the room, and stopped on 2026-10-04: a chair's
 * work is its passive (`passives.ts`), read where it is spent off `chairPoints`.
 */
export function crewEffects(crew: readonly CrewMember[]): CrewEffects {
  const total = noCrewEffects();
  for (const member of crew) {
    for (const perk of perksOf(member.perks)) applyPerkBonus(total, perk.bonus);
    if (member.role !== null && member.settling !== true) {
      total.chairPoints[member.role] = seatPoints(member.attributes, member.role);
    }
  }
  return total;
}

/** A chair's passive off a fold, nothing when nobody is working the chair (`passives.ts`). */
export function chairPassiveOf(
  effects: Pick<CrewEffects, 'chairPoints'>,
  role: OfficerRole,
  passive: Exclude<ChairPassive, 'market_rates'>,
): number {
  return seatedPassivePercent(passive, effects.chairPoints[role] ?? null);
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
    case 'intel_resistance':
      into.intelResistancePercent += bonus.percent;
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
    case 'building_credit':
      into.buildingCreditLevels = {
        ...into.buildingCreditLevels,
        [bonus.building]: (into.buildingCreditLevels[bonus.building] ?? 0) + bonus.levels,
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
 * printed on is not a perk, it is a different number, and the maintainer said so. Every one of these is
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
  return liftedSheet(own, [
    { from: 'the ground you hold', groupFlat: fromGround },
    {
      from: 'the rest of the crew',
      groupFlat: fromPeers.officerGroupFlat,
      attributeFlat: fromPeers.officerAttributeFlat,
      attributeAtLeast: fromPeers.officerAttributeAtLeast,
    },
  ]).attributes;
}

/**
 * The most anybody else can add to one of an officer's attributes (maintainer request, 2026-09-16).
 *
 * Teaching perks, the Lab's people rungs and a held Chapel all pay into the same few attributes,
 * and they stacked without a ceiling: measured against the shipped catalogues, a crew that had
 * signed every teacher in the book and finished the Lab could put about **thirty** points onto one
 * mental attribute, which is a third of the scale arriving from somewhere other than the person.
 * At that size the sheet stops describing who you hired.
 *
 * Ten is a tenth of the scale: visible on the bar, worth building a crew around, and never the
 * larger half of a figure. The cap is per attribute rather than per source, because what a player
 * reads is one number and the question they ask about it is how much of it is theirs.
 */
export const MAX_OFFICER_LIFT = 10;

/**
 * What the Right Hand lifts everybody else by (§C2b, maintainer 2026-09-22).
 *
 * The chair's sheet used to reach nothing outside its own research track. This is the first of
 * three things it now buys: the officers around them work better the better the Right Hand is at
 * bringing people together. Read off their fit points on the same curve every other officer
 * payoff uses, so it is continuous rather than a band, and paid as a flat lift to every group of
 * every other officer's sheet through the same {@link LiftSource} machinery the teaching perks
 * use. The receipt on the crew screen names them, exactly as it names a teacher.
 *
 * Half the cap on purpose. `MAX_OFFICER_LIFT` is ten points per attribute from all sources
 * together, and a Right Hand who could fill the whole of it alone would make every teaching perk
 * in the book worthless on the day one was seated.
 */
export const MAX_RIGHT_HAND_LIFT = 5;

/**
 * And what they lift the Overseer by: raw points, on every attribute.
 *
 * The Overseer is not an officer and takes no lift from anybody, which is the right rule for
 * teachers: a player's own character should not be improved by whoever they happened to hire.
 * The Right Hand is the one exception the maintainer asked for, because a second in command who
 * takes the load off the person at the top is the whole meaning of the chair. Smaller than the
 * officer lift, and the only source that reaches the Overseer at all.
 */
export const MAX_OVERSEER_LIFT = 3;

/** The lift a Right Hand at `points` fit pays, for either channel, on the standard curve. */
export function rightHandLift(points: number, ceiling: number): number {
  const floor = 10;
  const top = 100;
  const above = Math.max(0, Math.min(top, points) - floor);
  return Math.round((above / (top - floor)) * ceiling * 100) / 100;
}

/** One place an officer's sheet can be lifted from, and what it pays. */
export interface LiftSource {
  /** Where it came from, in the player's words: a name, "the Lab", "the ground you hold". */
  from: string;
  groupFlat?: Partial<Record<AttributeGroup, number>>;
  attributeFlat?: Partial<Record<AttributeName, number>>;
  attributeAtLeast?: Partial<Record<AttributeName, { threshold: number; flat: number }>>;
  /**
   * Outside {@link MAX_OFFICER_LIFT}, and spending none of it: the Overseer's grade lift
   * (`overseerLift`, 2026-10-04). It is the player's own passive, so it neither eats the room the
   * teachers, the ground and the Lab share nor is cut by them. Still clamped at the scale's top.
   */
  uncapped?: boolean;
}

/** One line of the breakdown the officer card shows when a bar is hovered. */
export interface AttributeLift {
  attribute: AttributeName;
  /** The {@link LiftSource.from} that paid it. */
  from: string;
  /** Points actually added, after the cap and after the 0..100 clamp. Always above zero. */
  amount: number;
}

/**
 * An officer's sheet as the crew actually fields it, and a receipt for every point of it.
 *
 * The receipt is the point. A player looking at `22` where they hired a `20` is owed the sentence
 * "20 of that is theirs and 2 came from the Overseer", and that cannot be reconstructed from a
 * merged fold: by the time three sources are summed into one channel, nobody can say whose it was.
 * So the sources arrive as a list, each with its own label, and each one's **effective** delta is
 * recorded after the cap and the clamp rather than its nominal one. A source that pays 5 into an
 * attribute already at the ceiling contributes nothing and says nothing, which is the honest
 * receipt: the alternative is a breakdown whose lines do not add up to the number above them.
 *
 * Order is therefore load bearing at the cap, and it is the order the caller passes: ground first,
 * then the people, which puts the scarce room at the top of the list on whatever the crew holds.
 */
export function liftedSheet(
  own: Attributes,
  sources: readonly LiftSource[],
): { attributes: Attributes; lift: AttributeLift[] } {
  const attributes = { ...own };
  const lift: AttributeLift[] = [];
  // Per attribute, so the ceiling is on what the person gained rather than on any one teacher.
  const spent: Partial<Record<AttributeName, number>> = {};

  const add = (name: AttributeName, flat: number, from: string, uncapped = false): void => {
    if (flat <= 0) return;
    const room = uncapped ? flat : Math.min(flat, MAX_OFFICER_LIFT - (spent[name] ?? 0));
    if (room <= 0) return;
    const before = attributes[name];
    attributes[name] = clampAttribute(before + room);
    const gained = attributes[name] - before;
    if (gained <= 0) return;
    if (!uncapped) spent[name] = (spent[name] ?? 0) + gained;
    lift.push({ attribute: name, from, amount: gained });
  };

  for (const source of sources) {
    for (const [group, flat] of Object.entries(source.groupFlat ?? {})) {
      if (!flat) continue;
      for (const name of ATTRIBUTES_BY_GROUP[group as AttributeGroup]) {
        add(name, flat, source.from, source.uncapped === true);
      }
    }
    for (const [name, flat] of Object.entries(source.attributeFlat ?? {})) {
      if (flat) add(name as AttributeName, flat, source.from, source.uncapped === true);
    }
    for (const [name, rule] of Object.entries(source.attributeAtLeast ?? {})) {
      if (!rule) continue;
      // Against the *unlifted* figure: what this perk pays for is somebody who was already good at
      // it, and reading the running total would let a group bonus carry somebody over the bar.
      if (own[name as AttributeName] < rule.threshold) continue;
      add(name as AttributeName, rule.flat, source.from);
    }
  }

  return { attributes, lift };
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
    officerSkillFlat: mergeCounts(crew.officerSkillFlat, territory.officerSkillFlat),
    unitTierMoraleFlat: mergeCounts(crew.unitTierMoraleFlat, territory.unitTierMoraleFlat),
    missionSpeedPercentByDistrict: mergeCounts(
      crew.missionSpeedPercentByDistrict,
      territory.missionSpeedPercentByDistrict,
    ),
    unitTierPercent: mergeTierCounts(crew.unitTierPercent, territory.unitTierPercent),
    unitMarks: mergeMarks(crew.unitMarks, territory.unitMarks),
    musterCostByTier: mergeCounts(crew.musterCostByTier, territory.musterCostByTier),
    // Reliquary's list and keyed channels (2026-10-07): lists end to end, doors at their highest
    // level, the Bounty Wall's odds added per district.
    unitStatFlats: [...crew.unitStatFlats, ...territory.unitStatFlats],
    noiseSwitches: [...crew.noiseSwitches, ...territory.noiseSwitches],
    dailyPages: [...crew.dailyPages, ...territory.dailyPages],
    dailyComponents: [...crew.dailyComponents, ...territory.dailyComponents],
    legendAuras: [...crew.legendAuras, ...territory.legendAuras],
    doorLevels: mergeMaxima(crew.doorLevels, territory.doorLevels),
    goldenJobsByDistrict: mergeGoldenOdds(
      crew.goldenJobsByDistrict,
      territory.goldenJobsByDistrict,
    ),
    // The switches are ORed, not added: ground and people are two ways of buying the same
    // permission, and holding both does not buy it twice. See `applyHoldBonus`.
    carriersFight: crew.carriersFight || territory.carriersFight,
    anyRide: crew.anyRide || territory.anyRide,
    steadyNerve: crew.steadyNerve || territory.steadyNerve,
    // Holding a Station is ground only: nothing a crew can research or hire puts a platform on the
    // line. Ored beside the others anyway, because this list is what the loop below skips, and a
    // boolean left out of it is a boolean the loop adds.
    railLink: crew.railLink || territory.railLink,
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
type RecordChannel =
  | 'perHour'
  | 'resourceYieldPercent'
  | 'officerGroupFlat'
  | 'officerSkillFlat'
  | 'unitTierMoraleFlat'
  | 'missionSpeedPercentByDistrict'
  | 'unitTierPercent'
  | 'unitMarks'
  | 'musterCostByTier'
  | 'unitStatFlats'
  | 'noiseSwitches'
  | 'dailyPages'
  | 'dailyComponents'
  | 'legendAuras'
  | 'doorLevels'
  | 'goldenJobsByDistrict'
  // The four switches are folded above too. They are not records, but they are not summable
  // either, and this is the one list `combineEffects` narrows against.
  | 'carriersFight'
  | 'anyRide'
  | 'steadyNerve'
  | 'railLink';

const RECORD_CHANNELS = new Set<string>([
  'perHour',
  'resourceYieldPercent',
  'officerGroupFlat',
  'officerSkillFlat',
  'unitTierMoraleFlat',
  'missionSpeedPercentByDistrict',
  'unitTierPercent',
  'unitMarks',
  'musterCostByTier',
  'unitStatFlats',
  'noiseSwitches',
  'dailyPages',
  'dailyComponents',
  'legendAuras',
  'doorLevels',
  'goldenJobsByDistrict',
  'carriersFight',
  'anyRide',
  'steadyNerve',
  'railLink',
] satisfies RecordChannel[]);

/**
 * A predicate rather than a bare `has`, so the `continue` in `combineEffects` *narrows*: everything
 * past it is one of the plain-number channels and the compiler knows it. A boolean check would
 * leave `total[key] = territory[key] + crew[key]` adding two union types and failing to build.
 */
function isRecordChannel(key: keyof TerritoryEffects): key is RecordChannel {
  return RECORD_CHANNELS.has(key);
}

/**
 * Two `{ unitId: marks[] }` maps, unioned.
 *
 * A set union rather than a concatenation: a mark granted by a location and by a rung is one mark,
 * and a duplicate in the list would be read twice by whatever consumes it later.
 */
function mergeMarks(
  a: TerritoryEffects['unitMarks'],
  b: TerritoryEffects['unitMarks'],
): TerritoryEffects['unitMarks'] {
  const total: TerritoryEffects['unitMarks'] = { ...a };
  for (const [unitId, marks] of Object.entries(b)) {
    total[unitId] = [...new Set([...(total[unitId] ?? []), ...marks])];
  }
  return total;
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
export function discounted(
  cost: PartialResources,
  percent: number,
  /** The most it may take off: the crew's 60 unless the caller has bent the figure already. */
  cap: number = MAX_CREW_DISCOUNT,
): PartialResources {
  const off = Math.min(cap, Math.max(0, percent)) / 100;
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = cost[key];
      if (amount === undefined) return [];
      return [[key, Math.max(1, Math.round(amount * (1 - off)))] as const];
    }),
  );
}

/**
 * §F2: the ones the medics get back.
 *
 * A share of a force's dead come off the casualty list before it is applied. Whole units only, and
 * counted over the whole fight's dead rather than per kind, so a squad-sized loss brings back close
 * to the share the Infirmary quotes.
 *
 * ## Diminishing, never capped (maintainer ruling, 2026-09-29)
 *
 * Every source pays **medic points**: the crew's perks, the Joker's card and the Infirmary's four a
 * level, added. No skill and no Lab rung pays any since 2026-10-04. The share of the dead that walks home is
 * `CASUALTY_RECOVERY_CEILING x (1 - e^(-points / CASUALTY_RECOVERY_CEILING))`, which is `softCap`
 * with no knee: nearly one for one at first, a little less for every point after, and never half,
 * because medicine changes how bad a loss is and is not allowed to make a fight free.
 *
 * It replaced a flat 40% ceiling that a level 10 Infirmary reached on its own, so the medics' ten
 * rungs (46 points) paid nothing to a crew that had built one. Calibrated on that ceiling, when the
 * Lab still had the Chief Medic's and the Wetware Chief's tracks and Medicine still paid points:
 * both tracks with a level 10 Infirmary were 86 points and 41%, a level 5 Infirmary with the
 * tracks 36.6%, and a medic with Medicine 40 on top 42.7%. Those sources went with the chair
 * rework (2026-10-04); every point that is left still adds something.
 */
export const CASUALTY_RECOVERY_CEILING = 50;

/** The percent of the dead the medics get back for this many medic points. */
export function casualtyRecoveryShare(points: number): number {
  return softCap(Math.max(0, points), 0, CASUALTY_RECOVERY_CEILING);
}

export function recoverCasualties(
  losses: Readonly<Record<string, number>>,
  /** Medic points, every source added. See {@link casualtyRecoveryShare}. */
  recoveryPoints: number,
  /**
   * How big each unit is, in unit slots, for who gets the leftover: the biggest first. One for
   * everybody when the caller does not say, which breaks ties by id.
   */
  sizeOf: (unitId: string) => number = () => 1,
): Record<string, number> {
  const share = casualtyRecoveryShare(recoveryPoints) / 100;
  if (share === 0) return { ...losses };
  /*
   * Over the whole fight's dead, not per unit type (maintainer, 2026-10-02). Rounded down per type,
   * a win that lost one or two of each kind brought back nobody: 300 wins with a level 10 Infirmary
   * quoting 28% lost 562 and got 1 back. The fight's share is rounded down once, each type takes
   * its own whole part, and what is left goes one at a time to the biggest units still dead.
   */
  const dead = Object.entries(losses).filter(([, count]) => count > 0);
  const total = dead.reduce((sum, [, count]) => sum + count, 0);
  let left = Math.floor(total * share);
  const back = new Map<string, number>();
  for (const [unitId, count] of dead) {
    const own = Math.floor(count * share);
    back.set(unitId, own);
    left -= own;
  }
  const biggestFirst = [...dead].sort(([a], [b]) => sizeOf(b) - sizeOf(a) || a.localeCompare(b));
  while (left > 0) {
    const next = biggestFirst.find(([unitId, count]) => (back.get(unitId) ?? 0) < count);
    if (!next) break;
    back.set(next[0], (back.get(next[0]) ?? 0) + 1);
    left -= 1;
  }
  return Object.fromEntries(
    Object.entries(losses).map(([unitId, count]) => [unitId, count - (back.get(unitId) ?? 0)]),
  );
}

/**
 * Two crew folds added together, channel by channel.
 *
 * `combineEffects` adds ground to people and only walks the ground's channels. Research pays into
 * crew-only channels too (a unit's own kind, a structure's cost, another crew out at once), so it
 * needs a merge that walks the whole crew struct. Numbers add, every record-valued channel is
 * merged key by key, and a rule table (`officerAttributeAtLeast`) is overlaid, since two rules on
 * one attribute do not add.
 */
export function mergeCrewEffects(into: CrewEffects, extra: CrewEffects): CrewEffects {
  const mine = into as unknown as Record<string, unknown>;
  const theirs = extra as unknown as Record<string, unknown>;
  const total: Record<string, unknown> = { ...mine };
  for (const key of Object.keys(theirs)) {
    const a = mine[key];
    const b = theirs[key];
    if (typeof a === 'number' && typeof b === 'number') {
      total[key] = a + b;
    } else if (typeof a === 'boolean' || typeof b === 'boolean') {
      // The switch channels (`carriers_fight`, `any_ride`, `steady_nerve`). Ored, the way
      // `combineEffects` ors them: two sources of one permission grant it once.
      //
      // This arm is why the fold is written as a chain of shapes rather than a list of names. The
      // `else` below is `mergeCounts`, which reads a boolean as an empty record and hands back
      // `{}`: truthy, so every crew in the game could seat a Colossus, and no channel list anywhere
      // would have shown it. `officer-in-battle.test.ts` is what caught it.
      total[key] = a === true || b === true;
    } else if (key === 'unitMarks') {
      const marks: Record<string, readonly string[]> = { ...(a as object) };
      for (const [unitId, granted] of Object.entries((b ?? {}) as Record<string, string[]>)) {
        marks[unitId] = [...new Set([...(marks[unitId] ?? []), ...granted])];
      }
      total[key] = marks;
    } else if (key === 'unitTierPercent' || key === 'unitKindPercent') {
      total[key] = mergeTierCounts(
        a as TerritoryEffects['unitTierPercent'],
        b as TerritoryEffects['unitTierPercent'],
      );
    } else if (key === 'officerAttributeAtLeast') {
      total[key] = { ...(a as object), ...(b as object) };
    } else if (key === 'doorLevels') {
      total[key] = mergeMaxima(
        (a ?? {}) as Record<string, number>,
        (b ?? {}) as Record<string, number>,
      );
    } else if (key === 'goldenJobsByDistrict') {
      total[key] = mergeGoldenOdds(
        (a ?? {}) as TerritoryEffects['goldenJobsByDistrict'],
        (b ?? {}) as TerritoryEffects['goldenJobsByDistrict'],
      );
    } else if (Array.isArray(a) || Array.isArray(b)) {
      // The list channels (`chairLeads`, `chairTeaches`): two sources are two lists, end to end. `mergeCounts`
      // read a list as a record and handed back one with no `filter`, which took every fight
      // down at the settle.
      total[key] = [
        ...((a as unknown[] | undefined) ?? []),
        ...((b as unknown[] | undefined) ?? []),
      ];
    } else {
      total[key] = mergeCounts(
        (a ?? {}) as Record<string, number | undefined>,
        (b ?? {}) as Record<string, number | undefined>,
      );
    }
  }
  return total as unknown as CrewEffects;
}

/** Two maps of levels, the higher kept per key: a door is as open as the best one held. */
export function mergeMaxima(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = Math.max(out[key] ?? 0, value);
  return out;
}

/** The Bounty Wall's odds from two sources, per district: chances add to a ceiling of 100. */
export function mergeGoldenOdds(
  a: TerritoryEffects['goldenJobsByDistrict'],
  b: TerritoryEffects['goldenJobsByDistrict'],
): TerritoryEffects['goldenJobsByDistrict'] {
  const out = { ...a };
  for (const [districtId, odds] of Object.entries(b)) {
    const held = out[districtId] ?? { chancePercent: 0, rewardPercent: 0 };
    out[districtId] = {
      chancePercent: Math.min(100, held.chancePercent + odds.chancePercent),
      rewardPercent: held.rewardPercent + odds.rewardPercent,
    };
  }
  return out;
}
