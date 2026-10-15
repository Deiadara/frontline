import { describe, expect, it } from 'vitest';
import {
  AD_HOC_ARMY_ID,
  GEPPETTO_ID,
  adHocArmyAt,
  adHocArmyLabel,
  adHocArmyPerRound,
  findUnit,
  gauntletLevelFor,
  isPlayerUnit,
  isUnitUnlocked,
  unitRules,
  unitsInTier,
  unitsUnlockedByLocation,
} from '../index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import {
  ATLAS_UNIFIED_BONUSES,
  findLocation,
  noTerritoryEffects,
  type TerritoryEffects,
} from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { markedUnit } from './line.js';
import {
  SAFE_DISTANCE_COST,
  SAFE_DISTANCE_REACH,
  allocate,
  intimidate,
  makeAdHocArmy,
  simulate,
  type SideState,
  type Stack,
} from './engine.js';

/**
 * Batch 11 (maintainer, 2026-10-09): SAFE DISTANCE as one rule with two halves, every legendary on
 * one set of requirements, and the Geppetto with his AD HOC ARMY off the Crate Ring.
 */

const field = bareBattlefield();
const side = { defending: false, outnumbered: 0 };

function stackOf(
  id: string,
  alive: number,
  territory: TerritoryEffects = noTerritoryEffects(),
  spec = markedUnit(findUnit(id)!, territory),
): Stack {
  const effective = effectiveStats(spec, field, side, territory);
  return {
    unit: spec,
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
    sheet: spec.stats,
    modGain: {},
    loudTier: 0,
  };
}

const sideOf = (stacks: Stack[]): SideState =>
  ({ stacks, luck: 0, swing: 1, name: 'side', defending: false }) as unknown as SideState;

const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );

/** A shooter with its range set, so the reach rule can be read on either side of the line. */
const shooterAt = (range: number): Stack => {
  const stack = stackOf('razors', 10);
  return { ...stack, effective: { ...stack.effective, range } };
};

describe('SAFE DISTANCE', () => {
  const marked = holding('marshalling-yards-signalbox', 5);

  it('keeps short-range fire off it while anybody without the rule is still in the fight', () => {
    const snipers = stackOf('snipers', 6, marked);
    const razors = stackOf('razors', 10);
    expect(snipers.unit.safe_distance).toBe(true);
    const short = allocate(shooterAt(SAFE_DISTANCE_REACH - 1), [snipers, razors]);
    expect(short.map(({ target }) => target.unit.id)).toEqual(['razors']);
    // Range 50 reaches it, as the ruling says: only below 50 is kept off.
    const long = allocate(shooterAt(SAFE_DISTANCE_REACH), [snipers, razors]);
    expect(long.map(({ target }) => target.unit.id).sort()).toEqual(['razors', 'snipers']);
  });

  it('is open to anything once the rest of its side is down or has run', () => {
    const snipers = stackOf('snipers', 6, marked);
    const dead = { ...stackOf('razors', 10), alive: 0, pool: 0 };
    const broken = { ...stackOf('wardens', 4), brokeAt: 2 };
    const short = allocate(shooterAt(10), [snipers, dead, broken]);
    expect(short.map(({ target }) => target.unit.id)).toEqual(['snipers']);
  });

  it('does not let two stacks with the rule screen each other', () => {
    const snipers = stackOf('snipers', 6, marked);
    const stitchers = stackOf('stitchers', 3, holding('bonded-row-coldstore', 5));
    expect(stitchers.unit.safe_distance).toBe(true);
    const short = allocate(shooterAt(10), [snipers, stitchers]);
    expect(short.map(({ target }) => target.unit.id).sort()).toEqual(['snipers', 'stitchers']);
  });

  it('still makes intimidation half as effective', () => {
    const plain = stackOf('snipers', 4);
    const safe = stackOf('snipers', 4, marked);
    const morale = plain.effective.morale;
    const against = 4 * morale + 2 * morale;
    expect(intimidate(sideOf([plain]), against)).toBe(2);
    expect(SAFE_DISTANCE_COST).toBe(2);
    expect(intimidate(sideOf([safe]), against)).toBe(1);
  });

  it('is carried by the Snipers and the Stitchers at level 5, and by the Geppetto always', () => {
    expect(holding('bonded-row-coldstore', 4).unitMarks).toEqual({});
    expect(holding('bonded-row-coldstore', 5).unitMarks).toEqual({ stitchers: ['safe_distance'] });
    expect(findUnit(GEPPETTO_ID)!.safe_distance).toBe(true);
    expect(unitRules(findUnit(GEPPETTO_ID)!).map((rule) => rule.label)).toEqual(
      expect.arrayContaining(['Safe Distance', 'Ad Hoc Army']),
    );
  });
});

