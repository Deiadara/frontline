import {
  ITEM_CATALOG,
  RESOURCE_KEYS,
  battleFeatsEarned,
  featMeasureKey,
  isCombineUnit,
  rarityOfPage,
  type Army,
  type BattleFeatFacts,
  type FeatMeasure,
  type ItemCost,
  type ItemId,
  type PartialResources,
  type BattleTier,
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
 * which is the hardest kind of bug to notice in a table of two hundred. So the sites call
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
  mission: {
    areaId: string;
    kind: 'battle' | 'standard';
    succeeded: boolean;
    /** The fight's tier, for the ladder that counts wins by weight. Null on plain work. */
    tier?: BattleTier | null;
  },
): void {
  record(repos, baseId, [
    one('missions_done'),
    ...(mission.succeeded ? [one('missions_won')] : []),
    one('missions_in_area', mission.areaId),
    one('missions_of_kind', mission.kind),
    ...(mission.succeeded && mission.tier ? [one('fights_won_at_tier', mission.tier)] : []),
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
 * Every door that hands a crew an inventory bundle hands over salvage and components in the same
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

/**
 * What the Reimagining bench handed back, counted only when it is a Masterpiece.
 *
 * Called for every trade rather than only the good ones, so the route says what happened and this
 * file decides what it is worth counting, which is the rule the whole module is built on.
 *
 * `rarityOfPage` is the shared lookup the bench itself draws with (`blueprints/state.ts`), and
 * reading it here is deliberate: the tier of a sheet is the sheet's own rarity where it was
 * authored one and its document's otherwise, and a second copy of that rule living in the server
 * would be a counter that disagrees with the draw it is counting.
 */
export function tallyPageReimagined(repos: Repositories, baseId: string, pageId: string): void {
  if (rarityOfPage(pageId) !== 'masterpiece') return;
  record(repos, baseId, [one('masterpieces_reimagined')]);
}

/** A party sent by a standing order. Counted at the send, whether or not it comes home with anything. */
export function tallyAutomatedParty(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('automated_parties')]);
}

/** The Reimagining lever pressed and three pages taken. `paidXp` is the finished collection's run. */
export function tallyBenchTrade(repos: Repositories, baseId: string, paidXp: boolean): void {
  record(repos, baseId, [one('bench_trades'), ...(paidXp ? [one('bench_experience')] : [])]);
}

/** Enemy units this crew made run, in a declared fight or off a battle job (2026-09-23). */
export function tallyUnitsRouted(repos: Repositories, baseId: string, count: number): void {
  if (count <= 0) return;
  record(repos, baseId, [by('units_routed', count)]);
}

/** A drill started while another was already running: the second bench, used. */
export function tallyDrillPaired(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('drills_paired')]);
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
 * ...and the four ways one of those fights can be worth telling somebody about.
 *
 * Separate from {@link tallyBattleResolved} because it is a different kind of call: that one is
 * bookkeeping every fight does, this one asks a question about the shape of the fight and most of
 * the time the answer is "none of them". Split so the settle site reads as what happened (a fight
 * settled, and here is what it looked like) rather than as one function with nine arguments.
 *
 * The rule is `feats/battle.ts` in shared, not here. The blurbs promise a line twice your own and
 * ten of theirs for one of yours, and a threshold written at the settle site is a threshold that
 * drifts away from the sentence a player was sold.
 */
export function tallyBattleShape(
  repos: Repositories,
  baseId: string,
  facts: BattleFeatFacts,
): void {
  const earned = battleFeatsEarned(facts);
  if (earned.length === 0) return;
  record(
    repos,
    baseId,
    earned.map((measure) => one(measure)),
  );
}

/**
 * A break-in on a lived-in district, counted for whoever came out of it on top.
 *
 * Only a `district` target reaches here. Taking a location or a gate is a capture and has its own
 * counters; a raid moves no control row at all, which is exactly why it needed its own.
 *
 * Named rather than a boolean, and the reason is a bug this call had on the way in: `forced` read
 * off the losing side's point of view paid the defender a repelled raid for one they lost, and a
 * boolean argument at the call site is the thing that made it possible to write and impossible to
 * see. Both words mean a win, so neither side is paid for turning up.
 */
export function tallyDistrictRaid(
  repos: Repositories,
  baseId: string,
  outcome: 'forced' | 'held',
): void {
  record(repos, baseId, [one(outcome === 'forced' ? 'districts_raided' : 'raids_repelled')]);
}

