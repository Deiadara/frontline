import {
  blueprintGateMet,
  describeBlueprintGate,
  BUILDING_CATALOG,
  CITY_DISTRICTS,
  BATTLE_BOOSTS,
  TRAP_CATALOG,
  buildingEffectiveness,
  declarableSlots,
  deploymentBlurPercent,
  districtHolder,
  gateArmed,
  deploymentIsOpen,
  deployedSize,
  findDistrict,
  blackMarketEffect,
  boostAvailable,
  boostCoverage,
  describeBoostEffect,
  describeBoostUnlock,
  findBlackMarketGood,
  findTech,
  stashCount,
  hasInfamy,
  intelQualityLine,
  movementCancellable,
  movementSize,
  observedForceSize,
  reportReaches,
  officerBattleStats,
  officerIsInjured,
  type BattleLeader,
  type Army,
  type BattleReportView,
  type BattleSide,
  type BattleView,
  type ActionsResponse,
  type BattlesResponse,
  type Base,
  type BoostStash,
  type DistrictGateView,
  type BattleBoostOption,
  type ScheduledBattle,
  type StructureDefence,
  type TrapOption,
} from '@frontline/shared';
import { crewEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { sideForce } from './side.js';
import { cityLevelFor } from '../blackmarket/shelf.js';
import { cityContextFor } from '../city/view.js';
import { sideOf } from './deploy.js';
import { defendingBaseOf } from './declare.js';
import { residentOf, targetName } from './ground.js';
import { battlefieldOf } from './resolve.js';
import { seatedRoles } from '../crew/roster.js';

/**
 * The battle board, as one crew sees it (GDD §A4, battle rework).
 *
 * The fog is enforced **here**, on the way out, the same way the city view enforces it: a caller is
 * told what they can see and nothing else is put on the payload. That matters more on this screen
 * than on any other, because the thing being hidden is the one thing worth hiding: what the other
 * side has moved up. A field that was sometimes null would leak by its own shape, so the enemy's
 * composition is not a nullable field: it does not exist. What exists is a *count*, and only when
 * this crew's intelligence is good enough to have one.
 */

/**
 * How many finished fights a crew is handed: **all of them**.
 *
 * It was twenty, which is an archive that quietly throws away the fight you are trying to look up.
 * A report is the only record of what a force did against a particular kind of ground, and the one
 * a player wants is usually not among the last twenty: it is the disaster from a fortnight ago they
 * are trying not to repeat.
 *
 * A cap rather than no argument at all, because the query is `SELECT ... LIMIT ?` and an unbounded
 * one is a payload that grows without end. This is high enough to be an archive in practice and low
 * enough that the response cannot become a megabyte on a crew that has been at war for a year.
 */
export const REPORT_HISTORY = 2000;

/**
 * What this side has on the ground, allies included.
 *
 * The whole side rather than the reader's own row: the muster is "what is standing here", and a
 * screen that showed a player only their own contribution would tell them they were about to fight
 * alone when three of their allegiance had already arrived.
 */
function musterOf(repos: Repositories, battle: ScheduledBattle, side: BattleSide) {
  const deployment = sideForce(repos, battle.id, side, battle.scheduledFor);
  return {
    army: deployment.army,
    perimeter: deployment.perimeter,
    size: deployedSize(deployment),
  };
}

/**
 * What this crew can make out of the other side's force.
 *
 * Their counter-intelligence and the force's own stealth against this crew's reading: one figure,
 * and it decides between an exact count, a rounded one and nothing at all. The **ring is never in
 * the count**: it is standing outside the fight, and a player who could see it coming would never
 * walk into one, which is the whole of what it is for.
 */
function readEnemy(
  repos: Repositories,
  battle: ScheduledBattle,
  ownSide: BattleSide,
  reading: number,
): { size: number | null; quality: string } {
  const other: BattleSide = ownSide === 'attacker' ? 'defender' : 'attacker';
  // Everything on the other side. Reading one row would understate an enemy who has been reinforced,
  // which is exactly the reading this function exists to get right.
  const force = sideForce(repos, battle.id, other, battle.scheduledFor).army;

  const enemyBase =
    other === 'attacker'
      ? repos.bases.findById(battle.attackerBaseId)
      : defendingBaseOf(repos, battle);
  const resistance = enemyBase ? crewEffectsFor(repos, enemyBase).intelResistancePercent : 0;

  const blur = deploymentBlurPercent({
    resistancePercent: resistance,
    yieldPercent: reading,
    force,
  });
  return { size: observedForceSize(force, blur), quality: intelQualityLine(blur) };
}

function viewOf(
  repos: Repositories,
  base: Base,
  battle: ScheduledBattle,
  reading: number,
  now: Date,
): BattleView {
  const district = findDistrict(battle.target.districtId);
  const resident = residentOf(repos, battle.target.districtId);
  const side = sideOf(repos, battle, base.id);
  const defenderBase = defendingBaseOf(repos, battle);
  const attackerName = repos.bases.findById(battle.attackerBaseId)?.name ?? 'a crew nobody knows';

  const enemy = side ? readEnemy(repos, battle, side, reading) : { size: null, quality: '' };
  const muster = side ? musterOf(repos, battle, side) : null;
  // This crew's own row: the deployment screen edits what *you* have sent, not what your allies have.
  const deployment = side ? repos.sieges.deployment(battle.id, side, base.id) : undefined;

  return {
    battle,
    targetName: targetName(battle.target, resident),
    districtName: district?.name ?? 'somewhere',
    role: side ?? 'bystander',
    side,
    deploymentOpen: deploymentIsOpen(new Date(battle.scheduledFor), now),
    muster,
    enemySize: enemy.size,
    enemyIntel: side ? enemy.quality : 'You are not in this one.',
    opponentName:
      side === 'defender'
        ? attackerName
        : (defenderBase?.name ?? holderLabel(battle.defender.kind)),
    /*
     * The ground, through the *same* function that will decide the fight (`battlefieldOf`).
     *
     * The deployment screen forecasts on it. Not a secret from either side: where the fight is and
     * what that ground is like is the one thing a declaration makes public. Fortification is read
     * live rather than frozen, so digging in between now and the mark shows up on both sides'
     * estimates, which is the honest reading of a fortification that is still being built.
     */
    battlefield: battlefieldOf(
      battle,
      district?.name ?? 'somewhere',
      battle.target.kind === 'location'
        ? (repos.city.control(battle.target.locationId)?.fortification ?? 0)
        : 0,
    ),
    // A bystander is not buying anything for a fight they are not in, and sending them the shelf
    // would be sending them the caller's own research and officer list.
    boosts: side
      ? boostsFor(
          base,
          muster?.army ?? {},
          repos.blackMarket.stashFor(base.id),
          cityLevelFor(repos),
        )
      : [],
    boostId: deployment?.boostId ?? null,
    officerId: deployment?.officerId ?? null,
    // §C3: what has been committed, and what is still in the yard to commit. Both, because the
    // picker's question is "how many of these am I taking", and the answer is bounded by the sum.
    vehicles: deployment?.vehicles ?? {},
    yard: side ? base.fleet : {},
    // §D1: who this crew could send. A bystander gets nothing, for the same reason they get no
    // shelf: the list is the caller's own roster and it is not the other side's business.
    leaders: side ? leadersFor(base, now) : [],
  };
}

/**
 * The officers a crew could put at the front of a column (§D1).
 *
 * Fit ones only. An injured officer is left out rather than sent and greyed: their recovery clock
 * is on the crew screen, which is the one place it belongs, and a second copy of it here is a
 * second place for it to drift. Their combat sheet rides along so the player can weigh a person
 * against a stack of Razors before deciding, which is the whole decision §D1 adds.
 */
function leadersFor(base: Base, now: Date): BattleLeader[] {
  return base.commanders
    .filter((officer) => !officerIsInjured(officer.injuredUntil, now))
    .map((officer) => ({
      officerId: officer.id,
      name: officer.name,
      role: officer.role,
      stats: officerBattleStats(officer.attributes),
    }));
}

function holderLabel(kind: ScheduledBattle['defender']['kind']): string {
  switch (kind) {
    case 'government':
      return 'The Combine';
    case 'looters':
      return 'Looters';
    case 'unoccupied':
      return 'Nobody';
    default:
      return 'Another crew';
  }
}

function reportsFor(repos: Repositories, base: Base): BattleReportView[] {
  return repos.sieges.resolvedFor(base.id, REPORT_HISTORY).map(({ battle, analysis }) => {
    const side = sideOf(repos, battle, base.id) ?? 'attacker';
    const reaches = reportReaches(side, analysis);
    return {
      battleId: battle.id,
      targetName: analysis.locationName,
      resolvedAt: battle.resolvedAt ?? '',
      side,
      won: analysis.winner === side,
      // Withheld outright rather than redacted. A redacted report still leaks the shape of what was
      // kept back, and a perimeter is bought to buy a silence.
      analysis: reaches ? analysis : null,
      redacted: !reaches,
    };
  });
}

/**
 * The crew's own structures, as the defence tab lists them.
 *
 * Level and damage, and nothing to buy: a gate's strength is the level it has been raised to
 * (board request), which is bought in the district's own build queue like every other level. The
 * digging that used to sit here bought defence without buying height and is gone; locations keep
 * theirs, where the ground varies and the choice is real.
 */
function structuresOf(base: Base): StructureDefence[] {
  return base.buildings.map((building) => ({
    buildingId: building.id,
    kind: building.kind,
    label: BUILDING_CATALOG[building.kind].name,
    level: building.level,
    damage: building.damage,
    effectiveness: buildingEffectiveness(building),
  }));
}

function trapsFor(base: Base): TrapOption[] {
  return TRAP_CATALOG.map((spec) => {
    const known = base.research.technologies.includes(spec.requiresTech);
    return {
      trapId: spec.id,
      name: spec.name,
      description: spec.description,
      available: known,
      blocker: known ? '' : 'The Lab has not worked this one out yet',
    };
  });
}

/**
 * §D7: what this crew's name will buy on this particular fight.
 *
 * `reach` is computed against the force they have actually deployed, which is the number that makes
 * the drop-down honest: "+35% defence for your heavy units" on a force with no heavy units in it is
 * worth nothing, and a player should be able to see that before they pay rather than after.
 */
function boostsFor(
  base: Base,
  force: Army,
  stash: BoostStash,
  cityLevel: number,
): BattleBoostOption[] {
  const crew = {
    technologies: base.research.technologies,
    // Chairs, not headcount: a boost unlocked by having a Raid Boss is not unlocked by having
    // signed one and left them on the bench.
    roles: seatedRoles(base.commanders),
  };
  // §D12e: the four manufactured boosts are behind their blueprint as well as behind whoever
  // proposed them. Bound once here rather than per row: the satchel does not change mid-list.
  const boostGate = (boostId: string): boolean =>
    blueprintGateMet(base.inventory, 'battle_boost', boostId);
  const names = BATTLE_BOOSTS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    effect: describeBoostEffect(spec.effect),
    /*
     * Why it is shut, and the blueprint is the half a player can act on.
     *
     * Without this a manufactured boost reads as unavailable with a line about who proposed it,
     * which is a reason the player has already satisfied. The document line comes first for the
     * same reason it is checked first: it is the gate they are part way through.
     */
    // The blueprint line wins while the drawings are what is missing, because that is the half the
    // player can act on. The `??` is not reachable today (the gate only shuts when a document
    // exists to shut it), and it falls back to the proposer rather than to an empty string so that
    // a future boost gated some other way cannot put a blank line on the card.
    source:
      boostGate(spec.id) === false
        ? (describeBlueprintGate('battle_boost', spec.id) ??
          describeBoostUnlock(spec.unlock, (id) => findTech(id)?.name ?? id))
        : describeBoostUnlock(spec.unlock, (id) => findTech(id)?.name ?? id),
    reach: Math.round(boostCoverage(spec.effect, force) * 100),
    affordable: hasInfamy(base.economy.infamy, spec.cost),
    available: boostAvailable(spec, crew, boostGate),
    held: false,
  }));

  /*
   * The crates the crew is carrying, on the same list.
   *
   * Weighted by the city's average level, exactly as the shelf priced them, so what the option
   * says is what the fight applies. `reach` is 100 because contraband lands on the whole force:
   * there is no weight class on a syringe. `affordable` and `available` are both true because the
   * crate is already paid for and already in the bag: what gates it is having one.
   */
  const crates = Object.keys(stash)
    .filter((goodId) => stashCount(stash, goodId) > 0)
    .map((goodId) => ({ goodId, spec: findBlackMarketGood(goodId) }))
    .filter((entry) => entry.spec?.boost !== undefined)
    .map(({ goodId, spec }) => ({
      id: goodId,
      name: spec!.name,
      description: spec!.description,
      cost: 0,
      effect: blackMarketEffect(spec!, cityLevel),
      source: `${stashCount(stash, goodId)} in the bag`,
      reach: 100,
      affordable: true,
      available: true,
      held: true,
    }));

  // Contraband first: it is the part of the list a player can act on without spending anything.
  return [...crates, ...names];
}

