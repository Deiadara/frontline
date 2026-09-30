import { describe, expect, it } from 'vitest';
import { ATTRIBUTE_NAMES, type Attributes } from '../attributes.js';
import { COMBINE_LEADERS } from '../city/combine.js';
import type { Army } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { jammedSheet, simulate } from './engine.js';
import { forecast } from './forecast.js';
import { findingsFor, narrate } from './report.js';
import { TacticalSkirmishEngine } from './skirmish.js';

/**
 * Defects found in the 2026-09-29 battle engine bug pass, each pinned as a sweep rather than on one
 * seed, because a fixed-seed fight moves every time the engine is retuned.
 */

const XERO = COMBINE_LEADERS.find((leader) => leader.power.kind === 'directive_xero')!.power;

const attackerWins = (army: Army, seeds: number): number => {
  let wins = 0;
  for (let i = 0; i < seeds; i += 1) {
    const fight = simulate({
      seed: `mirror-${i}`,
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army, defending: false },
      defender: { name: 'D', army, defending: true },
    });
    if (fight.winner === 'attacker') wins += 1;
  }
  return wins / seeds;
};

describe('the two morale tests read the same moment', () => {
  /*
   * Neither sheet here carries anything that reads `defending`, the ground is bare and nobody has
   * the stealth to ambush, so the only thing that can tell attacker from defender is the order the
   * engine happens to test them in. The defender was tested second and read an attacker line that
   * had already lost whatever broke in the first test: Juggernauts won 44.8% attacking and
   * Breakers 46.8% over 3,000 seeds, against 50.0% and 50.3% with one snapshot.
   */
  it.each([
    ['Juggernauts', { juggernauts: 8 }],
    ['Breakers', { breakers: 30 }],
  ])('gives a %s mirror to either side about equally', (_name, army) => {
    const rate = attackerWins(army, 1500);
    expect(rate).toBeGreaterThan(0.475);
    expect(rate).toBeLessThan(0.525);
  });
});

describe('the forecast says how many walk out, and means it', () => {
  /*
   * The screens print `attackerSurvival` as "about N% of yours walk out". It was the share still
   * standing when the fight ended, which on a lost fight is mostly routing bodies the rout then
   * rolls for: 40 Razors against 60 read 54% and brought home 32%.
   */
  it.each([
    ['a lost push', { razors: 40 }, { razors: 60 }],
    ['a lost push into a wall', { razors: 30 }, { wardens: 20 }],
    ['an even fight', { razors: 40 }, { razors: 40 }],
    ['a won one', { breakers: 20, snipers: 5 }, { wardens: 15 }],
  ])('matches what the settle sends home on %s', (_name, attacking, defending) => {
    const runs = 60;
    const read = forecast({
      seed: 'walk-out',
      runs,
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: attacking, defending: false },
      defender: { name: 'D', army: defending, defending: true },
    });
    const engine = new TacticalSkirmishEngine();
    const sent = Object.values(attacking).reduce((sum, n) => sum + n, 0);
    let home = 0;
    for (let run = 0; run < runs; run += 1) {
      const outcome = engine.resolve({
        seed: `walk-out:${run}`,
        attackerName: 'A',
        defenderName: 'D',
        locationName: 'L',
        battlefield: bareBattlefield(),
        attacking,
        defending,
      });
      const back = outcome.winner === 'attacker' ? outcome.winnerLosses : outcome.fled;
      const count = Object.values(back).reduce((sum, n) => sum + n, 0);
      home += outcome.winner === 'attacker' ? (sent - count) / sent : count / sent;
    }
    expect(Math.abs(read.attackerSurvival - home / runs)).toBeLessThan(0.03);
  });
});

describe('the report says what the medics did in a lost fight too', () => {
  const hospital = (defending: Army, seed: string) => {
    const fight = simulate({
      seed,
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: { razors: 30, stitchers: 6 }, defending: false },
      defender: { name: 'D', army: defending, defending: true },
    });
    const finding = findingsFor(fight).find(
      (one) => one.kind === 'support' && one.side === 'attacker',
    );
    const medics = fight.attacker.stacks.find((stack) => stack.unit.mends === true);
    return { fight, text: finding?.text, medicsStanding: medics?.alive ?? 0 };
  };

  /*
   * The share was read off the side as it ended, and a beaten line reads zero: the finding was
   * missing from every one of 135 losses in a 400-seed sweep, and "overrun" was never printed.
   */
  it('keeps the finding on a loss, and says "overrun" when the medics are dead', () => {
    let losses = 0;
    let overrun = 0;
    for (let i = 0; i < 200; i += 1) {
      const { fight, text, medicsStanding } = hospital({ razors: 40 + (i % 10) }, `medic-${i}`);
      if (fight.winner === 'attacker') continue;
      losses += 1;
      expect(text, `seed medic-${i}`).toMatch(/Stitchers/);
      if (medicsStanding === 0) {
        overrun += 1;
        expect(text).toMatch(/overrun/);
      }
    }
    expect(losses).toBeGreaterThan(100);
    expect(overrun).toBeGreaterThan(0);
  });
});

