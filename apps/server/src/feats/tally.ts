import {
  ITEM_CATALOG,
  RESOURCE_KEYS,
  battleFeatsEarned,
  cityOf,
  featMeasureKey,
  isCombineUnit,
  rarityOfPage,
  unitSlotsUsed,
  type Army,
  type BattleFeatFacts,
  type FeatMeasure,
  type ItemCost,
  type ItemId,
  type LocationControl,
  type PartialResources,
  LONG_ODDS_CHANCE,
  MARKET_DEAL_FLOOR_CAPS,
  fightCategory,
  marketDay,
  type Grade,
} from '@frontline/shared';
import { forceSize } from '../battle/forces.js';
import { controlsIn } from '../battle/ground.js';
import { apportion } from '../battle/side.js';
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
 * thing that knows what `missions_in_area:steelbelt` is called.
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
    /** The grade the card was dealt: counts wins by fight category and by letter. */
    grade?: Grade;
    /** The chance a plain run went out with, for the long-odds ladder. Fights do not roll one. */
    chance?: number | undefined;
  },
): void {
  record(repos, baseId, [
    one('missions_done'),
    ...(mission.succeeded ? [one('missions_won')] : []),
    one('missions_in_area', mission.areaId),
    one('missions_of_kind', mission.kind),
    ...(mission.succeeded && mission.grade !== undefined
      ? [
          one('jobs_won_at_letter', mission.grade[0]),
          ...(mission.kind === 'battle'
            ? [one('fights_won_in_category', fightCategory(mission.grade))]
            : []),
        ]
      : []),
    ...(mission.succeeded &&
    mission.kind === 'standard' &&
    mission.chance !== undefined &&
    mission.chance < LONG_ODDS_CHANCE
      ? [one('jobs_won_long_odds')]
      : []),
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

/**
 * A party a standing order sent, counted when it comes home, whether or not it brought anything. A
 * party turned round in its first tenth is not counted.
 */
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

/**
 * The crew's dead the medics brought round after a won fight, a declared one or a battle job
 * (P14-B, 2026-10-02): what the Infirmary, the Joker's seat and the recovery perks are for.
 */
export function tallyCasualtiesRecovered(repos: Repositories, baseId: string, count: number): void {
  if (count <= 0) return;
  record(repos, baseId, [by('casualties_recovered', count)]);
}

/** A level of work on held ground, landed (P8-C, 2026-10-02). */
export function tallyLocationLevelRaised(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('location_levels_raised')]);
}

/** A level on a captured gate, landed (P8-C, 2026-10-02). */
export function tallyGateLevelRaised(repos: Repositories, baseId: string, levels: number): void {
  if (levels <= 0) return;
  record(repos, baseId, [by('gate_levels_raised', levels)]);
}

/** A drill queued with two already on the list: the Professor's third place, used. */
export function tallyDrillThirdInLine(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('drills_third_in_line')]);
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
  outcome: {
    attacked: boolean;
    won: boolean;
    kills: number;
    /**
     * Where the fight was, for the away ladder. Optional, so a call site that has not been given
     * a district yet loses one counter rather than a fight.
     */
    districtId?: string;
  },
): void {
  record(repos, baseId, [
    one('battles_fought'),
    ...(outcome.won ? [one('battles_won')] : []),
    ...(outcome.won && outcome.attacked ? [one('battles_attacked_won')] : []),
    ...(outcome.won && !outcome.attacked ? [one('battles_defended_won')] : []),
    ...(outcome.kills > 0 ? [by('kills', outcome.kills)] : []),
    ...(outcome.won && foughtAbroad(repos, baseId, outcome.districtId)
      ? [one('battles_won_abroad')]
      : []),
  ]);
}

/**
 * One side of a declared fight, credited to every crew that stood in its line (audit, 2026-09-28).
 *
 * The settle used to call {@link tallyBattleResolved} for the two principals only, so a faction ally
 * who reinforced a fight was never in it as far as the board knew, and the kills their units made
 * went to the crew that called it. Every crew with units in the line is credited the fight and the
 * win, and the side's kills are split by the unit slots each crew put in (`apportion`). The
 * principal is credited even with nobody in the line: a crew whose home was raided was in that
 * fight whatever it had standing. `null` is the regime or the looters, who take their share of the
 * kills and are counted for nothing.
 */
