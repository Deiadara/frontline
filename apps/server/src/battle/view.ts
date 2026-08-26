import {
  BUILDING_CATALOG,
  CITY_DISTRICTS,
  BATTLE_BOOSTS,
  TRAP_CATALOG,
  buildingEffectiveness,
  fortifyBonusPercent,
  fortifyCost,
  nextFortifyLevel,
  type Building,
  declarableSlots,
  deploymentBlurPercent,
  districtHolder,
  gateArmed,
  deploymentIsOpen,
  deployedSize,
  findDistrict,
  boostAvailable,
  boostCoverage,
  describeBoostEffect,
  describeBoostUnlock,
  findTech,
  hasInfamy,
  intelQualityLine,
  movementCancellable,
  movementSize,
  observedForceSize,
  reportReaches,
  type Army,
  type BattleReportView,
  type BattleSide,
  type BattleView,
  type ActionsResponse,
  type BattlesResponse,
  type Base,
  type DistrictGateView,
  type BattleBoostOption,
  type ScheduledBattle,
  type StructureDefence,
  type TrapOption,
} from '@frontline/shared';
import { crewEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { cityContextFor } from '../city/view.js';
import { sideOf } from './deploy.js';
import { defendingBaseOf } from './declare.js';
import { residentOf, targetName } from './ground.js';

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

function musterOf(repos: Repositories, battle: ScheduledBattle, side: BattleSide) {
  const deployment = repos.sieges.deployment(battle.id, side);
  if (!deployment) return { army: {}, perimeter: {}, size: 0 };
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
  const deployment = repos.sieges.deployment(battle.id, other);
  const force = deployment?.army ?? {};

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
  const deployment = side ? repos.sieges.deployment(battle.id, side) : undefined;

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
    // A bystander is not buying anything for a fight they are not in, and sending them the shelf
    // would be sending them the caller's own research and officer list.
    boosts: side ? boostsFor(base, muster?.army ?? {}) : [],
    boostId: deployment?.boostId ?? null,
  };
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
 * What digging this structure one more level would cost, or null when there is nothing to buy.
 *
 * Null off the Gate as well as at the ceiling: the two are different sentences on screen ("only
 * the Gate is worth it" against "as dug in as it goes") but they are the same absence of an offer,
 * and the route refuses both.
 */
function nextGateFortify(building: Building): StructureDefence['nextFortify'] {
  if (building.kind !== 'gate') return null;
  const level = nextFortifyLevel(building.fortification);
  if (level === null) return null;
  return {
    level,
    cost: fortifyCost(level),
    bonusPercent: fortifyBonusPercent('medium', level),
  };
}

function structuresOf(base: Base): StructureDefence[] {
  return base.buildings.map((building) => ({
    buildingId: building.id,
    kind: building.kind,
    label: BUILDING_CATALOG[building.kind].name,
    level: building.level,
    damage: building.damage,
    effectiveness: buildingEffectiveness(building),
    fortification: building.fortification,
    // Only the Gate's digging is worth anything, and the screen says so by quoting zero on the
    // rest rather than by hiding the row: a player who has just spent on the wrong structure
    // needs to see that it bought nothing.
    fortifyPercent:
      building.kind === 'gate' ? fortifyBonusPercent('medium', building.fortification) : 0,
    nextFortify: nextGateFortify(building),
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
function boostsFor(base: Base, force: Army): BattleBoostOption[] {
  const crew = {
    technologies: base.research.technologies,
    roles: base.commanders.map((officer) => officer.role),
  };
  return BATTLE_BOOSTS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    effect: describeBoostEffect(spec.effect),
    source: describeBoostUnlock(spec.unlock, (id) => findTech(id)?.name ?? id),
    reach: Math.round(boostCoverage(spec.effect, force) * 100),
    affordable: hasInfamy(base.economy.infamy, spec.cost),
    available: boostAvailable(spec.unlock, crew),
  }));
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
