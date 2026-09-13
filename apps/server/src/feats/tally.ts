import {
  ITEM_CATALOG,
  RESOURCE_KEYS,
  featMeasureKey,
  type FeatMeasure,
  type ItemCost,
  type ItemId,
  type PartialResources,
} from '@frontline/shared';
import type { TallyBump } from '../db/repos/feats.js';
import type { Repositories } from '../db/repos/index.js';

/**
 * The one place an event turns into counters (maintainer request, 2026-09-13).
 *
 * ## Why the call sites do not write keys
 *
 * A tally is a string, and a string typed at fourteen call sites is a string spelled wrong at one
 * of them. The symptom would be a feat that sits at zero forever while everything around it works,
 * which is the hardest kind of bug to notice in a table of a hundred and sixty. So the sites call
 * a named function that says what happened in the game's own words, and this file is the only
 * thing that knows what `missions_in_area:rustyard` is called.
 *
 * ## Why every one of these is best-effort
 *
 * None of these functions may take down the thing that was happening. A mission coming home, a
 * fight resolving and a building finishing are the moves a player actually made, and losing one of
 * those to a bookkeeping failure is far worse than a feat reading low. `record` swallows, the way
 * `history.record` does and for the same reason, and says so out loud rather than hiding it.
 *
 * The one thing that is *not* best-effort is the claim itself: paying out is a transaction and is
 * nowhere near this file.
 */

function record(repos: Repositories, baseId: string, bumps: readonly TallyBump[]): void {
  try {
    repos.feats.bumpMany(baseId, bumps);
  } catch {
    // Deliberately silent. See the note above: a counter is never worth a failed move.
  }
}

const one = (measure: FeatMeasure, scope?: string): TallyBump => ({
  tally: featMeasureKey(measure, scope),
  amount: 1,
});

const by = (measure: FeatMeasure, amount: number, scope?: string): TallyBump => ({
  tally: featMeasureKey(measure, scope),
  amount,
});

/**
 * Everything a crew is ever paid, counted gross.
 *
 * This is the maintainer's own example, stated as "total even counting spent", and it is the reason the
 * lifetime half of the vocabulary exists at all. Every faucet calls it: missions, fights, the
 * market, and production, which is the biggest of the four and the one with no record of its own.
 *
 * Fractions are kept rather than rounded. Production settles in fractional carry and rounding each
 * tick down would lose a few caps an hour forever, which over a late-game crew's lifetime is the
 * difference between reaching a three million cap feat and sitting just under it.
 */
export function tallyResourcesEarned(
  repos: Repositories,
  baseId: string,
  gained: PartialResources,
): void {
  const bumps = RESOURCE_KEYS.flatMap((key) => {
    const amount = gained[key] ?? 0;
    return amount > 0 ? [by('resources_earned', amount, key)] : [];
  });
  record(repos, baseId, bumps);
}

/** A run coming home: what it was, where it was, and whether it came off. */
export function tallyMissionHome(
  repos: Repositories,
  baseId: string,
  mission: { areaId: string; kind: 'battle' | 'standard'; succeeded: boolean },
): void {
  record(repos, baseId, [
    one('missions_done'),
    ...(mission.succeeded ? [one('missions_won')] : []),
    one('missions_in_area', mission.areaId),
    one('missions_of_kind', mission.kind),
  ]);
}

/** Pages off a job, a shelf, a barrow or a feat. Counted where they are found, not where spent. */
export function tallyPagesFound(repos: Repositories, baseId: string, count: number): void {
  if (count <= 0) return;
  record(repos, baseId, [by('pages_found', count)]);
}

/**
 * The pages inside a bundle of items, counted.
 *
 * Every door that hands a crew a satchel bundle hands over salvage and components in the same
 * object, and counting those as pages would finish the blueprint ladder off scrap servos. One
 * answer to "which of these were pages", rather than the same six-line reduce written out at each
 * of the doors: a mission's haul, the fence's shelf, and a feat's reward.
 */