describe('what every legendary asks for', () => {
  /** The ruling, unit by unit: the Gauntlet at 15, the ground that is its own, and the extras. */
  const EXPECTED: Record<string, readonly string[]> = {
    the_specter: ['building:gauntlet:15', 'location:annexes-uplink,ccs-uplink'],
    the_abomination: ['building:gauntlet:15', 'location:undergrid-lair'],
    the_colossus: [
      'building:gauntlet:15',
      'building:scrapyard:18',
      'location:annexes-scaffold,ccs-scaffold',
    ],
    the_saint: ['building:gauntlet:15', 'door:the_saint'],
    // Her own area since 2026-10-09: the Old Dome, by name.
    the_cartographer: ['building:gauntlet:15', 'place:telemetry-hill-dome'],
    the_crimson_dancer: ['building:gauntlet:15', 'door:the_crimson_dancer'],
    the_loose_end: ['building:gauntlet:15', 'location:glasshouse-fields-haulers'],
    the_geppetto: ['building:gauntlet:15', 'building:lab:15', 'place:bonded-row-ring'],
  };

  it('is the Gauntlet at 15, its own ground, and the extras the ruling names, nothing else', () => {
    const held = unitsInTier('legendary');
    expect(held.map((unit) => unit.id).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const unit of held) {
      const clauses = unit.requires.map((need) => {
        switch (need.kind) {
          case 'building':
            return `building:${need.building}:${need.level}`;
          case 'location':
            return `location:${need.locationIds.join(',')}`;
          case 'door':
            return `door:${need.unitId}`;
          case 'place':
            return `place:${need.locationId}`;
          default:
            return need.kind;
        }
      });
      expect(clauses.sort(), unit.id).toEqual([...EXPECTED[unit.id]!].sort());
      expect(gauntletLevelFor(unit.id), unit.id).toBe(15);
    }
  });
});

describe('the Geppetto', () => {
  const geppetto = findUnit(GEPPETTO_ID)!;

  it('has the sheet the maintainer wrote', () => {
    expect(geppetto.tier).toBe('legendary');
    expect(geppetto.unique).toBe(true);
    expect(geppetto.stats).toMatchObject({
      speed: 10,
      armor: 30,
      range: 10,
      morale: 40,
      stealth: 20,
      penetration: 10,
      evasion: 10,
      intimidation: 10,
      vitality: 200,
      offense: 50,
    });
  });

  it('opens on the Crate Ring, which does nothing else and no longer opens a fight pit', () => {
    const ring = findLocation('bonded-row-ring')!;
    expect(bonusesAt(ring, 1).map((bonus) => bonus.kind)).toEqual(['ad_hoc_army']);
    expect(unitsUnlockedByLocation('bonded-row-ring').map((unit) => unit.id)).toEqual([
      GEPPETTO_ID,
    ]);
    expect(holding('bonded-row-ring', 3).adHocArmyLevel).toBe(3);
    expect(holding('bonded-row-ring', 5).intimidatedInfamyPercent).toBe(0);
    expect(describeHoldBonus(bonusesAt(ring, 5)[0]!)).toBe(
      'Opens The Geppetto; his robots fight at this level, two made a round',
    );
  });
});

