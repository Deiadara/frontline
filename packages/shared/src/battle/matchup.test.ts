import { describe, expect, it } from 'vitest';
import { findUnit, type UnitSpec } from '../units/index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { noTerritoryEffects } from '../city/index.js';
import {
  ARMOR_FALLOFF,
  armorMultiplier,
  damageTypeMultiplier,
  engagementEdge,
  engagementMultiplier,
  exchange,
  MAX_RESISTANCE,
  MIN_RESISTANCE,
  SHAKEN_MORALE,
  threatWeight,
} from './matchup.js';

/**
 * The interaction rules, one test per promise the design makes to the player.
 *
 * These are the tests worth having. The engine's arithmetic can be re-tuned freely; what may not
 * change without somebody deciding to change it is *that a fast unit runs a sniper down*, because
 * that is a sentence in the design and a player will plan around it.
 */

const unit = (id: string): UnitSpec => {
  const found = findUnit(id);
  if (!found) throw new Error(`no unit ${id}`);
  return found;
};

/** A unit on bare ground with nothing helping it: the sheet and nothing else. */
const bare = (id: string) =>
  effectiveStats(
    unit(id),
    bareBattlefield(),
    { defending: false, outnumbered: false },
    noTerritoryEffects(),
  );

describe('range works against slow units', () => {
  /**
   * Snipers out-range everything. What decides whether that is worth anything is how fast the
   * target crosses the ground: Ironsides walk into the fire, Road Reavers are inside it before the
   * second shot.
   */
  it('pays a sniper far more against a slow target than a fast one', () => {
    const snipers = bare('snipers');
    const slow = engagementMultiplier(snipers, bare('ironsides'));
    const fast = engagementMultiplier(snipers, bare('road_reavers'));

    expect(slow).toBeGreaterThan(fast * 1.25);
    expect(engagementEdge(snipers, bare('ironsides')).reach).toBeGreaterThan(0.6);
  });

  it('pays a knife-fighter nothing for reach, whatever it is facing', () => {
    const razors = bare('razors');
    for (const target of ['ironsides', 'road_reavers', 'snipers']) {
      expect(engagementEdge(razors, bare(target)).reach, target).toBe(0);
    }
  });
});

describe('fast units kill snipers easier', () => {
  /**
   * The mirror of the rule above, and the reason `closing` reads the *target's* range: catching
   * something is only worth extra if it wanted to be far away. Running down another brawler is
   * just a fight.
   */
  it('pays a fast unit for catching something built to stay at range', () => {
    const reavers = bare('road_reavers');
    const ontoSniper = engagementMultiplier(reavers, bare('snipers'));
    const ontoBrawler = engagementMultiplier(reavers, bare('razors'));

    expect(ontoSniper).toBeGreaterThan(ontoBrawler * 1.2);
    expect(engagementEdge(reavers, bare('snipers')).closing).toBeGreaterThan(0.4);
  });

  it('pays a slow unit nothing for chasing anything', () => {
    expect(engagementEdge(bare('ironsides'), bare('snipers')).closing).toBe(0);
    expect(engagementEdge(bare('the_colossus'), bare('snipers')).closing).toBe(0);
  });

  /** The whole point, stated as the outcome rather than as the multiplier. */
  it('makes a Reaver better against a Sniper than a Sniper is against a Reaver', () => {
    const reavers = bare('road_reavers');
    const snipers = bare('snipers');
    const onto = exchange(reavers, unit('road_reavers').modifiers, snipers, snipers.morale);
    const back = exchange(snipers, unit('snipers').modifiers, reavers, reavers.morale);
    expect(onto.perBody).toBeGreaterThan(back.perBody);
  });
});

describe('special units are almost immune to certain damage', () => {
  it('makes sonic nearly worthless against a unit that resists it', () => {
    const bells = bare('bell_ringers');
    expect(damageTypeMultiplier(bells, bare('hollow_men'))).toBeLessThan(0.25);
    // ...and worth full price against something with no answer to it.
    expect(damageTypeMultiplier(bells, bare('razors'))).toBe(1);
  });

  it('never lets a resistance reach immunity', () => {
    // The Abomination's sheet says 100. Nothing in this game is immune.
    const abomination = bare('the_abomination');
    const chemical = bare('ash_walkers');
    expect(damageTypeMultiplier(chemical, abomination)).toBeCloseTo(1 - MAX_RESISTANCE / 100, 5);
    expect(damageTypeMultiplier(chemical, abomination)).toBeGreaterThan(0);
  });

  /** The other half of the axis, and the half that makes bringing the right people a decision. */
  it('makes a vulnerability hurt more than a plain hit', () => {
    const netrunners = bare('netrunners');
    const juggernauts = bare('juggernauts');
    expect(damageTypeMultiplier(netrunners, juggernauts)).toBeGreaterThan(1.3);
    expect(damageTypeMultiplier(netrunners, bare('razors'))).toBe(1);
  });

  it('never lets a vulnerability run away either', () => {
    const floor = 1 - MIN_RESISTANCE / 100;
    for (const attacker of ['netrunners', 'bell_ringers', 'wrecking_crew']) {
      for (const defender of ['the_colossus', 'juggernauts', 'the_specter', 'ironsides']) {
        expect(
          damageTypeMultiplier(bare(attacker), bare(defender)),
          `${attacker}→${defender}`,
        ).toBeLessThanOrEqual(floor);
      }
    }
  });
});

