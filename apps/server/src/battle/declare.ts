import { randomUUID } from 'node:crypto';
import {
  declarationRefusal,
  declareInfamyCost,
  emptyDeployment,
  findDistrict,
  formatDayClock,
  isHeldBy,
  scheduleRefusal,
  spendInfamy,
  type BattleTarget,
  type Base,
  type DeclarationRefusal,
  type District,
  type LocationHolder,
  type ScheduledBattle,
  type ScheduleRefusal,
} from '@frontline/shared';
import { adminWaives } from '../admin/mode.js';
import type { Repositories } from '../db/repos/index.js';
import { cityContextFor } from '../city/view.js';
import { standingEffectsFor } from '../crew/standing.js';
import {
  crewCalledOut,
  defenderOf,
  defendingBaseOf,
  districtStandingFor,
  residentOf,
  targetName,
} from './ground.js';
import { npcMuster } from './npc.js';
import { notifyBase } from '../social/notify.js';

/**
 * Calling a fight (GDD §A4, battle rework).
 *
 * A declaration is public, timed and commits nobody: no units are sent and no materials change
 * hands. What it costs is surprise, because the whole point of the rework is that the defender is
 * told and told early enough to do something about it, and {@link DECLARE_INFAMY_COST} of the
 * caller's standing on top when the defender is a person ({@link callPriceFor}).
 *
 * Everything a declaration can be refused for is in {@link DECLARE_REFUSALS}, and each check runs in
 * the order a player wants to hear about it: what you are allowed to attack comes before when you
 * are allowed to attack it, because one is a fact about the world and the other is a fact about the
 * clock.
 */

/**
 * How many unresolved calls one crew may have out.
 *
 * Three. A call on a player costs a name ({@link DECLARE_INFAMY_COST}) but nothing that has to be
 * moved or garrisoned, and a call on anybody else costs nothing at all, so a crew could still paper
 * the city in calls and decide later which one it actually meant, which turns a public commitment
 * into noise and makes the defender's day's notice worthless. The price thins that out where it
 * applies; the cap ends it everywhere.
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
  /** §D7: the call's price in infamy, which this crew has not got. */
  'cannot_afford',
] as const;
export type DeclareRefusal = (typeof DECLARE_REFUSALS)[number];

export type DeclareResult =
  | { kind: 'refused'; reason: DeclareRefusal }
  | {
      kind: 'ok';
      battle: ScheduledBattle;
      /**
       * The caller, with the call's price already taken off.
       *
       * Returned rather than left for the route to re-read: the charge and the row are written in
       * one transaction here, and a route that responded with the base it passed in would hand the
       * screen a wallet that still had the hundred in it.
       */
      base: Base;
    };

