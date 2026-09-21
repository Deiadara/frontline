import { describe, expect, it } from 'vitest';
import { COMBINE_LEADERS } from '../city/combine.js';
import { findUnit } from '../units/index.js';
import { analyseBattle } from './analysis.js';
import { simulate } from './engine.js';
import { defaultSkirmishEngine } from './skirmish.js';

/**
 * The report names the legendary whose shadow the fight was under.
 *
 * This codebase's own rule, written on the intimidation figure: a mechanic the player cannot see
 * reads as a bug. The Executioner and Directive Xero each leave a toll the report already prints,
 * so a reader could at least tell something had happened. The Syndic leaves none, because her
 * power is points on the Combine's sheets rather than an event: a crew walked into a much harder
 * fight in the Annexes, lost it, and read an aftermath that never mentioned her.
 *
 * Since her 2026-09-20 retune that is the difference between the defence holding 3 of 80 seeds and
 * 75 of 80, so it is the whole fight and it was no part of the report.
 */
const fight = (presence?: (typeof COMBINE_LEADERS)[number]['power']) =>
  analyseBattle({
    battleId: 'b',
    locationName: 'Somewhere',
    simulation: simulate({
      seed: 'report-leader',
      attacker: { name: 'You', army: { razors: 30 }, defending: false },
      defender: {
        name: 'The Combine',
        army: { greycoat: 20 },
        defending: true,
        ...(presence ? { presence } : {}),
      },
    }),
    fled: {},
    winnerLosses: {},
    perimeter: { attacker: {}, defender: {} },
    perimeterCaught: {},
    trap: null,
    infamy: { attacker: 0, defender: 0 },
    ...(presence ? { underLeader: presence } : {}),
  });

describe('the report says who the fight was under', () => {
  it('names each of the three, with the power that made the difference', () => {
    expect(COMBINE_LEADERS.length, 'nothing to name').toBeGreaterThan(0);
    for (const leader of COMBINE_LEADERS) {
      const named = fight(leader.power).underLeader;
      expect(named, `${leader.unitId} is not named`).not.toBeNull();
      expect(named?.name).toBe(findUnit(leader.unitId)?.name);
      expect(named?.powerName).toBe(leader.powerName);
    }
  });

  /**
   * The Syndic is the case this exists for: she leaves no toll, so before this the report had
   * nothing about her at all. Asserted separately so it cannot be lost in the loop above.
   */
  it('names the Syndic, who leaves no toll of her own to print', () => {
    const syndic = COMBINE_LEADERS.find((one) => one.unitId === 'syndic');
    expect(syndic, 'the Syndic is not in the leader table').toBeDefined();
    const report = fight(syndic!.power);
    expect(report.executed).toBe(0);
    expect(report.turned).toEqual({});
    // ...and yet the player is told whose ground they were on.
    expect(report.underLeader?.name).toBe('Syndic');
  });

  /** A fight nobody commanded says so, rather than naming a blank. */
  it('says nobody when the fight was under nobody', () => {
    expect(fight().underLeader).toBeNull();
  });

  /**
   * The same claim again, through the door the game actually uses.
   *
   * The three tests above hand `underLeader` to `analyseBattle` themselves, so all they can prove
   * is that the deriver turns a power into a name. Nothing in them touches the one line that
   * decides whether a real fight ever supplies it: `outcomeFrom` reads `input.defenderPresence`
   * and passes it on, and deleting that line leaves every test above green while every report in
   * the game goes back to saying nobody was there. `defaultSkirmishEngine.resolve` is what
   * `apps/server/src/battle/resolve.ts` calls, so this is the wiring and not a restatement.
   */
  it('carries the presence from the fight the server runs into the report it stores', () => {
    const under = (presence?: (typeof COMBINE_LEADERS)[number]['power']) =>
      defaultSkirmishEngine.resolve({
        seed: 'report-leader-wired',
        attackerName: 'You',
        defenderName: 'The Combine',
        locationName: 'Somewhere',
        attacking: { razors: 30 },
        defending: { greycoat: 20 },
        ...(presence ? { defenderPresence: presence } : {}),
      }).analysis;

    for (const leader of COMBINE_LEADERS) {
      // `analysis` is optional on the outcome because a stub engine may not write one. The real
      // one always does, and a missing report is the failure this test is looking for anyway.
      expect(under(leader.power), `${leader.unitId} produced no report at all`).toBeDefined();
      expect(under(leader.power)?.underLeader, `${leader.unitId} never reaches the report`).toEqual(
        {
          name: findUnit(leader.unitId)?.name,
          powerName: leader.powerName,
        },
      );
    }
    expect(under()?.underLeader).toBeNull();
  });
});
