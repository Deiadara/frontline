import {
  capturedGateDefensePercent,
  addResources,
  mergeResources,
  battlefieldFor,
  breachExpiry,
  damageBuilding,
  districtDefense,
  findDistrict,
  LOCATION_CATALOG,
  findLocation,
  findTrap,
  gainInfamy,
  homeBattlefield,
  infamyForKills,
  infamyForRaidWon,
  isBattleDue,
  lootCapacityOf,
  plunder,
  raidTargetOf,
  recoverCasualties,
  spendResources,
  springTrap,
  strikeDamage,
  type Army,
  type Battlefield,
  type BattleAnalysis,
  type Base,
  type Building,
  type District,
  type EconomyState,
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
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import { recallOvertaken } from './movement.js';
import type { Repositories } from '../db/repos/index.js';
import { sideForce, splitSurvivors } from './side.js';
import { notifyBase } from '../social/notify.js';
import { cityLevelFor } from '../blackmarket/shelf.js';
import { defendingBaseOf } from './declare.js';
import { forceSize, mergeArmies, removeForce } from './forces.js';
import { controlsIn, residentOf, targetName } from './ground.js';
import { awardPlayerXp } from '../progression/award.js';
import { gateFor, holdsDistrictWhole } from '../city/gates.js';

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
  attackerRing: Army;
  defenderRing: Army;
  /**
   * True when the defending force was drawn out of a crew's own roster rather than off a garrison.
   *
   * Which pool the survivors go back into, and the one thing that cannot be worked out afterwards
   * from the armies alone.
   */
  fromHomeRoster: boolean;
}

/**
 * Everything standing on the ground when the clock runs out.
 *
 * The two pools that join a deployment without anybody having sent them are the point: a garrison is
 * already on the location it garrisons, and a crew's roster is already at home. Both are folded in here
 * and rebuilt from the survivors afterwards, so nobody is counted in two locations at once.
 */
function assemble(
  repos: Repositories,
  battle: ScheduledBattle,
  resident: Base | undefined,
): Assembled {
  // The whole of each side, allies folded in (`battle/side.ts`). Reading one row here would have
  // marched the declarer in alone while their reinforcements sat in the database.
  const at = battle.scheduledFor;
  const attackerDeployment = sideForce(repos, battle.id, 'attacker', at);
  const defenderDeployment = sideForce(repos, battle.id, 'defender', at);

  const attacking = attackerDeployment?.army ?? {};
  const attackerRing = attackerDeployment?.perimeter ?? {};
  const defenderRing = defenderDeployment?.perimeter ?? {};
  let defending = defenderDeployment?.army ?? {};

  if (battle.target.kind === 'location') {
    const control = repos.city.control(battle.target.locationId);
    if (control) defending = mergeArmies(defending, control.garrison);
    return { attacking, defending, attackerRing, defenderRing, fromHomeRoster: false };
  }

  // A gate, or a structure behind a broken one, is defended by whoever is standing in the district:
  // a crew's own roster if a crew lives there, and every garrison on the ground if it is the
  // Combine's. Nobody has to remember to defend their own home.
  if (resident) {
    defending = mergeArmies(defending, resident.army);
  } else {
    for (const { control } of controlsIn(repos, battle.target.districtId)) {
      defending = mergeArmies(defending, control.garrison);
    }
  }
  return {
    attacking,
    defending,
    attackerRing,
    defenderRing,
    fromHomeRoster: resident !== undefined,
  };
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
  note: { name: string; killed: number } | null;
  wipedOut: boolean;
}

/** Whatever was buried under the approach, and what it took. */
function springAnyTrap(repos: Repositories, battle: ScheduledBattle, attacking: Army): TrapResult {
  if (battle.target.kind !== 'location') return { attacking, note: null, wipedOut: false };
  const armed = repos.sieges.trap(battle.target.locationId);
  const spec = armed ? findTrap(armed.trapId) : undefined;
  if (!spec) return { attacking, note: null, wipedOut: false };

  // One use, cleared whether or not it decided anything. A trap that survives being walked over is
  // not a trap, it is a wall, and this system deliberately has none.
  repos.sieges.setTrap(battle.target.locationId, null);
  const toll = springTrap(attacking, spec);
  return {
    attacking: toll.survivors,
    note: { name: spec.name, killed: forceSize(toll.killed) },
    wipedOut: toll.wipedOut,
  };
}

/**
 * What a dead force is worth back in caps, at a given refund percentage (§A4).
 *
 * Priced off the units' own catalogue cost rather than a flat per-body figure, so losing a
 * Colossus refunds a Colossus. Empty when the crew holds nothing that pays a refund, which is the
 * common case and costs nothing to compute.
 */