export interface DeclareInput {
  base: Base;
  target: BattleTarget;
  scheduledFor: Date;
  now: Date;
  /** Leave the survivors holding the location they take, instead of marching them home (§A4). */
  holdAfterCapture?: boolean;
  /** Admin mode, which waives the call's price along with every other one (`admin/mode.ts`). */
  admin?: boolean;
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
  /*
   * The location has to be *in* the district the target names.
   *
   * The two ids arrive separately and nothing tied them together: the visibility check, the gate
   * rule and the infamy price all read `districtId`, while the defender, the capture and the
   * resolver read `locationId`. A crew could therefore name a shut, unscouted district's location
   * under an open district's id, march down the shorter road, and take the location behind a gate
   * it was never allowed through. Refused as `unscouted`, which is what the target *is* from where
   * the caller is standing.
   */
  if (
    target.kind === 'location' &&
    !district.locations.some((location) => location.id === target.locationId)
  ) {
    return { kind: 'refused', reason: 'unscouted' };
  }

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
  if (
    target.kind !== 'location' &&
    (residentOf(repos, target.districtId)?.id === base.id || base.districtId === target.districtId)
  ) {
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

  /*
   * §D7's price, checked last on purpose.
   *
   * Every refusal above is one a player can answer by picking a different target or a different
   * mark, and this is the one they can only answer by going and earning it. Telling somebody their
   * name is too small for a fight that was never legal in the first place sends them off to spend a
   * week on ground they still will not be allowed to call.
   *
   * Waived in admin mode with the rest of the price gates (`admin/mode.ts`), which is what keeps
   * the console's mock battle working in a city where no bot has earned a name yet.
   */
  const price = adminWaives('cannot_afford', input.admin ?? false)
    ? 0
    : callPriceFor(repos, target, district);
  const infamyLeft = spendInfamy(base.economy.infamy, price);
  if (infamyLeft === null) return { kind: 'refused', reason: 'cannot_afford' };

  /*
   * §A4: the Sleepers this crew planted here, who wake into the attacking deployment.
   *
   * Poured into the deployment at the *declaration* rather than folded in at the settle, and the
   * difference is everything a player sees. In the deployment they are on the board: the deploy
   * window counts them in the force it is planning, and they can still be pulled back out before
   * the mark, which `adjustDeployment` already does for anybody standing on the ground. Folded
   * in at resolve they would be a surprise on the report, and the withdrawal would have needed a
   * second door of its own.
   *
   * Only cells `waiting`: one still walking has not arrived, and one already recalled has left.
   * And only on a `location` target, because a cell is planted on a location and nowhere else.
   */
  const woken =
    target.kind === 'location' ? repos.sleepers.waitingAt(base.id, target.locationId) : undefined;

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
    /*
     * §A4: whether a cell of this crew's was already standing here (`city/sleepers.ts`).
     *
     * Recorded on the row because after the next few lines it is unrecoverable: the cell is
     * deleted and its Sleepers are indistinguishable in the deployment from Sleepers somebody
     * marched in the ordinary way. The `planted` ladder counts plans that came off, not crews
     * that happen to own the sheet.
     */
    wokeSleepers: woken !== undefined,
  };
  // The row and the bill together. Both callers wrap this in one transaction, so a call that is
  // recorded is a call that was paid for.
  repos.sieges.insert(battle);
  const economy = { ...base.economy, infamy: infamyLeft };
  repos.bases.updateEconomy(base.id, economy);

  const at = now.toISOString();
  if (woken) repos.sleepers.remove(woken.id);
  repos.sieges.putDeployment({
    ...emptyDeployment(battle.id, base.id, 'attacker', at),
    ...(woken ? { army: woken.army } : {}),
  });

  // The defending side's row exists from the moment the call is made, so both participants have
  // somewhere to move people to. An NPC fills theirs immediately (§A3: they answer a call the same
  // day it is made); a crew fills theirs when they get round to it, or does not.
  const defendingBase = defender.kind === 'crew' ? defender.baseId : null;
  repos.sieges.putDeployment({
    ...emptyDeployment(battle.id, defendingBase, 'defender', at),
    army: npcMuster(defender, district, battle.seed),
  });

  tellTheDefender(repos, battle, base, now);
  return { kind: 'ok', battle, base: { ...base, economy } };
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

/**
 * §D7: what calling a fight on this ground costs the caller.
 *
 * The rule is `declareInfamyCost` in shared; this reads the two facts it wants off the map and the
 * roster. The party a call is on is the crew {@link crewCalledOut} finds, and whether a person is
 * behind them is `Base.isBot`, which is the one thing that tells a player's crew from the seeded
 * rival's: both hold ground under a `crew` plate, both have a user row and a name. The same
 * function prices the board (`battle/view.ts`), so the dialog quotes what the route charges.
 */
export function callPriceFor(
  repos: Repositories,
  target: BattleTarget,
  district: District,
): number {
  const defender = defenderOf(repos, target, district);
  const crew = crewCalledOut(repos, target, defender);
  const party: LocationHolder = crew ? { kind: 'crew', baseId: crew.id } : defender;
  return declareInfamyCost(party, crew !== undefined && !crew.isBot);
}

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
