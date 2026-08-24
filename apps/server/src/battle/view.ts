import {
  BUILDING_CATALOG,
  CITY_DISTRICTS,
  INFAMY_SACRIFICES,
  TRAP_CATALOG,
  buildingEffectiveness,
  declarableSlots,
  deploymentBlurPercent,
  districtHolder,
  gateArmed,
  deploymentIsOpen,
  deployedSize,
  findDistrict,
  findSacrifice,
  hasInfamy,
  intelQualityLine,
  observedForceSize,
  reportReaches,
  type BattleReportView,
  type BattleSide,
  type BattleView,
  type BattlesResponse,
  type Base,
  type DistrictGateView,
  type SacrificeOption,
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
 * than on any other, because the thing being hidden is the one thing worth hiding — what the other
 * side has moved up. A field that was sometimes null would leak by its own shape, so the enemy's
 * composition is not a nullable field: it does not exist. What exists is a *count*, and only when
 * this crew's intelligence is good enough to have one.
 */

/** How many finished fights a crew is handed. Enough to learn from, short of an archive. */
export const REPORT_HISTORY = 20;

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
 * Their counter-intelligence and the force's own stealth against this crew's reading — one figure,
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

  return {
    battle,
    targetName: targetName(battle.target, resident),
    districtName: district?.name ?? 'somewhere',
    role: side ?? 'bystander',
    side,
    deploymentOpen: deploymentIsOpen(new Date(battle.scheduledFor), now),
    muster: side ? musterOf(repos, battle, side) : null,
    enemySize: enemy.size,
    enemyIntel: side ? enemy.quality : 'You are not in this one.',
    opponentName:
      side === 'defender'
        ? attackerName
        : (defenderBase?.name ?? holderLabel(battle.defender.kind)),
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

function structuresOf(base: Base): StructureDefence[] {
  return base.buildings.map((building) => ({
    buildingId: building.id,
    kind: building.kind,
    label: BUILDING_CATALOG[building.kind].name,
    level: building.level,
    damage: building.damage,
    effectiveness: buildingEffectiveness(building),
    garrisons: building.garrisons,
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

function sacrificesFor(base: Base): SacrificeOption[] {
  return INFAMY_SACRIFICES.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    cost: spec.cost,
    hours: spec.hours,
    effect: `+${spec.magnitude} on ${spec.channel.replace(/Percent|Flat/, '')} for ${spec.hours}h`,
    affordable: hasInfamy(base.economy.infamy, spec.cost),
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

/** A breach that has run out is a gate standing again — read once, here. */
function gateIsBrokenAt(brokenUntil: string | null, now: Date): boolean {
  return brokenUntil !== null && Date.parse(brokenUntil) > now.getTime();
}

export function projectBattles(repos: Repositories, base: Base, now: Date): BattlesResponse {
  const visible = cityContextFor(repos, base).visible;
  const reading = crewEffectsFor(repos, base).intelYieldPercent;

  const coming = repos.sieges
    .pending()
    .filter(
      (battle) => sideOf(repos, battle, base.id) !== null || visible.has(battle.target.districtId),
    )
    .map((battle) => viewOf(repos, base, battle, reading, now));

  const running = base.economy.sacrifice;
  const runningSpec = running ? findSacrifice(running.id) : undefined;

  return {
    coming,
    reports: reportsFor(repos, base),
    slots: declarableSlots(now).map((slot) => slot.toISOString()),
    infamy: base.economy.infamy,
    sacrifices: sacrificesFor(base),
    sacrificeRunning:
      running && runningSpec && Date.parse(running.until) > now.getTime()
        ? `${runningSpec.name}, until ${running.until}`
        : null,
    gates: gatesFor(repos, visible, now),
    structures: structuresOf(base),
    traps: trapsFor(base),
    serverNow: now.toISOString(),
  };
}