function refundFor(dead: Army, percent: number): PartialResources {
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
    infamy: gainInfamy(economy.infamy, earned * (1 + Math.max(0, infamyGainPercent) / 100)),
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
 * bodies is a different fight from one you took on your own, and a perk that only pays there is a
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
  const gate = districtDefense(buildings);
  // No Gate, no bonus: the perk buys a better door, not a door. A captured gate is a door, so it
  // counts for the perk too: a Gatewright is worth the same on a wall they took as on one they built.
  const anyGate = gate > 0 || capturedGateLevel > 0;
  const fromPerks = anyGate ? effects.gateDefensePercent : 0;
  const captured = capturedGateDefensePercent(capturedGateLevel);
  return {
    ...effects,
    defensePercent: effects.defensePercent + gate + captured + fromPerks,
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
): BattleBoost {
  const id = deployment?.boostId;
  if (!id) return NO_BOOST;

  const name = findBattleBoost(id);
  if (name) return boostBundle(name.effect, force);

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
    defensePercent: effects.defensePercent + boost.defensePercent,
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
 * Writes the survivors straight back onto the base's fleet and clears the deployment's, so a fight
 * that has been settled cannot hand the same machines back twice on a second read. Returns what was
 * destroyed, which is what the *enemy's* infamy is priced off.
 */
function settleVehicles(
  repos: Repositories,
  battle: ScheduledBattle,
  side: BattleSide,
  base: Base,
  force: { committed: number; survivors: number },
): { destroyed: Fleet } {
  const deployment = repos.sieges.deployment(battle.id, side, base.id);
  const took = deployment?.vehicles ?? {};
  if (Object.keys(took).length === 0) return { destroyed: {} };

  // A force of nobody that somehow took machines lost all of them: there was nobody to drive one
  // home, which is the same answer a wipe gets and for the same reason.
  const surviving = force.committed <= 0 ? 0 : force.survivors / force.committed;
  const destroyed = wrecked(took, surviving);
  const home = removeFleet(took, destroyed);

  repos.sieges.putDeployment({ ...deployment!, vehicles: {} });
  if (Object.keys(home).length > 0) {
    repos.bases.updateFleet(base.id, mergeFleets(repos.bases.findById(base.id)?.fleet ?? {}, home));
  }
  return { destroyed };
}

/** The roster with one officer laid up for a day. Written by the settler and nowhere else. */
function withInjury(commanders: readonly Commander[], officerId: string, now: Date): Commander[] {
  return commanders.map((officer) =>
    officer.id === officerId ? { ...officer, injuredUntil: officerRecoveryAt(now) } : officer,
  );
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
  const assembled = assemble(repos, battle, resident);
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
  // §D7: what a name bought for *this* fight, folded down against the force it actually reaches.
  // See `battle/boosts.ts`: a boost on one weight class is worth its own percentage times that
  // class's share of the supply standing on the ground. Contraband reaches the whole force.
  const attackerBoost = appliedBoost(
    repos,
    attacker.id,
    sideForce(repos, battle.id, 'attacker', battle.scheduledFor),
    assembled.attacking,
    cityLevel,
  );
  const defenderBoost = defenderBase
    ? appliedBoost(
        repos,
        defenderBase.id,
        sideForce(repos, battle.id, 'defender', battle.scheduledFor),
        assembled.defending,
        cityLevel,
      )
    : NO_BOOST;

  /*
   * §B7's two situational perks, applied where the situation is actually known.
   *
   * Neither can be folded at the source, because neither is a fact about the crew: whether an ally
   * turned up is a fact about *this fight*, and whether you hold the whole district is a fact about
   * the map at this moment. Folding them into `defensePercent` in `crew/effects.ts` would pay them
   * out in every fight, which is exactly the unconditional bonus the board asked us to stop making.
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

  const attackerEffects = situational(
    boosted(standingEffectsFor(repos, attacker, now), attackerBoost),
    {
      allied: attackerAllied,
      wholeDistrict: holdsWholeDistrict(repos, attacker),
    },
  );
  const attackerFinal = attackerLead ? leading(attackerEffects) : attackerEffects;
  const defenderEffects = defenderBase
    ? situational(boosted(standingEffectsFor(repos, defenderBase, now), defenderBoost), {
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
    attackerPerimeter: assembled.attackerRing,
    defenderPerimeter: assembled.defenderRing,
    ...(attackerLead ? { attackerOfficer: asCombatant(attackerLead) } : {}),
    ...(defenderLead ? { defenderOfficer: asCombatant(defenderLead) } : {}),
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

  // §A4: anybody still on the road to this fight turns around. A column arriving at a battle that
  // has already been decided is not a state the game should be able to reach, and the units are
  // more use at home than deleted.
  recallOvertaken(repos, battle.id);

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
    outcome,
    attackerWon,
    now,
    lead: { attacker: attackerLead, defender: defenderLead },
    leadEffects: { attacker: attackerFinal, defender: defenderFinal },
    injured,
  });

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
  const analysis: BattleAnalysis = {
    ...base,
    winner: attackerWon ? 'attacker' : 'defender',
    trap: trap.note,
    attacker: { ...withOfficer('attacker', base.attacker), infamy: settlement.attackerInfamy },
    defender: { ...withOfficer('defender', base.defender), infamy: settlement.defenderInfamy },
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
  const attackerGround = standingEffectsFor(repos, attacker);
  const defenderGround = defenderBase ? standingEffectsFor(repos, defenderBase) : null;

  /*
   * §F2 and §B10: the medics take some of the *winner's* dead off the list before it is applied.
   *
   * Only ever the winner's, which is both the board's rule for the Infirmary ("wins only") and the
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
  const winnerDead = recoverCasualties(outcome.winnerLosses, winnerRecovery);
  const attackerDead = attackerWon ? winnerDead : outcome.killed;
  const defenderDead = attackerWon ? outcome.killed : winnerDead;

  const attackerSurvivors = attackerWon ? removeForce(input.committed, attackerDead) : outcome.fled;

  /**
   * §A4: the survivors stay on the ground they took, because the attacker said so before the
   * fight.
   *
   * Only on a **won location**, and the two qualifications are both load-bearing. A lost fight has
   * nothing to hold, and a gate or a building is not a thing anybody can stand on afterwards: the
   * breach is a window in time rather than a position on the map, so there is no garrison for it to
   * be.
   */
  const holds = attackerWon && battle.target.kind === 'location' && battle.holdAfterCapture;
  const holding = holds ? attackerSurvivors : {};

  // The rings never fought and always come home, whichever way it went, and whichever way the
  // attacker answered the question, because the ring stood outside the fight and never took the
  // ground it is being asked to hold.
  const attackerHome = mergeArmies(holds ? {} : attackerSurvivors, assembled.attackerRing);

  /*
   * Whose survivors these are.
   *
   * A side can be several crews now (`battle/side.ts`), and the engine answers for the side as a
   * whole. Handing `attackerHome` to the declarer would quietly transfer an ally's army to whoever
   * called the fight: they sent bodies, the bodies lived, and they would never come back.
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
   * straight back in the yard, which is the other half of the board's rule.
   *
   * The infamy is the machines' **capacity**, not their price: a War Hauler is a bigger thing to
   * have destroyed than a Motorcycle whatever either cost to build, and capacity is what the fight
   * actually took off the board.
   */
  const attackerVehicles = settleVehicles(repos, battle, 'attacker', attacker, {
    committed: forceSize(input.committed),
    survivors: forceSize(attackerSurvivors),
  });
  const defenderVehicles = defenderBase
    ? settleVehicles(repos, battle, 'defender', defenderBase, {
        committed: forceSize(assembled.defending),
        survivors: forceSize(defenderSurvivors),
      })
    : { destroyed: {} as Fleet };

  const attackerInfamy =
    infamyForKills(defenderDead) + captureInfamy + vehicleInfamy(defenderVehicles.destroyed);
  const defenderInfamy = infamyForKills(attackerDead) + vehicleInfamy(attackerVehicles.destroyed);

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
  let haul: PartialResources = refundFor(attackerDead, attackerGround.salvageRefundPercent);
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
      // A captured position is not a captured position *plus* the enemy's diggings. The garrison is
      // whoever the attacker left standing there on purpose, and nobody otherwise.
      repos.city.put({
        locationId: battle.target.locationId,
        holder: { kind: 'crew', baseId: attacker.id },
        // §A4: **a capture resets the location to level 1.** Nobody inherits the previous
        // holder's investment: three upgrades of work on a Gas Station are gone the moment
        // somebody else walks onto the forecourt. That is the whole tension of the level system,
        // and it is enforced here rather than trusted to the caller.
        level: 1,
        upgradingUntil: null,
        fortification: 0,
        fortifyingUntil: null,
        garrison: holding,
      });
    } else {
      // Whoever held it holds it, and whoever is left standing is its garrison now: including
      // anybody who was sent up for the fight. They are already there.
      repos.city.setGarrison(battle.target.locationId, defenderSurvivors);
    }
  } else if (attackerWon) {
    haul = mergeResources(haul, breakIn(repos, input));
  }

  if (leadLoot > 0) haul = scaledSpoils(haul, leadLoot);

  // Banked once, on every path. Nothing above this line touches the stockpile.
  if (Object.keys(haul).length > 0) {
    attackerNext = { ...attackerNext, resources: addResources(attackerNext.resources, haul) };
  }

  // --- the defender's own books ---
  if (defenderBase) {
    // A home defence's survivors *are* the roster. They were taken out of it to fight. A location
    // defence's stay on the location, so only whoever ran (and the ring) comes home.
    const roster = assembled.fromHomeRoster
      ? mergeArmies(defenderSurvivors, assembled.defenderRing)
      : mergeArmies(
          defenderBase.army,
          mergeArmies(attackerWon ? defenderSurvivors : {}, assembled.defenderRing),
        );
    repos.bases.updateArmy(defenderBase.id, roster, defenderBase.trainingQueue);
    // Their Bone Market too. Holding one is worth the same whichever end of the fight you are on,
    // which is the whole reason it pays on a loss as well as a win.
    const theirRefund = refundFor(defenderDead, defenderGround?.salvageRefundPercent ?? 0);
    if (Object.keys(theirRefund).length > 0) {
      repos.bases.updateResources(
        defenderBase.id,
        addResources(defenderBase.resources, theirRefund),
      );
    }
    const defenderBanked = bankOutcome(
      defenderBase.economy,
      district,
      !attackerWon,
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
   * twelve bodies into somebody else's battle has as much reason to read the report as the crew
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
    ['defender', repos.sieges.side(battle.id, 'defender')],
  ];
  for (const [side, sideRows] of rows) {
    if (input.injured[side]) continue;
    for (const row of sideRows) {
      if (row.baseId === null) continue;
      notifyBase(repos, row.baseId, {
        kind: 'battle_report',
        title: attackerWon ? 'A fight was won' : 'A fight was lost',
        body: `${targetName(battle.target, residentOf(repos, battle.target.districtId))} is settled.`,
        link: '/game/battles',
        now,
      });
    }
  }

  repos.bases.updateArmy(attackerNext.id, attackerNext.army, attackerNext.trainingQueue);
  repos.bases.updateEconomy(attackerNext.id, attackerNext.economy);
  if (Object.keys(haul).length > 0)
    repos.bases.updateResources(attackerNext.id, attackerNext.resources);

  return { attackerInfamy, defenderInfamy, haul };
}

/**
 * What a won siege takes out of a lived-in district (§A4).
 *
 * A gate goes down for a day and everything behind it becomes reachable; a structure that was hit
 * is carried out of and left running badly. What never happens is the district changing hands:
 * losing three weeks of building because you were asleep is not a strategy game.
 */
function breakIn(repos: Repositories, input: SettleInput): PartialResources {
  const { battle, resident, outcome, now } = input;
  if (battle.target.kind === 'gate') {
    repos.sieges.breakGate(battle.target.districtId, breachExpiry(now));
    /*
     * §A4: the digging goes with the door.
     *
     * A location that changes hands loses its fortification, because nobody inherits the last
     * holder's work. A Gate is never captured, only broken, so without this it kept every level
     * through a breach: the one place in the game where paying to fortify carried no risk at all.
     * The structure itself survives, the way a location's own level does, because a breach is a
     * door off its hinges rather than a demolition.
     */
    if (resident) {
      repos.bases.updateBuildings(
        resident.id,
        resident.buildings.map((building) =>
          building.kind === 'gate' ? { ...building, fortification: 0 } : building,
        ),
      );
    }
    return {};
  }
  if (battle.target.kind !== 'building' || !resident) return {};

  const targetId = battle.target.buildingId;
  const building = resident.buildings.find((candidate) => candidate.id === targetId);
  if (!building) return {};

  // How badly it was hit follows how badly the defence lost, so a fight that went the distance
  // leaves the location scratched and one nobody turned up for leaves it wrecked.
  const defenderStarted = forceSize(input.assembled.defending);
  const lossShare =
    defenderStarted === 0 ? 1 : Math.min(1, forceSize(outcome.killed) / defenderStarted);
  const damaged = damageBuilding(building, strikeDamage(lossShare), input.now.toISOString());
  repos.bases.updateBuildings(
    resident.id,
    resident.buildings.map((candidate) => (candidate.id === building.id ? damaged : candidate)),
  );

  // What left with them, bounded by what the force could physically carry.
  const capacity = lootCapacityOf(
    input.committed,
    standingEffectsFor(repos, input.attacker).lootCapacityPercent,
  );
  const haul = plunder(resident.resources, capacity);
  repos.bases.updateResources(resident.id, spendResources(resident.resources, haul));
  return haul;
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
