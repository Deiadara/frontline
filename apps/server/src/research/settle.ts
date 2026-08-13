import {
  adjustMeter,
  developAttribute,
  extraFactsFrom,
  isResearchDue,
  moraleFromLeadership,
  recordFacts,
  type ActiveResearch,
  type Base,
  type DiscoveredFact,
  type Overseer,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { nextPairing, nextRoleFact } from './discover.js';

/**
 * Banking a research project whose clock has run out (GDD §B9, §F2–§F4).
 *
 * Settles lazily on the read path, exactly like payroll (`economy/settle.ts`), the §H5 alignment
 * drift and mission resolution: there is no scheduler, and a crew nobody looks at has learnt
 * precisely as much whenever it is next opened.
 */

export interface ResearchSettlement {
  base: Base;
  /** The Overseer as they ended up — §F2 training moves their sheet. */
  overseer: Overseer;
  /** Facts banked by this call, in discovery order. Empty when nothing was due. */
  discovered: DiscoveredFact[];
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

  // The lead may have been fired, or died, between launch and landing. The project still lands —
  // the work was done — but nothing their sheet was buying applies.
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
  if (!active || !isResearchDue(active, now)) return { base, overseer, discovered: [] };

  const discovered = investigationYield(base, active);
  const trained =
    active.project.kind === 'training'
      ? { ...overseer, attributes: developAttribute(overseer.attributes, active.project.attribute) }
      : overseer;

  // §F3 — Charisma is "leading people, raising morale", and landing a result in front of the crew
  // is where that cashes out. Feeds W2's meter (INTERFACES R5); it does not open a second one.
  const morale = adjustMeter(base.economy.morale, moraleFromLeadership(overseer.attributes));

  const settled: Base = {
    ...base,
    economy: { ...base.economy, morale },
    research: { ...recordFacts(base.research, discovered), active: null },
  };

  repos.bases.updateResearch(settled.id, settled.research);
  repos.bases.updateEconomy(settled.id, settled.economy);
  if (trained !== overseer) repos.overseers.updateAttributes(trained.id, trained.attributes);

  return { base: settled, overseer: trained, discovered };
}