describe('armour', () => {
  it('diminishes rather than subtracts, and never reaches zero', () => {
    expect(armorMultiplier(0)).toBe(1);
    expect(armorMultiplier(10)).toBeCloseTo(ARMOR_FALLOFF ** 10, 6);
    // Calibrated for a 0..100 stat: armour 45 takes about half, and the heaviest sheet in the game,
    // the Colossus at 95, still takes over a quarter. An earlier constant borrowed straight from
    // 0 A.D.'s 0..10 scale put that last figure at 1.6%, which made the heavy tier unkillable.
    expect(armorMultiplier(45)).toBeGreaterThan(0.5);
    expect(armorMultiplier(45)).toBeLessThan(0.6);
    expect(armorMultiplier(95)).toBeGreaterThan(0.25);
    expect(armorMultiplier(95)).toBeLessThan(0.35);
  });

  it('is worth less per point the more of it there is', () => {
    const first = armorMultiplier(0) - armorMultiplier(10);
    const later = armorMultiplier(50) - armorMultiplier(60);
    expect(first).toBeGreaterThan(later);
  });
});

describe('targeting is where the counters actually happen', () => {
  /**
   * Nothing anywhere says "armour-piercing units should shoot the heavies". It falls out of
   * `threatWeight` reading the sheet, which is the property that makes the system extensible: a
   * unit added next year with a new sheet slots into the same arithmetic with no rule written for
   * it.
   */
  it('sends an armour-piercing unit at the armour', () => {
    const demolishers = bare('demolishers');
    const modifiers = unit('demolishers').modifiers;
    const ontoArmour = threatWeight(demolishers, modifiers, bare('ironsides'), 70);
    const ontoRabble = threatWeight(demolishers, modifiers, bare('razors'), 70);

    const plain = bare('sparks');
    const plainMods = unit('sparks').modifiers;
    const plainArmour = threatWeight(plain, plainMods, bare('ironsides'), 70);
    const plainRabble = threatWeight(plain, plainMods, bare('razors'), 70);

    // Relative preference, not absolute: rabble is always easier to kill. What must be true is
    // that the specialist prefers armour *more* than a unit with no such tool does.
    expect(ontoArmour / ontoRabble).toBeGreaterThan(plainArmour / plainRabble);
  });

  it('prefers what it can efficiently kill over what is simply biggest', () => {
    const razors = bare('razors');
    const modifiers = unit('razors').modifiers;
    expect(threatWeight(razors, modifiers, bare('sparks'), 50)).toBeGreaterThan(
      threatWeight(razors, modifiers, bare('the_colossus'), 50),
    );
  });
});

describe('intimidation works on low morale', () => {
  /**
   * The mechanical half of the brief. A Terror unit is worth nothing against a steady enemy and a
   * third again as much against one already coming apart, so intimidation is not a stat that
   * makes you hit harder, it is a stat that makes *the next thing* hit harder.
   */
  it('pays a terror unit more against a shaken target than a steady one', () => {
    const bells = bare('bell_ringers');
    const modifiers = unit('bell_ringers').modifiers;
    const target = bare('razors');

    const steady = exchange(bells, modifiers, target, 80).perBody;
    const shaken = exchange(bells, modifiers, target, SHAKEN_MORALE - 10).perBody;
    expect(shaken).toBeGreaterThan(steady * 1.3);
  });

  it('pays a unit without the sheet for it nothing either way', () => {
    const snipers = bare('snipers');
    const modifiers = unit('snipers').modifiers;
    const target = bare('razors');
    expect(exchange(snipers, modifiers, target, 10).perBody).toBeCloseTo(
      exchange(snipers, modifiers, target, 90).perBody,
      6,
    );
  });
});
