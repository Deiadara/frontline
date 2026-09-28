import {
  creditStores,
  storeCeilings,
  wasteWarning,
  type Base,
  type PartialResources,
  type Resources,
  type StoreCeilings,
  type StoresCredit,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { crewEffectsFor } from '../crew/standing.js';
import { AppError } from '../errors.js';

/**
 * The one door resources come into a district through (maintainer ruling, 2026-09-28).
 *
 * Every credit in the server, mission pay, raid loot, a trade, a refund, a feat, is priced here
 * against the stores and lands up to their ceiling; what does not fit is gone. The callers still
 * write the stockpile themselves, because most of them write it in the same statement as something
 * else (the inventory, a queue), but the figure they write is the one this hands back.
 * `stores.test.ts` fails the build on a server file that adds to a stockpile any other way.
 */

/**
 * This crew's ceilings at `now`, its §F2 Logistics included.
 *
 * The bonus is not optional: it is what the HUD bar, the supply board and the production clamp
 * all draw, and a credit clamped to the bare structures would throw away what the screen says fits.
 */
export function storeCeilingsOf(repos: Repositories, base: Base, now: Date): StoreCeilings {
  return storeCeilings(base.buildings, crewEffectsFor(repos, base, now).storageCapacityPercent);
}

/** `gain` into this crew's stores as they stand in `base`: what lands and what is thrown away. */
export function creditBase(
  repos: Repositories,
  base: Base,
  gain: PartialResources,
  now: Date,
): StoresCredit {
  return creditStores(base.resources, gain, storeCeilingsOf(repos, base, now));
}

/**
 * Several credits landing on one read, each into the stores the one before it left.
 *
 * For a settle that brings more than one crew home at once: whichever run came first takes the
 * room, and the waste is named against the run that could not fit rather than smeared across all
 * of them.
 */
export function creditBaseInTurn(
  repos: Repositories,
  base: Base,
  gains: readonly PartialResources[],
  now: Date,
): { resources: Resources; credits: StoresCredit[] } {
  const ceilings = storeCeilingsOf(repos, base, now);
  let resources = base.resources;
  const credits = gains.map((gain) => {
    const credit = creditStores(resources, gain, ceilings);
    resources = credit.resources;
    return credit;
  });
  return { resources, credits };
}

/**
 * The warning, for a credit the player fires themselves.
 *
 * Refused with the figure unless the request already carries the player's yes. Thrown rather than
 * returned so it rolls back whatever the transaction around it has written, and so every route
 * answers it with the same code and body whatever its own refusals look like.
 */
export function refuseWaste(credit: StoresCredit, acceptWaste: boolean | undefined): void {
  if (credit.wasted === undefined || acceptWaste === true) return;
  throw new AppError('WOULD_WASTE', wasteWarning(credit.wasted), undefined, credit.wasted);
}
