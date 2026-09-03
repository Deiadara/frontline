/**
 * Getting out of a fight you lost (GDD §A4), through the real engine.
 *
 * The rout is what keeps a lost battle from being an extinction event, and it had the least direct
 * coverage of anything in the combat model: `integration.test.ts` checks that `fled + killed`
 * accounts for everybody, which is a conservation law and passes exactly as happily when nothing
 * ever flees. These ask the questions conservation cannot.
 *
 * Rates over many seeds, never one fight. A rout is a few dozen coin flips and a single seed proves
 * nothing about a probability: pinned to one, a test here would either be flaky or be pinned to a
 * number that stops meaning anything the moment somebody tunes a weight.
 *
 * One trap is worth naming, because the first version of this file fell in it. `fled / (fled +
 * killed)` looks like an escape rate and is not: `killed` counts everybody who died *in the fight*
 * as well as everybody caught running, so the ratio mostly measures how survivable a unit is. Under
 * it Juggernauts "escaped" nearly three times as often as Road Reavers, which is the opposite of
 * what the sheet says, because Juggernauts were alive to run in the first place. Whether the sheet
 * decides who gets away is asked of {@link fleeChance} directly instead.
 */
import { describe, expect, it } from 'vitest';
import { simulate } from './engine.js';
import { fleeChance } from './rout.js';
import { TacticalSkirmishEngine, type SkirmishInput, type SkirmishOutcome } from './skirmish.js';
import type { Army } from '../units/index.js';

const engine = new TacticalSkirmishEngine();
const SEEDS = 40;

const bodies = (army: Army): number =>
  Object.values(army).reduce((sum, count) => sum + (count ?? 0), 0);

/** A fight the attacker loses: sixty against eighty dug in, which is a rout and not a massacre. */
function fight(seed: string, over: Partial<SkirmishInput> = {}): SkirmishOutcome {
  return engine.resolve({
    seed,
    attackerName: 'the raiders',
    defenderName: 'the holders',
    locationName: 'the yard',
    attacking: { razors: 60 },
    defending: { wardens: 80 },
    ...over,
  });
}

/** The same matchup over many seeds, counting only the ones that actually went the way we need. */
function over(ring: Army | undefined = undefined) {
  let fled = 0;
  let killed = 0;
  let ringLosses = 0;
  let brokeThrough = 0;
  let withRunners = 0;
  for (let i = 0; i < SEEDS; i += 1) {
    const outcome = fight(`rout:${i}`, ring ? { defenderPerimeter: ring } : {});
    // Only fights the attacker lost have a withdrawal to measure.
    if (outcome.winner !== 'defender') continue;
    fled += bodies(outcome.fled);
    killed += bodies(outcome.killed);
    ringLosses += bodies(outcome.perimeterLosses);
    // A fight nobody ran from tells us nothing about the ring, and `brokeThrough` is true there by
    // definition: nobody was stopped. Counted separately so the breakthrough rate means something.
    if (bodies(outcome.fled) + bodies(outcome.perimeterCaught) > 0) {
      withRunners += 1;
      if (outcome.brokeThrough) brokeThrough += 1;
    }
  }
  return { fled, killed, ringLosses, brokeThrough, withRunners };
}

