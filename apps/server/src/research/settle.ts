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
import { overseerOf } from '../crew/training.js';
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
  /**
   * §F3: whose Charisma the finished rung is presented with. Optional because this settles on
   * every read path now (`district/settle.ts`), and a base whose owner row has gone must still
   * bank its rung rather than throw; an absent Overseer simply adds nothing.
   */
  overseer: Overseer | undefined,
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
    overseer ? factionXpFromLeadership(overseer.attributes) : 0,
    // Off the rung's own clock, on the same curve the mission board pays: "the longest single
    // commitment in the game" was paying a flat 150 whether it ran two minutes or twelve hours.
    xpForClock('researchCompleted', active.durationMinutes * 60),
  );

  return { base: progressed.base, awards: [progressed.award] };
}

/**
 * The same, on the read paths that do not know what an Overseer is.
 *
 * The Lab used to settle on `GET /research` and `POST /research/tech` and nowhere else, which made
 * it the one clock in the game that does not run when nobody is looking at *its own screen*. A
 * rung that landed while the player was on the battle board stayed unfinished: the technology it
 * grants was not in `base.research.technologies`, so every door it opens (a declaration slot, a
 * mission slot, a chair at the Bar, every percentage in the standing fold) stayed shut, and the
 * `research_done` receipt only rang when the player opened the very page it points at.
 *
 * The due check is here rather than inside the settle so the common case, a read with nothing
 * finished, costs one comparison and no lookup: `overseerOf` is two queries and `settleBase` runs
 * on every request in the server.
 */
export function settleResearchFor(repos: Repositories, base: Base, now: Date): ResearchSettlement {
  const active = base.research.active;
  if (!active || !isResearchDue(active, now)) return { base, awards: [] };
  return settleResearch(repos, base, overseerOf(repos, base), now);
}