describe('a fight called at the round limit does not deny its own breaks', () => {
  /*
   * `cap` means both lines still had somebody fighting at the round limit, not that nobody broke.
   * The Sparks break and the Ash Walkers hold, so this mirror caps with a break in it every time.
   */
  it('never says "neither side broke" beside a line that did', () => {
    let checked = 0;
    for (let i = 0; i < 400 && checked < 5; i += 1) {
      const fight = simulate({
        seed: `cap-${i}`,
        battlefield: bareBattlefield(),
        attacker: { name: 'A', army: { ash_walkers: 10, sparks: 5 }, defending: false },
        defender: { name: 'D', army: { ash_walkers: 10, sparks: 5 }, defending: true },
      });
      const broke = [...fight.attacker.stacks, ...fight.defender.stacks].some(
        (stack) => stack.brokeAt !== null,
      );
      if (fight.settledBy !== 'cap' || !broke) continue;
      checked += 1;
      const log = narrate(fight, findingsFor(fight));
      expect(log.some((line) => /broke\.$/.test(line) && line.startsWith('Round'))).toBe(true);
      expect(log.join(' ')).not.toMatch(/Neither side broke/);
      expect(log).toContain(
        'Both lines were still in it when time ran out. It was called on who was left standing.',
      );
    }
    expect(checked).toBe(5);
  });
});

describe('the log and the analysis count the same force', () => {
  const OFFICER = {
    officerId: 'o1',
    name: 'Vasquez',
    attributes: Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, 50])) as Attributes,
  };

  it.each([
    ['an officer leading the attack', {}, { attackerOfficer: OFFICER }],
    ['an officer leading the defence', {}, { defenderOfficer: OFFICER }],
    ['a defence under Directive Xero', { the_condemned: 20 }, { defenderPresence: XERO }],
  ])('opens with the committed figures under %s', (_name, extraDefenders, extra) => {
    const outcome = new TacticalSkirmishEngine().resolve({
      seed: 'counted',
      attackerName: 'A',
      defenderName: 'D',
      locationName: 'L',
      attacking: { razors: 20 },
      defending: { greycoat: 12, ...extraDefenders },
      ...extra,
    });
    const analysis = outcome.analysis!;
    expect(outcome.log[0]).toBe(
      `${analysis.attacker.committed} moving on L. D has ${analysis.defender.committed} on the ground.`,
    );
    expect(analysis.attacker.committed).toBe(20);
    // The Xero case has to turn somebody, or it is testing nothing the other two do not.
    if ('defenderPresence' in extra) expect(Object.keys(outcome.turned)).toContain('razors');
  });
});

describe('the jam reaches the speed a card adds', () => {
  /*
   * `exchange` reads speed every round (reach, closing, the dodge), and 17 of the 35 cards move it,
   * but the jam's list of figures left it out, so Dry Joints kept all seven points under a full jam.
   */
  it('strips the jam percent off a fitted speed card, and leaves the bare sheet alone', () => {
    const fight = simulate({
      seed: 'jam-speed',
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: { razors: 10 }, defending: false },
      defender: {
        name: 'D',
        army: { razors: 10 },
        defending: true,
        upgrades: { razors: ['dry_joints'] },
      },
    });
    const fitted = fight.defender.stacks[0]!;
    const gain = fitted.modGain.speed ?? 0;
    expect(gain).toBeGreaterThan(0);
    expect(jammedSheet(fitted, 40).speed).toBeCloseTo(fitted.effective.speed - gain * 0.4, 6);
    const bare = fight.attacker.stacks[0]!;
    expect(jammedSheet(bare, 40).speed).toBe(bare.effective.speed);
  });
});

describe('the headline knows which side it is writing for', () => {
  const headline = (attacking: Army, defending: Army) =>
    new TacticalSkirmishEngine().resolve({
      seed: 'headline',
      attackerName: 'Raiders',
      defenderName: 'Holders',
      locationName: 'the Yard',
      attacking,
      defending,
    }).analysis!;

  it('says a defence that lost nobody held the ground, and did not take it', () => {
    const analysis = headline({ razors: 3 }, { ironsides: 6 });
    expect(analysis.winner).toBe('defender');
    expect(analysis.defender.lost).toBe(0);
    expect(analysis.headline).toBe('Holders held the Yard and did not lose a soul doing it.');
  });

  it('does not say a defence walked onto its own empty ground when nobody came', () => {
    const analysis = headline({}, { razors: 5 });
    expect(analysis.winner).toBe('defender');
    expect(analysis.headline).toBe('Nobody reached the Yard. Holders still holds it.');
  });

  it('keeps the attacker lines as they were', () => {
    expect(headline({ razors: 5 }, {}).headline).toBe(
      'Raiders walked onto the Yard. Nobody was there.',
    );
  });
});
