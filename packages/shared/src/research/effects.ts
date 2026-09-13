import { clampAttribute, type Attributes } from '../attributes.js';

/**
 * What attributes actually *do* (GDD §F3-§F5).
 *
 * §F4 gives attributes two jobs beyond being a number on a sheet: they are **bonuses**, and some
 * **unlock new actions**. §F5 adds the second use, **modifiers on outcomes**.
 *
 * §F5's worked example, the Overseer's Speed and Stealth on a run that risks people, used to live
 * here as `overseerMissionEdge`: a single ±15% nudge on two attributes, and only on the Overseer,
 * and only on a battle job. `missions.leading.ts` is the general form of it (maintainer, 2026-09-10).
 * Every job now names what it leans on, whoever leads it is scored against that, and the Overseer
 * goes through the same table as any officer on the books. The one-axis version is gone rather
 * than kept beside it, because two functions moving the same number is how a launch ends up
 * pricing an edge twice.
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
