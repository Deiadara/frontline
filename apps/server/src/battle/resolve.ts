import {
  type LineRules,
  combineLeaderAt,
  combinePresenceOver,
  capturedGateDefensePercent,
  addResources,
  mergeResources,
  battlefieldFor,
  breachExpiry,
  clampLevel,
  disruptionFrom,
  refreshDisruption,
  districtDefense,
  findDistrict,
  LOCATION_CATALOG,
  findLocation,
  findTrap,
  earnedInfamy,
  gainInfamy,
  homeBattlefield,
  infamyPointsForFled,
  infamyForKills,
  infamyPointsForRingDead,
  infamyForRaidWon,
  isBattleDue,
  itemCount,
  lootCapacityOf,
  plunder,
  raidTargetOf,
  recoverCasualties,
  removeItems,
  spendResources,
  springTrap,
  type Army,
  type Battlefield,
  type BattleAnalysis,
  type Base,
  type Building,
  type District,
  type EconomyState,
  type ItemId,
  type PartialResources,
  type ScheduledBattle,
  type SideAnalysis,
  type SkirmishEngine,
  type SkirmishOutcome,
  NO_BOOST,
  boostBundle,
  blackMarketBoost,
  findBattleBoost,
  findBlackMarketGood,
  stashCount,
  takeFromStash,
  emptyDeployment,
  type BattleDeployment,
  type BattleBoost,
  type CrewEffects,
  findUnit,
  districtDisplayName,
  battleMargin,
  infirmaryRecoveryPercent,
  leading,
  mulberry32,
  officerInjured,
  officerIsInjured,
  officerRecoveryAt,
  mergeFleets,
  removeFleet,
  scaledSpoils,
  seedFrom,
  vehicleInfamy,
  wrecked,
  type Fleet,
  type BattleOfficer,
  type BattleSide,
  type Commander,
  loadable,
  findVehicle,
  ridingGroups,
  bareLineRules,
  fightingSlots,
  unitSlotsUsed,
  vehicleNoun,
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import { recallOvertaken } from './movement.js';
import type { Repositories } from '../db/repos/index.js';
import { sideForce, splitSurvivors } from './side.js';
import { notifyBase } from '../social/notify.js';
import { cityLevelFor } from '../blackmarket/shelf.js';

import { forceSize, mergeArmies, removeForce } from './forces.js';
import {
  tallyBattleResolved,
  tallyBattleShape,
  tallyCombineFight,
  tallyCaptured,
  tallyDistrictRaid,
  tallyInfamyEarned,
  tallyResourcesEarned,
  tallyRunnersCaught,
  tallyUnitsRouted,
  tallyTrapKills,
} from '../feats/tally.js';
import { controlsIn, defendingBaseOf, residentOf, targetName } from './ground.js';
import { awardPlayerXp } from '../progression/award.js';
import { gateFor, holdsDistrictWhole, resetGateOnDistrictLost } from '../city/gates.js';

/**
 * Running the fights whose mark has passed (GDD §A4, battle rework).
 *
 * **There is no scheduler.** A declared battle is a row with a timestamp, and it resolves the first
 * time anybody reads a page that cares: exactly the contract payroll, missions, research and the
 * build queue already run on. A fight nobody has looked at for three days resolves to the same
 * result whenever it is next opened, because everything it depends on was fixed before the mark:
 * the seed at declaration, the forces at the cutoff.
 *
 * The order inside one resolution is load-bearing and it is the order the fiction has:
 *
 * 1. **The trap goes off**, before anybody is in contact. It never turns an attack back. It takes a
 *    bite, and the fight happens anyway unless there is nothing left to fight with.
 * 2. **The fight runs**, through the same engine every other fight in the game goes through.
 * 3. **The ring takes its cut** of the losers' runners. That happens inside the engine's rout step,
 *    because who got away is the rout's business.
 * 4. **The ground changes hands**, or, on a lived-in district, is looted and wrecked instead.
 * 5. **The ledger is written**: infamy for what died, the §D8 tally, and the report.
 */

interface Assembled {
  attacking: Army;
  defending: Army;
  /** The defender's ring. The attacker has none (maintainer, 2026-09-23). */
  defenderRing: Army;
  /**
   * True when the defending force was drawn out of a crew's own roster rather than off a garrison.
   *
   * Which pool the survivors go back into, and the one thing that cannot be worked out afterwards
   * from the armies alone.
   */
  fromHomeRoster: boolean;
  /** A call on the resident's own door: met by the gate garrison, not the district army (2026-09-22). */
  atTheGate: boolean;
  /** Faction allies' postings on the ground, by crew: theirs, fighting for the holder. */
  posted: { baseId: string; army: Army }[];
}

/**
 * Everything standing on the ground when the clock runs out.
 *
 * The two pools that join a deployment without anybody having sent them are the point: a garrison is
 * already on the location it garrisons, and a crew's roster is already at home. Both are folded in here
 * and rebuilt from the survivors afterwards, so nobody is counted in two locations at once.
 */
export function assemble(
  repos: Repositories,
  battle: ScheduledBattle,
  defenderBase: Base | undefined,
): Assembled {
  // The whole of each side, allies folded in (`battle/side.ts`). Reading one row here would have
  // marched the declarer in alone while their reinforcements sat in the database.
  const at = battle.scheduledFor;
  const attackerDeployment = sideForce(repos, battle.id, 'attacker', at);
  const defenderDeployment = sideForce(repos, battle.id, 'defender', at);

  const attacking = attackerDeployment?.army ?? {};
  const defenderRing = defenderDeployment?.perimeter ?? {};
  let defending = defenderDeployment?.army ?? {};

  if (battle.target.kind === 'location') {
    const control = repos.city.control(battle.target.locationId);
    if (control) defending = mergeArmies(defending, control.garrison);
    // Allies posted on the ground stand in the line with the garrison (2026-09-22).
    const posted = repos.alliedGarrisons.at(battle.target.locationId);
    for (const row of posted) defending = mergeArmies(defending, row.army);
    return {
      attacking,
      defending,
      defenderRing,
      fromHomeRoster: false,
      atTheGate: false,
      posted,
    };
  }

  /*
   * A gate, or the district behind a broken one, is defended by whoever is standing in it.
   *
   * "Standing in" is literal, and the distinction is the whole of this block. `defenderBase` is the
   * crew whose books this fight is settled against, and for a gate that is whoever holds the
   * district: `districtHolder` never asks where they sleep. Holding a district is not living in it,
   * so the three cases are separate.
   *
   *   * A crew defending its own home fights with its roster, because nobody should have to
   *     remember to defend the room they are standing in. Its survivors then *replace* the roster,
   *     which is what `fromHomeRoster` is for.
   *   * The Combine's ground is defended by every garrison on it, plus the muster `declare` wrote.
   *     Nothing is settled against a party with no base, so nothing is written back either.
   *   * A crew holding ground it does not live on defends with **what it sent**. Its home army is
   *     three districts away and did not march.
   *
   * That last case used to take the first branch, because this took `residentOf(district)` and the
   * cross-wire fix changed the argument to the base being settled without changing the test. A crew
   * that held the Rustyard from the Ashen Terraces had its entire home army conscripted into every
   * gate fight there, and `fromHomeRoster` then overwrote the roster with the survivors: losing a
   * gate in a district they only held on paper destroyed everything they owned at home. An attacker
   * who wanted a rival's standing army gone did not have to go and find it.
   *
   * The garrisons are deliberately not folded in for a crew holder. They are never written back on
   * a gate fight (`setGarrison` is only called for a `location` target), so folding them in would
   * make them a defence that fights for free and cannot be killed, and merging the survivors home
   * afterwards would credit the roster with units still standing on their locations. Ground held
   * at a distance is defended by the column you send to it.
   */
  const livesHere = defenderBase?.districtId === battle.target.districtId;
  const atTheGate = livesHere && battle.target.kind === 'gate';
  if (livesHere) {
    // Each half of the army defends its own place (2026-09-22): the door is met by the gate
    // garrison, and a raid inside a breach by whoever is standing in the district.
    defending = mergeArmies(
      defending,
      atTheGate ? (defenderBase.gateArmy ?? {}) : defenderBase.army,
    );
  } else if (!defenderBase) {
    for (const { locationId, control } of controlsIn(repos, battle.target.districtId)) {
      defending = mergeArmies(defending, withoutTheLeader(locationId, control.garrison));
    }
  }
  return {
    attacking,
    defending,
    defenderRing,
    fromHomeRoster: livesHere,
    atTheGate,
    posted: [],
  };
}

/**
 * A plot's garrison with its Combine legendary left standing on it (`city/combine.ts`).
 *
 * "The leader himself stands on one location and fights only there." A gate fight is not on his
 * plot, and nothing above this line is written back for a gate: `setGarrison` runs for a
 * `location` target and nothing else. So folding him into a district's defence put him in a fight
 * he cannot die in, and the settle then counted him among the dead anyway. Measured on the
 * Annexes gate: the ledger wrote `combine_leaders_slain:syndic`, the uplink still held her sheet,
 * and every later fight in the district carried her power. A crew could collect the feat for
 * killing her as often as it liked and never once take the power off the ground.
 *
 * Only the leader is held back. The regiment standing beside him fights the gate as it always
 * has, which is a separate rule with its own reasons written above.
 */
function withoutTheLeader(locationId: string, garrison: Army): Army {
  const leader = combineLeaderAt(locationId);
  if (!leader || (garrison[leader.unitId] ?? 0) <= 0) return garrison;
  const { [leader.unitId]: _standing, ...rest } = garrison;
  return rest;
}

/**
 * The ground itself. A location fights like its kind; a district gate fights like a street.
 *
 * Read at the moment the fight was **called for**, not at the moment the settler happened to run.
 *
 * That distinction did not exist before the sky did, and it matters now that it does. Battles
 * settle lazily: `repos.sieges.due()` returns everything past its mark that nobody has read yet,
 * so a fight declared for 23:00 can be resolved at nine the next morning by whoever opens the page
 * first. Passing the settle clock meant that fight was decided in tomorrow's weather and in
 * daylight: a player who picked a foggy night for their Ghosts got a clear morning, and *which*
 * morning depended on when somebody else loaded a screen.
 *
 * Exported because `battle/view.ts` sends this ground to the client so the deployment screen can
 * forecast the fight on it. One function rather than two: a forecast computed on a *different*
 * battlefield from the one that will decide the fight is the exact failure `battle/forecast.ts`
 * exists to avoid, and a second copy here would drift the first time the weather rule moved.
 */
export function battlefieldOf(
  battle: ScheduledBattle,
  /** Only the name is used, for the home-district fallback. Narrowed so callers need no District. */
  districtName: string,
  fortification: number,
): Battlefield {
  const at = new Date(battle.scheduledFor);
  if (battle.target.kind === 'location') {
    const location = findLocation(battle.target.locationId);
    if (location) {
      return battlefieldFor({
        locationName: location.name,
        kind: location.kind,
        fortifyDifficulty: location.fortifyDifficulty,
        fortifyLevel: fortification,
        at,
      });
    }
  }
  return homeBattlefield(districtName, at);
}

interface TrapResult {
  attacking: Army;
  /**
   * Who the shell took, as a force rather than a headline figure.
   *
   * The settler needs the list, not the count: these are dead units like any other, so they are
   * worth infamy to the crew that set the trap and a Bone Market refund to the crew that walked
   * into it. They used to be subtracted from the attacking force and then dropped, which made a
   * trap the one way to kill somebody in this game that paid nobody anything.
   */
  killed: Army;
  note: { name: string; killed: number } | null;
  wipedOut: boolean;
  /**
   * Whose trap it was, or null when nobody laid one.
   *
   * Not the defending crew: the row that carries the shell may belong to an ally who came to
   * reinforce, and the feat counter is about who buried the thing rather than who owns the ground.
   */
  ownerBaseId: string | null;
}

/**
 * §I4: whatever the defending side set under this fight, and what it took.
 *
 * The whole side rather than the defender's own row, because an ally who came to reinforce may be
 * the one carrying the shell. At most one row can name a trap: `/battles/trap` refuses a second
 * from anybody else on the side, the same way `/battles/lead` refuses a second officer.
 *
 * The bag is checked **here** rather than trusted from the row. Naming a trap is free and free to
 * change, so the same one can sit on two coming fights at once; the first to resolve takes it out
 * of the inventory and the second finds nothing there. That is exactly what `appliedBoost` does with
 * a crate of contraband, and for the same reason.
 *
 * No longer restricted to a fight over a location. A trap used to live on `location_control`, so a
 * crew defending its own gate or its own structures could not have one; it rides the deployment
 * now, and every fight this crew is defending is ground it is standing on.
 */
function springAnyTrap(repos: Repositories, battle: ScheduledBattle, attacking: Army): TrapResult {
  const nothing: TrapResult = {
    attacking,
    killed: {},
    note: null,
    wipedOut: false,
    ownerBaseId: null,
  };
  const row = repos.sieges
    .side(battle.id, 'defender')
    .find((entry) => entry.trapId !== null && entry.baseId !== null);
  const spec = row?.trapId ? findTrap(row.trapId) : undefined;
  if (!row?.baseId || !spec) return nothing;

  // Read fresh rather than off `defenderBase`: the row's owner may be an ally, and nothing has
  // written to this crew yet, so what comes back is what they are actually carrying.
  const owner = repos.bases.findById(row.baseId);
  if (!owner || itemCount(owner.inventory, spec.id as ItemId) <= 0) return nothing;

  /*
   * Spent, whatever happens next.
   *
   * A trap goes off when somebody walks over it, not when the fight is won, so leaving it in the
   * bag on a loss would make it a free retry. Taken *before* the engine runs, which is why
   * `resolveOne` is wrapped in one transaction: an engine that threw used to take the defender's
   * trap with it and leave the fight to run again later without one.
   *
   * `updateHoldings` writes the stockpile as well, so it is handed the resources that were just
   * read back. Nothing in `resolveOne` has written this crew's stockpile at this point, and every
   * later resource write either re-reads the row or writes a value this call left untouched.
   */
  repos.bases.updateHoldings(
    owner.id,
    owner.resources,
    removeItems(owner.inventory, { [spec.id]: 1 }),
  );

  const toll = springTrap(attacking, spec);
  return {
    attacking: toll.survivors,
    killed: toll.killed,
    note: { name: spec.name, killed: forceSize(toll.killed) },
    wipedOut: toll.wipedOut,
    ownerBaseId: owner.id,
  };
}

/**
 * What a dead force is worth back in caps, at a given refund percentage (§A4).
 *
 * Priced off the units' own catalogue cost rather than a flat per-unit figure, so losing a
 * Colossus refunds a Colossus. Empty when the crew holds nothing that pays a refund, which is the
 * common case and costs nothing to compute.
 */
export function refundFor(dead: Army, percent: number): PartialResources {
  if (percent <= 0) return {};
  let caps = 0;
  for (const [unitId, count] of Object.entries(dead)) {
    const unit = findUnit(unitId);
    if (!unit) continue;
    caps += (unit.cost.caps ?? 0) * count * (percent / 100);
  }
  const whole = Math.floor(caps);
  return whole > 0 ? { caps: whole } : {};
}

/** §D7 and §D8 in one write, from one reading of the district. */
function bankOutcome(
  economy: EconomyState,
  district: District,
  won: boolean,
  killedInfamy: number,
  now: Date,
  /** §A4: what the ground adds to a name (the Graveyard, the Spire). Percent, never negative. */
  infamyGainPercent = 0,
): EconomyState {
  const target = raidTargetOf(district);
  const earned =
    killedInfamy +
    (won
      ? infamyForRaidWon({
          fromTheState: target.allegiance === 'government',
          seatOfPower: target.isSeatOfPower,
        })
      : 0);
  return {
    ...economy,
    infamy: gainInfamy(economy.infamy, earnedInfamy(earned, infamyGainPercent)),
  };
}

/**
 * The Gate's own contribution to holding the ground, and the perks that only pay for a Gate.
 *
 * `gateDefensePercent` (§B7) is folded in here rather than into `defensePercent` at the source,
 * because that is what makes it conditional: this function is only called for the side that is
 * *defending a district it has built a Gate on*, so a Gatewright is worth nothing on an attack and
 * nothing at all to a crew that never raised one. Added to the same channel the Gate itself pays
 * into, so it is one number on the report rather than two that have to be reconciled.
 */
/**
 * How many different crews put people on one side of a fight.
 *
 * The condition behind `allied_offense` (§B7). More than one means somebody else's crew is
 * standing in your line, which is the whole thing the perk is about: an ally who sent twelve
 * units is a different fight from one you took on your own, and a perk that only pays there is a
 * reason to fight alongside your faction rather than a number that pays out regardless.
 *
 * Counted from the rows rather than from the declaration, because reinforcements arrive after it.
 */
function alliedSideCount(repos: Repositories, battleId: string, side: 'attacker' | 'defender') {
  const bases = new Set<string>();
  for (const row of repos.sieges.side(battleId, side)) {
    if (row.baseId !== null) bases.add(row.baseId);
  }
  return bases.size;
}

/**
 * Whether this crew holds every location in the district they live in.
 *
 * The condition behind `whole_district`. A sweep rather than a majority on purpose: the perk is
 * priced for a state that is hard to reach and easy to lose, so one location changing hands turns
 * it off, and getting it back turns it on again.
 */
function holdsWholeDistrict(repos: Repositories, base: Base): boolean {
  const district = findDistrict(base.districtId);
  if (!district || district.locations.length === 0) return false;
  const controls = repos.city.controls();
  return district.locations.every((location) => {
    const holder = controls.get(location.id)?.holder;
    return holder?.kind === 'crew' && holder.baseId === base.id;
  });
}

/** Pays out the two situational channels, and only where their condition actually holds. */
function situational(
  effects: CrewEffects,
  when: { allied: boolean; wholeDistrict: boolean },
): CrewEffects {
  const offense = when.allied ? effects.alliedOffensePercent : 0;
  const defense = when.wholeDistrict ? effects.wholeDistrictPercent : 0;
  if (offense === 0 && defense === 0) return effects;
  return {
    ...effects,
    unitOffensePercent: effects.unitOffensePercent + offense,
    defensePercent: effects.defensePercent + defense,
  };
}

function withGate(
  effects: CrewEffects,
  buildings: readonly Building[],
  /**
   * §B7: the gate on the ground this fight is being had on, when the defender holds it whole.
   *
   * A crew defending a district they have taken is standing behind *that* district's wall, not
   * behind the one at home four districts away. Passed in rather than folded into
   * `standingEffectsFor`, because that fold is per crew and this is a fact about *where the fight
   * is*: folding it there would have paid a captured gate out in every fight the crew took
   * anywhere, which is the unconditional-bonus mistake the whole §B7 rework was about.
   */
  capturedGateLevel = 0,
): CrewEffects {
  /*
   * The structure's own contribution is **not** added here, and that is the whole of this comment.
   *
   * It used to be, as `districtDefense(buildings)`, from the days when that figure was computed and
   * read by nothing. §B7 then gave the Gate an explicit percentage per level and folded it into
   * `standingEffectsFor`, which is where every consumer of a crew's standing reads it. Both were
   * live, so a defender carried its Gate twice: 2.5 points a level through the fold and another 6 a
   * level through this line, and the `defense_percent` modifications once as points and again as a
   * multiplier inside the rating. Measured at a level-4 Gate: 34 points reached the engine where
   * the battle page quoted the player 10.
   *
   * They are not the same quantity either. `districtDefense` is the flat "what a raider has to
   * beat" rating the structure dialog prints, and `defensePercent` is a percentage.
   */
  // No Gate, no bonus: the perk buys a better door, not a door. A captured gate is a door, so it
  // counts for the perk too: a Gatewright is worth the same on a wall they took as on one they built.
  const anyGate = districtDefense(buildings) > 0 || capturedGateLevel > 0;
  const fromPerks = anyGate ? effects.gateDefensePercent : 0;
  const captured = capturedGateDefensePercent(capturedGateLevel);
  return {
    ...effects,
    defensePercent: effects.defensePercent + captured + fromPerks,
  };
}

/**
 * Credits a fight's infamy to the faction the crew fights for (§J8).
 *
 * Takes the two economies rather than the earned figure, so what reaches the faction is exactly
 * what reached the player: `gainInfamy` clamps, and a faction crediting the pre-clamp number would
 * drift above the sum of what its members were actually paid.
 *
 * Only ever adds. Infamy leaves a player's wallet when they buy notoriety, and a team record that
 * fell when somebody spent would be a record of what the faction is holding rather than of what it
 * has done.
 */
function creditFaction(repos: Repositories, base: Base, before: EconomyState, after: EconomyState) {
  const earned = after.infamy - before.infamy;
  if (earned > 0) repos.factions.addInfamyEarned(base.ownerId, earned);
}

export interface ResolvedSiege {
  battle: ScheduledBattle;
  analysis: BattleAnalysis;
}

/**
 * Runs every fight whose mark has passed. Returns what it resolved, in mark order.
 *
 * Safe on any read path and safe to call twice: `markResolved` is the last thing it does per battle
 * and `due` filters on it, so a second call finds nothing.
 */
export function settleBattles(
  repos: Repositories,
  engine: SkirmishEngine,
  now: Date,
): ResolvedSiege[] {
  const resolved: ResolvedSiege[] = [];
  for (const battle of repos.sieges.due(now.toISOString())) {
    if (!isBattleDue(battle, now)) continue;
    /*
     * One fight, one transaction.
     *
     * A fight is not a single write. It springs the trap standing on the ground, runs the engine,
     * marks itself resolved, moves both sides' armies, hands over the location and pays out the
     * haul, and those happen in that order. Unwrapped, anything that threw between the first and
     * the last left the world in a state the rules do not describe: the clearest is the trap, which
     * `springAnyTrap` consumes *before* the engine runs, so an engine that threw took the
     * defender's trap with it and left the fight to run again later without one.
     *
     * Per fight rather than per sweep, so one unreadable battle cannot roll back the fights that
     * resolved cleanly beside it in the same tick.
     */
    const outcome = repos.tx(() => resolveOne(repos, engine, battle, now));
    if (outcome) resolved.push(outcome);
  }
  return resolved;
}

/**
 * The city's average player level, which is what a boost is worth (§D8).
 *
 * The same reading `blackmarket/shelf.ts` prices against, and bots are excluded for the same
 * reason: §A3's rival is a fixture rather than a customer.
 */
/**
 * The one boost this side applied to this fight, whatever kind it was.
 *
 * Two things can be on `boostId` and they are settled here rather than in two places: a §D7 name,
 * burned with infamy on this battle's own screen, or a crate of contraband the crew bought off the
 * black market days ago and *chose* to spend here.
 *
 * The crate is checked against the bag at the moment it is applied, not at the moment it was
 * picked. A player can set the same crate on two battles that land minutes apart, and the second
 * one has to find the bag empty rather than spending a syringe twice; `stashCount` is what makes
 * that a miss instead of a duplicate.
 */
function appliedBoost(
  repos: Repositories,
  baseId: string,
  deployment: BattleDeployment | undefined,
  force: Army,
  cityLevel: number,
  /** This side's own line rules, threaded to `oneBoost`. See the note there. */
  rules: LineRules,
): BattleBoost {
  const ids = deployment?.boostIds ?? [];
  if (ids.length === 0) return NO_BOOST;

  /*
   * Two names stack (maintainer request, 2026-09-12), and they stack by adding their percentages.
   *
   * Additive rather than multiplied, and the difference matters at the top of the Field
   * Commander's track: two forty-percent names compound to +96% and add to +80%, and the second
   * name is meant to be worth the first one again rather than worth more than it.
   */
  return ids.reduce<BattleBoost>((total, id) => {
    const one = oneBoost(repos, baseId, id, force, cityLevel, rules);
    return {
      offensePercent: total.offensePercent + one.offensePercent,
      defensePercent: total.defensePercent + one.defensePercent,
      moralePercent: total.moralePercent + one.moralePercent,
    };
  }, NO_BOOST);
}

/** One name or one crate, priced against the force it reaches. A crate is spent by reading it. */
function oneBoost(
  repos: Repositories,
  baseId: string,
  id: string,
  force: Army,
  cityLevel: number,
  /**
   * What this side counts as a fighting sheet (bug pass, 2026-09-23).
   *
   * `boostBundle` prices a narrow boost by the share of **the line** it reaches, and it defaulted
   * to `bareLineRules()` here, which leaves the porters out. The engine under `carriers_fight`
   * puts those same porters *in* the line, so the denominator and the fight disagreed: a crew
   * holding that channel stuffed the deployment with carriers, bought the narrowest name it
   * covered, and every body on the ground got the full percentage. Measured at 7x on a Plated
   * Overnight and 34x on The Colossus Walks. `boostCoverage`'s own note names the invariant this
   * broke: "a crew whose porters do fight passes it in, so the two answers cannot drift apart".
   */
  rules: LineRules,
): BattleBoost {
  const name = findBattleBoost(id);
  if (name) return boostBundle(name.effect, force, rules);

  const crate = findBlackMarketGood(id);
  const stash = repos.blackMarket.stashFor(baseId);
  if (!crate || stashCount(stash, id) <= 0) return NO_BOOST;
  // Spent, whatever happens next. A crate is applied to *a* battle, not to a won one, and leaving
  // it in the bag on a loss would make contraband a free retry.
  repos.blackMarket.writeStash(baseId, takeFromStash(stash, id));
  return blackMarketBoost(crate, cityLevel) ?? NO_BOOST;
}

/**
 * One side's standing effects with its contraband folded in.
 *
 * Additive, like every other source in this struct: two syringes and a held Fight Pit are simply
 * added, because multiplicative stacking is where a strategy game's numbers stop being explainable.
 */
function boosted(effects: CrewEffects, boost: BattleBoost): CrewEffects {
  // §A4: the Black Clinic. Syringes handed out before the fight, one unit brought back to
  // strength each. It lands on the same three channels a bought boost does rather than on a
  // parallel one, so the engine reads one number per channel and the report explains itself.
  const stims = Math.max(0, effects.battleStims);
  const fromGround = stims * STIM_PERCENT_EACH;
  if (boost === NO_BOOST && fromGround === 0) return effects;
  return {
    ...effects,
    unitOffensePercent: effects.unitOffensePercent + boost.offensePercent + fromGround,
    /*
     * A bought defence lands on the unit, not on the ground.
     *
     * It used to go to `defensePercent`, which is the "holding your ground" channel, and
     * `battle/effects.ts` reads that one only for `side.defending`. So an attacker who burned
     * `Stand Your Ground` (open to anybody, 200 infamy, "+15% defence for everything you send") or
     * carried the Reinforced Plating crate ("any fight you take it into") fought with exactly the
     * sheet they would have had without it. Nothing on the fight page gates the shelf by side, and
     * where this codebase means to gate by side it does, plainly: `traps` next to it is
     * `side === 'defender' ? ... : []`.
     *
     * `unitVitalityPercent` is the same quantity spent the same way, minus the defender-only
     * clause: `defensePercent` is itself folded into `vitalityBonus`. It also sits outside
     * `MAX_HELD_DEFENSE`, which is correct rather than incidental, since that ceiling is on what
     * *holding built ground* is worth and a syringe is not built ground.
     */
    unitVitalityPercent: effects.unitVitalityPercent + boost.defensePercent,
    unitMoraleFlat: effects.unitMoraleFlat + boost.moralePercent + stims,
  };
}

/**
 * What one syringe is worth, in percentage points of offense.
 *
 * Small on purpose. A Black Clinic at level 4 hands out five of them, which is a real edge and not
 * a fight decided before it starts: the location is a thumb on the scale, not a second army.
 */
export const STIM_PERCENT_EACH = 3;

/**
 * §D1: the officer leading one side, or null.
 *
 * Read off the **principal** crew's deployment row: the declarer for the attacker, whoever is
 * being attacked for the defender. A side can be several crews and only one officer may lead it,
 * so somebody has to own the slot; the principal is the crew whose `CrewEffects` the whole side
 * already fights under, which makes the officer's perks land on the same numbers as the rest of
 * that crew's book rather than on a second, disagreeing fold.
 *
 * Re-read against the roster at the mark rather than trusted from the row. An id written sixteen
 * hours ago can name somebody who has since been released, or who came back hurt from an earlier
 * fight, and an injured officer is out: §D4 says their services are off, and leading is a service.
 */
function leaderFor(
  repos: Repositories,
  battle: ScheduledBattle,
  side: BattleSide,
  base: Base,
  now: Date,
): Commander | null {
  const officerId = repos.sieges.deployment(battle.id, side, base.id)?.officerId;
  if (!officerId) return null;
  const officer = base.commanders.find((candidate) => candidate.id === officerId);
  if (!officer || officerIsInjured(officer.injuredUntil, now)) return null;
  return officer;
}

/** An officer as the engine takes them. */
function asCombatant(officer: Commander): BattleOfficer {
  return { officerId: officer.id, name: officer.name, attributes: officer.attributes };
}

/**
 * §D4: whether each side's officer came home hurt.
 *
 * One draw per side, from a stream seeded on the battle and the side, so it is reproducible from
 * the row and settles the same on a second read. Drawn even when nobody led, so adding a leader to
 * one side cannot shift the other side's roll: a seeded stream that changes shape with the input
 * is a seed that stops replaying.
 *
 * The margin is the difference of the two surviving shares (`battleMargin`), so it says how the
 * fight *went* rather than how big it was. An officer taken off the field is injured whatever the
 * roll says: see `officerInjured`.
 */
function settleInjuries(
  battle: ScheduledBattle,
  outcome: SkirmishOutcome,
): Record<BattleSide, boolean> {
  const share = (side: SideAnalysis | undefined): number =>
    !side || side.committed <= 0 ? 0 : side.survived / side.committed;
  const attackerShare = share(outcome.analysis?.attacker);
  const defenderShare = share(outcome.analysis?.defender);

  const hurt = (side: BattleSide, ownShare: number, enemyShare: number): boolean => {
    const reported = outcome.officers[side];
    const roll = mulberry32(seedFrom(`${battle.seed}:officer:${side}`))();
    if (!reported) return false;
    return officerInjured(reported.fell, battleMargin(ownShare, enemyShare), roll);
  };
  return {
    attacker: hurt('attacker', attackerShare, defenderShare),
    defender: hurt('defender', defenderShare, attackerShare),
  };
}

/**
 * §C3: what a side's machines came home to, and what the other side gets for the rest.
 *
 * Per crew, not per side. A side can be several crews (`battle/side.ts`) and each row on it
 * holds its own machines, so settling the declarer's row alone left an ally's Cheese Wagon on a
 * deployment row for ever: never wrecked, never home, and gone from their yard. Each row's
 * survivors are its share of the side's, split the way the units are (`splitSurvivors`).
 *
 * Only the machines somebody was riding are at risk. `loadable` trims the row's set to what the
 * units could fill, fastest first, and the rest never left the yard in any sense that matters:
 * an empty truck cannot be wrecked by killing everybody on it, and it cannot hand the enemy
 * infamy for a seating plan. A row that fielded nobody gets everything back for the same reason.
 *
 * Writes the survivors straight back onto each base's fleet and clears the row's, so a fight that
 * has been settled cannot hand the same machines back twice on a second read. Returns what was
 * destroyed, which is what the *enemy's* infamy is priced off, and who lost what, for the receipt.
 */
function settleSideVehicles(
  repos: Repositories,
  rows: readonly BattleDeployment[],
  survivors: Army,
  /** The fight's own instant, so this fold answers about the same moment every other one does. */
  now: Date,
): { destroyed: Fleet; lostBy: Map<string, Fleet> } {
  const shares = splitSurvivors(rows, survivors, (row) => mergeArmies(row.army, row.perimeter));
  let destroyed: Fleet = {};
  const lostBy = new Map<string, Fleet>();
  for (const row of rows) {
    if (row.baseId === null || Object.keys(row.vehicles).length === 0) continue;
    // The row's own crew, read once: their `any_ride` holding decides who filled a seat, and their
    // yard is what the survivors go back into. Per row rather than per side, because a side can be
    // several crews and each of them holds their own ground (`battle/side.ts`).
    const owner = repos.bases.findById(row.baseId);
    const anyRide = owner ? standingEffectsFor(repos, owner, now).anyRide : false;
    const fielded = mergeArmies(row.army, row.perimeter);
    // Unit slots on both sides of the share, because that is what the seats were sold in. Counting
    // heads here made a machine's survival turn on a different currency from the one that decided
    // who got on it, so a column of one Colossus and ten Razors read as 1/11 lost when it read as
    // 12/22 to the window that loaded it.
    const committed = unitSlotsUsed(fielded);
    const survived = unitSlotsUsed(shares.get(row.baseId) ?? {});
    // Seats, not heads: a sheet that will not ride (§C3, `no_ride`) fills none, so counting it
    // here kept a machine on the road that nobody was ever in. A crew that walked a Colossus to a
    // fight beside one truck lost the truck on a mauling and paid the enemy thirty infamy for a
    // seating plan.
    const riding = loadable(row.vehicles, ridingGroups(fielded, anyRide));
    const idle = removeFleet(row.vehicles, riding);
    const lost = committed <= 0 ? {} : wrecked(riding, survived / committed);
    const home = mergeFleets(idle, removeFleet(riding, lost));

    repos.sieges.putDeployment({ ...row, vehicles: {} });
    if (Object.keys(home).length > 0) {
      const yard = owner?.fleet ?? {};
      repos.bases.updateFleet(row.baseId, mergeFleets(yard, home));
    }
    if (Object.keys(lost).length > 0) {
      destroyed = mergeFleets(destroyed, lost);
      lostBy.set(row.baseId, lost);
    }
  }
  return { destroyed, lostBy };
}

/**
 * "1 Cheese Wagon, 2 Scrappy": what a receipt says was wrecked.
 *
 * The article comes off the name here. Every machine is `The Something` since 2026-09-20, and a
 * count already stands where the article would: `2 The Scrappy` is not a thing anybody writes.
 */
function describeFleet(fleet: Fleet): string {
  return Object.entries(fleet)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([id, count]) => `${count} ${vehicleNoun(findVehicle(id)?.name ?? id)}`)
    .join(', ');
}

