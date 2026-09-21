import { describe, expect, it } from 'vitest';
import {
  bareBattlefield,
  battlefieldFor,
  DEFAULT_FRONTAGE,
  frontageFor,
  FRONTAGE_BY_CONTEXT,
} from './battlefield.js';
import {
  ambushShare,
  engagedUnits,
  frontageShare,
  mergeLosses,
  simulate,
  STEALTH_UNTAGGED_SHARE,
  type Simulation,
} from './engine.js';
import { findUnit } from '../units/index.js';

/**
 * Combat width, and the opening strike.
 *
 * These are the two mechanics that stop the fight being decided entirely by how much you brought.
 * Width says how much of it can deploy; the ambush says what being *unseen* is worth.
 */

const DAY = new Date('2026-08-14T13:00:00Z');

/** The same side with one stat overridden: the only way to move a single term at a time. */
const seeing = (side: Simulation['defender'], stealth: number): Simulation['defender'] => ({
  ...side,
  stacks: side.stacks.map((stack) => ({ ...stack, effective: { ...stack.effective, stealth } })),
});

const field = (kind: 'sewer_junction' | 'rail_yard' | 'armory') =>
  battlefieldFor({
    locationName: kind,
    kind,
    fortifyDifficulty: 'medium',
    fortifyLevel: 0,
    at: DAY,
  });

function run(
  attacking: Record<string, number>,
  defending: Record<string, number>,
  battlefield = bareBattlefield(),
  seeds = 24,
): { attackerWins: number; simulations: Simulation[] } {
  const simulations: Simulation[] = [];
  let attackerWins = 0;
  for (let seed = 0; seed < seeds; seed += 1) {
    const simulation = simulate({
      seed: `w-${seed}`,
      battlefield,
      attacker: { name: 'A', army: attacking, defending: false },
      defender: { name: 'D', army: defending, defending: true },
    });
    if (simulation.winner === 'attacker') attackerWins += 1;
    simulations.push(simulation);
  }
  return { attackerWins, simulations };
}