describe('the Ad Hoc Army', () => {
  const robot = findUnit(AD_HOC_ARMY_ID)!;

  it('is a Wonder of Engineering with TAUNT that nobody musters', () => {
    expect(robot.tier).toBe('wonder');
    expect(robot.taunts).toBe(true);
    expect(robot.spawned).toBe(true);
    expect(isPlayerUnit(robot)).toBe(false);
    expect(robot.stats).toMatchObject({
      offense: 50,
      vitality: 200,
      armor: 40,
      evasion: 10,
      stealth: 10,
      morale: 80,
      penetration: 10,
      range: 10,
      intimidation: 10,
      damageType: 'blunt',
    });
    // Refused before any clause is read, so an empty context is enough to ask.
    expect(isUnitUnlocked(robot, {} as Parameters<typeof isUnitUnlocked>[1])).toBe(false);
  });

  it('grows +100 vitality and +20 damage a ring level to 4, then comes two at a time', () => {
    expect([0, 1, 2, 3, 4, 5].map((level) => adHocArmyAt(level).stats.vitality)).toEqual([
      200, 200, 300, 400, 500, 500,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((level) => adHocArmyAt(level).stats.offense)).toEqual([
      50, 50, 70, 90, 110, 110,
    ]);
    expect([1, 4, 5].map(adHocArmyPerRound)).toEqual([1, 1, 2]);
    expect([4, 5].map(adHocArmyLabel)).toEqual(['Ad Hoc Army', 'Ad Hoc Army II']);
  });

  it('takes the tier bonuses a Wonder takes, Bonded Row held whole among them', () => {
    const whole = applyHoldBonus(noTerritoryEffects(), ATLAS_UNIFIED_BONUSES['bonded-row']!.bonus);
    const bare = effectiveStats(robot, field, side, noTerritoryEffects());
    const held = effectiveStats(robot, field, side, whole);
    expect(held.vitality).toBeGreaterThan(bare.vitality);
    expect(held.offense).toBeGreaterThan(bare.offense);
  });

  /** A side with the Geppetto and robots beside him, built by hand so a round can be stepped. */
  const workshop = (level: number, robots: number): SideState => {
    const formed = stackOf(AD_HOC_ARMY_ID, robots, noTerritoryEffects(), adHocArmyAt(level));
    return sideOf([stackOf(GEPPETTO_ID, 1), { ...formed, spawned: { formed: formed.effective } }]);
  };

  it('makes one more a round whether or not the first still stands, two at a level-5 ring', () => {
    const side = workshop(1, 1);
    makeAdHocArmy(side, 1);
    expect(side.stacks[1]!.alive).toBe(2);
    // The first is destroyed: the next round still adds one, so there is one again.
    const robots = side.stacks[1]!;
    robots.alive = 0;
    robots.pool = 0;
    robots.bodies = [];
    makeAdHocArmy(side, 1);
    expect(robots.alive).toBe(1);
    expect(robots.bodies).toEqual([robots.effective.vitality]);

    const five = workshop(5, 2);
    makeAdHocArmy(five, 5);
    expect(five.stacks[1]!.alive).toBe(4);
  });

  it('forms a fresh stack when the robots have run, and stops when he is out of the fight', () => {
    const side = workshop(2, 1);
    side.stacks[1]!.brokeAt = 1;
    makeAdHocArmy(side, 2);
    expect(side.stacks).toHaveLength(3);
    expect(side.stacks[2]!.alive).toBe(1);
    expect(side.stacks[2]!.effective.vitality).toBe(side.stacks[1]!.spawned!.formed.vitality);

    const gone = workshop(1, 1);
    gone.stacks[0]!.brokeAt = 3;
    makeAdHocArmy(gone, 1);
    expect(gone.stacks[1]!.alive).toBe(1);
  });

  it('leaves no robot on a result: not on the stacks, the kill ledgers or the turned', () => {
    let sawRobots = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const fight = simulate({
        seed: `geppetto-${seed}`,
        battlefield: field,
        attacker: {
          name: 'A',
          army: { the_geppetto: 1, razors: 10 },
          defending: false,
          territory: holding('bonded-row-ring', 5),
        },
        defender: { name: 'D', army: { razors: 14, wardens: 3 }, defending: true },
      });
      const ids = [...fight.attacker.stacks, ...fight.defender.stacks].map((s) => s.unit.id);
      expect(ids).not.toContain(AD_HOC_ARMY_ID);
      expect(Object.keys(fight.kills.attacker.intimidated)).not.toContain(AD_HOC_ARMY_ID);
      expect(Object.keys(fight.kills.attacker.spectacle)).not.toContain(AD_HOC_ARMY_ID);
      const tally = fight.adHocArmy!.attacker;
      // Two at the start and two at the start of every round after, while he fights.
      expect(tally.made % 2).toBe(0);
      expect(tally.made).toBeGreaterThanOrEqual(2);
      expect(tally.made).toBeLessThanOrEqual(2 * fight.rounds.length);
      expect(tally.lost).toBeGreaterThanOrEqual(0);
      expect(tally.lost).toBeLessThanOrEqual(tally.made);
      expect(fight.adHocArmy!.defender).toEqual({ made: 0, lost: 0 });
      sawRobots += tally.made;
    }
    expect(sawRobots).toBeGreaterThan(24);
  });

  it('gives a crew sending him the fight it would not have had without the robots', () => {
    let withRing = 0;
    let without = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const fight = (territory?: TerritoryEffects) =>
        simulate({
          seed: `workshop-${seed}`,
          battlefield: field,
          attacker: {
            name: 'A',
            army: { the_geppetto: 1, razors: 12 },
            defending: false,
            ...(territory ? { territory } : {}),
          },
          defender: { name: 'D', army: { razors: 24 }, defending: true },
        }).winner === 'attacker';
      if (fight(holding('bonded-row-ring', 5))) withRing += 1;
      if (fight()) without += 1;
    }
    // A level-5 ring makes him stronger robots, two at a time: it has to show. Measured over 100
    // seeds on 2026-10-09, twelve Razors and the Geppetto took 24 Razors 100 times at a level-5
    // ring and never without one.
    expect(withRing).toBeGreaterThan(without + 20);
  });
});