export function tallyBattleSide(
  repos: Repositories,
  side: {
    attacked: boolean;
    won: boolean;
    kills: number;
    districtId: string;
    principal: string | null;
    /** What each crew put in, from `lineByCrew`. */
    line: ReadonlyMap<string | null, Army>;
  },
): void {
  const weights = new Map([...side.line].map(([baseId, army]) => [baseId, unitSlotsUsed(army)]));
  // A line with nobody in it has nothing to split by, so whatever it is owed is the principal's.
  const kills = [...weights.values()].some((slots) => slots > 0)
    ? apportion(side.kills, weights)
    : new Map([[side.principal, side.kills]]);
  const crews = new Set([
    side.principal,
    ...[...side.line].filter(([, army]) => forceSize(army) > 0).map(([baseId]) => baseId),
  ]);
  for (const baseId of crews) {
    if (baseId === null) continue;
    tallyBattleResolved(repos, baseId, {
      attacked: side.attacked,
      won: side.won,
      kills: kills.get(baseId) ?? 0,
      districtId: side.districtId,
    });
  }
}

/**
 * Whether that fight was in a city this crew does not live in (2026-09-24).
 *
 * Decided here rather than at the settle, which is the rule this whole module is built on: the
 * site says what happened, in the game's own words ("the fight was in `viaduct`"), and this
 * file decides what it is worth counting. The alternative was an `abroad: boolean` argument, and a
 * boolean computed at the call site is exactly the shape of the `forced` bug the raid counter
 * above was written about.
 *
 * Costs one indexed read of the crew row, and only on a win with a district to compare, so a lost
 * fight and a call site that passes nothing both pay nothing. Answers false when either end is
 * unknown, because a counter is never worth a guess.
 */
function foughtAbroad(
  repos: Repositories,
  baseId: string,
  districtId: string | undefined,
): boolean {
  if (districtId === undefined) return false;
  const base = repos.bases.findById(baseId);
  if (!base) return false;
  const home = cityOf(base.districtId);
  const where = cityOf(districtId);
  return home !== undefined && where !== undefined && home !== where;
}

/**
 * A unit move or a battle column that took the train (maintainer, 2026-09-24).
 *
 * Counted when the ride **arrives** where it was sent, not when it is chosen (audit, 2026-09-28).
 * Counting the choice let a crew put a column on the train, turn it round in its first tenth and
 * have it home in seconds, a journey banked per press with nothing ridden. Missions and spy jobs
 * never ride and so never reach here, and neither does a party carrying vehicles or the Colossus,
 * which `partyCanRide` refuses outright.
 */
export function tallyRailJourney(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('rail_journeys')]);
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

/**
 * A trap that went off, and what it took before contact, counted for the crew that laid it rather
 * than for the side. The side's kills are split by the slots each crew put in the line, and a trap
 * is not in the line, so an ally's trap used to pay its `kills` to the principal (bug pass,
 * 2026-09-29). The settle takes these off the side's figure before it splits it.
 *
 * Sprung counts once whatever it killed (P11-B, 2026-10-02): a trap a Wall Breaker walked through
 * still went off, and the "set" and "laid" rungs are about traps laid under fights, not built.
 */
export function tallyTrapSprung(repos: Repositories, baseId: string, killed: number): void {
  record(repos, baseId, [
    one('traps_sprung'),
    ...(killed > 0 ? [by('trap_kills', killed), by('kills', killed)] : []),
  ]);
}

/** A bet put down at the Stackhouse (2026-10-05). */
export function tallyStackhouseBet(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('stackhouse_bets')]);
}

/** A Stackhouse bet that came in. */
export function tallyStackhouseWin(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('stackhouse_wins')]);
}

/** A name bought with infamy and put on a fight (P11-B, 2026-10-02). */
export function tallyNameBurned(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('names_burned')]);
}

/** Gate levels a Colossus knocked down, counted for the crew that called the fight. */
export function tallyGateLevelsBroken(repos: Repositories, baseId: string, levels: number): void {
  if (levels <= 0) return;
  record(repos, baseId, [by('gate_levels_broken', levels)]);
}

/** Beaten runners a ring stopped on the way out, counted for the side that set it. */
export function tallyRunnersCaught(repos: Repositories, baseId: string, caught: number): void {
  if (caught <= 0) return;
  record(repos, baseId, [by('runners_caught', caught)]);
}