/** The roster with one officer laid up for a day. Written by the settler and nowhere else. */
function withInjury(commanders: readonly Commander[], officerId: string, now: Date): Commander[] {
  return commanders.map((officer) =>
    officer.id === officerId ? { ...officer, injuredUntil: officerRecoveryAt(now) } : officer,
  );
}

/**
 * One side's rows with its recovered dead moved back into the living.
 *
 * Row by row rather than on the totals alone: the report's unit table is what a player reads to
 * decide which of their units is worth fielding again, and a table whose rows do not add up to the
 * side's own figures is worse than one that is merely stale. `lost` never goes below zero and
 * never gives back more than that row lost, so a recovery list that names a unit the row does not
 * have cannot invent a survivor.
 */
function withRecovered(side: SideAnalysis, recovered: Army): SideAnalysis {
  if (forceSize(recovered) === 0) return side;
  const units = side.units.map((unit) => {
    const back = Math.min(unit.lost, Math.max(0, recovered[unit.unitId] ?? 0));
    return back === 0 ? unit : { ...unit, lost: unit.lost - back, survived: unit.survived + back };
  });
  return {
    ...side,
    units,
    lost: units.reduce((sum, unit) => sum + unit.lost, 0),
    survived: units.reduce((sum, unit) => sum + unit.survived, 0),
  };
}

