import { describe, expect, it } from 'vitest';
import {
  JAM_FULL_SHARE,
  MAX_JAM,
  MAX_JAM_CEILING,
  bareBattlefield,
  battlefieldFor,
  contextBonusPercent,
  effectiveStats,
  findUnit,
  jamPercent,
  LOCATION_KINDS,
  noTerritoryEffects,
  simulate,
  upgradedStats,
  type Battlefield,
  type CombatContext,
  type SideState,
  type Stack,
  type UnitSpec,
} from '../index.js';

/**
 * The Netrunners' jam (maintainer, 2026-09-18).
 *
 * "Remove Armour Piercing and have them do 20 damage. Instead what they do to be strong is the
 * following: they have a tag that reduces the enemy unit's armour and damage by X% when they
 * participate in combat, and that effect is applied before attacks."
 *
 * Two halves are tested separately because they fail separately. The arithmetic is checked on
 * hand-built sides, where a share can be set exactly and the answer is a number rather than an
 * outcome; the effect is checked through `simulate`, because a percentage that is computed
 * correctly and then never reaches an exchange is the bug this whole feature is exposed to.
 */

const NETRUNNERS = findUnit('netrunners')!;
const RAZORS = findUnit('razors')!;

/** A stack, built the way `buildStacks` builds one, so `effective` is the real thing. */
function stackOf(
  unit: UnitSpec,
  alive: number,
  ground: Battlefield = bareBattlefield(),
  fitted: readonly string[] = [],
): Stack {
  const effective = effectiveStats(
    unit,
    ground,
    { defending: false, outnumbered: false },
    noTerritoryEffects(),
    fitted,
  );
  return {
    unit,
    effective,
    alive,
    pool: alive * effective.vitality,
    bodies: new Array<number>(alive).fill(effective.vitality),
    morale: effective.morale,
    brokeAt: null,
    started: alive,
    charged: 0,
    suppressed: 0,
    dealt: 0,
    // What `buildStacks` puts here: the sheet with the workshop's refits on and the ground off.
    sheet: upgradedStats(unit.stats, fitted),
    loudTier: 0,
  };
}

const sideOf = (stacks: Stack[]): SideState => ({
  name: 'A',
  stacks,
  defending: false,
  swing: 1,
  luck: 0,
  cohesionPercent: 0,
  steadyNerve: false,
});

