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
import { awardCharacterXp } from '../characters/award.js';
import type { Repositories } from '../db/repos/index.js';
import { MODIFICATION_ROLE, fitModification } from '../district/modifications.js';
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
 * The officer this project kept busy, or `null` when it kept nobody busy.
 *
 * An investigation names its lead on the row. Modification work does not — §C4 makes it the Lead
 * Engineer's job and the server reads whoever holds the post *now*, which is also the honest
 * answer: if the engineer who started it left, the one who finished it is the one who earned it.
 * A training project develops the Overseer, who carries no character level, so it pays nobody.
 */
function leadOf(base: Base, active: ActiveResearch): string | null {
  if (active.project.kind === 'investigation') return active.project.leadOfficerId;
  if (active.project.kind !== 'modification') return null;
  return base.commanders.find((officer) => officer.role === MODIFICATION_ROLE)?.id ?? null;
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

  // §A1 — modification work ends with the thing bolted on. `fitModification` is a no-op when the
  // structure or its slot went away while the work was under way, which is why this is a plain
  // assignment rather than a branch: the project lands either way and never runs twice.
  const buildings =
    active.project.kind === 'modification'
      ? fitModification(base.buildings, active.project.modificationId)
      : base.buildings;

  const settled: Base = {
    ...base,
    buildings,
    economy: { ...base.economy, morale },
    research: { ...recordFacts(base.research, discovered), active: null },
  };

  repos.bases.updateResearch(settled.id, settled.research);
  repos.bases.updateEconomy(settled.id, settled.economy);
  if (buildings !== base.buildings) {
    repos.bases.updateDistrict(settled.id, settled.buildings, settled.buildQueue);
  }
  if (trained !== overseer) repos.overseers.updateAttributes(trained.id, trained.attributes);

  // §G6/§H6 — an investigation is the "internal process" half of INTERFACES R2: a named officer is
  // assigned to it and it runs on a clock, which is everything the reading needs. The lead is paid
  // for the time it kept them on it, exactly as a mission officer is.
  //
  // Deliberately *after* `investigationYield`: the sheet that decided what this project turned up
  // is the one the officer had while doing the work, not the one this project's own XP just bought
  // them. A training project has no lead and pays nobody.
  const paid = awardCharacterXp(repos, settled, [
    { officerId: leadOf(settled, active), minutesEngaged: active.durationMinutes },
  ]);

  return { base: paid, overseer: trained, discovered };
}