/** What a trap took before contact, counted for the crew that laid it rather than for the side. */
export function tallyTrapKills(repos: Repositories, baseId: string, killed: number): void {
  if (killed <= 0) return;
  record(repos, baseId, [by('trap_kills', killed)]);
}

/** Beaten runners a ring stopped on the way out, counted for the side that set it. */
export function tallyRunnersCaught(repos: Repositories, baseId: string, caught: number): void {
  if (caught <= 0) return;
  record(repos, baseId, [by('runners_caught', caught)]);
}

/**
 * Units and unit slots committed to a declared fight.
 *
 * Counted when the muster is **sent**, not when the fight resolves, because that is when the crew
 * made the decision the feat is about and because a fight that is later called off still cost them
 * the commitment. Deliberately gross: adding to a muster twice counts twice, which is right, since
 * the feat asks how much has ever been put on the ground.
 */
export function tallyDeployed(
  repos: Repositories,
  baseId: string,
  sent: { units: number; unitSlots: number },
): void {
  record(repos, baseId, [
    ...(sent.units > 0 ? [by('bodies_deployed', sent.units)] : []),
    ...(sent.unitSlots > 0 ? [by('supply_deployed', sent.unitSlots)] : []),
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

/** Units out of the drill yard, counted per unit rather than per order. */
export function tallyUnitsTrained(repos: Repositories, baseId: string, units: number): void {
  if (units <= 0) return;
  record(repos, baseId, [by('units_trained', units)]);
}

/**
 * The character an account picked, counted the once.
 *
 * Bumped inside the same transaction that seats them, so the feat is already finished by the time
 * the picker hands the player to the district: the first thing a new crew sees on the feats board
 * is a rung waiting to be collected, and what it pays is the five Scavengers the opening needs to
 * run a job at all.
 *
 * Not conditional on anything. `POST /overseer` refuses a second character and the schema has a
 * unique index behind that refusal, so the only way here twice is a Clean slate, which leaves the
 * counter where it was and the feat collected. That is the right outcome: a reset crew keeps the
 * carriers it was paid.
 */
export function tallyOverseerTaken(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('overseer_taken')]);
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

/** A spy report that stood: one under the floor is caps spent, not a report. */
export function tallySpyReport(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('spy_reports')]);
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

/**
 * What a fight against the Combine is worth on the board (maintainer, 2026-09-19).
 *
 * Everything in it, so a player who takes the Combine on has a whole section of feats moving at
 * once rather than one. Called only when the defender was the regime; a fight against looters or
 * another crew tallies none of this, and the settle site decides that, not this function.
 */
export interface CombineFightFacts {
  won: boolean;
  /** Won without losing a body. The same rule as `battles_won_flawless`, on the Combine alone. */
  flawless: boolean;
  /**
   * Won in a district whose Combine legendary was still standing **when the fight settled**.
   *
   * Read off the control rows at the settle, not off anything recorded at the declaration: see
   * `combinePresenceOver` in `battle/resolve.ts`. A crew that kills him after calling a fight in
   * his district fights it without him, and does not collect this.
   */
  underLeader: boolean;
  /** The Combine units that fell, by id, including any leader among them. */
  killed: Army;
  /** The attacker's own units that changed sides under Directive Xero and did not come back. */
  turned: number;
  /** A location changed hands from the Combine to this crew. */
  locationTaken: boolean;
}

export function tallyCombineFight(
  repos: Repositories,
  baseId: string,
  facts: CombineFightFacts,
): void {
  const fallen = Object.entries(facts.killed).filter(
    ([unitId, count]) => count > 0 && isCombineUnit(unitId),
  );
  const kills = fallen.reduce((total, [, count]) => total + count, 0);
  const leaders = fallen
    .map(([unitId]) => unitId)
    .filter((unitId) => ['syndic', 'executioner', 'directive_xero'].includes(unitId));
  record(repos, baseId, [
    ...(kills > 0 ? [by('combine_kills', kills)] : []),
    ...fallen.map(([unitId, count]) => by('combine_kills_of', count, unitId)),
    ...leaders.map((unitId) => one('combine_leaders_slain', unitId)),
    ...(facts.locationTaken ? [one('combine_locations_taken')] : []),
    ...(facts.won ? [one('combine_fights_won')] : []),
    ...(facts.won && facts.flawless ? [one('combine_fights_won_flawless')] : []),
    ...(facts.won && facts.underLeader ? [one('combine_fights_won_shadowed')] : []),
    ...(facts.turned > 0 ? [by('units_turned', facts.turned)] : []),
  ]);
}
