import { randomUUID } from 'node:crypto';
import {
  declarationRefusal,
  declareInfamyCost,
  emptyDeployment,
  findCity,
  findDistrict,
  formatDayClock,
  isHeldBy,
  scheduleRefusal,
  spendInfamy,
  type BattleTarget,
  type DistrictStanding,
  type Base,
  type DeclarationRefusal,
  type District,
  type LocationHolder,
  type ScheduledBattle,
  type ScheduleRefusal,
  GAME_TIMEZONE,
  LOST_CALL_COOLDOWN_HOURS,
} from '@frontline/shared';
import { adminWaives } from '../admin/mode.js';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import {
  crewCalledOutAmong,
  defenderOf,
  defendingBaseOf,
  districtStandingFor,
  residentOf,
  targetName,
} from './ground.js';
import { npcMuster } from './npc.js';
import { notifyBase } from '../social/notify.js';
import { logFightCalled } from '../factions/log.js';

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
  'gate_down',
  /** The target names a district the map does not have, or a location outside the one it names. */
  'no_such_place',
  /** The district is in a city that is authored but not open yet (`City.open`). */
  'city_closed',
  'already_declared',
  /** This crew called a fight here and lost it less than a day ago (`LOST_CALL_COOLDOWN_HOURS`). */
  'lost_here',
  'too_many_pending',
  'own_ground',
  /** Nobody holds the place: it is walked onto, never fought for (maintainer, 2026-10-04). */
  'empty_ground',
  /** §D7: the call's price in infamy, which this crew has not got. */
  'cannot_afford',
  /** A fight through a breach, called for after the gate is back up. */
  'breach_closes',
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
  /** Admin mode, which waives the call's price along with every other one (`admin/mode.ts`). */
  admin?: boolean;
}

/**
 * Whether this crew called a fight on `target` and lost it within `LOST_CALL_COOLDOWN_HOURS` of
 * `now`, counted from the fight's mark (maintainer, 2026-10-05). Only the losing caller waits:
 * anybody else may call the place at once. A fight called off with no winner is not a loss.
 */
function lostHereRecently(
  repos: Repositories,
  baseId: string,
  target: BattleTarget,
  now: Date,
): boolean {
  const since = new Date(now.getTime() - LOST_CALL_COOLDOWN_HOURS * 3_600_000).toISOString();
  return repos.sieges.lostCallsSince(baseId, since).some((lost) => sameTarget(lost, target));
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
  if (!district) return { kind: 'refused', reason: 'no_such_place' };
  // A shut city has ground in the atlas and no way onto it (bug pass, 2026-09-29): a call there took
  // plots in a city no screen draws, so the closed door is checked here rather than trusted to the UI.
  if (findCity(district.cityId)?.open !== true) return { kind: 'refused', reason: 'city_closed' };
  /*
   * The location has to be *in* the district the target names.
   *
   * The two ids arrive separately and nothing tied them together: the gate rule and the infamy
   * price read `districtId`, while the defender, the capture and the resolver read `locationId`. A
   * crew could therefore name a shut district's location under an open district's id, march down
   * the shorter road, and take the location behind a gate it was never allowed through.
   */
  if (
    target.kind === 'location' &&
    !district.locations.some((location) => location.id === target.locationId)
  ) {
    return { kind: 'refused', reason: 'no_such_place' };
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
    /*
     * Ground nobody holds is taken by walking onto it (maintainer, 2026-10-04: "Don't allow
     * calling a fight on an empty ground. Make it so you just have to send units instead"). A call
     * there was a fight against nobody, and it shut the place to every walk-in for eight hours.
     */
    if (control?.holder.kind === 'unoccupied') return { kind: 'refused', reason: 'empty_ground' };
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
  if (lostHereRecently(repos, base.id, target, now))
    return { kind: 'refused', reason: 'lost_here' };
  // The cap, widened by what research has opened (the Raid Boss's last rung, The Name, calls one
  // more fight at once).
  const cap = MAX_PENDING_DECLARATIONS + standingEffectsFor(repos, base, now).declarationsFlat;
  if (repos.sieges.pendingCountFor(base.id) >= cap) {
    return { kind: 'refused', reason: 'too_many_pending' };
  }

  const late: ScheduleRefusal | null = scheduleRefusal(scheduledFor, now);
  if (late) return { kind: 'refused', reason: late };
  /*
   * A breach is a window, and the fight has to land inside it (maintainer, 2026-09-27). A raid, or
   * a location fight in a shut district, is only legal because the gate is down; called for after
   * it comes back up, it would reach ground the rules say is closed. The settle checks again at
   * the mark (`battle/resolve.ts`), for a gate put back early.
   */
  if (throughBreach(target, standing)) {
    const brokenUntil = repos.sieges.gate(target.districtId)?.brokenUntil ?? null;
    if (brokenUntil === null || scheduledFor.getTime() >= Date.parse(brokenUntil)) {
      return { kind: 'refused', reason: 'breach_closes' };
    }
  }

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
    // Winners stay and hold what they took, always (maintainer, 2026-09-22 and 2026-09-28: "The
    // server should automatically give the winners what they should hold, not ask them").
    holdAfterCapture: true,
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
  logFightCalled(repos, battle, base, now);
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
  // On the defender's own clock face, the one their board and Fights tab print the same mark on
  // (bug pass, 2026-10-02): the house clock here read 18:30 to a defender whose screens said 00:30.
  const zone = repos.users.findById(defending.ownerId)?.timezone ?? GAME_TIMEZONE;
  notifyBase(repos, defending.id, {
    kind: 'district_attacked',
    title: `${attacker.name} has called a fight on you`,
    body: `${targetName(battle.target, defending)}, at ${formatDayClock(new Date(battle.scheduledFor), zone)}.`,
    link: '/game/battles',
    subjectId: battle.id,
    at: now,
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
 *
 * Read off the crews' summary rows, which the board passes in once for its whole list.
 */
export function callPriceFor(
  repos: Repositories,
  target: BattleTarget,
  district: District,
  summaries: ReturnType<Repositories['bases']['listSummaries']> = repos.bases.listSummaries(),
): number {
  const defender = defenderOf(repos, target, district);
  const crew = crewCalledOutAmong(summaries, target, defender);
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
  /*
   * Off the summaries, read once (bug pass, 2026-10-06), as the board's price list is: `/me` ran
   * a full parse of each pending fight's defender, so one unreadable defender answered 500 to
   * every player in the world, on the read every screen polls.
   */
  const summaries = repos.bases.listSummaries();
  return repos.sieges
    .pending()
    .filter(
      (battle) =>
        battle.attackerBaseId !== base.id &&
        crewCalledOutAmong(summaries, battle.target, battle.defender)?.id === base.id,
    ).length;
}

/** Whether a fight is only legal because the district's gate is down. */
export function throughBreach(
  target: BattleTarget,
  standing: Pick<DistrictStanding, 'shut'>,
): boolean {
  return target.kind === 'district' || (target.kind === 'location' && standing.shut);
}
