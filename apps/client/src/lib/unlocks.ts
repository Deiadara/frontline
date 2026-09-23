import { noUnlocks, type UnlockFacts } from '@frontline/shared';
import { useMe } from './queries';

/**
 * The five facts every door in the game is gated on, read off `/me` (§I3).
 *
 * One place that assembles them, because two callers need the same answer and they are not near
 * each other: `routes/guards.tsx` decides whether to draw a screen, and `features/game/BottomNav`
 * decides whether to draw a padlock on the door to it. Two copies of this mapping is two chances
 * for a door that is shut in the nav and open on the page, which is the one failure mode a gate
 * must not have.
 *
 * `useMe` is already resolved and polling on every screen behind `/game`, so this is a cache read
 * rather than a request, and the doors re-decide themselves the moment a build finishes or an
 * officer is seated.
 */
export function useUnlockFacts(): UnlockFacts | null {
  const me = useMe();
  const base = me.data?.base;
  // Distinguishes "not loaded" from "loaded, and this crew has nothing": the first must not draw a
  // padlock on every door for a frame, and the second must.
  if (!me.data) return null;
  if (!base) return noUnlocks();
  return {
    level: base.level,
    buildings: base.buildings.map((building) => building.kind),
    // Seated officers only. The bench is the absence of a chair (`CommanderSchema.role`), and a
    // door gated on a Head of Research wants the person doing the job, not the person on the books.
    officers: base.commanders
      .map((officer) => officer.role)
      .filter((role): role is NonNullable<typeof role> => role !== null),
    notoriety: base.economy.notoriety,
    technologies: base.research.technologies,
  };
}
