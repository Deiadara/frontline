import { describe, expect, it } from 'vitest';
import {
  JAM_FULL_SHARE,
  MAX_JAM,
  MAX_JAM_CEILING,
  bareBattlefield,
  battlefieldFor,
  effectiveStats,
  findUnit,
  jamPercent,
  WONDER_JAM_CAP,
  wonderJam,
  jammedSheet,
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
    modGain: {},
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
   * time. A jam is laid on the whole enemy line at once, so there is no target to read a `vs_`
   * modifier against. (The Netrunners carried `tracking` until 2026-09-26, which is what made
   * this worth pinning; the sweep below still is, for any target-shaped modifier.)
   */
  it('is not moved by what it is jamming', () => {
    /*
     * ...and none of them can reach the jam, because no ground the game builds carries them.
     *
     * The jam's ratio comes out of `effectiveStats`, which resolves `battlefield.contexts` and
     * nothing else, and `battlefieldFor` pushes none of the `vs_` family. The target-shaped ones
     * are decided per exchange in `matchup.ts`, against one defender at a time, and a jam has no
     * one defender.
     *
     * Swept over every location kind rather than asserted about one, because this is a claim
     * about the whole map and a new kind is the way it would quietly stop being true.
     */
    const targetShaped: readonly CombatContext[] = ['vs_armor', 'vs_evasive', 'vs_low_morale'];
    for (const kind of LOCATION_KINDS) {
      const ground = battlefieldFor({
        locationName: kind,
        kind,
        at: new Date('2026-09-19T22:00:00.000Z'),
        weather: 'stormy',
      });
      // And since fortification left the game (2026-09-26), not `vs_structure` either: a gate is
      // the holder's and arrives with their territory, so no ground carries any of the family.
      for (const context of [...targetShaped, 'vs_structure' as const]) {
        expect(ground.contexts, `${kind} carries ${context}`).not.toContain(context);
      }
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
/*
 * What the jam does (maintainer, 2026-09-27). It used to cut the whole enemy line's armour and
 * damage; now it does two narrower things that stack: it weakens what modifications add, and it
 * cuts Wonders of Engineering the jammers cover.
 */
describe('the jam against modifications', () => {
  const fitted = (): Stack => ({
    ...stackOf(RAZORS, 10),
    effective: { ...stackOf(RAZORS, 10).effective, armor: 50, offense: 100, penetration: 30 },
    modGain: { armor: 20, offense: 30 },
  });

  it('strips the jam percent off what the modifications add, and nothing else', () => {
    const sheet = jammedSheet(fitted(), 40);
    expect(sheet.armor).toBeCloseTo(50 - 20 * 0.4, 6);
    expect(sheet.offense).toBeCloseTo(100 - 30 * 0.4, 6);
    expect(sheet.penetration).toBe(30);
  });

  it('does nothing to a unit with nothing fitted', () => {
    const bare = stackOf(RAZORS, 10);
    expect(jammedSheet(bare, 40)).toEqual(bare.effective);
  });

  it('knows what a fitted stack was given, from the fight itself', () => {
    // The Scrap Vest: four points of armour, fitted in the first bracket.
    const card = 'scrap_vest';
    const out = simulate({
      seed: 'mod-gain',
      attacker: { name: 'A', army: { razors: 10 }, defending: false },
      defender: {
        name: 'D',
        army: { razors: 10 },
        defending: true,
        upgrades: { razors: [card] },
      },
      battlefield: bareBattlefield(),
    });
    expect(out.defender.stacks[0]!.modGain.armor ?? 0).toBeGreaterThan(0);
    expect(out.attacker.stacks[0]!.modGain.armor ?? 0).toBe(0);
  });
});

describe('the jam against Wonders of Engineering', () => {
  const WONDER = findUnit('hollow_men')!;
  const jammers = (count: number): SideState => sideOf([stackOf(NETRUNNERS, count)]);
  const wonders = (...units: UnitSpec[]): SideState =>
    sideOf(units.map((unit) => stackOf(unit, 1)));
  const cutOn = (jamming: SideState, target: SideState, at = 0): number =>
    wonderJam(jamming, target).get(target.stacks[at]!) ?? 0;

  it('does nothing until the jammers cover the machine, then 10% and 10% more each', () => {
    // A 5-slot Hollow Men against 3-slot Netrunners: one covers 3, two cover 6.
    expect(WONDER.unitSlots).toBe(5);
    expect(NETRUNNERS.unitSlots).toBe(3);
    const target = wonders(WONDER);
    expect(cutOn(jammers(1), target)).toBe(0);
    expect(cutOn(jammers(2), target)).toBeCloseTo(10, 6);
    expect(cutOn(jammers(3), target)).toBeCloseTo(20, 6);
    expect(cutOn(jammers(4), target)).toBeCloseTo(30, 6);
  });

  it('stops at half on nominal ground', () => {
    expect(cutOn(jammers(40), wonders(WONDER))).toBeCloseTo(WONDER_JAM_CAP, 6);
  });

  it('covers as many machines as it can before it deepens any', () => {
    // Two 5-slot machines and four Netrunners (12 slots): both covered, 2 slots left over.
    const target = wonders(WONDER, WONDER);
    expect(cutOn(jammers(4), target, 0)).toBeCloseTo(10, 6);
    expect(cutOn(jammers(4), target, 1)).toBeCloseTo(10, 6);
  });

  it('takes the cut off damage and armour, on top of the modification strip', () => {
    const stack = { ...stackOf(WONDER, 1), modGain: { armor: 10 } };
    const sheet = jammedSheet(stack, 50, 20);
    expect(sheet.armor).toBeCloseTo((stack.effective.armor - 5) * 0.8, 6);
    expect(sheet.offense).toBeCloseTo(stack.effective.offense * 0.8, 6);
  });

  /*
   * Through a real fight, so a cut that is computed and never reaches a round fails here. The
   * control is the same army without the mark: forty Razors granted Jamming by a holding, one slot
   * each, which covers the Twins' four slots and deepens the cut to the cap. The fight is over in
   * one round, so both runs are read from the same snapshot.
   */
  it('lets a covered Wonder deal half as much', () => {
    const TWINS = findUnit('the_twins')!;
    expect(TWINS.unitSlots).toBe(4);
    const dealtByTheTwins = (marked: boolean): number => {
      const out = simulate({
        seed: 'wonder-jam',
        attacker: {
          name: 'A',
          army: { razors: 40 },
          defending: false,
          ...(marked
            ? { territory: { ...noTerritoryEffects(), unitMarks: { razors: ['jammer'] } } }
            : {}),
        },
        defender: { name: 'D', army: { the_twins: 1 }, defending: true },
        battlefield: bareBattlefield(),
      });
      expect(out.rounds).toHaveLength(1);
      return out.defender.stacks[0]!.dealt;
    };
    const bare = dealtByTheTwins(false);
    expect(dealtByTheTwins(true)).toBeCloseTo(bare * (1 - WONDER_JAM_CAP / 100), 1);
  });
});