function resolveOne(
  repos: Repositories,
  engine: SkirmishEngine,
  battle: ScheduledBattle,
  now: Date,
): ResolvedSiege | null {
  const district = findDistrict(battle.target.districtId);
  const attacker = repos.bases.findById(battle.attackerBaseId);
  if (!district || !attacker) return null;

  const resident = residentOf(repos, district.id);
  const defenderBase = defendingBaseOf(repos, battle);
  /*
   * The roster that fights must be the roster that is written back.
   *
   * This took `resident`, which is `residentOf(district)`, while `applyOutcome` writes the
   * survivors to `defenderBase`, which is `defendingBaseOf(battle)`. Those are two different
   * lookups and they agree only while a district holds exactly one crew. Every account is planted
   * on the same opening ground and nothing stops two sharing a district, so when they diverged the
   * settle spent one crew's army and overwrote a second crew's roster with what was left: units
   * destroyed for a player who was not in the fight and conjured for one who was, in a single
   * write with no report to trace it by.
   *
   * `resident` is still the right answer for everything *about the place*: the buildings that take
   * damage and the stockpile that is looted belong to whoever lives there, which is what `breakIn`
   * uses it for. It is only the defending force that has to follow the roster being written.
   */
  const assembled = assemble(repos, battle, defenderBase);
  const fortification =
    battle.target.kind === 'location'
      ? (repos.city.control(battle.target.locationId)?.fortification ?? 0)
      : 0;

  const trap = springAnyTrap(repos, battle, assembled.attacking);
  /*
   * The black market's contraband, spent here and nowhere else.
   *
   * A boost is bought with infamy days before the fight and sits in a stash until one happens; this
   * is the moment it is worth anything, and the moment it is gone. Folded into the same
   * `CrewEffects` struct the crew's attributes, the ground and the Lab all write into, so the
   * engine needs no third parameter and a syringe stacks with everything else by the same rule.
   *
   * `moralePercent` lands on `unitMoraleFlat` one-for-one. Morale is already a 0..100 rating, so a
   * "+10% morale" syringe reading as +10 points is the interpretation that matches both the label
   * on the crate and the number it moves.
   */
  // What a crate is worth is a fact about the city, not about the crew that bought it: a shelf
  // priced and stocked for a veteran street hands out veteran contraband, and this is where that
  // lands. Read once for the fight, so both sides' bags are weighted by the same number.
  const cityLevel = cityLevelFor(repos);
  /*
   * Each side's standing, read once, before the boost rather than after it.
   *
   * The boost is folded *into* these effects a few lines down (`boosted`), so the read has to come
   * first, and the line rules a boost is priced against come out of the same read: `carriersFight`
   * is a holding, not something a syringe grants. Read once also means the two reads cannot
   * disagree, and it saves a second settle of the same fold per side.
   */
  const attackerStanding = standingEffectsFor(repos, attacker, now);
  const defenderStanding = defenderBase ? standingEffectsFor(repos, defenderBase, now) : undefined;
  // §D7: what a name bought for *this* fight, folded down against the force it actually reaches.
  // See `battle/boosts.ts`: a boost on one weight class is worth its own percentage times that
  // class's share of the unit slots standing on the ground. Contraband reaches the whole force.
  const attackerBoost = appliedBoost(
    repos,
    attacker.id,
    sideForce(repos, battle.id, 'attacker', battle.scheduledFor),
    assembled.attacking,
    cityLevel,
    attackerStanding,
  );
  const defenderBoost = defenderBase
    ? appliedBoost(
        repos,
        defenderBase.id,
        sideForce(repos, battle.id, 'defender', battle.scheduledFor),
        assembled.defending,
        cityLevel,
        defenderStanding ?? bareLineRules(),
      )
    : NO_BOOST;

  /*
   * §B7's two situational perks, applied where the situation is actually known.
   *
   * Neither can be folded at the source, because neither is a fact about the crew: whether an ally
   * turned up is a fact about *this fight*, and whether you hold the whole district is a fact about
   * the map at this moment. Folding them into `defensePercent` in `crew/effects.ts` would pay them
   * out in every fight, which is exactly the unconditional bonus the maintainer asked us to stop making.
   */
  /*
   * §B7: the wall on the ground this fight is on, if the defender took the district whole.
   *
   * Read once here, next to the other two situational conditions, because it is the same kind of
   * fact: not "what does this crew own" but "what is true of *this fight*". A crew defending a
   * district they hold outright fights behind its gate; the same crew attacking somewhere else
   * gets nothing from it.
   *
   * Zero while the district is still split, which is also what makes taking the last location
   * worth something beyond the location.
   */
  const defenderCapturedGateLevel =
    defenderBase && holdsDistrictWhole(repos, defenderBase.id, battle.target.districtId)
      ? gateFor(repos, battle.target.districtId).level
      : 0;

  const attackerAllied = alliedSideCount(repos, battle.id, 'attacker') > 1;
  const defenderAllied = alliedSideCount(repos, battle.id, 'defender') > 1;

  /*
   * §D1/§D5: who is leading, and what their book is worth because of it.
   *
   * `leading` is the spending step for the perk channels that pay nothing until an officer
   * actually goes. Applied here rather than in `standingEffectsFor` for the reason every
   * conditional channel exists: folding it at the source would pay a leading bonus out on every
   * fight, including the ones the officer sat at home for.
   */
  const attackerLead = leaderFor(repos, battle, 'attacker', attacker, now);
  const defenderLead = defenderBase
    ? leaderFor(repos, battle, 'defender', defenderBase, now)
    : null;

  /*
   * The Combine's legendary over this district, while he lives (`city/combine.ts`).
   *
   * Read at the settle off the control rows as they stand, which is the one reading that makes
   * killing him worth anything: a crew that took his plot yesterday fights the rest of the
   * district without his shadow today. Only the regime's ground carries one; a crew or the looters
   * holding the same plot does not inherit his power with it.
   */
  const presence =
    battle.defender.kind === 'government'
      ? combinePresenceOver(
          battle.target.districtId,
          controlsIn(repos, battle.target.districtId).map(({ control }) => control),
        )
      : undefined;

  const attackerEffects = situational(boosted(attackerStanding, attackerBoost), {
    allied: attackerAllied,
    wholeDistrict: holdsWholeDistrict(repos, attacker),
  });
  const attackerFinal = attackerLead ? leading(attackerEffects) : attackerEffects;
  const defenderEffects =
    defenderBase && defenderStanding
      ? situational(boosted(defenderStanding, defenderBoost), {
          allied: defenderAllied,
          wholeDistrict: holdsWholeDistrict(repos, defenderBase),
        })
      : undefined;
  const defenderFinal =
    defenderEffects && defenderLead ? leading(defenderEffects) : defenderEffects;

  const name = targetName(battle.target, resident);
  // Read once and shared: the engine fights on it and the report is stamped with it, so a card can
  // never describe ground the fight did not happen on.
  /*
   * The ground's name, as the crew who lives on it would give it.
   *
   * The one place the resident *is* the right viewer: a report about a raid on somebody's home
   * should say whose home it was, and both crews in that fight already know. The map is the screen
   * that numbers plots instead, because there the reader is a stranger to nine of them.
   */
  const ground = battlefieldOf(
    battle,
    districtDisplayName(district, {
      ownDistrictId: district.id,
      ownName: resident?.name ?? null,
    }),
    fortification,
  );
  const outcome: SkirmishOutcome = engine.resolve({
    seed: battle.seed,
    battleId: battle.id,
    attackerName: attacker.name,
    defenderName: defenderBase?.name ?? holderWord(battle.defender.kind),
    locationName: name,
    attacking: trap.attacking,
    defending: assembled.defending,
    battlefield: ground,
    attackerTerritory: attackerFinal,
    attackerUpgrades: attacker.unitLoadouts,
    attackerCohesionPercent: attackerFinal.cohesionPercent,
    defenderPerimeter: assembled.defenderRing,
    ...(attackerLead ? { attackerOfficer: asCombatant(attackerLead) } : {}),
    ...(defenderLead ? { defenderOfficer: asCombatant(defenderLead) } : {}),
    ...(presence ? { defenderPresence: presence.power } : {}),
    ...(defenderFinal && defenderBase
      ? {
          // The Gate, and everybody garrisoned inside the structures behind it (§A1, §A4).
          defenderTerritory: withGate(
            defenderFinal,
            defenderBase.buildings,
            defenderCapturedGateLevel,
          ),
          defenderCohesionPercent: defenderFinal.cohesionPercent,
          defenderUpgrades: defenderBase.unitLoadouts,
        }
      : {}),
  });

  // A trap that left nothing standing is the one case an attack does not happen at all. The engine
  // has still been run: it costs one seeded stream and it produces the report that says so.
  const attackerWon = !trap.wipedOut && outcome.winner === 'attacker';

  // §D4: settled before anything is written, because the roster write and the report both read it.
  const injured = settleInjuries(battle, outcome);

  const settlement = applyOutcome(repos, {
    battle,
    district,
    attacker,
    defenderBase,
    resident,
    assembled,
    committed: trap.attacking,
    trapKilled: trap.killed,
    outcome,
    attackerWon,
    now,
    lead: { attacker: attackerLead, defender: defenderLead },
    leadEffects: { attacker: attackerFinal, defender: defenderFinal },
    injured,
  });

  /*
   * §A4: anybody still on the road to this fight turns around. A column arriving at a battle that
   * has already been decided is not a state the game should be able to reach, and the units are
   * more use at home than deleted.
   *
   * **After the settlement, not before it.** `returnHome` re-reads the base and merges the column
   * into whatever the roster is; run first, that merge was then overwritten by `applyOutcome`
   * writing the roster from a snapshot taken before the recall, and the column was silently
   * deleted. Deployment stays open until a second before the mark and a march can take two hours,
   * so every late reinforcement to a distant fight hit this. Settling first means the units come
   * home to the roster the fight actually left behind.
   */
  recallOvertaken(repos, battle.id);

  const base = outcome.analysis ?? fallbackAnalysis(battle, name, outcome, attacker.name, ground);
  /*
   * §D4: the injury lands on the analysis, which is what withholds the report.
   *
   * `reportReaches` reads exactly this field, so an officer on a stretcher takes this side's report
   * with them: winner or loser, whoever else got home. The engine leaves `injured` false because it
   * has no margin and no stream; the settler is the only writer.
   */
  const withOfficer = (side: BattleSide, into: SideAnalysis): SideAnalysis => {
    // Written from the *outcome* rather than patched onto whatever the analysis carried, so the
    // settler is the single writer of this field and a stub engine with no ledger behind it still
    // reports the officer it was told about. `analyseBattle` fills it in with `injured: false`
    // because it has no margin and no stream to roll one with.
    const reported = outcome.officers[side];
    return reported === null ? into : { ...into, officer: { ...reported, injured: injured[side] } };
  };
  /*
   * §B10: the medics, on the report as well as on the roster.
   *
   * Only the winner's side, because only the winner recovers anybody, and only here because the
   * engine that built these rows does not know what this crew's Infirmary is worth. See
   * `Settlement.recovered`.
   */
  const mended = (side: BattleSide, into: SideAnalysis): SideAnalysis =>
    attackerWon === (side === 'attacker') ? withRecovered(into, settlement.recovered) : into;

  const analysis: BattleAnalysis = {
    ...base,
    winner: attackerWon ? 'attacker' : 'defender',
    trap: trap.note,
    attacker: {
      ...mended('attacker', withOfficer('attacker', base.attacker)),
      infamy: settlement.attackerInfamy,
    },
    defender: {
      ...mended('defender', withOfficer('defender', base.defender)),
      infamy: settlement.defenderInfamy,
    },
  };

  repos.sieges.markResolved(battle.id, now.toISOString(), analysis);
  repos.battles.insert({
    id: battle.id,
    attackerBaseId: attacker.id,
    targetDistrictId: district.id,
    targetPlaceId: battle.target.kind === 'location' ? battle.target.locationId : null,
    winner: attackerWon ? 'attacker' : 'defender',
    log: analysis.log,
    rewards: settlement.haul,
    seed: battle.seed,
    createdAt: now.toISOString(),
  });

  /*
   * §I1: fighting pays, win or lose, and it pays **both** crews.
   *
   * Last, after every other write, because `awardPlayerXp` is the single writer of `Base.level`
   * (INTERFACES R7) and the level a fight buys should be the one the crew ends the night on.
   *
   * The pre-settlement `Base` objects are safe to hand it: it reads `level` and `xpIntoLevel` and
   * writes only the progression row, none of which `applyOutcome` touches. Re-reading them would
   * be two queries to get the same two numbers back.
   *
   * Both sides, which is new. The routes this replaced paid the attacker only, because under an
   * instant fight the defender did not *do* anything. They were a number the attacker rolled
   * against. A declared fight is the opposite: the defender reads the call, moves people up, arms
   * the gate and turns out. §I1 pays for fighting, not for starting it.
   */
  awardPlayerXp(repos, attacker, attackerWon ? 'raidWon' : 'raidLost');
  if (defenderBase) awardPlayerXp(repos, defenderBase, attackerWon ? 'raidLost' : 'raidWon');

  /*
   * Feats, for both crews, for the same reason the XP is paid to both: a declared fight is
   * something the defender did as well.
   *
   * `attacked` is which side of this fight the crew was on rather than who started the war, so the
   * "win fights you called" and "turn back fights called on you" ladders can be different feats.
   * Infamy is tallied off the settlement rather than off the economy row, because the row has
   * already had it added and reading the difference back would be arithmetic on a number that a
   * perk percentage has moved.
   */
  tallyBattleResolved(repos, attacker.id, {
    attacked: true,
    won: attackerWon,
    kills: settlement.attackerKills,
  });
  tallyInfamyEarned(repos, attacker.id, settlement.attackerInfamy);
  if (defenderBase) {
    tallyBattleResolved(repos, defenderBase.id, {
      attacked: false,
      won: !attackerWon,
      kills: settlement.defenderKills,
    });
    tallyInfamyEarned(repos, defenderBase.id, settlement.defenderInfamy);
  }
  // Ground only. A district raid is a fight over a whole district and moves no control row, so
  // counting it as a capture would credit the ladder for a place nobody took.
  if (attackerWon && battle.target.kind !== 'district') {
    tallyCaptured(repos, attacker.id, battle.target.kind === 'gate' ? 'gate' : 'location');
  }

  /*
   * The Combine's ledger (maintainer, 2026-09-19): a section of the board that moves only when
   * the other side was the regime. The Combine's dead are whichever map holds the defender's
   * losses: the loser's `killed` when the attacker won, the winner's `winnerLosses` when it did
   * not (an NPC has no infirmary, so nothing in that map came back). `flawless` is the attacker's
   * own losses at zero, turncoats included: a unit that changed sides was lost.
   */
  if (battle.defender.kind === 'government') {
    const turned = Object.values(outcome.turned).reduce((total, count) => total + count, 0);
    tallyCombineFight(repos, attacker.id, {
      won: attackerWon,
      flawless: attackerWon && settlement.defenderKills === 0 && turned === 0,
      underLeader: presence !== undefined,
      killed: attackerWon ? outcome.killed : outcome.winnerLosses,
      turned,
      locationTaken: attackerWon && battle.target.kind === 'location',
    });
  }

  /*
   * The feats that are about *this* fight rather than about how many you have had.
   *
   * Every number here is read off what the settler already worked out, and two of them are read
   * the long way round on purpose. The force sizes come off `assembled`, which is the two lines
   * that stood at the mark, rather than off the analysis: a stub engine's ledger reports nobody
   * committed at all, and half the server suite injects one, so the odds would read as a walkover
   * in exactly the tests that drive a fight. The casualty figures are crossed over because
   * `attackerKills` is what the attacker *took off* the defender, which is the defender's losses.
   *
   * `fightingSlots` rather than `unitSlotsUsed`, each side under its own rules: a crew defends its
   * home with its whole roster and the porters in it never take a place in the line, so the raw
   * slot count was the size of a *warehouse* and not of a defence. See `battle/line.ts` for the
   * measurement. `simulate` has counted its own sides this way since the rule was written; this is
   * the feats board finally asking the same question the fight did.
   */
  /** §A5: whether a force has anything in it that makes the ground unbearable (`UnitSpec.loud`). */
  const hasLoud = (army: Army): boolean =>
    Object.entries(army).some(
      ([unitId, count]) => (count ?? 0) > 0 && findUnit(unitId)?.loud === true,
    );

  const attackerForce = fightingSlots(assembled.attacking, attackerFinal);
  // `bareLineRules` for the Combine's ground and for a holder with no crew sheet: nobody has
  // bought `carriers_fight` for a lot that has no owner.
  const defenderForce = fightingSlots(assembled.defending, defenderFinal ?? bareLineRules());
  tallyBattleShape(repos, attacker.id, {
    won: attackerWon,
    ownForce: attackerForce,
    enemyForce: defenderForce,
    killed: settlement.attackerKills,
    lost: settlement.defenderKills,
    // §E: what this side's jammers laid on the other, read off the engine rather than recomputed
    // here, so the counter is paid on the figure the rounds were fought at.
    jam: outcome.jam.attacker,
    // §A4: only the crew that called the fight can have woken a cell into it.
    planted: battle.wokeSleepers,
    // §A5: whether this side put the racket on the other's ground (`UnitSpec.loud`). Read off
    // the force that actually stood there rather than off what was sent, so a crew whose
    // Anodics never arrived is not paid for a din nobody heard.
    loud: hasLoud(assembled.attacking),
  });
  if (defenderBase) {
    tallyBattleShape(repos, defenderBase.id, {
      won: !attackerWon,
      ownForce: defenderForce,
      enemyForce: attackerForce,
      killed: settlement.defenderKills,
      lost: settlement.attackerKills,
      jam: outcome.jam.defender,
      // A defender never plants: a cell goes on ground its crew does **not** hold.
      planted: false,
      loud: hasLoud(assembled.defending),
    });
  }

  /*
   * A break-in, counted for whichever crew won it and for neither when nobody did.
   *
   * Only a whole-district target is one: taking a location or a gate is a capture and has its
   * counters two lines up. A raid the defence turned back is a repelled raid rather than a raid,
   * which is why this is two calls and not one with the side flipped.
   */
  if (battle.target.kind === 'district') {
    if (attackerWon) tallyDistrictRaid(repos, attacker.id, 'forced');
    else if (defenderBase) tallyDistrictRaid(repos, defenderBase.id, 'held');
  }

  // The trap goes to whoever buried it, which may be an ally rather than the crew being attacked.
  if (trap.ownerBaseId) tallyTrapKills(repos, trap.ownerBaseId, forceSize(trap.killed));
  // ...and the ring to the defender, because only a defender has one and only a winner's fights.
  if (!attackerWon && defenderBase) {
    tallyRunnersCaught(repos, defenderBase.id, forceSize(outcome.perimeterCaught));
  }
  // The rout: everybody the winner made run, home or caught (`units_routed`).
  const routed = forceSize(mergeArmies(outcome.fled, outcome.perimeterCaught));
  if (attackerWon) tallyUnitsRouted(repos, attacker.id, routed);
  else if (defenderBase) tallyUnitsRouted(repos, defenderBase.id, routed);

  return { battle: { ...battle, resolvedAt: now.toISOString() }, analysis };
}

