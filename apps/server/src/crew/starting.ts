import { randomUUID } from 'node:crypto';
import {
  STARTER_DISTRICT_ID,
  STARTING_RESOURCES,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
} from '@frontline/shared';

/**
 * A crew at its first second, and the only place that shape is written down.
 *
 * It used to live inline in `POST /overseer`, which was fine while that route was the only thing
 * that ever made one. The Console's Clean slate makes one too (maintainer request, 2026-09-14),
 * and two copies of "what a new crew is" is the setup for the two drifting: a starting army
 * retuned in one and not the other reads as a bug in the reset rather than as a missing edit.
 *
 * Takes its identity from the caller because the two uses differ there and nowhere else. Creating
 * mints a fresh id; resetting keeps the one the crew already has, because five tables reference a
 * base without `ON DELETE CASCADE` and deleting the row is blocked by any of them the crew has
 * touched. A reset is therefore a rewrite in place, and the id is the thing that must not move.
 */
export function startingBase({
  id = randomUUID(),
  ownerId,
  name,
  now,
  districtId = STARTER_DISTRICT_ID,
}: {
  id?: string;
  ownerId: string;
  name: string;
  /** ISO, so the clocks the crew starts with all agree with each other. */
  now: string;
  /**
   * Which residential district this crew lives in (maintainer, 2026-09-17).
   *
   * Every human account used to be created in {@link STARTER_DISTRICT_ID}, so the whole player base
   * shared one home and a crew calling on "somebody else's district" was calling on its own. The
   * caller picks now, from the four residential districts, and the default is the old behaviour so
   * a test or a seeder that does not care does not have to choose.
   */
  districtId?: string;
}): Base {
  return {
    id,
    ownerId,
    // §A1: a allegiance has a name from the first second, because the HUD shows one from the
    // first second. This is a placeholder the player is expected to replace, not a decision
    // made for them: `POST /base/district-name` is on the district page.
    name,
    districtId,
    level: 1,
    isBot: false,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    /**
     * What a new district starts standing (§A1).
     *
     * The Nexus, because it is what authorises everything else and a district without one
     * caps every other plot at zero. The Generator, because it is what takes time off every
     * other structure's clock (§B4), and a first session where every build runs at full length
     * is a first session spent waiting. Everything else is the player's to lay.
     */
    buildings: [
      {
        id: randomUUID(),
        kind: 'nexus',
        level: 1,
        modifications: [],
      },
      {
        id: randomUUID(),
        kind: 'generator',
        level: 1,
        modifications: [],
      },
    ],
    buildQueue: [],
    /**
     * §A5: eight Scavengers, and no fighters at all (maintainer, 2026-09-23).
     *
     * The opening kit used to be eight Razors, chosen so a new crew could walk into Steelbelt on
     * day one and win. The opening is a different shape now: the board's first runs are minutes
     * rather than hours (`earlyMissionRamp`), so what a new crew needs on the first evening is
     * loot capacity, and carriers are what carries loot. Fighters are earned instead: off the
     * early feat bands that pay them, and off the training floor once the Gauntlet is up. The
     * maintainer's rule is that you start with carriers and you earn the rest.
     */
    army: { scavengers: 8 },
    gateArmy: {},
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
}
