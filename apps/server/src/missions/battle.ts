import {
  TacticalSkirmishEngine,
  loadable,
  mergeFleets,
  removeFleet,
  ridingBodies,
  wrecked,
  type Army,
  type BattleOfficer,
  type BattleTier,
  type Fleet,
  type MissionOutcome,
} from '@frontline/shared';
import { forceSize, removeForce } from '../battle/forces.js';
import { enemyForce } from './enemy.js';

/**
 * A battle job, fought (maintainer, 2026-09-10).
 *
 * A `battle` template used to settle the way a scrap run does: one draw against a frozen number,
 * and everybody walked home whatever it said. §E5 has always claimed a battle job *risks your
 * people*, and it did not: the risk it priced was an empty bag.
 *
 * So it is a fight now, with the engine that settles a declared battle. The crew is the attacker,
 * the tier's force (`enemy.ts`) is the defender, and the ground is bare: no fortification, no
 * weather worth the name, and **no ring on either side**. That last one is the rule the maintainer
 * asked for in as many words: whoever breaks and runs is not pursued, so a lost battle job is a
 * mauling rather than an extermination, and a crew can come home beaten and still be a crew.
 *
 * What comes back is `force` less the dead. On a win that is the winner's casualties; on a loss it
 * is everybody who did not get clear, which is what `routSurvivors` decides. Porters are never in
 * the line (`standsInLine`) and are therefore never on either list: they came for the haul and
 * they walk back with it, or with nothing.
 */

export interface MissionBattle {
  /** Whether the crew held the field. */
  outcome: MissionOutcome;
  /** Who was waiting. Kept for the report and for the tests; nothing on the wire carries it. */
  enemy: Army;
  /** The bodies that did not come home. */
  lost: Army;
  /** ...and the ones that did, `force` less `lost`. */
  home: Army;
  /** The machines that came back. */
  vehicles: Fleet;
  /** §C3: and the ones whose riders all died. */
  wreckedVehicles: Fleet;
}

export function fightMissionBattle(args: {
  /** The row's own seed, so the fight is as reproducible as the roll it replaces. */
  seed: number;
  /** The name of the job, which is the only name this ground has. */
  jobName: string;
  force: Army;
  vehicles: Fleet;
  tier: BattleTier;
  /** The crew's level, which is what the tier's figure scales on. */
  level: number;
  /** §D1: whoever led the run, folded in the way a declared battle folds them. */
  leader?: BattleOfficer | undefined;
  /** §C3: whether this crew's holdings put anybody in a seat (`any_ride`). */
  anyRide: boolean;
}): MissionBattle {
  const seed = String(args.seed);
  const enemy = enemyForce(args.tier, args.level, seed);
  const fought = new TacticalSkirmishEngine().resolve({
    seed: `${seed}:battle`,
    attackerName: 'Your crew',
    defenderName: 'Whoever was waiting',
    locationName: args.jobName,
    attacking: args.force,
    defending: enemy,
    ...(args.leader ? { attackerOfficer: args.leader } : {}),
  });

  const won = fought.winner === 'attacker';
  const lost = won ? fought.winnerLosses : fought.killed;
  const home = removeForce(args.force, lost);

  /*
   * §C3: a machine whose riders all died is gone, the way the battle settler loses them.
   *
   * The same three steps and the same reasons: only what somebody was riding is at risk, an empty
   * truck cannot be wrecked by killing everybody on it, and what `wrecked` reads is the share of
   * the force that walked away.
   */
  const committed = forceSize(args.force);
  const riding = loadable(args.vehicles, ridingBodies(args.force, args.anyRide));
  const idle = removeFleet(args.vehicles, riding);
  const wreckedVehicles = committed <= 0 ? {} : wrecked(riding, forceSize(home) / committed);

  return {
    outcome: won ? 'success' : 'failure',
    enemy,
    lost,
    home,
    vehicles: mergeFleets(idle, removeFleet(riding, wreckedVehicles)),
    wreckedVehicles,
  };
}
