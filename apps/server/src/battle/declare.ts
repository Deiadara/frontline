import { randomUUID } from 'node:crypto';
import {
  declarationRefusal,
  emptyDeployment,
  findDistrict,
  formatDayClock,
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
import { standingEffectsFor } from '../crew/standing.js';
import { defenderOf, districtStandingFor, residentOf, targetName } from './ground.js';
import { npcMuster } from './npc.js';
import { notifyBase } from '../social/notify.js';

/**
 * Calling a fight (GDD §A4, battle rework).
 *
 * A declaration is public, timed and cheap: it commits no units and costs no materials. What it
 * costs is surprise: the whole point of the rework is that the defender is told, and told early
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
 * the city at once and decide later which one you actually meant, which turns a public commitment
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
  return a.districtId === b.districtId;
}

export function declareBattle(repos: Repositories, input: DeclareInput): DeclareResult {
  const { base, target, scheduledFor, now } = input;

  const district = findDistrict(target.districtId);
  if (!district) return { kind: 'refused', reason: 'unscouted' };

  // The same visibility the map computed, uplink range included: deriving it twice from different
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
  if (defender.kind === 'crew' && defender.baseId === base.id) {
    return { kind: 'refused', reason: 'own_ground' };
  }
  if (target.kind === 'location') {
    const control = repos.city.control(target.locationId);
    if (control && isHeldBy(control, base.id)) return { kind: 'refused', reason: 'own_ground' };
  }
  /*
   * Your own home is not a target either, at the gate or behind it.
   *
   * `defenderOf` answers the *district's* holder, and residential ground has no locations to hold,
   * so it answers `unoccupied` and the check above cannot see this case at all. The party actually
   * being called out is the resident, and the resident may be the caller: a crew could declare a
   * raid on itself, and the settle then looted the resident (itself) and paid the haul back off a
   * stockpile read before the loot, so the same fight minted resources out of nothing.
   */
  if (target.kind !== 'location' && residentOf(repos, target.districtId)?.id === base.id) {
    return { kind: 'refused', reason: 'own_ground' };
  }

  if (alreadyCalled(repos, target)) return { kind: 'refused', reason: 'already_declared' };
  // The cap, widened by what research has opened (the Field Commander's and the Raid Boss's last
  // rungs each call one more fight at once).
  const cap = MAX_PENDING_DECLARATIONS + standingEffectsFor(repos, base, now).declarationsFlat;
  if (repos.sieges.pendingCountFor(base.id) >= cap) {
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
  // somewhere to move people to. An NPC fills theirs immediately (§A3: they answer a call the same
  // day it is made); a crew fills theirs when they get round to it, or does not.
  const defendingBase = defender.kind === 'crew' ? defender.baseId : null;
  repos.sieges.putDeployment({
    ...emptyDeployment(battle.id, defendingBase, 'defender', at),
    army: npcMuster(defender, district, battle.seed),
  });

  tellTheDefender(repos, battle, base, now);
  return { kind: 'ok', battle };
}

/**
 * §A4: the defender is told, and told early enough to do something about it.
 *
 * That sentence is the whole reason a declaration is public and eight hours out, and nothing was
 * saying it: `district_attacked` is one of the two receipts a player is not allowed to silence
 * and it had no emitter anywhere in the server, so the only way to find out somebody had called a
 * fight on your ground was to open the battle board and read it.
 *
 * Written here rather than in the route because a declaration is the only thing that creates one,
 * and `notify` never throws: a bell that cannot ring must not take the call down with it.
 *
 * A `gate` or `district` target names no crew on the row, so the crew being called out is found
 * the same way the settler finds it (`defendingBaseOf`). An NPC holder has no base and hears
 * nothing, which is what `notifyBase` already does with a district nobody lives in.
 */
function tellTheDefender(
  repos: Repositories,
  battle: ScheduledBattle,
  attacker: Base,
  now: Date,
): void {
  const defending = defendingBaseOf(repos, battle);
  // A crew cannot declare on its own ground (`own_ground` above), so this is never self-addressed.
  if (!defending || defending.id === attacker.id) return;
  notifyBase(repos, defending.id, {
    kind: 'district_attacked',
    title: `${attacker.name} has called a fight on you`,
    // The house clock (`time/zone.ts`): a mark quoted in anything else is a mark two players
    // read differently.
    body: `${targetName(battle.target, defending)}, at ${formatDayClock(new Date(battle.scheduledFor))}.`,
    link: '/game/battles',
    subjectId: battle.id,
    now,
  });
}

/** The crew standing behind the defending side, if one is. */
/**
 * How many fights still to come somebody has called on this crew's ground.
 *
 * The number behind the red mark on the bottom bar (`UnreadCounts.fightsOnYou`). Counted the way
 * the settler finds the defender (`defendingBaseOf`), so a fight called on the gate of a district
 * this crew lives in, or on the district itself, counts, and a fight this crew called does not.
 */
export function fightsCalledOn(repos: Repositories, base: Base): number {
  return repos.sieges
    .pending()
    .filter(
      (battle) =>
        battle.attackerBaseId !== base.id && defendingBaseOf(repos, battle)?.id === base.id,
    ).length;
}

export function defendingBaseOf(repos: Repositories, battle: ScheduledBattle): Base | undefined {
  if (battle.defender.kind === 'crew') return repos.bases.findById(battle.defender.baseId);
  // A gate or a raid names a district rather than a party, and a lived-in district has a crew
  // behind it whether or not the control table calls them the holder.
  if (battle.target.kind !== 'location') return residentOf(repos, battle.target.districtId);
  return undefined;
}
