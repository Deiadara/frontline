import {
  developAttribute,
  extraFactsFrom,
  isResearchDue,
  factionXpFromLeadership,
  recordFacts,
  xpForClock,
  type ActiveResearch,
  type Base,
  type DiscoveredFact,
  type Overseer,
  type PlayerXpAward,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { fitModification } from '../district/modifications.js';
import { awardPlayerXp } from '../progression/award.js';
import { nextPairing, nextRoleFact } from './discover.js';

/**
 * Banking a research project whose clock has run out (GDD §B9, §F2-§F4).
 *
 * Settles lazily on the read path, exactly like payroll (`economy/settle.ts`), the §H5 alignment
 * drift and mission resolution: there is no scheduler, and a crew nobody looks at has learnt
 * precisely as much whenever it is next opened.
 */

export interface ResearchSettlement {
  base: Base;
  /** The Overseer as they ended up: §F2 training moves their sheet. */
  overseer: Overseer;
  /** Facts banked by this call, in discovery order. Empty when nothing was due. */
  discovered: DiscoveredFact[];
  /** §I1: the player XP the finished project paid. At most one; empty when nothing was due. */
  awards: PlayerXpAward[];
}

/**
 * What an investigation turned up.
 *
 * The lead's own sheet decides how much (§F3/§F4): one fact for showing up, a second if they can
 * actually debrief the crew (Communication), and a pairing if they were imaginative enough to
 * unlock the cross-reference at launch. Each is looked up against the facts accumulated *so far*
 * in this same settlement, so a double yield never files the same thing twice.
 */
function investigationYield(base: Base, active: ActiveResearch): DiscoveredFact[] {
  if (active.project.kind !== 'investigation') return [];
  const { role, leadOfficerId, crossReference } = active.project;

  // The lead may have been fired, or died, between launch and landing. The project still lands:
  // the work was done, but nothing their sheet was buying applies.
  const lead = base.commanders.find((officer) => officer.id === leadOfficerId);
  const wanted = 1 + (lead ? extraFactsFrom(lead.attributes) : 0);

  const discovered: DiscoveredFact[] = [];
  const soFar = () => [...base.research.facts, ...discovered];
  for (let taken = 0; taken < wanted; taken += 1) {
    const fact = nextRoleFact(role, soFar());
    if (!fact) break;
    discovered.push(fact);
  }
  if (crossReference) {
    const pairing = nextPairing(soFar());
    if (pairing) discovered.push(pairing);
  }
  return discovered;
}

/**
 * Applies the project that just landed and persists it.
 *
 * Writes are ordered so that clearing `active` happens in the same state update as banking the
 * result: a project can only ever pay out once, whatever the caller does afterwards.
 */
export function settleResearch(
  repos: Repositories,
  base: Base,
  overseer: Overseer,
  now: Date,
): ResearchSettlement {
  const active = base.research.active;
  if (!active || !isResearchDue(active, now)) {
    return { base, overseer, discovered: [], awards: [] };
  }

  const discovered = investigationYield(base, active);
  const trained =
    active.project.kind === 'training'
      ? { ...overseer, attributes: developAttribute(overseer.attributes, active.project.attribute) }
      : overseer;

  // §A1: modification work ends with the thing bolted on. `fitModification` is a no-op when the
  // structure or its slot went away while the work was under way, which is why this is a plain
  // assignment rather than a branch: the project lands either way and never runs twice.
  const buildings =
    active.project.kind === 'modification'
      ? fitModification(base.buildings, active.project.modificationId)
      : base.buildings;

  const settled: Base = {
    ...base,
    buildings,
    research: { ...recordFacts(base.research, discovered), active: null },
  };

  repos.bases.updateResearch(settled.id, settled.research);
  repos.bases.updateEconomy(settled.id, settled.economy);
  if (buildings !== base.buildings) {
    repos.bases.updateDistrict(settled.id, settled.buildings, settled.buildQueue);
  }
  if (trained !== overseer) repos.overseers.updateAttributes(trained.id, trained.attributes);

  // §G6/§H6: an investigation is the "internal process" half of INTERFACES R2: a named officer is
  // The lead used to be paid character XP here for the time the project kept them on it. Officers
  // have no level any more (see `commander.ts`), so a project pays the player and nobody else.
  const paid = settled;

  // §I1, and the player. A project is the longest single commitment in the game, so it is the one
  // clock that has to be worth waiting out on its own. Last, after the officer's own XP, for the
  // same reason: the two ledgers are separate and this one must not change what that one paid.
  // §F3: Charisma is "leading people". A lead who can present a result gets the crew more out of
  // it, which is the one thing that attribute buys now that district morale is gone.
  const progressed = awardPlayerXp(
    repos,
    paid,
    'researchCompleted',
    factionXpFromLeadership(overseer.attributes),
    // Off the project's own clock, on the same curve the mission board pays: "the longest single
    // commitment in the game" was paying a flat 150 whether it ran two minutes or twelve hours.
    xpForClock('researchCompleted', active.durationMinutes * 60),
  );

  return {
    base: progressed.base,
    overseer: trained,
    discovered,
    awards: [progressed.award],
  };
}