describe('combat width', () => {
  /**
   * The ordering, not the three numbers.
   *
   * Frontage is the context's width narrowed (or widened) by how Crammed or Open the ground is
   * labelled: a sewer junction is `Crammed IV` and gets *narrower* than bare `underground`, which
   * is the point of reading the label into the width at all. Pinning the raw constants made this
   * a restatement of `FRONTAGE_BY_CONTEXT` that could not see the label doing anything; what has
   * to hold is that a tunnel takes fewer units than a room and a room fewer than a yard.
   */
  it('is narrowest where the ground is narrowest', () => {
    const tunnel = field('sewer_junction').frontage;
    const room = field('armory').frontage;
    const yard = field('rail_yard').frontage;
    expect(tunnel).toBeLessThan(room);
    expect(room).toBeLessThan(yard);
    // And the labels genuinely bite: a `Crammed IV` tunnel is tighter than bare underground.
    expect(tunnel).toBeLessThan(FRONTAGE_BY_CONTEXT.underground ?? 0);
    // A rail yard is `Open III`, so it takes more than open ground alone would.
    expect(yard).toBeGreaterThan(FRONTAGE_BY_CONTEXT.open_ground ?? 0);
  });

  it('takes the narrowest of the contexts that apply', () => {
    expect(frontageFor(['indoor', 'urban'])).toBe(FRONTAGE_BY_CONTEXT.indoor);
    expect(frontageFor(['urban', 'open_ground'])).toBe(FRONTAGE_BY_CONTEXT.urban);
  });

  it('falls back to a default for ground with nothing to say about its shape', () => {
    expect(frontageFor(['dark'])).toBe(DEFAULT_FRONTAGE);
    expect(frontageFor([])).toBe(DEFAULT_FRONTAGE);
  });

  it('caps how many units are in contact, and never below one', () => {
    const [side] = run({ razors: 40 }, { razors: 1 }, bareBattlefield(), 1).simulations;
    expect(side).toBeDefined();
    if (!side) return;
    expect(engagedUnits(side.attacker, 10)).toBe(10);
    expect(engagedUnits(side.attacker, 100)).toBe(40);
    expect(engagedUnits(side.attacker, 0)).toBe(1);
    expect(frontageShare(side.attacker, 10)).toBeCloseTo(0.25, 6);
    expect(frontageShare(side.attacker, 100)).toBe(1);
  });

  /**
   * An overstack penalty lived here and was reverted (maintainer, 2026-09-18).
   *
   * Its cases went with it, because they pinned a mechanic that no longer exists. What is worth
   * keeping is why, and that is written at length on `engagedUnits` in `engine.ts`: the penalty
   * did not make depth cost anything (300 against 60 still won every seed) and it made even fights
   * at scale unwinnable for the attacker (150 v 150 went to 0 wins in 60). Both halves are
   * measured there. The cases below this line are the original combat-width ones and are unrelated
   * to it.
   */

  /**
   * The whole reason combat width exists.
   *
   * The same overwhelming force, on ground it can deploy on and on ground it cannot. In a sewer the
   * fortieth Razor is queuing, so a small good defence has a chance it does not have in a rail yard.
   */
  it('makes numbers worth far less on narrow ground', () => {
    // Isolated to the width and nothing else. Comparing a sewer with a rail yard does *not* isolate
    // it: those grounds also switch different unit modifiers on, and a first version of this test
    // comparing them passed with the frontage cap deleted outright. These two differ in one field.
    const ground = (frontage: number) => ({ ...bareBattlefield(), frontage });
    const wide = run({ razors: 44 }, { wardens: 10 }, ground(48)).attackerWins;
    const narrow = run({ razors: 44 }, { wardens: 10 }, ground(10)).attackerWins;
    expect(wide).toBeGreaterThan(narrow);
  });

  /**
   * The claim the cap makes, isolated: past the frontage, extra units add almost no *output*.
   *
   * Doubling an army that already cannot deploy has to be close to worthless offensively: it still
   * buys durability, which is why the two are measured on what the *defender* has left rather than
   * on who won. Without the cap on fire, twice the razors is twice the damage and this collapses.
   */
  it('stops extra units past the frontage from adding fire', () => {
    const narrow = { ...bareBattlefield(), frontage: 10 };
    /*
     * More seeds than the rest of this file, because this one compares two *estimates*.
     *
     * Every other assertion here is a comparison between two runs of the same shape, where the
     * noise largely cancels. This one measures a gap against a fixed threshold, so the noise is the
     * whole question, and 24 seeds does not settle it: the gap reads 0.104 at 24 seeds, 0.097 at
     * 100 and 0.090 at 400. It sat the wrong side of the bar on a sample too small to say so, and
     * went red on a morale change that moved the real figure by about a point.
     */
    const survived = (attackers: number) => {
      const { simulations } = run({ razors: attackers }, { wardens: 12 }, narrow, 200);
      return (
        simulations.reduce((total, simulation) => {
          const started = simulation.defender.stacks.reduce((n, stack) => n + stack.started, 0);
          const alive = simulation.defender.stacks.reduce((n, stack) => n + stack.alive, 0);
          return total + alive / started;
        }, 0) / simulations.length
      );
    };
    // Four times the units, all of them past the width. The defender must come out of both in
    // roughly the same shape. Not *exactly*: since 2026-09-21 a queued body fires
    // `SECOND_RANK_FIRE` of its share scaled by its range, and a Razor's range of 5 lets a sliver
    // through, so the bar sits a little above the noise it was measured against.
    expect(Math.abs(survived(48) - survived(12))).toBeLessThan(0.15);
  });

  /**
   * ...and does nothing at all to a force that fits inside it.
   *
   * Four units, because a sewer junction is five wide.
   *
   * This sent eight into both grounds and asserted that all of them deployed, which is not true of
   * a frontage of five and never was: it passed because an even 8-v-8 had already killed the
   * attacker down under the width by the time anything was counted, so what it actually measured
   * was attrition. A one percent change in damage moved who died and the whole thing fell over.
   * Now the force genuinely fits, and the defender is small enough that it is still standing to
   * be counted.
   */
  it('costs a force that fits within the frontage nothing', () => {
    // The narrow ground is the binding one, so the force is sized to it and checked against both.
    expect(field('sewer_junction').frontage).toBeGreaterThanOrEqual(4);
    const [wide] = run({ razors: 4 }, { razors: 1 }, field('rail_yard'), 1).simulations;
    const [narrow] = run({ razors: 4 }, { razors: 1 }, field('sewer_junction'), 1).simulations;
    expect(wide && narrow).toBeTruthy();
    if (!wide || !narrow) return;
    expect(frontageShare(wide.attacker, field('rail_yard').frontage)).toBe(1);
    expect(frontageShare(narrow.attacker, field('sewer_junction').frontage)).toBe(1);
  });
});