/**
 * Units and unit slots committed to a declared fight.
 *
 * Counted when the column **lands** on the fight's ground (`battle/movement.ts`), not when it is
 * sent and not when the fight resolves (audit, 2026-09-28). Counted at the send, a column recalled
 * in its first tenth walks home in the seconds it had spent, and deploy-then-recall banked four
 * thousand of each in twenty presses with no fight anywhere. Landing is still before the fight, so
 * a fight later called off keeps what was put on its ground. Deliberately gross: a crew that
 * withdrew and sent the same units again did put them on the ground twice.
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

/** A location changing hands, counted for whoever took it: in a fight, or by walking onto it. */
export function tallyCaptured(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('locations_captured')]);
}

/**
 * A gate fight won, counted for the crew that called it.
 *
 * A breach and not a capture: winning at a gate breaks it for `GATE_BREACH_HOURS` and opens the
 * district behind it to a raid, and nobody holds the gate afterwards. The measure was called
 * `gates_captured` and its ladder promised a door that answered to you, which the game never did.
 */
export function tallyGateBreached(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('gates_breached')]);
}

/** Units out of the drill yard, counted per unit rather than per order. */
export function tallyUnitsMustered(repos: Repositories, baseId: string, units: number): void {
  if (units <= 0) return;
  record(repos, baseId, [by('units_mustered', units)]);
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

/**
 * Who was on the other side of a deal: another crew, or one of the house's three counters, each of
 * which is one counterparty however many times a crew goes back to it.
 */
export type DealCounterparty = 'broker' | 'supplier' | 'runner' | { baseId: string };

/**
 * One deal on the market, from one crew's side of it: a listing of theirs taken (`sale`), or
 * anything bought, which is a listing taken, a supply run, a barter with the Broker or a lot won.
 *
 * Two rules, both decided here rather than at the four doors (audit, 2026-09-28):
 *
 *   * **It has to be a real deal.** Worth at least `MARKET_DEAL_FLOOR_CAPS` on its smaller side
 *     (`dealValue`), so a ten-scrap barter or a one-scrap listing is a trade and not a rung.
 *   * **Once per counterparty per market day.** Two accounts washing a listing back and forth, or one
 *     crew pressing the Broker all afternoon, count once a day each. With at most
 *     `OVERSEER_POOL_SIZE` crews in the world, that bounds a day's sales at one per other crew and
 *     its buys at three more, which is the rate `catalog.test.ts` holds both ladders' top rungs to.
 */
export function tallyMarketDeal(
  repos: Repositories,
  baseId: string,
  deal: {
    side: 'buy' | 'sale';
    counterparty: DealCounterparty;
    /** `dealValue` of the two sides, in caps. */
    worth: number;
    now: Date;
  },
): void {
  if (deal.worth < MARKET_DEAL_FLOOR_CAPS) return;
  const measure = deal.side === 'buy' ? 'market_buys' : 'market_sales';
  try {
    const first = repos.feats.firstDealOfDay(
      baseId,
      measure,
      typeof deal.counterparty === 'string' ? deal.counterparty : deal.counterparty.baseId,
      marketDay(deal.now),
    );
    if (!first) return;
  } catch {
    // Best-effort like every counter here: a failed dedupe write costs a feat reading, not a trade.
    return;
  }
  record(repos, baseId, [one(measure)]);
}

export function tallyContrabandTaken(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('contraband_taken')]);
}

/** A spy report that stood: one under the floor is caps spent, not a report. */
export function tallySpyReport(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('spy_reports')]);
}

/** A spy job home with a report, stood or failed. A job turned round writes none and is not one. */
export function tallySpyJobReturned(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('spy_jobs_returned')]);
}

/** A job home on a crew's ground that the crew never knew about. */
export function tallySpyJobUnnoticed(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('spy_jobs_unnoticed')]);
}