interface SettleInput {
  battle: ScheduledBattle;
  district: District;
  attacker: Base;
  defenderBase: Base | undefined;
  resident: Base | undefined;
  assembled: Assembled;
  /** What the attacker actually had left to fight with once the trap had gone off. */
  committed: Army;
  /** ...and who the trap took, which is off `committed` already and still owed to the ledger. */
  trapKilled: Army;
  outcome: SkirmishOutcome;
  attackerWon: boolean;
  now: Date;
  /** §D1: who led each side, or null. Re-read at the mark by `leaderFor`. */
  lead: Record<BattleSide, Commander | null>;
  /** ...and that side's folded book, `leading` already spent. Undefined where there is no crew. */
  leadEffects: { attacker: CrewEffects; defender: CrewEffects | undefined };
  /** §D4: whether each side's officer came home hurt. */
  injured: Record<BattleSide, boolean>;
}

interface Settlement {
  attackerInfamy: number;
  defenderInfamy: number;
  haul: PartialResources;
  /**
   * Units each side took off the other, for the feat counters (maintainer request, 2026-09-13).
   *
   * Carried out of here rather than recounted at the call site because the two casualty lists are
   * assembled from the outcome plus the trap plus the ring, and a second reading downstream is the
   * exact bug the doc block above this function warns about.
   */
  attackerKills: number;
  defenderKills: number;
  /**
   * The winner's dead that the medics handed back, by unit id.
   *
   * Out of here for the same reason the kill counts are: this is the only place that knows what
   * the crew's medicine and its Infirmary were worth, and the report is assembled by the caller.
   * Empty for the loser's side, which recovers nobody: a routed force leaves its wounded where
   * they fell.
   */
  recovered: Army;
}