export function tallyPagesIn(repos: Repositories, baseId: string, items: ItemCost): void {
  tallyPagesFound(
    repos,
    baseId,
    Object.entries(items).reduce(
      (total, [id, count]) =>
        ITEM_CATALOG[id as ItemId]?.kind === 'page' ? total + (count ?? 0) : total,
      0,
    ),
  );
}

/** Infamy banked, gross. Spending it on the ladder or the back room does not take it back. */
export function tallyInfamyEarned(repos: Repositories, baseId: string, amount: number): void {
  if (amount <= 0) return;
  record(repos, baseId, [by('infamy_earned', amount)]);
}

/**
 * A declared fight settling, from one crew's point of view.
 *
 * Called once per crew that stood in it, attackers and defenders alike, which is what makes
 * `battles_fought` mean "fights you were in" rather than "fights you called".
 */
export function tallyBattleResolved(
  repos: Repositories,
  baseId: string,
  outcome: { attacked: boolean; won: boolean; kills: number },
): void {
  record(repos, baseId, [
    one('battles_fought'),
    ...(outcome.won ? [one('battles_won')] : []),
    ...(outcome.won && outcome.attacked ? [one('battles_attacked_won')] : []),
    ...(outcome.won && !outcome.attacked ? [one('battles_defended_won')] : []),
    ...(outcome.kills > 0 ? [by('kills', outcome.kills)] : []),
  ]);
}

/**
 * Bodies and population committed to a declared fight.
 *
 * Counted when the muster is **sent**, not when the fight resolves, because that is when the crew
 * made the decision the feat is about and because a fight that is later called off still cost them
 * the commitment. Deliberately gross: adding to a muster twice counts twice, which is right, since
 * the feat asks how much has ever been put on the ground.
 */
export function tallyDeployed(
  repos: Repositories,
  baseId: string,
  sent: { bodies: number; supply: number },
): void {
  record(repos, baseId, [
    ...(sent.bodies > 0 ? [by('bodies_deployed', sent.bodies)] : []),
    ...(sent.supply > 0 ? [by('supply_deployed', sent.supply)] : []),
  ]);
}

/** Ground changing hands, counted for whoever took it. */
export function tallyCaptured(
  repos: Repositories,
  baseId: string,
  what: 'location' | 'gate',
): void {
  record(repos, baseId, [one(what === 'gate' ? 'gates_captured' : 'locations_captured')]);
}

/** Bodies out of the drill yard, counted per body rather than per order. */
export function tallyUnitsTrained(repos: Repositories, baseId: string, bodies: number): void {
  if (bodies <= 0) return;
  record(repos, baseId, [by('units_trained', bodies)]);
}

/** One building level finished. Levels, not buildings: raising a Nexus to ten is ten of these. */
export function tallyBuildingRaised(repos: Repositories, baseId: string, levels = 1): void {
  if (levels <= 0) return;
  record(repos, baseId, [by('buildings_raised', levels)]);
}

export function tallyOfficerHired(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('officers_hired')]);
}

export function tallyVehicleBuilt(repos: Repositories, baseId: string, count = 1): void {
  if (count <= 0) return;
  record(repos, baseId, [by('vehicles_built', count)]);
}

/** A listing of this crew's taken off the board. The seller's side of a deal. */
export function tallyMarketSale(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('market_sales')]);
}

/** Anything bought: a listing taken, a supply run, a barter with the Broker, a lot won. */
export function tallyMarketBuy(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('market_buys')]);
}

export function tallyContrabandTaken(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('contraband_taken')]);
}

export function tallyScoutingRun(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('scouting_runs')]);
}

/**
 * Something out of the Scrapyard.
 *
 * A trap counts twice on purpose: once as a trap and once as a fitting. The two feats are asking
 * different questions ("have you ever laid one" against "how much have you had cut") and a trap is
 * an honest answer to both.
 */
export function tallyAddonBuilt(repos: Repositories, baseId: string, isTrap: boolean): void {
  record(repos, baseId, [one('addons_built'), ...(isTrap ? [one('traps_built')] : [])]);
}

export function tallyMessageSent(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('messages_sent')]);
}