describe('what a jamming line takes off the other side', () => {
  it('is nothing at all without one', () => {
    expect(jamPercent(sideOf([stackOf(RAZORS, 40)]))).toBe(0);
    expect(jamPercent(sideOf([]))).toBe(0);
  });

  it('rises with the jammers share of the line and stops at the ceiling', () => {
    // A line of forty. `JAM_FULL_SHARE` of it is ten, so ten is where it tops out.
    const full = Math.round(40 * JAM_FULL_SHARE);
    const at = (jammers: number): number =>
      jamPercent(sideOf([stackOf(NETRUNNERS, jammers), stackOf(RAZORS, 40 - jammers)]));

    expect(at(full)).toBeCloseTo(MAX_JAM, 5);
    expect(at(full * 2), 'past the share, it keeps climbing').toBeCloseTo(MAX_JAM, 5);
    // Linear under it, so a player can read the sheet: half the share is half the jam.
    expect(at(full / 2)).toBeCloseTo(MAX_JAM / 2, 5);
    // ...and strictly increasing, which a cap applied at the wrong end would break.
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(4)).toBeGreaterThan(at(2));
  });

  it('stops the moment the last of them is down, or has run', () => {
    const line = stackOf(RAZORS, 30);
    const dead = { ...stackOf(NETRUNNERS, 10), alive: 0, pool: 0, bodies: [] };
    const routed = { ...stackOf(NETRUNNERS, 10), brokeAt: 2 };
    expect(jamPercent(sideOf([dead, line]))).toBe(0);
    expect(jamPercent(sideOf([routed, line]))).toBe(0);
  });

  /**
   * The maintainer's second note: the ground has to move it.
   *
   * "Make sure the eerie and crammed bonuses apply to the Netrunners' tag too, not just their
   * attack and defence, as this is their main form of hitting the enemy."
   *
   * Their offense is twenty, so every percentage the game spends on making them hit harder was
   * landing on a number nobody cares about. Measured on ground they like against ground they do
   * not, with the same ten of them in the same line.
   */
  it('moves with the ground the jammers are standing on', () => {
    const line = (ground: Battlefield): number =>
      jamPercent(sideOf([stackOf(NETRUNNERS, 10, ground), stackOf(RAZORS, 30, ground)]));

    // A crammed indoor site against bare open ground. Netrunners carry `crammed: 5` per tier and
    // `night_operations`, so a tight dark room is their ground and open daylight is not.
    const cellar = battlefieldFor({
      locationName: 'a cellar',
      kind: 'smugglers_tunnel',
      fortifyDifficulty: 'medium',
      fortifyLevel: 0,
      at: new Date('2026-09-18T12:00:00.000Z'),
      weather: 'normal',
    });
    const open = bareBattlefield();

    expect(line(cellar), 'the ground did nothing to the jam').not.toBeCloseTo(line(open), 3);
    // Both stay inside the hard stop, whatever the ground is worth.
    expect(line(cellar)).toBeLessThanOrEqual(MAX_JAM_CEILING);
    expect(line(open)).toBeLessThanOrEqual(MAX_JAM_CEILING);
  });

  /**
   * A gunsight makes them shoot better. It does not make them jam better.
   *
   * The bug this test exists for, found in the 2026-09-18 bug pass. The jam is scaled by what
   * the situation did to the unit's offense, and the workshop's refits are **flat points**:
   * Guided Rounds is +72, which is a rounding error on a Sniper's 350 and a 4.6x multiplier on
   * a Netrunner's 20. Read against the catalogue figure, the three refits the Scrapyard sells
   * for this sheet each took a jamming line from 40% straight to the 60% ceiling, and the
   * intricate one was worth exactly as much as the masterpiece.
   *
   * The fix is the denominator: `Stack.sheet` carries the refits too, so they cancel.
   */
  it('is not moved by a refit, however big the gunsight', () => {
    const line = (fitted: readonly string[]): number =>
      jamPercent(sideOf([stackOf(NETRUNNERS, 10, bareBattlefield(), fitted), stackOf(RAZORS, 30)]));

    const bare = line([]);
    for (const refit of ['hardened_optics', 'ranging_gear', 'guided_rounds']) {
      // The premise: the refit really is on the sheet and really is enormous relative to it.
      const fittedOffense = upgradedStats(NETRUNNERS.stats, [refit]).offense;
      expect(fittedOffense, refit).toBeGreaterThan(NETRUNNERS.stats.offense);
      expect(line([refit]), `${refit} moved the jam`).toBeCloseTo(bare, 5);
    }
    // ...and the biggest of the three is a multiplier big enough to have hit the ceiling.
    expect(
      upgradedStats(NETRUNNERS.stats, ['guided_rounds']).offense / NETRUNNERS.stats.offense,
    ).toBeGreaterThan(4);
  });

  /**
   * ...and neither is it moved by who they are jamming (bug pass, 2026-09-19).
   *
   * The card used to promise that "everything that would make another unit hit harder makes them
   * jam harder instead", and two whole families of bonus are outside that: the workshop's refits,
   * pinned above, and the `vs_` modifiers, which `matchup.ts` decides against one target at a
   * time. The Netrunners carry `tracking`, the biggest of them at +45%, so a player reading that
   * sentence beside that chip would conclude the jam bites deeper into something evasive. It does
   * not, and cannot: a jam is laid on the whole enemy line at once, so there is no target to read
   * a `vs_` modifier against.
   */
  it('is not moved by what it is jamming, though Tracking is on the sheet', () => {
    expect(NETRUNNERS.modifiers).toContain('tracking');
    // Tracking is worth real points, and more of them than any other modifier in the table.
    expect(contextBonusPercent(NETRUNNERS, ['vs_evasive']).percent).toBeGreaterThan(0);

    /*
     * ...and none of them can reach the jam, because no ground the game builds carries them.
     *
     * The jam's ratio comes out of `effectiveStats`, which resolves `battlefield.contexts` and
     * nothing else, and `battlefieldFor` pushes exactly one of the `vs_` family: `vs_structure`,
     * which is a property of the ground. The three target-shaped ones are decided per exchange
     * in `matchup.ts`, against one defender at a time, and a jam has no one defender.
     *
     * Swept over every location kind rather than asserted about one, because this is a claim
     * about the whole map and a new kind is the way it would quietly stop being true.
     */
    const targetShaped: readonly CombatContext[] = ['vs_armor', 'vs_evasive', 'vs_low_morale'];
    for (const kind of LOCATION_KINDS) {
      const ground = battlefieldFor({
        locationName: kind,
        kind,
        fortifyDifficulty: 'medium',
        fortifyLevel: 10,
        at: new Date('2026-09-19T22:00:00.000Z'),
        weather: 'stormy',
      });
      for (const context of targetShaped) {
        expect(ground.contexts, `${kind} carries ${context}`).not.toContain(context);
      }
      // The control: fortified ground does carry the one `vs_` context that is about the place,
      // so this sweep is reading a list that really can hold members of that family.
      expect(ground.contexts).toContain('vs_structure');
    }
  });

  it('never runs past the hard ceiling, whatever the ground is worth', () => {
    // Every context at once, which is more than any real location grants.
    const everywhere: Battlefield = {
      ...bareBattlefield(),
      contexts: ['urban', 'dark', 'indoor', 'underground', 'open_ground'],
      labels: [
        { id: 'crammed', tier: 4 },
        { id: 'dark', tier: 4 },
      ],
    };
    expect(jamPercent(sideOf([stackOf(NETRUNNERS, 40, everywhere)]))).toBeLessThanOrEqual(
      MAX_JAM_CEILING,
    );
  });
});

