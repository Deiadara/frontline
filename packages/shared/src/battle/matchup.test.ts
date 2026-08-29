import { describe, expect, it } from 'vitest';
import {
  DAMAGE_TYPES,
  findUnit,
  UNIT_CATALOG,
  type UnitSpec,
  type UnitStats,
} from '../units/index.js';
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
  missChance,
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

/**
 * Evasion is a chance to miss, and it is half the rating.
 *
 * There was no coverage of this at all before it was rewritten, which is how a rule at the centre
 * of the damage formula got replaced with all fifteen tests in this file still green. The rule is
 * one line of arithmetic and a player plans around it, so it is pinned to the number rather than to
 * a direction: "more evasion is better" would pass against evasion, against evasion squared, and
 * against the multiplier this replaced.
 */
describe('evasion is a chance to miss', () => {
  it('turns a rating into half its value as a miss chance', () => {
    expect(missChance(60)).toBeCloseTo(0.3, 10);
    expect(missChance(0)).toBe(0);
    expect(missChance(100)).toBeCloseTo(0.5, 10);
  });

  it('refuses a rating outside the scale rather than producing a nonsense chance', () => {
    expect(missChance(-20)).toBe(0);
    expect(missChance(400)).toBeCloseTo(0.5, 10);
  });

  /** The formula, end to end: what an attack is worth is exactly what does not miss. */
  it('takes exactly the missed share off the damage, and nothing more', () => {
    const attacker = bare('razors');
    const dodgy = { ...bare('razors'), evasion: 60 };
    const still = { ...bare('razors'), evasion: 0 };

    const hit = exchange(attacker, [], dodgy, 100);
    const flat = exchange(attacker, [], still, 100);
    expect(hit.parts.dodge).toBeCloseTo(0.7, 10);
    expect(flat.parts.dodge).toBe(1);
    expect(hit.perBody).toBeCloseTo(flat.perBody * 0.7, 6);
  });

  /**
   * It reads the *defender's* sheet alone.
   *
   * The rule it replaced let a fast attacker erode evasion, so what a sheet's 60 was worth depended
   * on who was shooting. Two attackers at opposite ends of the speed range have to see the same
   * dodge now, or that coupling is back.
   */
  it('is worth the same against a sprinter and against a shield wall', () => {
    const dodgy = { ...bare('razors'), evasion: 88 };
    const quick = exchange({ ...bare('road_reavers'), speed: 100 }, [], dodgy, 100);
    const slow = exchange({ ...bare('ironsides'), speed: 5 }, [], dodgy, 100);
    expect(quick.parts.dodge).toBeCloseTo(slow.parts.dodge, 10);
    expect(quick.parts.dodge).toBeCloseTo(1 - 0.44, 10);
  });

  it('leaves the most evasive sheet in the game taking better than half of what is aimed at it', () => {
    const best = Math.max(...['the_loose_end', 'the_crimson_dancer'].map((id) => bare(id).evasion));
    expect(1 - missChance(best)).toBeGreaterThan(0.5);
  });
});

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
  /**
   * Built rather than borrowed from the roster, and deliberately.
   *
   * This is a test of the *rule*, and pointing it at whichever unit happens to carry the damage
   * type today makes it a test of the roster instead: it was written against the Bell-Ringers and
   * went red the day that unit left, even though nothing about resistances had changed.
   */
  const carrying = (type: UnitStats['damageType']) => ({ ...bare('razors'), damageType: type });

  it('makes a damage type nearly worthless against a unit that resists it', () => {
    // Ash Walkers are sealed against chlorine at 90, which is the strongest resistance a sheet in
    // the catalogue actually carries.
    expect(damageTypeMultiplier(carrying('chemical'), bare('ash_walkers'))).toBeLessThan(0.25);
    // ...and worth full price against something with no answer to it.
    expect(damageTypeMultiplier(carrying('chemical'), bare('razors'))).toBe(1);
  });

  /**
   * Every resistance on every sheet names a type something can still deal.
   *
   * A resistance against a type no unit carries is a lever the engine can never pull: it reads as
   * design on the roster screen and does nothing in a fight. Four sheets resisted `sonic` for a
   * change after the only unit that dealt it left the game.
   */
  it('leaves no sheet resisting a damage type nothing in the game deals', () => {
    const dealt = new Set(UNIT_CATALOG.map((spec) => spec.stats.damageType));
    expect([...dealt].sort()).toEqual([...DAMAGE_TYPES].sort());
    for (const spec of UNIT_CATALOG) {
      for (const type of Object.keys(spec.stats.resistances)) {
        expect(dealt.has(type as UnitStats['damageType']), `${spec.id} resists ${type}`).toBe(true);
      }
    }
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
    // Every damage type in the game, so a vulnerability written on any sheet is covered rather
    // than the three that happened to have a unit carrying them on the day this was written.
    for (const type of DAMAGE_TYPES) {
      for (const defender of ['the_colossus', 'juggernauts', 'the_specter', 'ironsides']) {
        expect(
          damageTypeMultiplier(carrying(type), bare(defender)),
          `${type}→${defender}`,
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
    const terror = bare('hollow_men');
    const modifiers = unit('hollow_men').modifiers;
    const target = bare('razors');

    const steady = exchange(terror, modifiers, target, 80).perBody;
    const shaken = exchange(terror, modifiers, target, SHAKEN_MORALE - 10).perBody;
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

/**
 * The shield wall: a sheet built to be a bad target, and the rule that makes it a good one.
 *
 * Targeting is by damage per point of enemy health (`threatWeight`), so a unit designed with almost
 * no damage and a great deal of health is the *least* attractive thing on the field. That is the
 * whole problem `taunts` exists to answer, and it is why the first assertion here is the one that
 * looks backwards: without the rule, the enemy walks past the wall and shoots what is behind it.
 */
describe('a wall is the least attractive target on the field', () => {
  it('would be ignored on threat alone, which is why it taunts', () => {
    const shooter = bare('snipers');
    const wall = threatWeight(shooter, unit('snipers').modifiers, bare('ironsides'), 100);
    const behind = threatWeight(shooter, unit('snipers').modifiers, bare('stitchers'), 100);
    expect(wall).toBeLessThan(behind);
    expect(unit('ironsides').taunts).toBe(true);
  });

  /** And it is the only one, so the engine's split has something to be a split *from*. */
  it('is carried by exactly one sheet in the catalogue', () => {
    const taunting = UNIT_CATALOG.filter((spec) => spec.taunts === true).map((spec) => spec.id);
    expect(taunting).toEqual(['ironsides']);
  });
});

/**
 * `bulwark` has to reach toughness, not damage.
 *
 * Every modifier before it was an attack bonus, and pointing one at a sheet with 45 damage buys
 * 31 points of a stat nobody fields the unit for. Both channels are asserted: that the defensive
 * modifier moves hit points, and that an *offensive* one still does not, because a change that
 * routed every modifier to toughness would pass a test that only checked the first half.
 */
describe('a defensive modifier makes a unit harder to kill, not harder to be hit by', () => {
  const holding = (id: string, defending: boolean) =>
    effectiveStats(
      unit(id),
      bareBattlefield(),
      { defending, outnumbered: false },
      noTerritoryEffects(),
    );

  it('pays the wall in hit points for holding ground', () => {
    const dug = holding('ironsides', true);
    const open = holding('ironsides', false);
    expect(dug.vitality).toBeGreaterThan(open.vitality * 1.5);
    expect(dug.reasons).toContain('Bulwark');
  });

  it('leaves an attack modifier on attack', () => {
    // Sluggers carry `dug_in`, which is the same context and the ordinary channel.
    const dug = holding('sluggers', true);
    const open = holding('sluggers', false);
    expect(dug.offense).toBeGreaterThan(open.offense);
    expect(dug.vitality).toBe(open.vitality);
  });
});
