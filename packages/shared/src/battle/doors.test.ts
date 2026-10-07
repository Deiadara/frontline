import { describe, expect, it } from 'vitest';
import { envLabel, noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import {
  ANTI_COMBINE_PERCENT,
  CONDEMNED_PER_LEVEL,
  PAMPHLET_PENALTY_PERCENT,
  PAPERCUT_ARMOR,
  SAINT_CONGREGATION_CAP,
} from '../city/reliquary.js';
import { findUnit, type UnitSpec } from '../units/index.js';
import { bareBattlefield, type Battlefield } from './battlefield.js';
import { doorPerks, NO_DOOR_PERKS } from './doors.js';
import { effectiveStats, type UnitFightContext } from './effects.js';
import { auraSheet, simulate, type SideSetup, type Simulation } from './engine.js';

const unit = (id: string): UnitSpec => findUnit(id) as UnitSpec;
const territory = (patch: Partial<TerritoryEffects> = {}): TerritoryEffects => ({
  ...noTerritoryEffects(),
  ...patch,
});
const ground = (patch: Partial<Battlefield> = {}): Battlefield => ({
  ...bareBattlefield(),
  ...patch,
});
const sheet = (
  id: string,
  patch: Partial<TerritoryEffects> = {},
  fight: UnitFightContext = {},
  defending = false,
  field: Battlefield = ground(),
) => effectiveStats(unit(id), field, { defending, outnumbered: 0 }, territory(patch), [], fight);

/** The same fight with and without one rule, over `seeds` seeds. */
function sweep(
  seeds: number,
  build: (seed: string) => { attacker: SideSetup; defender: SideSetup },
  read: (fight: Simulation) => number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < seeds; i += 1) {
    const seed = `doors-${i}`;
    out.push(read(simulate({ seed, battlefield: ground(), ...build(seed) })));
  }
  return out;
}
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('the door ladders as data', () => {
  it('pays nothing below level 2 and sums the steps above it', () => {
    expect(doorPerks('the_condemned', 1)).toEqual(NO_DOOR_PERKS);
    expect(doorPerks('the_condemned', 0)).toEqual(NO_DOOR_PERKS);
    expect(doorPerks('nobody', 5)).toEqual(NO_DOOR_PERKS);
    expect(doorPerks('the_condemned', 3).offense).toBe(2 * CONDEMNED_PER_LEVEL);
    expect(doorPerks('the_condemned', 5).offense).toBe(4 * CONDEMNED_PER_LEVEL);
    expect(doorPerks('the_condemned', 4).lastChancePercent).toBe(0);
    expect(doorPerks('the_condemned', 5).lastChancePercent).toBeGreaterThan(0);
    expect(doorPerks('the_saint', 2).stalwart).toBe(true);
    expect(doorPerks('the_saint', 3).evasion).toBe(10);
    expect(doorPerks('the_saint', 4).inspiration).toBe(true);
    expect(doorPerks('the_saint', 5).congregationCap).toBe(SAINT_CONGREGATION_CAP);
    expect(doorPerks('juggernauts', 4).taunts).toBe(true);
    expect(doorPerks('juggernauts', 3).homeLabels).toEqual(['wet', 'cold', 'snowy']);
    expect(doorPerks('the_crimson_dancer', 4).ignoredLabels).toEqual(['crammed', 'wet']);
    expect(doorPerks('the_crimson_dancer', 5).papercutArmor).toBe(PAPERCUT_ARMOR);
  });

  it('puts the door flats on the sheet before the percentages, and the congregation under its cap', () => {
    const plain = sheet('the_condemned');
    const l5 = sheet('the_condemned', {}, { door: doorPerks('the_condemned', 5) });
    expect(l5.offense - plain.offense).toBeCloseTo(4 * CONDEMNED_PER_LEVEL, 5);
    expect(l5.vitality - plain.vitality).toBeCloseTo(4 * CONDEMNED_PER_LEVEL, 5);
    const saint = sheet('the_saint');
    const small = sheet('the_saint', {}, { door: doorPerks('the_saint', 5), slotsBeside: 40 });
    const huge = sheet('the_saint', {}, { door: doorPerks('the_saint', 5), slotsBeside: 5000 });
    expect(small.offense - saint.offense).toBeCloseTo(40, 5);
    expect(huge.offense - saint.offense).toBeCloseTo(SAINT_CONGREGATION_CAP, 5);
    expect(huge.vitality - saint.vitality).toBeCloseTo(SAINT_CONGREGATION_CAP, 5);
    const l3 = sheet('the_saint', {}, { door: doorPerks('the_saint', 3) });
    expect(l3.evasion).toBe(saint.evasion + 10);
    expect(l3.stealth).toBe(saint.stealth + 10);
    expect(l3.speed).toBeGreaterThan(saint.speed);
    const jug = sheet('juggernauts', {}, { door: doorPerks('juggernauts', 2) });
    expect(jug.range).toBe(sheet('juggernauts').range + 20);
  });

  it('reads the labels through the door: ignored, home ground and INSPIRATION', () => {
    const wet = ground({ labels: [envLabel('wet', 3)] });
    const dancer = sheet('the_crimson_dancer', {}, {}, false, wet);
    const dancerL4 = sheet(
      'the_crimson_dancer',
      {},
      { door: doorPerks('the_crimson_dancer', 4) },
      false,
      wet,
    );
    expect(dancer.offense).toBeLessThan(sheet('the_crimson_dancer').offense);
    expect(dancerL4.evasion).toBe(100);
    expect(dancerL4.reasons.some((r) => r.startsWith('Wet'))).toBe(false);
    const jug = sheet('juggernauts', {}, {}, false, wet);
    const jugL3 = sheet('juggernauts', {}, { door: doorPerks('juggernauts', 3) }, false, wet);
    expect(jug.offense).toBeLessThan(sheet('juggernauts').offense);
    // Home ground is the mirror of what the wet cost, on top of the +100 vitality.
    expect(jugL3.offense).toBeGreaterThan(sheet('juggernauts').offense);
    expect(jugL3.reasons.some((r) => r.includes('home ground'))).toBe(true);
    const razorsWet = sheet('razors', {}, {}, false, wet);
    const razorsInspired = sheet('razors', {}, { inspired: true }, false, wet);
    expect(razorsWet.offense).toBeLessThan(sheet('razors').offense);
    expect(razorsInspired.offense).toBeCloseTo(sheet('razors').offense, 5);
    // The Tolling Tower: the crew's own list drops the label the same way.
    const noisy = ground({ labels: [envLabel('noisy', 3)] });
    const hounds = sheet('cyber_dogs', {}, {}, false, noisy);
    const deaf = sheet(
      'cyber_dogs',
      { ignoredLabels: ['noisy'] } as Partial<TerritoryEffects>,
      {},
      false,
      noisy,
    );
    expect(hounds.offense).toBeLessThan(deaf.offense);
  });

  it('lets a level-2 Shrine hold the Saint and a level-4 Lab make the Juggernauts taunt', () => {
    const doors = (ids: Record<string, number>): Partial<TerritoryEffects> => ({ doorLevels: ids });
    const fight = simulate({
      seed: 'flags',
      attacker: { name: 'A', army: { razors: 10 }, defending: false },
      defender: {
        name: 'D',
        army: { the_saint: 1, juggernauts: 2 },
        defending: true,
        territory: territory(doors({ the_saint: 2, juggernauts: 4 })),
      },
    });
    const [saint, jugs] = fight.defender.stacks;
    expect(saint?.unit.stalwart).toBe(true);
    expect(jugs?.unit.taunts).toBe(true);
    const bare = simulate({
      seed: 'flags',
      attacker: { name: 'A', army: { razors: 10 }, defending: false },
      defender: { name: 'D', army: { the_saint: 1, juggernauts: 2 }, defending: true },
    });
    expect(bare.defender.stacks[0]?.unit.stalwart).toBeUndefined();
    expect(bare.defender.stacks[1]?.unit.taunts).toBeUndefined();
  });
});