describe('the Netrunners sheet the jam replaced', () => {
  it('does almost no damage and no longer carries Armour Piercing', () => {
    expect(NETRUNNERS.jammer).toBe(true);
    expect(NETRUNNERS.stats.offense).toBe(20);
    expect(NETRUNNERS.modifiers).not.toContain('armor_piercing');
    // The floor under the whole feature: twenty offense has to be *low*, or the jam is a bonus on
    // top of a gun rather than the reason to bring them.
    expect(NETRUNNERS.stats.offense).toBeLessThan(RAZORS.stats.offense);
  });
});

/**
 * ...and that it reaches an exchange, which the arithmetic above cannot say.
 *
 * Through `simulate`, comparing round one of two fights that differ only in whether the jammers
 * are there. The jammers are added *on top* rather than swapped in, so the line firing back is
 * identical and the only thing that moved is the jam: a swap would confound the effect with the
 * bodies it cost.
 */
describe('the jam, in a fight', () => {
  /*
   * Room for everybody, so adding jammers does not quietly answer a different question.
   *
   * `frontageShare` divides a side's fire by how much of it fits on the ground, so putting twenty
   * more bodies beside sixty razors on ordinary ground makes each razor fire *less*. Measured on
   * open ground the jam looked like a penalty for exactly that reason: 0.083 against 0.100. A
   * frontage nothing reaches takes combat width out of the comparison and leaves the jam.
   */
  const ROOMY: Battlefield = { ...bareBattlefield(), frontage: 10_000 };

  /** What each side dealt and lost over the whole fight, from the stacks themselves. */
  const fight = (army: Record<string, number>, enemy: Record<string, number>) => {
    const out = simulate({
      seed: 'jam-probe',
      attacker: { name: 'A', army, defending: false },
      defender: { name: 'D', army: enemy, defending: true },
      battlefield: ROOMY,
    });
    const dead = (side: SideState, unitId: string): number =>
      side.stacks
        .filter((stack) => stack.unit.id === unitId)
        .reduce((total, stack) => total + (stack.started - stack.alive), 0);
    const first = out.rounds[0];
    if (!first) throw new Error('the fight had no rounds');
    return {
      theirDead: dead(out.defender, Object.keys(enemy)[0] ?? ''),
      ourRazorsDead: dead(out.attacker, 'razors'),
      /*
       * Round one alone, which is the only window where the armour half can be seen on its own.
       *
       * Both sides fire from the same snapshot, so nothing the jam did to the *enemy's damage*
       * has saved a single one of our shooters yet: whatever extra they lose in round one, they
       * lost to their own armour being down. By round two the two halves are tangled, and a
       * whole-fight count passes with the armour cut deleted, which is how this test was wrong
       * the first time.
       */
      theirFirstRound: first.defenderLost,
    };
  };

  /**
   * The armour half, measured against something that has some.
   *
   * A Razor wears five points of armour, so taking forty per cent of it off is worth two points
   * and the effect is inside the noise. The jam's armour half is a rule about *armoured* enemies,
   * which is what makes a Juggernaut the honest target for it.
   */
  /**
   * The armour half, isolated by **what it is worth against different armour**.
   *
   * Two confounds have to go before this measures anything. Round one alone removes the damage
   * half, because both sides fire from the same snapshot and nothing the jam did to the enemy's
   * offense has saved one of our shooters yet. What is left is that the two hundred Netrunners
   * are themselves two hundred more guns, and adding them raises the round-one figure whether or
   * not the armour cut exists at all: with the cut deleted the reading was still "more than the
   * bare line", which is how this test was wrong the first time it was written.
   *
   * So the reading is a *ratio of ratios*. The same comparison runs against Juggernauts (68
   * armour) and against Razors (5), and only the armour half can care which. Measured on the
   * same seed:
   *
   * | | gain vs armour 68 | vs armour 5 | ratio |
   * | --- | --- | --- | --- |
   * | as shipped | 2.250 | 1.095 | **2.05** |
   * | armour half deleted | 1.500 | 1.095 | 1.37 |
   *
   * The floor sits at 1.7, between the two. The unarmoured column is identical in both rows,
   * which is the check that this is measuring armour and not the size of the army.
   *
   * Six hundred Razors because `defenderLost` is a share of a stack: twelve Juggernauts lose
   * nobody at all in one round to sixty of them, jam or no jam, and zero against zero proves
   * nothing.
   */
  it('is worth far more against armour than against none', () => {
    const gainAgainst = (enemy: Record<string, number>): number => {
      const alone = fight({ razors: 600 }, enemy).theirFirstRound;
      const jammed = fight({ razors: 600, netrunners: 200 }, enemy).theirFirstRound;
      expect(alone, 'nobody died in round one, so there is no ratio to take').toBeGreaterThan(0);
      return jammed / alone;
    };

    /*
     * Twenty-four Juggernauts since 2026-09-21. Armour is worth less per point now, so the gap is
     * smaller, and on this field six hundred Razors kill every smaller armoured line to the last
     * body in round one, jam or no jam, which reads as a ratio of exactly one and proves nothing.
     *
     * The bar has come down twice, and each time against a freshly measured control rather than
     * against the shipped number alone, because a floor that drifts up to meet the code is a test
     * that has stopped asking anything:
     *
     * | | ratio, as shipped | ratio, armour half deleted | bar |
     * | --- | --- | --- | --- |
     * | before 2026-09-21 | 2.05 | 1.37 | 1.7 |
     * | after the armour retune | 1.47 | ~1.2 | 1.4 |
     * | after the ambush weighting | **1.387** | **1.134** | **1.25** |
     *
     * The last row moved because the opening volley is now scaled by how much of the force is
     * hidden (`ambushShare`): two hundred Netrunners carry the `ambush` mark and six hundred
     * Razors do not, so the jammed line and the bare line no longer open with the same share of a
     * round. The mechanic is untouched, and the control says so: delete the armour half and the
     * reading falls to 1.134, a fifth of the way from the bar to nothing.
     */
    const armoured = gainAgainst({ juggernauts: 24 });
    const unarmoured = gainAgainst({ razors: 200 });
    expect(armoured, 'the jam did nothing extra to an armoured enemy').toBeGreaterThan(
      unarmoured * 1.25,
    );
  });

  it('kills more of an armoured enemy over the whole fight', () => {
    const enemy = { juggernauts: 24 };
    expect(fight({ razors: 600, netrunners: 200 }, enemy).theirDead).toBeGreaterThan(
      fight({ razors: 600 }, enemy).theirDead,
    );
  });

  it('does more the more of the line is doing it', () => {
    const enemy = { juggernauts: 12 };
    const few = fight({ razors: 60, netrunners: 2 }, enemy);
    const many = fight({ razors: 60, netrunners: 20 }, enemy);
    expect(many.theirDead).toBeGreaterThan(few.theirDead);
  });

  /**
   * ...and the damage half, which needs its own control.
   *
   * Both sides field sixty razors, so the stack being counted is the same stack with the same
   * sheet in both runs. The jammed run has twenty Netrunners standing beside them, and the
   * control has twenty *razors* standing beside them instead: the same twenty extra bodies to
   * soak and to split incoming fire, so what is left between the two runs is the jam on the
   * enemy's offense and twenty razors' worth of guns the jammed side is giving up.
   */
  it('keeps more of the line alive by taking the enemy down a peg', () => {
    const enemy = { razors: 80 };
    const moreGuns = fight({ razors: 80 }, enemy);
    const jammed = fight({ razors: 60, netrunners: 20 }, enemy);
    expect(
      jammed.ourRazorsDead,
      'the jam did not protect the line it was brought for',
    ).toBeLessThan(moreGuns.ourRazorsDead);
  });
});