/**
 * Everything the fight changed: rosters, ground, gates, structures, stock and the two ledgers.
 *
 * One function rather than five, because every one of these writes has to see the same pair of
 * casualty lists, and a second reading of the outcome downstream is how a unit ends up dead on the
 * roster and alive in the garrison.
 */
function applyOutcome(repos: Repositories, input: SettleInput): Settlement {
  const { battle, district, attacker, defenderBase, assembled, outcome, attackerWon, now } = input;

  // Everything either side's ground is worth, read once. Four separate reads of the same fold were
  // already happening in this function; the two below are the same numbers with a name on them.
  // At the fight's own instant, like the two folds `resolveOne` already reads at `now`: both are
  // step functions of time (an officer is out until `injuredUntil`, a raid's disruption until it
  // expires), so the same fold read at the wall clock is a second, disagreeing answer.
  const attackerGround = standingEffectsFor(repos, attacker, now);
  const defenderGround = defenderBase ? standingEffectsFor(repos, defenderBase, now) : null;

  /*
   * §F2 and §B10: the medics take some of the *winner's* dead off the list before it is applied.
   *
   * Only ever the winner's, which is both the maintainer's rule for the Infirmary ("wins only") and the
   * one that was already true here: a routed force leaves its wounded on the field, which is what
   * routing means.
   *
   * Two sources, added. `casualtyRecoveryPercent` is the crew's own medicine and whatever ground
   * they hold; `infirmaryRecoveryPercent` is the structure, and it was authored, drawn on the base
   * screen and read by nothing at all until this line. `recoverCasualties` caps the total at
   * `MAX_CASUALTY_RECOVERY`, so a crew with a deep Infirmary and a chief medic does not walk
   * everybody home.
   */
  const winnerBase = attackerWon ? attacker : defenderBase;
  const winnerRecovery =
    (attackerWon
      ? attackerGround.casualtyRecoveryPercent
      : (defenderGround?.casualtyRecoveryPercent ?? 0)) +
    (winnerBase ? infirmaryRecoveryPercent(winnerBase.buildings) : 0);
  /*
   * The Executioner's bodies come off before the medics see the list, and go back on after.
   *
   * His card says an attacker brought to his line is finished where it stands, and an
   * Infirmary that walks those home makes it false. The winner's losses are the only list the
   * medics work from, and a *winning attacker* carries every executed body inside them.
   *
   * Re-measured on 2026-09-21 after the damage walk became a per-body ledger, because the first
   * figure here was taken before it and badly understated the scale: over 1400 Blacksite fights,
   * 565 of them winning attacks, **1341 of 1481** winning-attacker losses were executed, which is
   * 90.5%. Under his line nearly everything the fire kills is finished rather than wounded, so on
   * his ground the Infirmary is close to switched off rather than shaved. That is the card doing
   * what it says; it is recorded here so the next reader does not size the exemption off a
   * number that was already wrong by a factor of ten.
   *
   * `removeForce` here rather than a smaller recovery percentage, because the two are not the same
   * claim: a percentage would still hand some of them back, just fewer, and what is wanted is that
   * these particular bodies are not candidates at all. Only ever the attacker's, since he only
   * ever fires at the side opposite him, so this is a no-op on a defence that held.
   */
  const executed = outcome.executedForce;
  const recoverable = attackerWon
    ? removeForce(outcome.winnerLosses, executed)
    : outcome.winnerLosses;
  const winnerDead = attackerWon
    ? mergeArmies(recoverCasualties(recoverable, winnerRecovery), executed)
    : recoverCasualties(recoverable, winnerRecovery);
  /*
   * ...and who they were, which the report needs as much as the roster does.
   *
   * `analyseBattle` runs inside the engine and the engine has never heard of this crew's Infirmary,
   * so the side it builds counts every one of the winner's dead as dead. The recovery happens here,
   * one line up, and the settler patched only the officer and the infamy onto that analysis. So the
   * roster handed the survivors back and the report a player reads afterwards still listed them as
   * casualties: two numbers for one fight, and the one on the screen was the wrong one.
   */
  const recovered = removeForce(outcome.winnerLosses, winnerDead);
  const attackerDead = attackerWon ? winnerDead : outcome.killed;
  const defenderDead = attackerWon ? outcome.killed : winnerDead;

  /*
   * Directive Xero's turncoats (`outcome.turned`) are off the attacker's books for good.
   *
   * They are in `committed` (they marched) and in neither `killed` nor `fled` (the engine settles
   * them as nobody's), so without this line a winning attacker would walk home with the units
   * that fought against them. Taken off before the dead are, so a unit cannot be both.
   */
  const stillTheirs = removeForce(input.committed, outcome.turned);
  const attackerSurvivors = attackerWon ? removeForce(stillTheirs, attackerDead) : outcome.fled;

  /**
   * §A4: the survivors stay on the ground they took, because the attacker said so before the
   * fight.
   *
   * Only on a **won location**, and the two qualifications are both load-bearing. A lost fight has
   * nothing to hold, and a gate or a raid is not a thing anybody can stand on afterwards: the
   * breach is a window in time rather than a position on the map, so there is no garrison for it to
   * be.
   */
  const holds = attackerWon && battle.target.kind === 'location' && battle.holdAfterCapture;
  const holding = holds ? attackerSurvivors : {};

  /*
   * The rings, less what the winner's paid to hold the line.
   *
   * A ring still never takes the ground, so it comes home whichever way the attacker answered the
   * hold-after-capture question. What changed is that it is no longer free: meeting a withdrawal is
   * a second battle now (`@frontline/shared`, `battle/perimeter.ts`) rather than a catch-rate, so
   * the ring that fought one has casualties. Only the winner's does: a beaten side's ring never
   * fights, which is the same rule that decides whether it does anything at all, so it walks away
   * whole and `perimeterLosses` is not its to pay.
   */
  const defenderRingHome = attackerWon
    ? assembled.defenderRing
    : removeForce(assembled.defenderRing, outcome.perimeterLosses);

  /*
   * Everybody who died, as opposed to everybody the engine killed.
   *
   * Three lists go into each side's ledger and only one of them comes out of the round loop: the
   * engine's dead, the trap's dead (off the attacking force before a shot was fired), and the ring
   * that paid for meeting a withdrawal. All three are units that did not walk off the field, and
   * §I1 prices exactly that, so all three are worth infamy to the other crew and a Bone Market
   * refund to their own.
   *
   * Kept apart from `attackerDead` and `defenderDead`, which the roster arithmetic above has
   * already spent: `committed` is the force the trap left standing and `*RingHome` has already had
   * the ring's losses taken off it, so folding these in up there would kill them a second time.
   * The medics do not reach either addition: a ring meets a withdrawal away from the line, and a
   * trap goes off before the crew that set it is anywhere near the wounded.
   */
  const attackerFallen = mergeArmies(attackerDead, input.trapKilled);
  const defenderFallen = attackerWon
    ? defenderDead
    : mergeArmies(defenderDead, outcome.perimeterLosses);

  const attackerHome = holds ? {} : attackerSurvivors;

  /**
   * §C3: who lived, as opposed to where they went.
   *
   * `attackerHome` answers "what walks back into the district", which is deliberately empty of the
   * line when the crew stays to hold the ground. The machines are a different question: what a
   * wreck is priced on is the share of the force that **survived the fight**, and a unit standing
   * on the location it just took survived it.
   *
   * Handing `attackerHome` to the vehicle settle conflated the two, and with no ring behind the
   * fight the two are not close: a crew that won a held location without a single casualty read as
   * a force that came back as nobody, so `wrecked` wrote off every machine that carried them and
   * the loser was paid their whole capacity in infamy for it. Winning the thing you asked to hold
   * emptied your yard.
   */
  const attackerLived = attackerSurvivors;

  /*
   * Whose survivors these are.
   *
   * A side can be several crews now (`battle/side.ts`), and the engine answers for the side as a
   * whole. Handing `attackerHome` to the declarer would quietly transfer an ally's army to whoever
   * called the fight: they sent units, the units lived, and they would never come back.
   *
   * Split proportionally to what each crew committed, counting the ring as well as the line,
   * because both are in `attackerHome`. The declarer's share carries on through `attackerNext`;
   * everybody else is paid out below.
   */
  const attackerRows = repos.sieges.side(battle.id, 'attacker');
  const attackerShares = splitSurvivors(attackerRows, attackerHome, (row) =>
    mergeArmies(row.army, row.perimeter),
  );
  const attackerOwnHome = attackerShares.get(attacker.id) ?? {};
  const defenderSurvivors = attackerWon
    ? outcome.fled
    : removeForce(assembled.defending, defenderDead);

  /*
   * The same split for the defending side, which never had one.
   *
   * `/factions/reinforce` puts an ally's column on either side, and the attacker's allies were
   * paid back through `attackerShares` above while the defender's allies were not: every survivor
   * on the defending side was written to the principal's roster, or stood as the principal's
   * garrison on a held location. An ally who sent thirty Razors to hold a friend's ground and won
   * never saw them again. The line and the ring are split separately, each by what every row
   * committed to it, and the principal's share carries on through the books below; the allies'
   * shares walk home in the loop beside the attacker's.
   *
   * A home defence (`fromHomeRoster`) has no rows of its own for the principal, so the split
   * would hand the principal nothing: in that case the whole of the line is the principal's, as
   * it was, and only the rows that exist (the allies') are paid out of it.
   */
  const defenderRows = repos.sieges.side(battle.id, 'defender');
  /*
   * Whose row is the principal's. A crew's own deployment is keyed by its id; the Combine's and
   * the looters' row, the garrison the ground came with, is keyed `null`, and it is the principal
   * when nobody's crew holds the ground. Only a faction-mate can reinforce, so an NPC defence
   * never has an ally row beside it.
   *
   * The principal's commitment is not only its row: `assemble` folds in the location's garrison,
   * or the home roster on a raid, or the district's garrisons on NPC ground, none of which has a
   * deployment row. So the split runs over the allies' rows as they stand plus one row standing
   * for the principal, holding everything on the side that no ally sent. Split by row over the
   * side as a whole, an ally who sent five Razors against a home roster of twenty would have
   * been handed every surviving Razor.
   */
  const principalKey: string | null = defenderBase?.id ?? null;
  /*
   * An ally's posting on the ground is a row of theirs in the line (2026-09-22): folded into
   * their deployment row when they have one, so the split hands each crew one share. What is
   * left of a posting after a held fight goes back onto the ground; after a lost one, home.
   */
  const postedIds = new Set(assembled.posted.map((row) => row.baseId));
  const deployedAllies = defenderRows.filter((row) => row.baseId !== principalKey);
  const allyRows: BattleDeployment[] = [
    ...deployedAllies.map((row) => {
      const posting = assembled.posted.find((posted) => posted.baseId === row.baseId);
      return posting ? { ...row, army: mergeArmies(row.army, posting.army) } : row;
    }),
    ...assembled.posted
      .filter((posted) => !deployedAllies.some((row) => row.baseId === posted.baseId))
      .map((posted) => ({
        ...emptyDeployment(battle.id, posted.baseId, 'defender', battle.scheduledFor),
        army: posted.army,
      })),
  ];
  const alliesSent = allyRows.reduce<Army>((total, row) => mergeArmies(total, row.army), {});
  const alliesRinged = allyRows.reduce<Army>((total, row) => mergeArmies(total, row.perimeter), {});
  /*
   * The principal's own machines, carried onto the synthetic row (bug pass, 2026-09-23).
   *
   * `emptyDeployment` has an empty yard, and the vehicle settle used to be handed the raw
   * `defenderRows` for exactly that reason. That was the bug: `splitSurvivors` skips a unit id no
   * row committed, so on any defence where part of the line came from a garrison, an allied
   * posting or the home roster, the survivors of the row-less principal were credited to whoever
   * *did* have a row, that row's share came out above 1, and `wrecked` clamped the loss to zero.
   * The defending side's machines were effectively unwreckable, and the attacker was never paid
   * the infamy for them. With the yard on the row, the same `splitRows` can settle the line, the
   * ring and the vehicles, which is what makes those three agree.
   */
  const principalDeployed = defenderRows.find((row) => row.baseId === principalKey);
  const principalRow: BattleDeployment = {
    ...emptyDeployment(battle.id, principalKey, 'defender', battle.scheduledFor),
    ...(principalDeployed ? { vehicles: principalDeployed.vehicles } : {}),
    army: removeForce(assembled.defending, alliesSent),
    perimeter: removeForce(assembled.defenderRing, alliesRinged),
  };
  const splitRows = [principalRow, ...allyRows];
  const defenderLineShares = splitSurvivors(splitRows, defenderSurvivors, (row) => row.army);
  const defenderRingShares = splitSurvivors(splitRows, defenderRingHome, (row) => row.perimeter);
  const principalLine = defenderLineShares.get(principalKey) ?? {};
  const principalRing = defenderRingShares.get(principalKey) ?? {};

  /*
   * §D8: the one-off infamy some ground pays the moment it changes hands.
   *
   * The Statue of the Revolutionist, and so far only it: taking nine metres of bronze off the
   * Combine is a statement the whole city hears, and it is an *event* rather than a rate. It was
   * authored on the location and read by nothing at all, which made it exactly what the catalogue
   * forbids: a number on a card that never moves.
   *
   * Added to the fight's own infamy rather than banked separately, so a crew's Graveyard
   * multiplies it like everything else that earns them a name (`bankOutcome`).
   */
  const taken =
    attackerWon && battle.target.kind === 'location'
      ? findLocation(battle.target.locationId)
      : undefined;
  const captureInfamy = taken ? (LOCATION_CATALOG[taken.kind].captureInfamy ?? 0) : 0;

  /*
   * §C3: the machines, and what the other side earns for wrecking them.
   *
   * *"If every unit riding a vehicle dies, the vehicle is destroyed."* Riders are not tracked
   * individually and could not honestly be: a column is a force rather than a seating plan. What
   * `wrecked` reads is the share of the force that came home, so a side that was wiped loses
   * everything it committed and a side that walked it off loses nothing. Whatever survives goes
   * straight back in the yard, which is the other half of the maintainer's rule.
   *
   * The infamy is the machines' **capacity**, not their price: a Cheese Wagon is a bigger thing to
   * have destroyed than a Scrappy whatever either cost to build, and capacity is what the fight
   * actually took off the board.
   */
  const attackerVehicles = settleSideVehicles(repos, attackerRows, attackerLived, now);
  const defenderVehicles = settleSideVehicles(
    repos,
    // `splitRows`, not the raw deployment rows: see the note on `principalRow` for the survivors
    // that went to the wrong crew when these two disagreed.
    splitRows,
    mergeArmies(defenderSurvivors, defenderRingHome),
    now,
  );

  /*
   * The ledger (maintainer, 2026-09-23): a kill in the fight pays whole, a rout pays half, and
   * every death at the ring pays half.
   *
   * The engine's `killed` is the loser's whole dead, the ring's catch included, so the fight's
   * own kills are that less `perimeterCaught`. The loser's runners are everybody who broke:
   * the ones who got home (`fled`) and the ones the ring then killed (`perimeterCaught`), and
   * both pay the rout's half; the caught pay the ring's half on top, which makes the whole. The
   * ring's own dead pay their half to the attacker. Only the defender has a ring, so the ring's
   * figures are all zero when the attacker won.
   */
  const loserRan = mergeArmies(outcome.fled, outcome.perimeterCaught);
  /*
   * Summed in half-points and floored **once** (bug pass, 2026-09-23).
   *
   * The two halves are only a whole if nothing rounds between them, and they used to be floored
   * one at a time: a single caught one-slot runner was promised a half for running and a half for
   * dying and paid nothing at all, which is precisely the "worth nothing" that `FLED_INFAMY_SHARE`
   * exists to prevent. Every mixed case lost a flat half the same way.
   */
  const attackerInfamy = Math.floor(
    attackerWon
      ? infamyForKills(defenderFallen) +
          infamyPointsForFled(loserRan) +
          captureInfamy +
          vehicleInfamy(defenderVehicles.destroyed)
      : infamyForKills(defenderDead) +
          infamyPointsForRingDead(outcome.perimeterLosses) +
          vehicleInfamy(defenderVehicles.destroyed),
  );
  const defenderInfamy = Math.floor(
    attackerWon
      ? infamyForKills(attackerFallen) + vehicleInfamy(attackerVehicles.destroyed)
      : infamyForKills(removeForce(attackerFallen, outcome.perimeterCaught)) +
          infamyPointsForFled(loserRan) +
          infamyPointsForRingDead(outcome.perimeterCaught) +
          vehicleInfamy(attackerVehicles.destroyed),
  );

  /**
   * §A4: the Bone Market. A share of what you lost comes back as caps rather than as nothing.
   *
   * Both sides, and on a loss as well as a win: the whole point of the location is that a bad
   * afternoon is not a total write-off, and paying out only on a victory would make it a bonus for
   * winning, which the game already has several of.
   */
  /*
   * The Bone Market's refund (§A4), and it is *added to* whatever else the fight paid rather than
   * being one of the things that might have paid.
   *
   * Written as an accumulator for a reason. The first version seeded `haul` with the refund and
   * then let the break-in path assign over it, so a won raid, the one fight that pays anything,
   * was the one fight that threw the refund away. And the credit itself only ran inside that same
   * branch, so on every other path the refund was computed, reported on the battle card, and never
   * banked. A mechanic that is visible and inert is worse than one that is absent.
   */
  let haul: PartialResources = refundFor(attackerFallen, attackerGround.salvageRefundPercent);
  /**
   * §A4: whether the raiders actually got into a structure, which is what leaves the place limping.
   *
   * Carried out of {@link breakIn} rather than derived from the target, because a `district` call
   * on ground nobody lives on loots nothing and must disrupt nothing either.
   */
  let raided = false;
  /*
   * §D5: what the officer's own book adds to the take, when they led and the fight was won.
   *
   * Spent here rather than folded into `lootCapacityPercent`, because "a percentage more loot" and
   * "a bigger truck" are different promises: the truck is already full on most raids, and a crew
   * that bought the perk would have measured nothing. Applied at the end, to everything the fight
   * paid, so the refund and the break-in are both scaled by it.
   */
  const leadLoot =
    attackerWon && input.lead.attacker ? input.leadEffects.attacker.leadLootPercent : 0;
  const attackerBanked = bankOutcome(
    attacker.economy,
    district,
    attackerWon,
    attackerInfamy,
    now,
    attackerGround.infamyGainPercent,
  );
  creditFaction(repos, attacker, attacker.economy, attackerBanked);
  let attackerNext: Base = {
    ...attacker,
    army: mergeArmies(attacker.army, attackerOwnHome),
    economy: attackerBanked,
  };

  // --- the ground ---
  if (battle.target.kind === 'location') {
    if (attackerWon) {
      /*
       * §A4: whether the crew losing this location was holding the whole district behind it.
       *
       * Read *before* the write, because that is the state the write destroys: after the location
       * changes hands the predicate always answers false, and "false now" cannot tell a district
       * that has just been broken up from one that was already split. `resetGateOnDistrictLost`
       * below is what turns it into the gate rule.
       */
      const losing = repos.city.control(battle.target.locationId);
      const loser = losing?.holder;
      const loserBaseId = loser?.kind === 'crew' ? loser.baseId : null;
      // Whatever the ground had been worked up to, which the attacker now owns. A location with no
      // control row at all has never been worked, so 1.
      const previousLevel = clampLevel(losing?.level ?? 1);
      const loserHeldWhole =
        loserBaseId !== null && holdsDistrictWhole(repos, loserBaseId, battle.target.districtId);

      // A captured position is not a captured position *plus* the enemy's diggings. The garrison is
      // whoever the attacker left standing there on purpose, and nobody otherwise.
      repos.city.put({
        locationId: battle.target.locationId,
        holder: { kind: 'crew', baseId: attacker.id },
        // §A4: **a capture keeps the location's level.** You take the ground as it stands. Nine
        // levels of work on a Gas Station do not evaporate because somebody else walked onto the
        // forecourt: they change hands, which is what makes a worked location a target rather
        // than a sandcastle. It used to reset to 1, and that made the whole ladder a tax on
        // holding anything near a border.
        //
        // The *unfinished* level does not carry: `upgradingUntil` is cleared, so an upgrade the
        // loser had paid for and not yet banked is lost with the location. Banked work transfers,
        // work in progress does not.
        //
        // What still resets is the district gate, and that is a different rule in a different
        // place: `resetGateOnDistrictLost` in `city/gates.ts`, below.
        level: previousLevel,
        upgradingUntil: null,
        fortification: 0,
        fortifyingUntil: null,
        garrison: holding,
      });

      /*
       * §A4: a district lost while its gate is down takes the gate with it.
       *
       * The only place in the game where a location changes hands, so the only place the rule has
       * to be run. `city/upgrade.ts` and `city/actions.ts` write control rows too, but neither
       * touches the holder: they move a level and a dig clock on ground the same crew still holds.
       */
      if (loserBaseId !== null) {
        resetGateOnDistrictLost(repos, {
          districtId: battle.target.districtId,
          holderBaseId: loserBaseId,
          heldWholeBefore: loserHeldWhole,
          now,
        });
      }
    } else {
      // Whoever held it holds it, and whoever of *theirs* is left standing is its garrison now,
      // including anybody they sent up for the fight. An ally's survivors are not theirs to keep:
      // a garrison belongs to the ground's holder, and the allies walk home below.
      // ...plus whoever changed sides under Directive Xero and is still standing: they are his
      // now, and his means the ground's (`outcome.turnedAlive`).
      repos.city.setGarrison(
        battle.target.locationId,
        mergeArmies(principalLine, outcome.turnedAlive),
      );
    }
  } else if (attackerWon) {
    const broken = breakIn(repos, input, winnerDead);
    haul = mergeResources(haul, broken.haul);
    raided = broken.raided;
  }

  if (leadLoot > 0) haul = scaledSpoils(haul, leadLoot);

  // Banked once, on every path. Nothing above this line touches the stockpile.
  if (Object.keys(haul).length > 0) {
    attackerNext = { ...attackerNext, resources: addResources(attackerNext.resources, haul) };
  }

  // --- the defender's own books ---
  if (defenderBase) {
    /*
     * A home defence's survivors *are* the roster. They were taken out of it to fight.
     *
     * Everywhere else the roster is what stayed behind, plus whatever comes back. A location the
     * defender held keeps its survivors as its garrison (`setGarrison` above), so those must not be
     * written home as well; that is the only case where a survivor does not come back, and it used
     * to be spelled `attackerWon ? survivors : {}`, which says the same thing for a location and
     * the wrong thing for a gate. A column sent to defend a gate and winning it was dropped on the
     * floor: it had left the roster when it marched and nothing put it back.
     */
    const stayedAsGarrison = battle.target.kind === 'location' && !attackerWon;
    if (assembled.atTheGate) {
      // The door (2026-09-22). Held: the survivors stay at the gate, and the ring, which came up
      // from the district, goes back to it. Fallen: whoever is left falls back into the district.
      repos.bases.updateGateArmy(defenderBase.id, attackerWon ? {} : principalLine);
      repos.bases.updateArmy(
        defenderBase.id,
        mergeArmies(
          defenderBase.army,
          attackerWon ? mergeArmies(principalLine, principalRing) : principalRing,
        ),
        defenderBase.trainingQueue,
      );
    } else {
      const roster = assembled.fromHomeRoster
        ? mergeArmies(principalLine, principalRing)
        : mergeArmies(
            defenderBase.army,
            mergeArmies(stayedAsGarrison ? {} : principalLine, principalRing),
          );
      repos.bases.updateArmy(defenderBase.id, roster, defenderBase.trainingQueue);
    }
    // Their Bone Market too. Holding one is worth the same whichever end of the fight you are on,
    // which is the whole reason it pays on a loss as well as a win.
    const theirRefund = refundFor(defenderFallen, defenderGround?.salvageRefundPercent ?? 0);
    if (Object.keys(theirRefund).length > 0) {
      /*
       * Added to the stockpile as it stands *now*, not as it stood when this settle began.
       *
       * On a break-in, `breakIn` has already written this same row: it deducted the haul the
       * raiders carried out. `updateResources` rewrites the whole column, so adding the refund to
       * the snapshot taken at the top of the settle put the looted resources straight back. The
       * attacker kept the haul and the defender lost nothing, which is resource duplication on
       * every raid against a defender holding a Bone Market or carrying a salvage perk.
       *
       * A district target is always the resident's own base (`defendingBaseOf` returns the
       * resident when the target is not a location), so this is the same row every time, not an
       * unlucky alias.
       */
      const banked = repos.bases.findById(defenderBase.id) ?? defenderBase;
      repos.bases.updateResources(defenderBase.id, addResources(banked.resources, theirRefund));
      // The attacker's own refund rides in `haul` and is tallied with it, so counting this one
      // keeps "holding a Bone Market is worth the same at either end of the fight" true of the
      // lifetime ladders as well as of the stockpile.
      tallyResourcesEarned(repos, defenderBase.id, theirRefund);
    }
    /*
     * The kills, never the raid premium. `infamyForRaidWon` prices what taking ground off the
     * state is worth, seat of power included; paid to a crew for merely holding its position it
     * was 140 a fight on the Spire with nobody killed, farmable between two accounts with the
     * attacker risking nothing.
     */
    const defenderBanked = bankOutcome(
      defenderBase.economy,
      district,
      false,
      defenderInfamy,
      now,
      defenderGround?.infamyGainPercent ?? 0,
    );
    creditFaction(repos, defenderBase, defenderBase.economy, defenderBanked);
    repos.bases.updateEconomy(defenderBase.id, defenderBanked);
  }

  /*
   * The allies' share, back to the crews that sent it.
   *
   * Written before the declarer's own line below only so the two reads cannot interleave: each
   * ally's base is re-read here rather than carried, because nothing else in this settle has
   * touched them and a stale copy would drop whatever they trained while the column was away.
   */
  for (const [allyId, share] of attackerShares) {
    if (allyId === null || allyId === attacker.id) continue;
    if (Object.keys(share).length === 0) continue;
    const ally = repos.bases.findById(allyId);
    if (!ally) continue;
    repos.bases.updateArmy(ally.id, mergeArmies(ally.army, share), ally.trainingQueue);
  }
  // And the defending side's, line and ring together, to the crews that sent them.
  for (const allyId of new Set([...defenderLineShares.keys(), ...defenderRingShares.keys()])) {
    if (allyId === null || allyId === principalKey) continue;
    const lineShare = defenderLineShares.get(allyId) ?? {};
    const ringShare = defenderRingShares.get(allyId) ?? {};
    // A posting that held stays posted; one that fell walks home with everybody else.
    const postedOn =
      battle.target.kind === 'location' && postedIds.has(allyId) && !attackerWon
        ? battle.target.locationId
        : null;
    if (postedOn !== null) repos.alliedGarrisons.set(postedOn, allyId, lineShare);
    const share = postedOn !== null ? ringShare : mergeArmies(lineShare, ringShare);
    if (Object.keys(share).length === 0) continue;
    const ally = repos.bases.findById(allyId);
    if (!ally) continue;
    repos.bases.updateArmy(ally.id, mergeArmies(ally.army, share), ally.trainingQueue);
  }
  // Ground that changed hands has no postings left on it: their survivors went home above.
  if (battle.target.kind === 'location' && attackerWon) {
    repos.alliedGarrisons.clearAt(battle.target.locationId);
  }

  /*
   * §D4: the officer who would have died is laid up for a day instead.
   *
   * Written straight onto the roster rather than banked into `attackerNext`, because the defender's
   * roster is written by its own branch above and the attacker's is written below: one statement
   * that names the base it is changing is easier to be sure about than two that have to be threaded
   * into two different accumulators. `updateCommanders` touches only `commanders_json`.
   */
  for (const side of ['attacker', 'defender'] as const) {
    const officer = input.lead[side];
    const owner = side === 'attacker' ? attacker : defenderBase;
    if (!officer || !owner || !input.injured[side]) continue;
    repos.bases.updateCommanders(owner.id, withInjury(owner.commanders, officer.id, now));
  }

  /*
   * The receipts for the fight.
   *
   * Everybody who had a row on either side hears, not only the two principals: an ally who sent
   * twelve units into somebody else's battle has as much reason to read the report as the crew
   * who called it, and they are the ones whose survivors just came back.
   *
   * `battle_report` is always-on (`social/notifications.ts`), so this is one of the two kinds a
   * player cannot mute: a fight is irreversible and silence about one is how an army disappears.
   *
   * §D4 is the one exception, and it is the point of the rule: a side whose officer came home hurt
   * gets no report, so telling them one is waiting would be a notification pointing at a redaction.
   */
  const rows: [BattleSide, ReturnType<Repositories['sieges']['side']>][] = [
    ['attacker', attackerRows],
    ['defender', defenderRows],
  ];
  for (const [side, sideRows] of rows) {
    if (input.injured[side]) continue;
    const lostBy = side === 'attacker' ? attackerVehicles.lostBy : defenderVehicles.lostBy;
    for (const row of sideRows) {
      if (row.baseId === null) continue;
      // §C3: the machines are not on the report's table, so the receipt is where a crew hears
      // that a wreck is why the yard came back short.
      const wrecks = lostBy.get(row.baseId);
      const settled = `${targetName(battle.target, residentOf(repos, battle.target.districtId))} is settled.`;
      notifyBase(repos, row.baseId, {
        kind: 'battle_report',
        title: attackerWon ? 'A fight was won' : 'A fight was lost',
        body: wrecks ? `${settled} Wrecked on the way: ${describeFleet(wrecks)}.` : settled,
        /*
         * At **this** report, not at the pile of them (maintainer request, 2026-09-15).
         *
         * The receipt named a fight and then put the player on a screen listing every fight they
         * have ever had, with the one they were told about somewhere in it. A crew that fights
         * twice in an evening cannot tell which row the bell was about.
         *
         * The battle's own id, carried in the query rather than the path: `/game/battles` is one
         * screen with four tabs and the report is a modal on one of them, so there is no route to
         * point at. `subjectId` carries the same id for anything that wants it without parsing a
         * URL, which is what it is for.
         */
        link: `/game/battles?report=${battle.id}`,
        subjectId: battle.id,
        now,
      });
    }
  }

  repos.bases.updateArmy(attackerNext.id, attackerNext.army, attackerNext.trainingQueue);
  repos.bases.updateEconomy(attackerNext.id, attackerNext.economy);
  if (Object.keys(haul).length > 0) {
    // Off a fresh read, the way the defender's refund is: `breakIn` above writes the resident's
    // stockpile, and if the resident is this crew a write from the snapshot taken at the top of
    // the settle would put the plundered amount back and add the haul on top.
    const banked = repos.bases.findById(attackerNext.id) ?? attacker;
    repos.bases.updateResources(attackerNext.id, addResources(banked.resources, haul));
    /*
     * §I: a fight is a faucet, and it was the one faucet that counted for nothing.
     *
     * `tallyResourcesEarned` names "missions, fights, the market, and production" in its own doc
     * and three of the four called it. A raid is the largest single payment in the game, so the
     * five `resources_earned` ladders were measuring a crew's *jobs and shopping* and calling the
     * total what it had ever earned: a war crew that took everything it owned off other people sat
     * at nothing on all five.
     *
     * Here rather than beside the in-memory merge above, because this is the line that banks it,
     * and a tally beside an assignment would count a haul on paths that never write one.
     */
    tallyResourcesEarned(repos, attackerNext.id, haul);
  }

  /*
   * §A4: what stays broken, and it is the **only** thing a won raid leaves broken.
   *
   * "What leaves is bounded by what the raiders can carry; what stays broken is disruption" is
   * `raid.ts`'s whole second half, and `settleDistrict` reads `economy.disruption` per segment of
   * every production walk. A raid used to charge the victim twice, here and again per roof on a
   * 24 hour repair clock; the per-structure half is gone and this one scales with the defeat
   * instead, so the size of a raid still decides what it costs.
   *
   * Written last, off a fresh read, and against the **resident** rather than the defending crew.
   * Those are the same row on an ordinary break-in and not on the odd one where a crew holds a
   * district it does not live in: the district that was turned over is the resident's, so the
   * hours of bad running are the resident's too. Last, because the defender's own economy write
   * above rebuilds that column from the snapshot this settle opened with.
   */
  if (raided && input.resident) {
    const limping = repos.bases.findById(input.resident.id);
    if (limping) {
      repos.bases.updateEconomy(limping.id, {
        ...limping.economy,
        // A second raid refreshes rather than stacks: two crews taking turns must not be able to
        // hold a district at zero output for ever.
        disruption: refreshDisruption(
          limping.economy.disruption,
          disruptionFrom(now, defenderLossShare(input)),
        ),
      });
    }
  }

  return {
    attackerInfamy,
    defenderInfamy,
    haul,
    attackerKills: forceSize(defenderFallen),
    defenderKills: forceSize(attackerFallen),
    recovered,
  };
}

