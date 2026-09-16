import {
  TacticalSkirmishEngine,
  loadable,
  recoverCasualties,
  mergeFleets,
  removeFleet,
  ridingGroups,
  unitSlotsUsed,
  wrecked,
  type Army,
  type BattleOfficer,
  type BattleTier,
  type CrewEffects,
  type Fleet,
  type MissionOutcome,
  type UnitLoadouts,
} from '@frontline/shared';
import { removeForce } from '../battle/forces.js';
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
  /** The units that did not come home. */
  lost: Army;
  /** The enemy's dead, which is what the job pays a name for (§D7, `missionInfamyForKills`). */
  killed: Army;
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
  /** §B10: what the crew's medicine and its Infirmary get back off a win, as a percentage. */
  recoveryPercent?: number;
  /**
   * What the crew has bolted to each unit (`units/loadout.ts`), folded onto every sheet the way
   * the battle settler folds `attacker.unitLoadouts`. It was not passed at all, so a card fitted
   * in the yard fought on a declared battle and did nothing on a battle job down the same road.
   */
  loadouts?: UnitLoadouts;
  /**
   * §E5: the crew's own book, folded the way a declared battle folds it.
   *
   * It was not passed at all, so the one mission kind that kills people was the one fight in the
   * game the crew fought bare: no perks, no held ground, no cohesion, no marks, no `carriers_fight`
   * and none of the six `lead_*` channels. A crew that had bought every offensive perk in the book
   * fought a battle job exactly as well as one that had bought none, on a screen that tells them
   * their people are at risk.
   */
  territory?: CrewEffects;
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
    ...(args.loadouts ? { attackerUpgrades: args.loadouts } : {}),
    ...(args.territory
      ? {
          attackerTerritory: args.territory,
          attackerCohesionPercent: args.territory.cohesionPercent,
        }
      : {}),
  });

  const won = fought.winner === 'attacker';
  // The engine names the dead by who lost the field: `killed` is the loser's and `winnerLosses` the
  // winner's, so which list is ours and which is theirs turns on who held it.
  const killed = won ? fought.killed : fought.winnerLosses;
  /*
   * §F2 and §B10: the medics take some of the crew's dead off the list, on a win.
   *
   * The same rule and the same two sources as a declared battle (`battle/resolve.ts`): the crew's
   * own medicine plus the Infirmary, winner only, because a routed force leaves its wounded where
   * they fell. Neither reached a battle job, so a Chief Medic, `sig_field_surgeon`, the Joker's
   * seat and a level 20 Infirmary saved nobody on the one job that kills people.
   */
  const fell = won ? fought.winnerLosses : fought.killed;
  const lost = won ? recoverCasualties(fell, args.recoveryPercent ?? 0) : fell;
  const home = removeForce(args.force, lost);

  /*
   * §C3: a machine whose riders all died is gone, the way the battle settler loses them.
   *
   * The same three steps and the same reasons: only what somebody was riding is at risk, an empty
   * truck cannot be wrecked by killing everybody on it, and what `wrecked` reads is the share of
   * the force that walked away.
   */
  // Unit slots on both sides, the currency the seats were sold in (`building/vehicles.ts`).
  const committed = unitSlotsUsed(args.force);
  const riding = loadable(args.vehicles, ridingGroups(args.force, args.anyRide));
  const idle = removeFleet(args.vehicles, riding);
  const wreckedVehicles = committed <= 0 ? {} : wrecked(riding, unitSlotsUsed(home) / committed);

  return {
    outcome: won ? 'success' : 'failure',
    enemy,
    lost,
    killed,
    home,
    vehicles: mergeFleets(idle, removeFleet(riding, wreckedVehicles)),
    wreckedVehicles,
  };
}
