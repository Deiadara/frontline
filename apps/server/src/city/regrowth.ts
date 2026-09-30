import {
  EVERY_LOCATION,
  findDistrict,
  lastWeekBoundary,
  startingGarrison,
  type LocationControl,
} from '@frontline/shared';
import { tallyHeldThroughRegrowth } from '../feats/tally.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The regime is rebuilt on Monday morning, on every plot nobody took off it.
 *
 * The maintainer's ruling (2026-09-24): *"The army of combine erodes during the week but sunday
 * night at midnight (before monday starts) they are all regenerated on whichever locations a
 * player does not hold. Legendaries regen only if you dont hold their location."*
 *
 * The erosion is the other half of that sentence and lives in `battle/resolve.ts`: a gate or a
 * district fight is now paid for out of the garrisons that fought it. Without a regrowth that
 * makes the city a resource that runs out, one raid a day, until there is nothing behind any door
 * in it. With one, a week of attrition is something a crew has to spend the week doing, and the
 * ground it wants has to be **held** rather than merely cleared.
 *
 * Three rules, and each is one line below:
 *
 *   * **A player's ground is a player's.** A plot held by a crew is untouched, garrison and all:
 *     what is standing on it is theirs, bought and walked there.
 *   * **Authored strength, not a top-up.** `startingGarrison` is what the district's difficulty
 *     and the location's own `baseDefense` say should be standing there, so a plot regrows to
 *     what the catalogue says rather than to whatever it happened to have last week.
 *   * **The legendaries come back with the rest.** A leader is a body in his plot's garrison
 *     (`city/combine.ts`), so `startingGarrison` puts him back on ground the regime still holds
 *     and cannot put him back on ground it does not. Nothing hands a taken plot back to the
 *     regime (maintainer, 2026-09-29): a crew that loses it loses it to another crew, and one
 *     that lets it go leaves it `unoccupied`, which this sweep skips. So taking his plot kills
 *     him for good.
 *
 * ## Once a week, and not once a tick
 *
 * `settleWorld` runs about once a second and on every page load besides, so "is it Monday
 * midnight" is the wrong question: it is false on almost every tick and true on a tick nobody may
 * be there to take. The question asked instead is *which week is this tick in*, and whether that
 * week has been grown back yet. `lastWeekBoundary` answers the first in Athens time; the one row
 * per mark behind `repos.regrowth.claim` answers the second (migration 0119). So a server that was
 * switched off from Saturday to Wednesday pays the week it comes back into, once, on its first
 * tick.
 *
 * A world whose table has no row for the week it is in grows back on the next tick, which on the
 * deploy that lands this is the tick after the restart. That is the correct behaviour rather than
 * an accident: there is no record of that week having been rebuilt, because until now no week ever
 * was.
 */
export function settleGarrisonRegrowth(repos: Repositories, now: Date): number {
  // The claim and every garrison it rebuilds are one transaction: claimed and then half-done
  // would leave the rest of the week's regrowth skipped for good, since the week is taken.
  return repos.tx(() => regrowWeek(repos, now));
}

function regrowWeek(repos: Repositories, now: Date): number {
  const mark = lastWeekBoundary(now).toISOString();
  if (!repos.regrowth.claim(mark, now.toISOString())) return 0;

  const controls = repos.city.controls();
  // The rebuild's only reading a player can chase: ground that was still a crew's when it ran
  // (`feats/tally.ts`, `plots_held_through_regrowth`). Inside the once-a-week claim above, so a
  // sweep that has already been paid for this week counts nothing.
  tallyHeldThroughRegrowth(repos, controls);
  let grown = 0;
  for (const location of EVERY_LOCATION) {
    const control = controls.get(location.id);
    if (!control || !regrows(control)) continue;
    const district = findDistrict(location.districtId);
    if (!district) continue;

    const authored = startingGarrison(location, district);
    // Nothing to stand back up: the plots the catalogue leaves empty (`COMBINE_UNOCCUPIED`, and
    // the open ground in a squatted district) stay empty rather than being handed a garrison the
    // world never gave them.
    if (Object.keys(authored).length === 0) continue;
    if (sameGarrison(control.garrison, authored)) continue;

    repos.city.setGarrison(location.id, authored);
    grown += 1;
  }
  return grown;
}

/**
 * Whether this plot is the regime's or the squatters' to rebuild.
 *
 * Asked as "is the holder one of the two parties that regrow" rather than as "is the holder not a
 * crew", because `unoccupied` is a real holder and a third answer: open ground stays open. A
 * garrison standing on a plot nobody holds would be a party the map cannot name.
 */
function regrows(control: LocationControl): boolean {
  return control.holder.kind === 'government' || control.holder.kind === 'looters';
}

/** Whether a plot is already at strength, so the sweep can count what it actually changed. */
function sameGarrison(standing: LocationControl['garrison'], authored: Record<string, number>) {
  const ids = new Set([...Object.keys(standing), ...Object.keys(authored)]);
  for (const id of ids) {
    if ((standing[id] ?? 0) !== (authored[id] ?? 0)) return false;
  }
  return true;
}