describe('the rules that read the other side', () => {
  it('GUARD pays both halves on the defending side and nothing on the attack', () => {
    const wardens = unit('wardens');
    expect(wardens.modifiers).toContain('guard');
    const attacking = sheet('wardens');
    const defending = sheet('wardens', {}, {}, true);
    expect(defending.offense / attacking.offense).toBeCloseTo(1.25, 5);
    expect(defending.vitality / attacking.vitality).toBeCloseTo(1.25, 5);
  });

  it('ANTI-COMBINE pays per level against the Combine only', () => {
    const plain = sheet('razors');
    const levels = { antiCombineLevels: 2 };
    const notCombine = sheet('razors', levels, { againstCombine: false });
    const combine = sheet('razors', levels, { againstCombine: true });
    expect(notCombine.offense).toBeCloseTo(plain.offense, 5);
    expect(combine.offense / plain.offense).toBeCloseTo(1 + (2 * ANTI_COMBINE_PERCENT) / 100, 5);
    expect(combine.vitality / plain.vitality).toBeCloseTo(1 + (2 * ANTI_COMBINE_PERCENT) / 100, 5);
    // Through the engine: the flag on the enemy's setup is what turns it on.
    const vs = (government: boolean) =>
      simulate({
        seed: 'anti',
        attacker: {
          name: 'A',
          army: { razors: 10 },
          defending: false,
          territory: territory(levels),
        },
        defender: { name: 'D', army: { civic_levy: 10 }, defending: true, government },
      }).attacker.stacks[0]?.effective.offense ?? 0;
    expect(vs(true)).toBeGreaterThan(vs(false));
  });

  it('a pinned unit fights the wall’s holder at a discount, and only that holder', () => {
    const plain = sheet('razors');
    const pinned = sheet('razors', {}, { pamphleted: true });
    expect(pinned.offense / plain.offense).toBeCloseTo(1 - PAMPHLET_PENALTY_PERCENT / 100, 5);
    expect(pinned.vitality / plain.vitality).toBeCloseTo(1 - PAMPHLET_PENALTY_PERCENT / 100, 5);
    const vs = (pins: string[]) =>
      simulate({
        seed: 'pins',
        attacker: { name: 'A', army: { razors: 10 }, defending: false },
        defender: {
          name: 'D',
          army: { civic_levy: 10 },
          defending: true,
          territory: { ...territory(), pamphletUnits: pins },
        },
      }).attacker.stacks[0]?.effective.offense ?? 0;
    expect(vs(['razors'])).toBeLessThan(vs([]));
    expect(vs(['civic_levy'])).toBeCloseTo(vs([]), 5);
  });

  it('the Rose Window pays a faction mate’s units, weighted by how many each mate sent', () => {
    const fight = simulate({
      seed: 'rose',
      attacker: {
        name: 'A',
        army: { razors: 10, civic_levy: 5 },
        defending: false,
        allies: [{ army: { razors: 5 }, fightPercent: 10 }],
      },
      defender: { name: 'D', army: { civic_levy: 10 }, defending: true },
    });
    const own = simulate({
      seed: 'rose',
      attacker: { name: 'A', army: { razors: 10, civic_levy: 5 }, defending: false },
      defender: { name: 'D', army: { civic_levy: 10 }, defending: true },
    });
    const razors = fight.attacker.stacks[0]!.effective.offense;
    const ownRazors = own.attacker.stacks[0]!.effective.offense;
    // Half the Razors came from the ally at +10%, so the stack is +5%.
    expect(razors / ownRazors).toBeCloseTo(1.05, 5);
    expect(fight.attacker.stacks[1]!.effective.offense).toBeCloseTo(
      own.attacker.stacks[1]!.effective.offense,
      5,
    );
  });

  it('flat stat points land by scope, on range and penetration too', () => {
    const plain = sheet('wardens');
    const flats: Partial<TerritoryEffects> = {
      unitStatFlats: [
        { stat: 'range', flat: 10, rule: 'guard' },
        { stat: 'penetration', flat: 7, tier: 'heavy' },
        { stat: 'armor', flat: 5, damageType: 'energy' },
      ],
    };
    const wardens = sheet('wardens', flats);
    expect(wardens.range).toBe(plain.range + 10);
    expect(wardens.penetration).toBe(
      plain.penetration + (unit('wardens').tier === 'heavy' ? 7 : 0),
    );
    expect(wardens.armor).toBe(
      plain.armor + (unit('wardens').stats.damageType === 'energy' ? 5 : 0),
    );
    const razors = sheet('razors', flats);
    expect(razors.range).toBe(sheet('razors').range);
  });

  it('every modification fitted is armour under the Bellfounders, inside the cap', () => {
    const plain = sheet('razors', { modificationArmorFlat: 3 }, { fittedCount: 0 });
    const two = sheet('razors', { modificationArmorFlat: 3 }, { fittedCount: 2 });
    expect(two.armor).toBe(plain.armor + 6);
    expect(sheet('razors', { modificationArmorFlat: 60 }, { fittedCount: 3 }).armor).toBe(100);
  });

  it('a legend’s aura holds while the legend stands and stops when he is down', () => {
    const aura: Partial<TerritoryEffects> = {
      legendAuras: [
        { unitId: 'the_saint', stat: 'offense_vitality', amount: 2 },
        { unitId: 'the_crimson_dancer', stat: 'penetration', amount: 5 },
      ],
    };
    const with_ = simulate({
      seed: 'aura',
      attacker: { name: 'A', army: { civic_levy: 10 }, defending: false },
      defender: {
        name: 'D',
        army: { the_saint: 1, the_crimson_dancer: 1, razors: 10 },
        defending: true,
        territory: territory(aura),
      },
    });
    const without = simulate({
      seed: 'aura',
      attacker: { name: 'A', army: { civic_levy: 10 }, defending: false },
      defender: {
        name: 'D',
        army: { the_saint: 1, the_crimson_dancer: 1, razors: 10 },
        defending: true,
      },
    });
    const razors = with_.defender.stacks.find((s) => s.unit.id === 'razors')!;
    const bare = without.defender.stacks.find((s) => s.unit.id === 'razors')!;
    expect(razors.effective.offense / bare.effective.offense).toBeCloseTo(1.02, 5);
    expect(razors.effective.penetration).toBe(bare.effective.penetration + 5);
    // The Saint not in the force: his aura is not cast.
    const absent = simulate({
      seed: 'aura',
      attacker: { name: 'A', army: { civic_levy: 10 }, defending: false },
      defender: { name: 'D', army: { razors: 10 }, defending: true, territory: territory(aura) },
    });
    expect(absent.defender.stacks[0]!.effective.offense).toBeCloseTo(bare.effective.offense, 5);
    // And once he is down, the Razors fire without it: `auraSheet` is what `fireRound` reads.
    const saint = with_.defender.stacks.find((s) => s.unit.id === 'the_saint')!;
    expect(auraSheet(razors, with_.defender, razors.effective).offense).toBeCloseTo(
      razors.effective.offense,
      5,
    );
    saint.alive = 0;
    expect(auraSheet(razors, with_.defender, razors.effective).offense).toBeCloseTo(
      bare.effective.offense,
      5,
    );
  });
});

