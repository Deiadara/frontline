import {
  makeAttributes,
  AREA_REQUIREMENTS,
  createCommander,
  type GatedArea,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';

/**
 * Opens the named doors for the crew behind `token`, and nothing more (2026-09-28).
 *
 * The server holds the doors the client draws (`progression/doors.ts`), so a test driving the Bar
 * or the Market with a fresh level-one crew is refused before it reaches what it is about. This
 * meets each door the way a player would, on the smallest fact that opens it: the level for a
 * level door (never lowered), the rung for a research door, the rank for the back room.
 *
 * District Offers takes a Trader in the chair as well as the rung (2026-09-29): the board's write
 * routes refuse without one, so opening that door seats one if the crew has none.
 */
export function openDoors(app: FastifyInstance, token: string, ...areas: GatedArea[]): void {
  const { sub } = app.jwt.decode<{ sub: string }>(token) ?? { sub: '' };
  const base = app.repos.bases.findByOwnerId(sub);
  if (!base) throw new Error('openDoors: that token has no crew yet');
  let level = base.level;
  const technologies = new Set(base.research.technologies);
  let notoriety = base.economy.notoriety;
  for (const area of areas) {
    const requirement = AREA_REQUIREMENTS[area];
    if (requirement.kind === 'level') level = Math.max(level, requirement.level);
    else if (requirement.kind === 'research') technologies.add(requirement.technology);
    else if (requirement.kind === 'notoriety') notoriety = Math.max(notoriety, requirement.rank);
    else throw new Error(`openDoors: ${area} opens on a ${requirement.kind}, set it up directly`);
  }
  if (level !== base.level) app.repos.bases.updateProgression(base.id, level, base.progression);
  if (technologies.size !== base.research.technologies.length) {
    app.repos.bases.updateResearch(base.id, { ...base.research, technologies: [...technologies] });
  }
  if (notoriety !== base.economy.notoriety) {
    app.repos.bases.updateEconomy(base.id, { ...base.economy, notoriety });
  }
  if (areas.includes('offers') && !base.commanders.some((one) => one.role === 'trader')) {
    app.repos.bases.updateCommanders(base.id, [
      ...base.commanders,
      // A blank sheet, so the Trader opens the board and moves no rate (`traderRates` pays nothing
      // at the floor of the grades, 2026-10-04): a test about the Trader seats its own.
      createCommander(`${base.id}-trader`, 'The Trader', 'trader', makeAttributes(0)),
    ]);
  }
}
