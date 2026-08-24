import { randomUUID } from 'node:crypto';
import {
  declarationRefusal,
  emptyDeployment,
  findDistrict,
  isHeldBy,
  scheduleRefusal,
  type BattleTarget,
  type Base,
  type DeclarationRefusal,
  type ScheduledBattle,
  type ScheduleRefusal,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { cityContextFor } from '../city/view.js';
import { defenderOf, districtStandingFor, residentOf } from './ground.js';
import { npcMuster } from './npc.js';

/**
 * Calling a fight (GDD §A4, battle rework).
 *
 * A declaration is public, timed and cheap: it commits no units and costs no materials. What it
 * costs is surprise — the whole point of the rework is that the defender is told, and told early
 * enough to do something about it.
 *
 * Everything a declaration can be refused for is in {@link DECLARE_REFUSALS}, and each check runs in
 * the order a player wants to hear about it: what you are allowed to attack comes before when you
 * are allowed to attack it, because one is a fact about the world and the other is a fact about the
 * clock.
 */

/**
 * How many unresolved calls one crew may have out.
 *
 * Three. Declarations are free, so without a cap the correct opening move is to call every location in
 * the city at once and decide later which one you actually meant — which turns a public commitment
 * into noise and makes the defender's day's notice worthless.
 */
export const MAX_PENDING_DECLARATIONS = 3;

export const DECLARE_REFUSALS = [
  'off_slot',
  'too_soon',
  'too_late',
  'gate_armed',
  'no_gate',
  'gate_intact',
  'nothing_to_break',
  'unscouted',
  'already_declared',
  'too_many_pending',
  'own_ground',
] as const;
export type DeclareRefusal = (typeof DECLARE_REFUSALS)[number];

export type DeclareResult =
  { kind: 'refused'; reason: DeclareRefusal } | { kind: 'ok'; battle: ScheduledBattle };

export interface DeclareInput {
  base: Base;
  target: BattleTarget;
  scheduledFor: Date;
  now: Date;
  /** Leave the survivors holding the location they take, instead of marching them home (§A4). */
  holdAfterCapture?: boolean;
}

/** True when the target is already the subject of a call nobody has resolved yet. */
function alreadyCalled(repos: Repositories, target: BattleTarget): boolean {
  return repos.sieges.pending().some((battle) => sameTarget(battle.target, target));
}

export function sameTarget(a: BattleTarget, b: BattleTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'location' && b.kind === 'location') return a.locationId === b.locationId;
  if (a.kind === 'building' && b.kind === 'building') return a.buildingId === b.buildingId;
  return a.districtId === b.districtId;
}

export function declareBattle(repos: Repositories, input: DeclareInput): DeclareResult {
  const { base, target, scheduledFor, now } = input;

  const district = findDistrict(target.districtId);
  if (!district) return { kind: 'refused', reason: 'unscouted' };

  // The same visibility the map computed, uplink range included — deriving it twice from different
  // inputs is how a screen and a rule quietly disagree about what a crew can see.
  if (!cityContextFor(repos, base).visible.has(district.id)) {
    return { kind: 'refused', reason: 'unscouted' };
  }

  // What may be attacked comes first: it is a fact about the world, and telling somebody their time
  // is wrong when the target was never legal sends them looking in the wrong location.
  const standing = districtStandingFor(repos, district, now);
  const illegal: DeclarationRefusal | null = declarationRefusal(target, standing);
  if (illegal) return { kind: 'refused', reason: illegal };

  const defender = defenderOf(repos, target, district);
  if (defender.kind === 'faction' && defender.baseId === base.id) {
    return { kind: 'refused', reason: 'own_ground' };
  }
  if (target.kind === 'location') {
    const control = repos.city.control(target.locationId);
    if (control && isHeldBy(control, base.id)) return { kind: 'refused', reason: 'own_ground' };
  }

  if (alreadyCalled(repos, target)) return { kind: 'refused', reason: 'already_declared' };
  if (repos.sieges.pendingCountFor(base.id) >= MAX_PENDING_DECLARATIONS) {
    return { kind: 'refused', reason: 'too_many_pending' };
  }

  const late: ScheduleRefusal | null = scheduleRefusal(scheduledFor, now);
  if (late) return { kind: 'refused', reason: late };

  const battle: ScheduledBattle = {
    id: randomUUID(),
    target,
    attackerBaseId: base.id,
    defender,
    scheduledFor: scheduledFor.toISOString(),
    declaredAt: now.toISOString(),
    resolvedAt: null,
    seed: randomUUID(),
    holdAfterCapture: input.holdAfterCapture ?? false,
  };
  repos.sieges.insert(battle);

  const at = now.toISOString();
  repos.sieges.putDeployment(emptyDeployment(battle.id, base.id, 'attacker', at));

  // The defending side's row exists from the moment the call is made, so both participants have
  // somewhere to move people to. An NPC fills theirs immediately (§A3 — they answer a call the same
  // day it is made); a crew fills theirs when they get round to it, or does not.
  const defendingBase = defender.kind === 'faction' ? defender.baseId : null;
  repos.sieges.putDeployment({
    ...emptyDeployment(battle.id, defendingBase, 'defender', at),
    army: npcMuster(defender, district, battle.seed),
  });

  return { kind: 'ok', battle };
}

/** The crew standing behind the defending side, if one is. */
export function defendingBaseOf(repos: Repositories, battle: ScheduledBattle): Base | undefined {
  if (battle.defender.kind === 'faction') return repos.bases.findById(battle.defender.baseId);
  // A gate or a structure names a district rather than a party, and a lived-in district has a crew
  // behind it whether or not the control table calls them the holder.
  if (battle.target.kind !== 'location') return residentOf(repos, battle.target.districtId);
  return undefined;
}
