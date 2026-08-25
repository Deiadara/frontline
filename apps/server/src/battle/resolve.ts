import {
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
  recordRaidOutcome,
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
  type TerritoryEffects,
  NO_BOOST,
  averageCityLevel,
  hasBoost,
  boostBundle,
  findBattleBoost,
  type BattleDeployment,
  spentStash,
  stashBoost,
  type BattleBoost,
  type CrewEffects,
  findUnit,
} from '@frontline/shared';
import { standingEffectsFor } from '../crew/standing.js';
import { recallOvertaken } from './movement.js';
import type { Repositories } from '../db/repos/index.js';
import { defendingBaseOf } from './declare.js';
import { forceSize, mergeArmies, removeForce } from './forces.js';
import { controlsIn, residentOf, targetName } from './ground.js';
import { awardPlayerXp } from '../progression/award.js';

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
  const attackerDeployment = repos.sieges.deployment(battle.id, 'attacker');
  const defenderDeployment = repos.sieges.deployment(battle.id, 'defender');

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
 */
function battlefieldOf(
  battle: ScheduledBattle,
  district: District,
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
  return homeBattlefield(district.name, at);
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
          fromTheState: target.faction === 'government',
          seatOfPower: target.isSeatOfPower,
        })
      : 0);
  return {
    ...economy,
    infamy: gainInfamy(economy.infamy, earned * (1 + Math.max(0, infamyGainPercent) / 100)),
    reputationTally: recordRaidOutcome(
      economy.reputationTally,
      { winner: won ? 'attacker' : 'defender', target },
      now,
    ),
  };
}