describe('units leaving a fight they lost', () => {
  it('gets a real share of them out alive instead of killing all of them', () => {
    const open = over();
    expect(open.fled + open.killed, 'nobody lost a fight in forty tries').toBeGreaterThan(0);
    expect(open.fled, 'every loss killed everybody, every time').toBeGreaterThan(0);
    // Measured at about a quarter of everybody the losing side committed, combat deaths included.
    // A model where losing means dying reads zero; one where it means nothing reads near a half.
    expect(open.fled / (open.fled + open.killed)).toBeGreaterThan(0.15);
  });

  /**
   * Whether the sheet decides who gets away, asked of the roll rather than of the body count.
   *
   * Same losing position and same context for all three, so the only thing between them is the
   * unit. Road Reavers and Ghosts are the fast and the quiet ends of the roster; a Juggernaut is
   * neither, and walks.
   */
  it('gives the fast and the quiet better odds than the slow and the loud', () => {
    const stackOf = (unitId: string) =>
      simulate({
        seed: 'sheet',
        attacker: { name: 'a', army: { [unitId]: 10 }, defending: false },
        defender: { name: 'b', army: { wardens: 40 }, defending: true },
      }).attacker.stacks[0]!;
    const context = { pursuit: 40, lastRound: 4, away: true };

    const reavers = fleeChance(stackOf('road_reavers'), context);
    const ghosts = fleeChance(stackOf('ghosts'), context);
    const juggernauts = fleeChance(stackOf('juggernauts'), context);

    expect(reavers, 'speed bought nothing').toBeGreaterThan(juggernauts);
    expect(ghosts, 'stealth bought nothing').toBeGreaterThan(juggernauts);
    // And nobody is ever certain either way, which is what the clamp is for.
    for (const chance of [reavers, ghosts, juggernauts]) {
      expect(chance).toBeGreaterThan(0);
      expect(chance).toBeLessThan(1);
    }
  });
});

describe('the winner’s ring, on the way out', () => {
  it('gets far fewer of them home than no ring at all', () => {
    const open = over();
    const held = over({ wardens: 30 });
    expect(open.fled, 'nobody escaped even with the road open').toBeGreaterThan(0);
    // Measured at 29 against 590: a ring that holds is the difference between a withdrawal and a
    // report nobody files.
    expect(held.fled).toBeLessThan(open.fled / 2);
  });

  it('costs the ring bodies, which a toll never did', () => {
    expect(over({ wardens: 30 }).ringLosses, 'the ring stopped them for free').toBeGreaterThan(0);
  });

  /*
   * A ring is not a wall, and this is the whole difference between a fight and a catch-rate.
   *
   * Under the old model, thickness scaled only *how much* a ring caught: one body in front of a
   * mass breakout still took its share of them and lost nobody, because there was no way to lose.
   * As a battle it can be ridden through, and it dies doing it.
   */
  it('is ridden through when it is thin, and dies doing it', () => {
    const thin = over({ razors: 1 });
    const thick = over({ wardens: 30 });

    expect(thin.withRunners, 'nobody ran, so there was no ring to test').toBeGreaterThan(0);
    expect(thin.brokeThrough, 'one body turned every mass breakout back').toBe(thin.withRunners);
    expect(thick.brokeThrough, 'thirty wardens were ridden through').toBe(0);
    // It stopped nobody and paid for it: measured at the whole ring, every time.
    expect(thin.fled).toBe(over().fled);
    expect(thin.ringLosses).toBeGreaterThan(0);
  });

  /**
   * The report and the battle log are the same narrative.
   *
   * They were not. `analyseBattle` composed its own prose from `narrate()` alone, while the outcome
   * appended the loss line and whatever the ring did, so the after-action report a player opens
   * stopped at the end of the fight and said nothing about the withdrawal. The e2e fixture had the
   * fuller version hardcoded, which is how it looked correct on screen while the real pipeline
   * produced something shorter: the fixture was the contract and the contract was wrong.
   */
  it('tells the report the same story as the battle log', () => {
    const outcome = fight('narrative', { defenderPerimeter: { wardens: 30 } });
    expect(outcome.analysis, 'the real engine produced no ledger').toBeDefined();
    expect(outcome.analysis?.log).toEqual(outcome.log);
    // And that it is not vacuously equal because both are empty.
    expect(outcome.log.length).toBeGreaterThan(1);
  });

  it('says nothing happened when there was no ring', () => {
    const outcome = fight('no-ring');
    expect(outcome.brokeThrough, 'nobody was stopped, so nothing turned them back').toBe(true);
    expect(outcome.perimeterCaught).toEqual({});
    expect(outcome.perimeterLosses).toEqual({});
  });
});
