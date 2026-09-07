import {
  isResearchDue,
  factionXpFromLeadership,
  findResearchItem,
  xpForClock,
  type Base,
  type Overseer,
  type PlayerXpAward,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { notifyBase } from '../social/notify.js';
import { awardPlayerXp } from '../progression/award.js';

/**
 * Banking a rung whose clock has run out (GDD §C).
 *
 * Settles lazily on the read path, exactly like payroll (`economy/settle.ts`), the §H5 alignment
 * drift and mission resolution: there is no scheduler, and a crew nobody looks at has finished
 * precisely as much whenever it is next opened.
 */

export interface ResearchSettlement {
  base: Base;
  /** §I1: the player XP the finished rung paid. At most one; empty when nothing was due. */
  awards: PlayerXpAward[];
}

/**
 * Applies the rung that just landed and persists it.
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
  if (!active || !isResearchDue(active, now)) return { base, awards: [] };

  /*
   * §C: a track rung lands as an id on `technologies`, the same list the older programmes were
   * granted into. Guarded against a second copy, because two rows for one rung would double
   * whatever channel it pays into.
   */
  const known = base.research.technologies;
  const technologies = known.includes(active.project.techId)
    ? known
    : [...known, active.project.techId];

  const settled: Base = { ...base, research: { active: null, technologies } };

  repos.bases.updateResearch(settled.id, settled.research);
  repos.bases.updateEconomy(settled.id, settled.economy);

  notifyBase(repos, base.id, {
    kind: 'research_done',
    title: 'The Lab has finished',
    body: `${findResearchItem(active.project.techId)?.name ?? 'A programme'} is finished.`,
    link: '/game/research',
    now,
  });

  // §I1, and the player. A rung is the longest single commitment in the game, so it is the one
  // clock that has to be worth waiting out on its own.
  // §F3: Charisma is "leading people". A lead who can present a result gets the crew more out of
  // it, which is the one thing that attribute buys now that district morale is gone.
  const progressed = awardPlayerXp(
    repos,
    settled,
    'researchCompleted',
    factionXpFromLeadership(overseer.attributes),
    // Off the rung's own clock, on the same curve the mission board pays: "the longest single
    // commitment in the game" was paying a flat 150 whether it ran two minutes or twelve hours.
    xpForClock('researchCompleted', active.durationMinutes * 60),
  );

  return { base: progressed.base, awards: [progressed.award] };
}
