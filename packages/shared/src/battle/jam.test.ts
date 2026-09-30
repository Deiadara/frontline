import { describe, expect, it } from 'vitest';
import {
  JAM_FULL_SHARE,
  JAM_SHARE_CEILING,
  JAMMING_AT,
  MAX_JAM,
  MAX_JAM_CEILING,
  MAX_JAM_KNEE,
  bareBattlefield,
  battlefieldFor,
  effectiveStats,
  findUnit,
  jamPercent,
  openingJam,
  UNIT_RULES,
  WONDER_COVER_PER_SLOT,
  WONDER_JAM_CEILING,
  WONDER_JAM_KNEE,
  WONDER_JAM_NOMINAL_CEILING,
  groundedJam,
  groundedWonderCut,
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
  slowed: 0,
});

describe('what a jamming line takes off the other side', () => {
  it('is nothing at all without one', () => {
    expect(jamPercent(sideOf([stackOf(RAZORS, 40)]))).toBe(0);
    expect(jamPercent(sideOf([]))).toBe(0);
  });

  it('rises with the jammers share of the line, linear up to the full share', () => {
    // A line of 120 slots. `JAM_FULL_SHARE` of it is 30 slots, ten 3-slot Netrunners.
    const at = (jammers: number): number =>
      jamPercent(sideOf([stackOf(NETRUNNERS, jammers), stackOf(RAZORS, 120 - 3 * jammers)]));
    const full = (120 * JAM_FULL_SHARE) / NETRUNNERS.unitSlots;
    expect(full).toBe(10);

    expect(at(full)).toBeCloseTo(MAX_JAM, 5);
    // Linear under it, so a player can read the sheet: half the share is half the jam.
    expect(at(full / 2)).toBeCloseTo(MAX_JAM / 2, 5);
    expect(at(1)).toBeCloseTo(MAX_JAM / full, 5);
  });

  /*
   * Slots, not bodies (maintainer, 2026-09-30: "jam by slots"). Counted in bodies, four
   * Netrunners beside 36 Razors were 4 of 40 bodies and jammed at 16; they are 12 of 48 slots,
   * which is the full quarter.
   */
  it('counts the jammers and the line in unit slots', () => {
    expect(jamPercent(sideOf([stackOf(NETRUNNERS, 4), stackOf(RAZORS, 36)]))).toBeCloseTo(
      MAX_JAM,
      5,
    );
    // A 3-slot jammer is worth three 1-slot jammers, whatever the line is made of.
    const MARKED: UnitSpec = { ...RAZORS, jammer: true };
    const WARDENS = findUnit('wardens')!;
    for (const line of [stackOf(RAZORS, 30), stackOf(WARDENS, 15), stackOf(NETRUNNERS, 0)]) {
      const big = jamPercent(sideOf([stackOf(NETRUNNERS, 2), { ...line }]));
      const small = jamPercent(sideOf([stackOf(MARKED, 6), { ...line }]));
      expect(big, line.unit.id).toBeGreaterThan(0);
      expect(big, line.unit.id).toBeCloseTo(small, 5);
    }
  });

  /*
   * No hard cap (maintainer, 2026-09-29): one more jammer is always worth a little. Swept over
   * line sizes and jammer counts, from one Netrunner to three times the full share. (A line that is
   * nothing but jammers holds its share whatever its size, so it is not in the sweep.)
   */
  it('never stops climbing as jammers are added, and never passes its ceiling', () => {
    const ceiling = MAX_JAM * JAM_SHARE_CEILING;
    for (const razors of [40, 100, 300]) {
      let last = 0;
      for (let jammers = 1; jammers <= razors; jammers += 1) {
        const jam = jamPercent(sideOf([stackOf(NETRUNNERS, jammers), stackOf(RAZORS, razors)]));
        expect(jam, `${jammers} beside ${razors}`).toBeGreaterThan(last);
        expect(jam, `${jammers} beside ${razors}`).toBeLessThan(ceiling);
        last = jam;
      }
    }
    // Past the full share it is still climbing, and slowly: a line twice as jammed is under 18.7.
    const at = (jammers: number) =>
      jamPercent(sideOf([stackOf(NETRUNNERS, jammers), stackOf(RAZORS, 120 - 3 * jammers)]));
    expect(at(20)).toBeGreaterThan(at(10));
    expect(at(20) - at(10)).toBeLessThan(MAX_JAM * (JAM_SHARE_CEILING - 1));
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
    // Both stay under the ceiling, whatever the ground is worth.
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
    // ...and the biggest of the three more than doubles the gun (offense 60 since 2026-09-30), a
    // multiplier that read against the catalogue figure would carry the jam into its ceiling.
    expect(
      upgradedStats(NETRUNNERS.stats, ['guided_rounds']).offense / NETRUNNERS.stats.offense,
    ).toBeGreaterThan(2);
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

  it('never reaches the ceiling, whatever the ground is worth', () => {
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

/*
 * The slot rule through real fights (2026-09-30). 44 Razors and a growing Netrunner detachment
 * against 40 Razors wearing three cards each, 30 seeds a point on the same seeds. Measured on
 * adoption, with the jam at 40: 0% with none, 27% with four, 67% with six, 87% with eight. With the
 * jam at 17 and the range-and-offense sheet (2026-09-30): 0%, 0%, 3%, 30%, 53%, 83% and 97% from
 * none to twelve, so it now takes eight to turn the fight.
 */
describe('a Netrunner detachment beside a line, fight by fight', () => {
  const CARDS = ['recoil_dampers', 'ablative_layers', 'drill_book'];
  const SEEDS = 30;
  const run = (netrunners: number) => {
    let wins = 0;
    let jam = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const out = simulate({
        seed: `jam-slots-${seed}`,
        battlefield: bareBattlefield(),
        attacker: {
          name: 'A',
          army: { razors: 44, ...(netrunners > 0 ? { netrunners } : {}) },
          defending: false,
        },
        defender: { name: 'D', army: { razors: 40 }, defending: true, upgrades: { razors: CARDS } },
      });
      jam += openingJam(out.attacker);
      if (out.winner === 'attacker') wins += 1;
    }
    return { win: wins / SEEDS, jam: jam / SEEDS };
  };
  const sweep = [0, 2, 4, 6, 8, 10, 12].map((netrunners) => ({ netrunners, ...run(netrunners) }));

  it('lays the slot share as the lines form', () => {
    // Six Netrunners are 18 of 62 slots, past the full quarter.
    const six = sweep.find((point) => point.netrunners === 6)!;
    expect(six.jam).toBeGreaterThan(MAX_JAM);
    expect(six.jam).toBeLessThan(MAX_JAM * JAM_SHARE_CEILING);
  });

  it('wins more fights with every pair added, and turns a lost fight into a won one', () => {
    for (let i = 1; i < sweep.length; i += 1) {
      expect(sweep[i]!.win, `${sweep[i]!.netrunners} Netrunners`).toBeGreaterThanOrEqual(
        sweep[i - 1]!.win,
      );
    }
    expect(sweep[0]!.win).toBe(0);
    expect(sweep.find((point) => point.netrunners === 8)!.win).toBeGreaterThan(0.5);
  });
});

/*
 * The card jam's strength and the feat that counts it (maintainer's retune, 2026-09-30: 40 to 17).
 * Four 3-slot Netrunners beside 36 Razors are a full quarter of the line; beside 84 they are an
 * eighth, which is where the jamming feat's bar sits. One tagging along does not clear it.
 */
describe('how hard the jam is, and where the feat for it sits', () => {
  const line = (netrunners: number, razors: number) =>
    jamPercent(sideOf([stackOf(NETRUNNERS, netrunners), stackOf(RAZORS, razors)]));

  it('jams at 17 from a full quarter of the line', () => {
    expect(line(4, 36)).toBeCloseTo(17, 6);
  });

  it('puts the jamming feat at an eighth of the line, and out of reach of a lone Netrunner', () => {
    expect(line(4, 84)).toBeCloseTo(JAMMING_AT, 6);
    expect(line(1, 60)).toBeLessThan(JAMMING_AT);
  });
});

describe('the Netrunners sheet the jam replaced', () => {
  it('does little damage and no longer carries Armour Piercing', () => {
    expect(NETRUNNERS.jammer).toBe(true);
    expect(NETRUNNERS.modifiers).not.toContain('armor_piercing');
    // The floor under the whole feature: the gun has to stay *low*, or the jam is a bonus on top
    // of a gun rather than the reason to bring them. The 2026-09-30 buff (range 80, offense 60)
    // left it under half a Razor's offense and short of a Sniper's reach.
    expect(NETRUNNERS.stats.offense).toBe(60);
    expect(NETRUNNERS.stats.range).toBe(80);
    expect(NETRUNNERS.stats.offense).toBeLessThan(RAZORS.stats.offense / 2);
    expect(NETRUNNERS.stats.range).toBeLessThan(findUnit('snipers')!.stats.range);
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

/**
 * Every figure a card adds (maintainer, 2026-09-29: "Jamming should affect the modifications as
 * well as Armor and Damage of the enemy units. That is it."). The figures read once, as the lines
 * form, were out of its reach: the Composite Carapace's forty hit points and five intimidation
 * came through a full jam whole.
 */
describe('the jam on the figures a card adds that are read once', () => {
  const carapace = (attacking: Record<string, number>) =>
    simulate({
      seed: 'carapace',
      attacker: { name: 'A', army: attacking, defending: false },
      defender: {
        name: 'D',
        army: { razors: 20, breakers: 5 },
        defending: true,
        upgrades: { razors: ['composite_carapace'] },
      },
      battlefield: bareBattlefield(),
    });

  it('takes the opening jam off their hit points and intimidation', () => {
    const plain = carapace({ razors: 30 });
    const jammed = carapace({ razors: 24, netrunners: 6 });
    const jam = openingJam(jammed.attacker);
    expect(jam).toBeGreaterThan(0);

    const before = plain.defender.stacks.find((stack) => stack.unit.id === 'razors')!;
    const after = jammed.defender.stacks.find((stack) => stack.unit.id === 'razors')!;
    expect(before.modGain.vitality ?? 0).toBeGreaterThan(0);
    expect(after.effective.vitality).toBeCloseTo(
      before.effective.vitality - (before.modGain.vitality ?? 0) * (jam / 100),
      6,
    );
    expect(after.effective.intimidation).toBeCloseTo(
      before.effective.intimidation - (before.modGain.intimidation ?? 0) * (jam / 100),
      6,
    );
    // ...and the pools the bodies started with are the lower figure.
    expect(after.started * after.effective.vitality).toBeLessThan(
      before.started * before.effective.vitality,
    );
  });

  it('leaves a stack with nothing fitted exactly as it was', () => {
    const breakers = (attacking: Record<string, number>) =>
      carapace(attacking).defender.stacks.find((stack) => stack.unit.id === 'breakers')!;
    const plain = breakers({ razors: 30 });
    const jammed = breakers({ razors: 24, netrunners: 6 });
    expect(jammed.effective.vitality).toBe(plain.effective.vitality);
    expect(jammed.effective.intimidation).toBe(plain.effective.intimidation);
  });

  it('says on the card what it weakens, and that it is nothing else', () => {
    const card = UNIT_RULES.jammer.description;
    expect(card).toContain('every figure the enemy');
    expect(card).toContain('damage and armour');
    expect(card).toContain('Nothing else.');
  });
});

describe('the jam against Wonders of Engineering', () => {
  const WONDER = findUnit('hollow_men')!;
  const jammers = (count: number): SideState => sideOf([stackOf(NETRUNNERS, count)]);
  const wonders = (...units: UnitSpec[]): SideState =>
    sideOf(units.map((unit) => stackOf(unit, 1)));
  const cutOn = (jamming: SideState, target: SideState, at = 0): number =>
    wonderJam(jamming, target).get(target.stacks[at]!) ?? 0;

  /*
   * Stronger against Wonders (maintainer, 2026-09-30): a jammer slot covers three slots of machine
   * and covering one takes 55%, where it was one slot and 10%. Measured in the situational balance
   * run, the old cut barely moved a Netrunner's worth against a line half in Wonders.
   */
  it('covers three slots of machine per jammer slot, and takes 55% off what it covers', () => {
    expect(WONDER_COVER_PER_SLOT).toBe(3);
    expect(WONDER.unitSlots).toBe(5);
    expect(NETRUNNERS.unitSlots).toBe(3);
    // One Netrunner covers 9 slots: the first 5-slot machine, and 4 short of the second.
    const pair = wonders(WONDER, WONDER);
    expect(cutOn(jammers(1), pair, 0)).toBeCloseTo(55, 6);
    expect(cutOn(jammers(1), pair, 1)).toBe(0);
  });

  /*
   * A curve past the first step, not a stop (maintainer, 2026-09-30: "smooth curve"). Swept
   * against one machine, one Netrunner a step: every jammer cuts deeper, by less than the one
   * before, towards 75 and never onto it.
   */
  it('keeps cutting past the first step, by less each time, towards 75 and never onto it', () => {
    expect(WONDER_JAM_KNEE).toBe(55);
    expect(WONDER_JAM_NOMINAL_CEILING).toBe(75);
    const target = wonders(WONDER);
    const byStep = (steps: number) => cutOn(jammers(steps), target);
    let before = 0;
    let gainBefore = Infinity;
    for (let steps = 1; steps <= 5; steps += 1) {
      const cut = byStep(steps);
      const gain = cut - before;
      expect(gain, `step ${steps} added nothing`).toBeGreaterThan(0);
      expect(gain, `step ${steps} added more than the one before`).toBeLessThan(gainBefore);
      expect(cut).toBeLessThan(75);
      before = cut;
      gainBefore = gain;
    }
    // Independent anchors: 55, then 55 + 20(1 - e^-2.75) and 55 + 20(1 - e^-5.5).
    expect(byStep(1)).toBeCloseTo(55, 6);
    expect(byStep(2)).toBeCloseTo(73.72, 2);
    expect(byStep(3)).toBeCloseTo(74.92, 2);
    const deep = cutOn(jammers(200), target);
    expect(deep).toBeGreaterThan(74.99);
    expect(deep).toBeLessThanOrEqual(75);
  });

  it('covers as many machines as it can before it deepens any', () => {
    // Two 5-slot machines and two Netrunners (18 slots of cover): both covered, 8 left over.
    const target = wonders(WONDER, WONDER);
    expect(cutOn(jammers(2), target, 0)).toBeCloseTo(55, 6);
    expect(cutOn(jammers(2), target, 1)).toBeCloseTo(55, 6);
  });

  it('shares the steps past cover evenly round several machines, the smallest first', () => {
    // Three Netrunners (27): 10 cover both, 17 left is one more step, to the first.
    const target = wonders(WONDER, WONDER);
    expect(cutOn(jammers(3), target, 0)).toBeCloseTo(73.72, 2);
    expect(cutOn(jammers(3), target, 1)).toBeCloseTo(55, 6);
    // Four (36): 26 left is two steps, one each.
    expect(cutOn(jammers(4), target, 0)).toBeCloseTo(73.72, 2);
    expect(cutOn(jammers(4), target, 1)).toBeCloseTo(73.72, 2);
  });

  /*
   * The ground-scaled limits curve rather than stop (maintainer, 2026-09-30: "smooth both"). Each
   * is exact up to its knee and then climbs, by less each time, towards its old stop. Swept over
   * everything the ground could make of either figure.
   */
  it('lets the ground carry both cuts towards their limits, never onto them', () => {
    const sweep = (limit: (x: number) => number, knee: number, ceiling: number) => {
      for (let x = 0; x <= knee; x += 5) expect(limit(x)).toBeCloseTo(x, 9);
      let before = limit(knee);
      for (let x = knee + 2; x <= knee + 40; x += 2) {
        const now = limit(x);
        expect(now, `${x} gained nothing over ${x - 2}`).toBeGreaterThan(before);
        expect(now).toBeLessThan(ceiling);
        before = now;
      }
    };
    // A quarter and a half over the nominal jam, read off it.
    expect([MAX_JAM_KNEE, MAX_JAM_CEILING]).toEqual([21.25, 25.5]);
    sweep(groundedJam, MAX_JAM_KNEE, MAX_JAM_CEILING);
    // Where a hard stop would read 25.5, the curve reads 21.25 + 4.25(1 - e^-1).
    expect(groundedJam(25.5)).toBeCloseTo(23.94, 2);
    expect(WONDER_JAM_CEILING).toBe(90);
    sweep(groundedWonderCut, WONDER_JAM_NOMINAL_CEILING, WONDER_JAM_CEILING);
    // A cut of 100 the ground scaled: 75 + 15(1 - e^-5/3), where a stop would read 90.
    expect(groundedWonderCut(100)).toBeCloseTo(87.17, 2);
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
   * each, which covers the Twins' four slots and deepens the cut 38 steps, as near 75% as the
   * curve goes. The fight is over in one round, so both runs are read from the same snapshot.
   */
  it('lets a deeply covered Wonder deal a quarter as much', () => {
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
    expect(dealtByTheTwins(true)).toBeCloseTo(bare * 0.25, 1);
  });
});