describe('what the doors do when the dying strike back', () => {
  const SEEDS = 60;
  it('LAST CHANCE: a level-5 Watch Cell kills more than the same Condemned at level 4', () => {
    const dealt = (level: number) =>
      sweep(
        SEEDS,
        () => ({
          attacker: {
            name: 'A',
            army: { the_condemned: 30 },
            defending: false,
            territory: territory({ doorLevels: { the_condemned: level } }),
          },
          defender: { name: 'D', army: { civic_levy: 40 }, defending: true },
        }),
        (fight) => fight.attacker.stacks[0]!.dealt,
      );
    // Level 4 against level 5 isolates the strike: the +30 is the one other step between them.
    const l4 = dealt(4);
    const l5 = dealt(5);
    expect(sum(l5)).toBeGreaterThan(sum(l4) * 1.03);
    expect(l5.filter((x, i) => x < l4[i]!).length).toBeLessThan(SEEDS / 4);
  });

  it('BLOWOUT: dying Juggernauts take covered enemy bodies with them, smallest first', () => {
    const killed = (level: number) =>
      sweep(
        SEEDS,
        () => ({
          attacker: { name: 'A', army: { snipers: 30, wardens: 4 }, defending: false },
          defender: {
            name: 'D',
            army: { juggernauts: 4 },
            defending: true,
            territory: territory({ doorLevels: { juggernauts: level } }),
          },
        }),
        (fight) => fight.attacker.stacks[0]!.started - fight.attacker.stacks[0]!.alive,
      );
    const l4 = killed(4);
    const l5 = killed(5);
    expect(sum(l5)).toBeGreaterThan(sum(l4));
    expect(l5.filter((x, i) => x < l4[i]!).length).toBeLessThan(SEEDS / 4);
  });

  it('PAPERCUT strips the enemy’s plate round by round, to the floor', () => {
    const armorAfter = (level: number) =>
      simulate({
        seed: 'paper',
        attacker: {
          name: 'A',
          army: { the_crimson_dancer: 1, razors: 10 },
          defending: false,
          territory: territory({ doorLevels: { the_crimson_dancer: level } }),
        },
        defender: { name: 'D', army: { wardens: 12 }, defending: true },
      });
    const cut = armorAfter(5);
    const kept = armorAfter(4);
    const wardens = (fight: Simulation) => fight.defender.stacks[0]!.effective.armor;
    expect(wardens(kept)).toBe(sheet('wardens', {}, {}, true).armor);
    expect(wardens(cut)).toBeLessThan(wardens(kept));
    // One strip per round she fired, opening volley included, never below zero.
    expect(wardens(cut)).toBeGreaterThanOrEqual(0);
    expect(wardens(cut)).toBe(
      Math.max(0, wardens(kept) - PAPERCUT_ARMOR * (cut.rounds.length + 1)),
    );
  });
});