/**
 * How badly the defence lost, 0..1: the share of the line that defended and did not walk away.
 *
 * What the raid's disruption is priced off (`raidDisruptionPercent`), so a fight that went the
 * distance costs the district a tenth of its output for the evening and one nobody turned up to
 * costs it half. **1 when nobody defended**, which is the honest reading of an undefended district
 * rather than a division by zero: everything that was there to lose was lost.
 *
 * `outcome.killed` is the losing side's dead, and this is only ever read on a won raid, so it is
 * the defender's. The routed are deliberately not in it: somebody who ran is somebody the raiders
 * did not have to go through.
 */
function defenderLossShare(input: SettleInput): number {
  const started = forceSize(input.assembled.defending);
  if (started === 0) return 1;
  return Math.min(1, forceSize(input.outcome.killed) / started);
}

/**
 * What a won siege takes out of a lived-in district (§A4).
 *
 * A gate goes down for a day and everything behind it becomes reachable; a raid inside that day
 * carries off a share of the stockpile and leaves the place limping (the disruption written by the
 * caller). What never happens is the district changing hands: losing three weeks of building
 * because you were asleep is not a strategy game.
 */
function breakIn(
  repos: Repositories,
  input: SettleInput,
  /**
   * The attacker's dead with the Infirmary's recovered already taken off (`winnerDead`).
   *
   * Handed in rather than recomputed because the recovery is settled above, once, and two reads of
   * "who did we get back" would be two answers to one question.
   */
  recoveredDead: Army,
): { haul: PartialResources; raided: boolean } {
  const { battle, resident, outcome, now } = input;
  if (battle.target.kind === 'gate') {
    /*
     * §A4: the door comes off its hinges for {@link GATE_BREACH_HOURS} hours, and that is all.
     *
     * The Gate itself keeps its level, the way a location keeps its own until somebody stands on
     * it: a breach is a way in for a day, not a demolition. What the holder can still lose in
     * that day is the district, and losing it takes the district's gate down to level 1: see
     * `city/gates.ts`.
     */
    repos.sieges.breakGate(battle.target.districtId, breachExpiry(now));
    return { haul: {}, raided: false };
  }
  if (battle.target.kind !== 'district' || !resident) return { haul: {}, raided: false };

  /*
   * What left with them, bounded by what the force could physically carry, and never in caps.
   *
   * Caps come off the top of `PLUNDER_PRIORITY` and weigh one apiece, so a raid that could take
   * them carried nothing else: the whole hold filled with the victim's wallet and their materials
   * were never touched. The board's rule is a share of everything *except* caps, which is what
   * makes the carry sheet matter, so the exclusion is passed to `plunder` rather than fixed in the
   * priority order: a location raid, if one ever pays out again, is a different question.
   */
  /*
   * Who is standing at the end of it, which is who carries (maintainer, 2026-09-18).
   *
   * Not the whole force that marched. A raid used to load its hold off `committed`, so a crew that
   * lost nine tenths of itself taking a district carried exactly as much home as one that walked in
   * unopposed. Dead people do not carry sacks.
   *
   * And the Infirmary's recovered do not either, by default: somebody the medics bring round
   * tomorrow was lying on the ground while the stockpile was being emptied. `outcome.winnerLosses`
   * is the raw list, before the medics, and is the right one for a question about who was upright
   * at the time. `recoveredCarryLoot` is the research a crew buys to get the other answer, which is
   * the stretcher party going back for the bags.
   */
  const effects = standingEffectsFor(repos, input.attacker, now);
  const fallen = effects.recoveredCarryLoot ? recoveredDead : outcome.winnerLosses;
  const carrying = removeForce(input.committed, fallen);
  // `effects` is passed as the fourth argument rather than dropped. A `unit_mark` grant such as
  // Haul Rigging's `picker` is only visible through `markedUnit`, so reading the raw sheet here
  // made that research rung a cost and a wait for nothing at all. The mission door has always
  // passed it (`missions/resolve.ts`); this one did not, and the two now agree.
  const capacity = lootCapacityOf(
    carrying,
    effects.lootCapacityPercent,
    input.attacker.unitLoadouts,
    effects,
  );
  /*
   * Seeded off the battle's **seed**, not its id, so a raid replays.
   *
   * `plunder` draws the mix rather than walking a priority table, so it needs a stream, and two
   * reads of one fight must not disagree about what left the district. Either field gives that.
   * The seed is the right one because it is the field the record carries *for* this: the fight
   * itself runs on `battle.seed`, and taking the haul off a different column made the loot the
   * one part of a battle that could not be reproduced by fixing the seed. That cost a test, too:
   * `breakin.test.ts` compares two worlds and had to tolerate a fifth of the haul as draw noise,
   * because two worlds can share a seed and can never share an id.
   */
  const haul = plunder(resident.resources, capacity, ['caps'], `plunder:${battle.seed}`);
  repos.bases.updateResources(resident.id, spendResources(resident.resources, haul));
  return { haul, raided: true };
}

