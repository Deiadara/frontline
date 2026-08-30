import {
  MAX_ATTRIBUTE,
  clampAttribute,
  type AttributeName,
  type Attributes,
} from '../attributes.js';
import type { MissionKind } from '../missions.js';

/**
 * What attributes actually *do* (GDD §F3-§F5).
 *
 * §F4 gives attributes two jobs beyond being a number on a sheet: they are **bonuses**, and some
 * **unlock new actions**. §F5 adds the second use, **modifiers on outcomes**. The board named four
 * worked examples in §F3 and two in §F4/§F5; every one of them is wired below, because an example
 * with no mechanic behind it is a section that is not done.
 *
 * | §F3 example                                   | Live mechanic                                    |
 * | --------------------------------------------- | ------------------------------------------------ |
 * | **Charisma** → leading people                 | `factionXpFromLeadership`: a lead who can present a result gets the crew more out of it |
 * | **Communication** → better ideas out of people | `extraFactsFrom`: a talkative lead gets a second fact out of the same investigation |
 * | **Imagination** → coming up with new things    | `unlocksCrossReference`: §F4's worked example, the option that stays locked otherwise |
 * | A **physical** attribute → keeping things in check | `overseerMissionEdge`: §F5's worked example, Speed and Stealth on a run that risks people |
 *
 * The thresholds sit just above `attributeTier`'s `strong` boundary (28) and below the
 * recruitment ceiling (40): reachable by choosing the right person for the job, not by default.
 */

/**
 * §F3: "**Charisma** → leading people". What that buys, now that district morale is gone.
 *
 * A finished project is worth more to the allegiance when the person who ran it can stand up and say
 * what it means. Percentage points on the XP the project pays (§I1), scaled linearly off charisma,
 * so a dour genius still finishes the work and a charismatic one turns it into something the whole
 * crew learns from.
 */
export const MAX_RESEARCH_LEADERSHIP_XP = 25;

export function factionXpFromLeadership(attributes: Attributes): number {
  return Math.round((MAX_RESEARCH_LEADERSHIP_XP * clampAttribute(attributes.charisma)) / 100);
}

/** §F4: the Imagination the lead researcher needs before the cross-reference option unlocks. */
export const CROSS_REFERENCE_IMPROVISATION = 30;

/** §F3: Communication at or above this gets an extra fact out of the same investigation. */
export const EXTRA_FACT_COMMUNICATION = 30;

/**
 * §F4: "researching something new: if the person on it has high enough **Imagination**, an option
 * unlocks that would otherwise stay locked".
 *
 * The option is the cross-reference: instead of only answering the question asked, an imaginative
 * lead also notices a pairing: §B9's *what goes with what*.
 */
export function unlocksCrossReference(attributes: Attributes): boolean {
  return attributes.improvisation >= CROSS_REFERENCE_IMPROVISATION;
}

/**
 * §F3: "**Communication** inspires better ideas out of your people". A lead who can actually
 * debrief the crew comes back with one more fact than the investigation was worth.
 */
export function extraFactsFrom(attributes: Attributes): number {
  return attributes.communication >= EXTRA_FACT_COMMUNICATION ? 1 : 0;
}

/**
 * §F5: "a raid to steal resources: good **Speed** and **Stealth** on your character raise the
 * team's success chance".
 *
 * Only `battle` runs are modified. §E5 makes those the ones that *risk your people*, which is what
 * the board's raid is; a standard scrap run is not a raid and gets no edge. Per-template edge
 * attributes would be a better model, but `MissionTemplate` is W3's to extend. This stays on the
 * one axis the board actually specified.
 */
export const MISSION_EDGE_ATTRIBUTES: Record<MissionKind, readonly AttributeName[]> = {
  standard: [],
  battle: ['speed', 'stealth'],
};

/** The rating an edge attribute has to beat before it is an advantage rather than a liability. */
export const EDGE_NEUTRAL_RATING = 15;

/** Most a perfectly built Overseer can add to (or a hopeless one subtract from) a success roll. */
export const MAX_MISSION_EDGE = 0.15;

/**
 * How much the Overseer's own sheet moves a run's success chance, in the ±`MAX_MISSION_EDGE` band.
 *
 * Signed on purpose: §F5 says good Speed and Stealth *raise* the chance, and the honest converse
 * is that a slow, loud Overseer lowers it. Zero at the recruitment mean, so a fresh character
 * changes nothing and the mission board's authored chances still mean what they say.
 */
export function overseerMissionEdge(attributes: Attributes, kind: MissionKind): number {
  const edgeAttributes = MISSION_EDGE_ATTRIBUTES[kind];
  if (edgeAttributes.length === 0) return 0;

  const mean =
    edgeAttributes.reduce((total, name) => total + attributes[name], 0) / edgeAttributes.length;
  const headroom = MAX_ATTRIBUTE - EDGE_NEUTRAL_RATING;
  return ((mean - EDGE_NEUTRAL_RATING) / headroom) * MAX_MISSION_EDGE;
}

/**
 * The success chance a run actually launches with (§F5). Clamped into 0..1: the edge is a nudge on
 * an authored number, never a way to make a certainty or an impossibility out of one.
 */
export function modifiedSuccessChance(
  successChance: number,
  attributes: Attributes,
  kind: MissionKind,
): number {
  return Math.min(1, Math.max(0, successChance + overseerMissionEdge(attributes, kind)));
}

/** §F2: how far one completed training project moves the attribute it targeted. */
export const TRAINING_STEP = 1;

/**
 * §F2. "You can **develop any of them**". Every attribute is trainable, including ones with no
 * bearing on how the Overseer was built (§B6), and training stops at the ceiling rather than
 * throwing.
 */
export function developAttribute(attributes: Attributes, attribute: AttributeName): Attributes {
  return { ...attributes, [attribute]: clampAttribute(attributes[attribute] + TRAINING_STEP) };
}

/** Whether `attribute` has anywhere left to go: a project that would gain nothing is refused. */
export function canDevelop(attributes: Attributes, attribute: AttributeName): boolean {
  return attributes[attribute] < MAX_ATTRIBUTE;
}