describe('the ledgers of the dead', () => {
  it('files the intimidated among the fallen, in their share of the stack', () => {
    const fight = simulate({
      seed: 'pit',
      attacker: { name: 'A', army: { juggernauts: 30 }, defending: false },
      defender: { name: 'D', army: { civic_levy: 40 }, defending: true },
    });
    expect(fight.intimidated.defender).toBeGreaterThan(0);
    const filed = fight.kills.defender.intimidated['civic_levy'] ?? 0;
    const fell = fight.defender.stacks[0]!.started - fight.defender.stacks[0]!.alive;
    expect(filed).toBeGreaterThan(0);
    expect(filed).toBeLessThanOrEqual(Math.min(fell, fight.intimidated.defender));
    // Nobody intimidated, nothing filed.
    const calm = simulate({
      seed: 'pit',
      attacker: { name: 'A', army: { civic_levy: 20 }, defending: false },
      defender: { name: 'D', army: { civic_levy: 20 }, defending: true },
    });
    expect(calm.intimidated.defender).toBe(0);
    expect(calm.kills.defender.intimidated).toEqual({});
  });

  it('SPECTACLE credits the Dancer her share of the bodies, at level 3 and not below', () => {
    const credited = (level: number) =>
      simulate({
        seed: 'show',
        attacker: {
          name: 'A',
          army: { the_crimson_dancer: 1, razors: 10 },
          defending: false,
          territory: territory({ doorLevels: { the_crimson_dancer: level } }),
        },
        defender: { name: 'D', army: { civic_levy: 30 }, defending: true },
      });
    const l3 = credited(3);
    const l2 = credited(2);
    expect(l2.kills.defender.spectacle).toEqual({});
    const hers = l3.kills.defender.spectacle['civic_levy'] ?? 0;
    expect(hers).toBeGreaterThan(0);
    expect(hers).toBeLessThanOrEqual(l3.defender.stacks[0]!.started - l3.defender.stacks[0]!.alive);
  });
});