/** A report the Turned Runners courier brought in. */
export function tallyCourierReport(repos: Repositories, baseId: string): void {
  record(repos, baseId, [one('courier_reports')]);
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

/**
 * A district worn down to nobody (maintainer, 2026-09-24: "the army of combine erodes").
 *
 * `spendGarrisons` in `battle/resolve.ts` writes a gate or district fight's survivors back onto the
 * plots they were drawn off, so the regime's and the squatters' standing armies really do shrink
 * across a week of assaults. The board had nothing on it, and this is the counter that says so:
 * `districts_emptied`, one for each district this crew's fight left with nothing of theirs standing
 * anywhere in it.
 *
 * `plots` is the rows that put bodies in the line, in the settle's own words, and the decision about
 * what that is worth is here, which is the rule this whole module is built on. Three conditions, and
 * each one is a way the counter could otherwise be dishonest:
 *
 *   * **This fight has to have stripped something.** At least one of the rows that fought must now
 *     be empty **and still theirs**. Still theirs is what keeps a capture from counting: clear six
 *     plots, take the seventh, and the district has none of them left in it, but the seventh was
 *     never worn down. Without that word a crew taking every garrisoned plot in Chrome Row one at a
 *     time would collect this, which is `districts_held_whole` and `locations_captured` wearing
 *     another ladder's name.
 *   * **Nothing of theirs may be left anywhere in the district**, including on plots that were not
 *     in this fight. A legendary is never in a gate fight (`withoutTheLeader`), so his plot keeps one
 *     body and holds his district off this counter until somebody takes it off him. That is the rule
 *     the erosion was written under and it is load-bearing here.
 *   * **A crew's plot is neither.** It is not stripped, because that garrison is not the regime's,
 *     and it does not hold the district either. Ground held away from a fight is defended by the
 *     column you send to it, which is the same rule `assemble` skips those rows under.
 *
 * Not conditional on winning. A defence that holds can still be apportioned down to nothing on the
 * plot it stood on, and a district with nobody left in it is stripped whoever took the door.
 *
 * Nothing refills a garrison until Monday (`city/regrowth.ts`), so a second fight in the same week
 * finds no rows to spend and pays nothing: the counter climbs once per stripping, and a crew that
 * wants another has to wait for the rebuild. That is the whole shape of the feat rather than a
 * limitation of it.
 */
export function tallyDistrictStripped(
  repos: Repositories,
  baseId: string,
  fight: { districtId: string; plots: readonly string[] },
): void {
  if (fight.plots.length === 0) return;

  // Their ground, and how many are standing on each bit of it. A plot that is not in here is not
  // theirs, which is why the two questions below can both be asked of one map.
  const theirs = new Map(
    controlsIn(repos, fight.districtId)
      .filter(
        ({ control }) => control.holder.kind === 'government' || control.holder.kind === 'looters',
      )
      .map(({ locationId, control }) => [locationId, forceSize(control.garrison)] as const),
  );

  const strippedHere = fight.plots.some((locationId) => theirs.get(locationId) === 0);
  if (!strippedHere) return;
  if ([...theirs.values()].some((standing) => standing > 0)) return;

  record(repos, baseId, [one('districts_emptied')]);
}

/**
 * Ground that was still a crew's when the regime was rebuilt (maintainer, 2026-09-24).
 *
 * `settleGarrisonRegrowth` walks every control row at Monday 00:00 Athens time and puts back
 * whatever the regime or the squatters hold. A crew's plot is skipped, and that skip is the only
 * thing regrowth adds that a player can chase, so it is the one it is counted on:
 * `plots_held_through_regrowth`, one per plot per crew per rebuild.
 *
 * Plot-weeks, deliberately. A crew holding twenty five plots banks twenty five a week, so the number
 * climbs with how much ground is yours **and** with how long you have kept it, which is what the
 * rebuild made worth asking about. `locations_held` already answers the first half on its own.
 *
 * Handed the whole control map rather than a count per crew, so the sweep's only job is to say when
 * it ran. One `record` per crew, because a tally row is keyed by base and the write is per base
 * anyway; a crew holding nothing is not written at all rather than written a zero.
 */
export function tallyHeldThroughRegrowth(
  repos: Repositories,
  controls: ReadonlyMap<string, LocationControl>,
): void {
  const kept = new Map<string, number>();
  for (const control of controls.values()) {
    if (control.holder.kind !== 'crew') continue;
    kept.set(control.holder.baseId, (kept.get(control.holder.baseId) ?? 0) + 1);
  }
  for (const [baseId, plots] of kept) {
    record(repos, baseId, [by('plots_held_through_regrowth', plots)]);
  }
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