/**
 * The front door of every district this crew can see into.
 *
 * Computed here rather than on the district screen, so the answer to "may I attack a location here or
 * only the gate" comes from the same reading of the control table the declaration rules use.
 */
function gatesFor(
  repos: Repositories,
  visible: ReadonlySet<string>,
  now: Date,
): DistrictGateView[] {
  const controls = repos.city.controls();
  return CITY_DISTRICTS.filter((district) => visible.has(district.id)).map((district) => {
    const gate = repos.sieges.gate(district.id);
    return {
      districtId: district.id,
      name: district.name,
      shut: gateArmed(districtHolder(district, controls)),
      brokenUntil: gate && gateIsBrokenAt(gate.brokenUntil, now) ? gate.brokenUntil : null,
    };
  });
}

/** A breach that has run out is a gate standing again: read once, here. */
function gateIsBrokenAt(brokenUntil: string | null, now: Date): boolean {
  return brokenUntil !== null && Date.parse(brokenUntil) > now.getTime();
}

/**
 * §A4: what this crew has on the road.
 *
 * A screen of its own rather than a section of the board, because it answers a different question:
 * the board is "what is coming and what came back", and this is "where is everybody right now".
 */
export function projectActions(repos: Repositories, base: Base, now: Date): ActionsResponse {
  const named = (districtId: string): string => findDistrict(districtId)?.name ?? districtId;

  return {
    movements: repos.movements.forBase(base.id).map((movement) => {
      const battle = repos.sieges.find(movement.battleId);
      const resident = battle ? residentOf(repos, battle.target.districtId) : undefined;
      return {
        id: movement.id,
        battleId: movement.battleId,
        targetName: battle ? targetName(battle.target, resident) : 'somewhere',
        fromName: named(movement.fromDistrictId),
        toName: named(movement.toDistrictId),
        side: movement.side,
        army: movement.army,
        perimeter: movement.perimeter,
        size: movementSize(movement),
        departedAt: movement.departedAt,
        arrivesAt: movement.arrivesAt,
        recallable: movementCancellable(movement, now),
      };
    }),
    serverNow: now.toISOString(),
  };
}

export function projectBattles(repos: Repositories, base: Base, now: Date): BattlesResponse {
  // One context, read once: the same fold the city view uses, so the two screens cannot report a
  // different quality of intel about the same rival. It was two folds and they disagreed. This
  // one had no locations in it, so a Watchtower made the city page sharper and the board blind.
  const context = cityContextFor(repos, base);
  const visible = context.visible;
  const reading = context.intelYieldPercent;

  const coming = repos.sieges
    .pending()
    .filter(
      (battle) => sideOf(repos, battle, base.id) !== null || visible.has(battle.target.districtId),
    )
    .map((battle) => viewOf(repos, base, battle, reading, now));

  return {
    coming,
    reports: reportsFor(repos, base),
    slots: declarableSlots(now).map((slot) => slot.toISOString()),
    infamy: base.economy.infamy,
    gates: gatesFor(repos, visible, now),
    structures: structuresOf(base),
    traps: trapsFor(base),
    serverNow: now.toISOString(),
  };
}