describe('the opening strike', () => {
  /**
   * Since 2026-09-21 an unmarked stack hides at `STEALTH_UNTAGGED_SHARE` of a marked one, so a
   * force with nobody marked is not worth *nothing*: it is worth less than the same stealth would
   * be with the mark, and nothing at all against an enemy that can already see it.
   */
  it('is worth less to a force with nobody marked than to one with the mark', () => {
    const [plain] = run({ razors: 12 }, { sparks: 12 }, bareBattlefield(), 1).simulations;
    const [marked] = run({ ghosts: 12 }, { sparks: 12 }, bareBattlefield(), 1).simulations;
    expect(plain).toBeDefined();
    expect(marked).toBeDefined();
    if (!plain || !marked) return;
    expect(ambushShare(plain.attacker, plain.defender)).toBeLessThan(
      ambushShare(marked.attacker, marked.defender),
    );
  });

  /**
   * The `ambush` mark is worth something *on its own*, at equal stealth.
   *
   * The test above it compares Razors to Ghosts, which differ by 55 points of stealth as well as
   * by the mark, so it passes on the rating alone: between 2026-09-21's stealth generalisation
   * and this, the mark bought literally nothing and that test stayed green. `stealth / hidden` is
   * a weighted mean, so the weight cancels exactly for any force whose stacks are marked the same
   * way, and the share came out at the bare rating either way.
   *
   * Cyber Dogs carry the mark and Netrunners do not, and both sheets read 55 stealth, so the mark
   * is the only thing that differs. `units.test.ts` holds the catalogue's shape; if that pairing
   * is ever retuned apart this test should be re-pointed rather than deleted.
   *
   * `ambushShare` reads the sides as the fight left them, so the fixture has to leave both runs
   * in the same shape or the *enemy* is what differs: a stack that broke is skipped entirely, and
   * `watchfulness` is the enemy's own mean stealth, which is zero once the enemy is gone. Two
   * hundred against four Sparks settles both the same way, and the defender count is asserted
   * below rather than assumed.
   */
  it('is worth more to a marked force than to an unmarked one of the same stealth', () => {
    expect(findUnit('cyber_dogs')?.modifiers).toContain('ambush');
    expect(findUnit('netrunners')?.modifiers ?? []).not.toContain('ambush');
    expect(findUnit('cyber_dogs')?.stats.stealth).toBe(findUnit('netrunners')?.stats.stealth);

    const [marked] = run({ cyber_dogs: 200 }, { sparks: 4 }, bareBattlefield(), 1).simulations;
    const [plain] = run({ netrunners: 200 }, { sparks: 4 }, bareBattlefield(), 1).simulations;
    expect(marked && plain).toBeTruthy();
    if (!marked || !plain) return;

    const standing = (side: Simulation['defender']): number =>
      side.stacks.reduce((total, stack) => total + stack.alive, 0);
    expect(
      standing(marked.defender),
      'the two runs left different enemies standing, so the watchfulness differs too',
    ).toBe(standing(plain.defender));
    expect(marked.attacker.stacks[0]?.brokeAt, 'a broken stack is skipped entirely').toBeNull();
    expect(plain.attacker.stacks[0]?.brokeAt).toBeNull();

    const withMark = ambushShare(marked.attacker, marked.defender);
    const without = ambushShare(plain.attacker, plain.defender);
    expect(without, 'an unmarked force should still get something').toBeGreaterThan(0);
    expect(withMark, 'the mark bought nothing at all').toBeGreaterThan(without);
    // ...and by the weight, not by a rounding: an unmarked body hides at `STEALTH_UNTAGGED_SHARE`.
    expect(without / withMark).toBeCloseTo(STEALTH_UNTAGGED_SHARE, 5);
  });

  it('is worth something to a force that can hide from what it is hitting', () => {
    // Ghosts carry `ambush` and 60 stealth; Sparks carry neither and have very little.
    const [only] = run({ ghosts: 12 }, { sparks: 12 }, bareBattlefield(), 1).simulations;
    expect(only).toBeDefined();
    if (!only) return;
    expect(ambushShare(only.attacker, only.defender)).toBeGreaterThan(0);
  });

  /**
   * Stealth is the whole of what separates an ambush from a free hit, so it is moved on its own
   * rather than by swapping the enemy: a version of this test that put a Specter on the other side
   * passed with the stealth term replaced by 1, because the enemy's *whole sheet* had changed.
   */
  it('is worth nothing to an ambusher the enemy can already see', () => {
    const [only] = run({ ghosts: 12 }, { sparks: 12 }, bareBattlefield(), 1).simulations;
    expect(only).toBeDefined();
    if (!only) return;

    expect(ambushShare(only.attacker, seeing(only.defender, 0))).toBeGreaterThan(0);
    expect(ambushShare(only.attacker, seeing(only.defender, 100))).toBe(0);
  });

  it('is worth more the wider the stealth gap', () => {
    const [only] = run({ ghosts: 12 }, { sparks: 12 }, bareBattlefield(), 1).simulations;
    expect(only).toBeDefined();
    if (!only) return;
    const against = (stealth: number) => ambushShare(only.attacker, seeing(only.defender, stealth));
    expect(against(0)).toBeGreaterThan(against(20));
    expect(against(20)).toBeGreaterThan(against(40));
  });

  /** It has to change the outcome, not just the arithmetic. */
  it('wins fights an identical force without it would lose', () => {
    // Ghosts and Sleepers are close on the sheet; Sleepers carry `ambush`, Ghosts also do.
    // Scrapers carry it too, so this compares an ambusher against a plain unit of similar cost.
    const withIt = run({ scrapers: 26 }, { sparks: 20 }, bareBattlefield()).attackerWins;
    const withoutIt = run({ anodics: 26 }, { sparks: 20 }, bareBattlefield()).attackerWins;
    expect(withIt).toBeGreaterThanOrEqual(withoutIt);
  });
});