function withGate(effects: TerritoryEffects, buildings: readonly Building[]): TerritoryEffects {
  return { ...effects, defensePercent: effects.defensePercent + districtDefense(buildings) };
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
    const outcome = resolveOne(repos, engine, battle, now);
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
function cityLevelOf(repos: Repositories): number {
  return averageCityLevel(
    repos.bases
      .listSummaries()
      .filter((summary) => !summary.isBot)
      .map((summary) => summary.level),
  );
}

/** Takes one of each boost out of a crew's bag: exactly what the fight was allowed to use. */
function spendBoosts(repos: Repositories, baseId: string): void {
  const stash = repos.blackMarket.stashFor(baseId);
  if (hasBoost(stash)) repos.blackMarket.writeStash(baseId, spentStash(stash));
}

/** §D7: the boost this side bought for this fight, as a whole-force bundle. */
function nameBoost(deployment: BattleDeployment | undefined, force: Army): BattleBoost {
  const spec = deployment?.boostId ? findBattleBoost(deployment.boostId) : undefined;
  if (!spec) return NO_BOOST;
  return boostBundle(spec.effect, force);
}

/** Two bundles on the same three channels. Additive, like everything else in this file. */
function addBoosts(a: BattleBoost, b: BattleBoost): BattleBoost {
  if (b === NO_BOOST) return a;
  return {
    offensePercent: a.offensePercent + b.offensePercent,
    defensePercent: a.defensePercent + b.defensePercent,
    moralePercent: a.moralePercent + b.moralePercent,
  };
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
  const cityLevel = cityLevelOf(repos);
  const attackerBoost = addBoosts(
    stashBoost(repos.blackMarket.stashFor(attacker.id), cityLevel),
    // §D7: what a name bought for *this* fight, folded down against the force it actually
    // reaches. See `battle/boosts.ts`: a boost on one weight class is worth its own percentage
    // times that class's share of the supply standing on the ground.
    nameBoost(repos.sieges.deployment(battle.id, 'attacker'), assembled.attacking),
  );
  const defenderBoost = defenderBase
    ? addBoosts(
        stashBoost(repos.blackMarket.stashFor(defenderBase.id), cityLevel),
        nameBoost(repos.sieges.deployment(battle.id, 'defender'), assembled.defending),
      )
    : NO_BOOST;

  const attackerEffects = boosted(standingEffectsFor(repos, attacker), attackerBoost);
  const defenderEffects = defenderBase
    ? boosted(standingEffectsFor(repos, defenderBase), defenderBoost)
    : undefined;

  const name = targetName(battle.target, resident);
  // Read once and shared: the engine fights on it and the report is stamped with it, so a card can
  // never describe ground the fight did not happen on.
  const ground = battlefieldOf(battle, district, fortification);
  const outcome: SkirmishOutcome = engine.resolve({
    seed: battle.seed,
    battleId: battle.id,
    attackerName: attacker.name,
    defenderName: defenderBase?.name ?? holderWord(battle.defender.kind),
    locationName: name,
    attacking: trap.attacking,
    defending: assembled.defending,
    battlefield: ground,
    attackerTerritory: attackerEffects,
    attackerUpgrades: attacker.fittedUpgrades,
    attackerCohesionPercent: attackerEffects.cohesionPercent,
    attackerPerimeter: assembled.attackerRing,
    defenderPerimeter: assembled.defenderRing,
    ...(defenderEffects && defenderBase
      ? {
          // The Gate, and everybody garrisoned inside the structures behind it (§A1, §A4).
          defenderTerritory: withGate(defenderEffects, defenderBase.buildings),
          defenderCohesionPercent: defenderEffects.cohesionPercent,
          defenderUpgrades: defenderBase.fittedUpgrades,
        }
      : {}),
  });

  // Spent, whatever happened. A boost is bought for *a* battle, not for a won one, and leaving it
  // in the stash on a loss would make contraband a free retry.
  //
  // One of each, matching what the fight was allowed to use (board: "the same boost only once").
  // Clearing the whole bag instead would bill a crew for a second syringe they never got to open.
  spendBoosts(repos, attacker.id);
  if (defenderBase) spendBoosts(repos, defenderBase.id);

  // §A4: anybody still on the road to this fight turns around. A column arriving at a battle that
  // has already been decided is not a state the game should be able to reach, and the units are
  // more use at home than deleted.
  recallOvertaken(repos, battle.id);

  // A trap that left nothing standing is the one case an attack does not happen at all. The engine
  // has still been run: it costs one seeded stream and it produces the report that says so.
  const attackerWon = !trap.wipedOut && outcome.winner === 'attacker';

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
  });

  const base = outcome.analysis ?? fallbackAnalysis(battle, name, outcome, attacker.name, ground);
  const analysis: BattleAnalysis = {
    ...base,
    winner: attackerWon ? 'attacker' : 'defender',
    trap: trap.note,
    attacker: { ...base.attacker, infamy: settlement.attackerInfamy },
    defender: { ...base.defender, infamy: settlement.defenderInfamy },
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

  // §F2: the medics take some of the *winner's* dead off the list before it is applied. Only ever
  // the winner's: a routed force leaves its wounded on the field, which is what routing means.
  const winnerRecovery = attackerWon
    ? attackerGround.casualtyRecoveryPercent
    : (defenderGround?.casualtyRecoveryPercent ?? 0);
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

  const attackerInfamy = infamyForKills(defenderDead) + captureInfamy;
  const defenderInfamy = infamyForKills(attackerDead);

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
  let attackerNext: Base = {
    ...attacker,
    army: mergeArmies(attacker.army, attackerHome),
    economy: bankOutcome(
      attacker.economy,
      district,
      attackerWon,
      attackerInfamy,
      now,
      attackerGround.infamyGainPercent,
    ),
  };

  // --- the ground ---
  if (battle.target.kind === 'location') {
    if (attackerWon) {
      // A captured position is not a captured position *plus* the enemy's diggings. The garrison is
      // whoever the attacker left standing there on purpose, and nobody otherwise.
      repos.city.put({
        locationId: battle.target.locationId,
        holder: { kind: 'faction', baseId: attacker.id },
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
    repos.bases.updateEconomy(
      defenderBase.id,
      bankOutcome(
        defenderBase.economy,
        district,
        !attackerWon,
        defenderInfamy,
        now,
        defenderGround?.infamyGainPercent ?? 0,
      ),
    );
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