function holderWord(kind: ScheduledBattle['defender']['kind']): string {
  switch (kind) {
    case 'government':
      return 'The Combine';
    case 'looters':
      return 'The looters';
    case 'unoccupied':
      return 'Nobody';
    default:
      return 'The holder';
  }
}

function emptySide(name: string): SideAnalysis {
  return {
    name,
    committed: 0,
    lost: 0,
    survived: 0,
    fled: 0,
    perimeter: 0,
    perimeterCaught: 0,
    // A stub engine set no ring and intimidated nobody, because it ran no fight.
    perimeterLost: 0,
    intimidated: 0,
    infamy: 0,
    units: [],
    // A stub engine ran no officer, because it ran no fight.
    officer: null,
  };
}

/**
 * A ledger for an engine that had no simulation behind it.
 *
 * Only ever reached by a stub engine, which is what half the server suite injects. It carries the
 * outcome's own log so a test can still read what the stub decided, and nothing it does not know.
 */
function fallbackAnalysis(
  battle: ScheduledBattle,
  locationName: string,
  outcome: SkirmishOutcome,
  attackerName: string,
  battlefield: Battlefield,
): BattleAnalysis {
  const attacker = emptySide(attackerName);
  const defender = emptySide('the holder');
  // Even a stub knows who ran, and that is the one figure the report-visibility rule turns on. A
  // fallback that reported nobody home would silence every loser on every stubbed fight.
  const loser = outcome.winner === 'attacker' ? defender : attacker;
  loser.fled = forceSize(outcome.fled);

  return {
    battleId: battle.id,
    locationName,
    winner: outcome.winner,
    rounds: outcome.rounds,
    decidedOnPower: false,
    settledBy: 'standing' as const,
    // A stub ran no presence, so there is no leader to put over the ground.
    underLeader: null,
    // The Combine's two tolls ride along even on a stub, so a fight settled by a test engine
    // still reports the same shape the report reads.
    turned: outcome.turned,
    executed: outcome.executed,
    // A stub engine's fights have no ring in them, so nobody was turned back by one.
    brokeThrough: outcome.brokeThrough,
    attacker,
    defender,
    log: outcome.log,
    findings: outcome.findings,
    trap: null,
    legends: [],
    headline: outcome.log[0] ?? 'It happened.',
    // The ground is a fact about where the fight was, not about how it was resolved, so a stub
    // engine knows it just as well as the real one does.
    weather: battlefield.weather as BattleAnalysis['weather'],
    ground: battlefield.labels,
  };
}