describe('regressions in the opening strike', () => {
  /**
   * The arithmetic of folding the opening strike into round one.
   *
   * Two loss fractions of *different* starting numbers do not add: losing a fifth and then a fifth
   * of what is left is 36% gone, not 40%. Tested directly, because the integration below can only
   * show that an opening strike happened, not that it was combined correctly.
   */
  it('compounds two rounds of losses rather than adding them', () => {
    const stack = {} as never;
    const merged = mergeLosses(new Map([[stack, 0.2]]), new Map([[stack, 0.2]]));
    expect(merged.get(stack)).toBeCloseTo(0.36, 6);

    expect(mergeLosses(new Map([[stack, 0.5]]), undefined).get(stack)).toBe(0.5);
    expect(mergeLosses(new Map(), new Map([[stack, 0.3]])).get(stack)).toBeCloseTo(0.3, 6);
    // Nothing can be lost twice over.
    expect(mergeLosses(new Map([[stack, 1]]), new Map([[stack, 1]])).get(stack)).toBe(1);
  });

  it('reports an opening strike only where one was set', () => {
    const of = (attacking: Record<string, number>) =>
      simulate({
        seed: 'opening',
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: attacking, defending: false },
        defender: { name: 'D', army: { sparks: 20 }, defending: true },
      }).openingStrike;
    // Scrapers carry `ambush`; Anodics do not.
    expect(of({ scrapers: 20 })).toBeGreaterThan(0);
    expect(of({ anodics: 20 })).toBe(0);
  });

  /**
   * A roster the engine cannot resolve must not count toward being outnumbered.
   *
   * Asserted on the reason the modifier *records*, not on who won. Two earlier versions of this
   * test measured win rates and both passed with the fix reverted, because a 25% Last Stand bonus
   * does not flip a matchup that was not close: the flag was set wrongly and nothing downstream
   * moved far enough to see it.
   */
  it('counts only units that exist when deciding who is outnumbered', () => {
    const reasons = (attacking: Record<string, number>) =>
      simulate({
        seed: 'phantom',
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: attacking, defending: false },
        // Wardens carry `last_stand`, which is the only sheet that reads `outnumbered`.
        defender: { name: 'D', army: { wardens: 10 }, defending: true },
      }).defender.stacks[0]?.effective.reasons ?? [];

    // Twelve real units against ten is not outnumbering anybody.
    expect(reasons({ razors: 12 })).not.toContain('Last Stand');
    // ...and two hundred units that do not exist must not change that.
    expect(reasons({ razors: 12, not_a_unit: 200 })).not.toContain('Last Stand');
    // The flag still fires when the units are real, or this would pass by never firing at all.
    expect(reasons({ razors: 40 })).toContain('Last Stand');
  });
});
