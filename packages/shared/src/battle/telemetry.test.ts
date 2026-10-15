import { describe, expect, it } from 'vitest';
import { findUnit, describeRequirement, unitsUnlockedByLocation } from '../index.js';
import { bareBattlefield } from './battlefield.js';
import { effectiveStats } from './effects.js';
import { findLocation, noTerritoryEffects, type TerritoryEffects } from '../city/index.js';
import { applyHoldBonus, bonusesAt, describeHoldBonus } from '../city/locations.js';
import { markedUnit } from './line.js';
import {
  ROOFTOP_REACH,
  fromTheRoof,
  outOfTheAmbush,
  simulate,
  type SideState,
  type Stack,
} from './engine.js';
import { UNIT_MODIFIERS, UNIT_RULES } from '../units/index.js';

/** Telemetry Hill, batch 12 (maintainer, 2026-10-09): four locations that each do one thing. */

const field = bareBattlefield();
const side = { defending: false, outnumbered: 0 };

const holding = (id: string, level: number): TerritoryEffects =>
  bonusesAt(findLocation(id)!, level).reduce(
    (into, bonus) => applyHoldBonus(into, bonus),
    noTerritoryEffects(),
  );
const kindsAt = (id: string, level: number): string[] =>
  bonusesAt(findLocation(id)!, level).map((bonus) => bonus.kind);

function stackOf(id: string, territory: TerritoryEffects = noTerritoryEffects()): Stack {
  const spec = markedUnit(findUnit(id)!, territory);
  const effective = effectiveStats(spec, field, side, territory);
  return {
    unit: spec,
    effective,
    alive: 4,
    pool: 4 * effective.vitality,
    bodies: new Array<number>(4).fill(effective.vitality),
    morale: effective.morale,
    brokeAt: null,
    started: 4,
    charged: 0,
    suppressed: 0,
    dealt: 0,
    sheet: spec.stats,
    modGain: {},
    loudTier: 0,
  };
}

describe('the Uplink Farm', () => {
  it('lifts four skills on every officer, 5 to 10, and does nothing else', () => {
    expect(kindsAt('telemetry-hill-uplink', 5)).toEqual([
      'officer_skill',
      'officer_skill',
      'officer_skill',
      'officer_skill',
    ]);
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('telemetry-hill-uplink', level).officerSkillFlat),
    ).toEqual(
      [5, 6, 7, 8, 10].map((n) => ({ signals: n, cryptography: n, cybernetics: n, navigation: n })),
    );
  });

  it('no longer opens what a satellite uplink opens', () => {
    expect(unitsUnlockedByLocation('telemetry-hill-uplink')).toEqual([]);
  });
});

describe('the Repeater Mast', () => {
  const kites = findUnit('kite_crews')!;

  it('is one of the Kite Crews’ requirements, beside their structures', () => {
    const mast = kites.requires.find((need) => need.kind === 'place');
    expect(mast).toEqual({ kind: 'place', locationId: 'telemetry-hill-repeater' });
    expect(describeRequirement(mast!)).toBe('Hold The Repeater Mast in Telemetry Hill');
    expect(kites.requires.filter((need) => need.kind === 'building')).toHaveLength(3);
  });

  it('lends them +30 damage and vitality a level, 30 to 180, and ROOFTOP at level 5 alone', () => {
    const bare = effectiveStats(kites, field, side, noTerritoryEffects());
    const offense = bare.offense / kites.stats.offense;
    const vitality = bare.vitality / kites.stats.vitality;
    expect(
      [1, 2, 3, 4, 5].map((level) => {
        const held = effectiveStats(kites, field, side, holding('telemetry-hill-repeater', level));
        return [
          Math.round(held.offense / offense - kites.stats.offense),
          Math.round(held.vitality / vitality - kites.stats.vitality),
        ];
      }),
    ).toEqual([
      [30, 30],
      [60, 60],
      [90, 90],
      [120, 120],
      [180, 180],
    ]);
    expect(holding('telemetry-hill-repeater', 4).unitMarks).toEqual({});
    expect(holding('telemetry-hill-repeater', 5).unitMarks).toEqual({ kite_crews: ['rooftop'] });
    expect(describeHoldBonus(bonusesAt(findLocation('telemetry-hill-repeater')!, 5).at(-1)!)).toBe(
      'Rooftop for Kite Crews',
    );
  });

  it('took ROOFTOP off the Kite Crews’ sheet and left it on the Snipers’', () => {
    expect(kites.rooftop).toBeUndefined();
    expect(kites.modifiers).toEqual(['open_field', 'tracking']);
    expect(findUnit('snipers')!.rooftop).toBe(true);
    expect('rooftop' in UNIT_MODIFIERS).toBe(false);
    expect(UNIT_RULES.rooftop.description).toBe(
      'They cannot be ambushed, and have double evasion against units with range below 30.',
    );
  });
});

describe('ROOFTOP', () => {
  const marked = { ...noTerritoryEffects(), unitMarks: { kite_crews: ['rooftop' as const] } };

  it('doubles evasion against range below 30 only, inside the 100 cap', () => {
    const roof = stackOf('kite_crews', marked);
    const evasion = roof.effective.evasion;
    expect(fromTheRoof(roof.effective, roof, ROOFTOP_REACH - 1).evasion).toBe(
      Math.min(100, evasion * 2),
    );
    expect(fromTheRoof(roof.effective, roof, ROOFTOP_REACH).evasion).toBe(evasion);
    const ground = stackOf('kite_crews');
    expect(fromTheRoof(ground.effective, ground, 10).evasion).toBe(ground.effective.evasion);
    const high = { ...roof.effective, evasion: 80 };
    expect(fromTheRoof(high, roof, 10).evasion).toBe(100);
  });

  it('keeps them out of the ambush and leaves everybody else in it', () => {
    const roof = stackOf('kite_crews', marked);
    const razors = stackOf('razors');
    const view = outOfTheAmbush({ stacks: [roof, razors] } as unknown as SideState);
    expect(view.stacks).toEqual([razors]);
  });

  it('costs a line of them less in the first round of an ambush', () => {
    let roofLost = 0;
    let groundLost = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const fight = (territory?: TerritoryEffects) =>
        simulate({
          seed: `roof-${seed}`,
          battlefield: field,
          // Snipers shoot from 90, so the evasion half never applies: only the ambush is measured.
          attacker: { name: 'A', army: { snipers: 20 }, defending: false },
          defender: {
            name: 'D',
            army: { kite_crews: 10 },
            defending: true,
            ...(territory ? { territory } : {}),
          },
        });
      const ambushed = fight();
      expect(ambushed.openingStrike).toBeGreaterThan(0);
      groundLost += ambushed.rounds[0]?.defenderLost ?? 0;
      roofLost += fight(marked).rounds[0]?.defenderLost ?? 0;
    }
    expect(roofLost).toBeLessThan(groundLost);
  });
});

describe('the Quiet Room', () => {
  it('cuts drill time 2.5% a level to 10%, and adds a session a day at level 5 alone', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('telemetry-hill-quiet', level).trainingTimePercent),
    ).toEqual([2.5, 5, 7.5, 10, 10]);
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('telemetry-hill-quiet', level).extraTrainingSessions),
    ).toEqual([0, 0, 0, 0, 1]);
    expect(new Set(kindsAt('telemetry-hill-quiet', 5))).toEqual(
      new Set(['training_time', 'training_sessions']),
    );
  });
});

describe('Hilltop Lodge', () => {
  it('is the lodge by name and by id, and pays beds alone: 80, 110, 140, 170, 230', () => {
    const lodge = findLocation('telemetry-hill-lodge')!;
    expect(lodge.name).toBe('Hilltop Lodge');
    expect(findLocation('telemetry-hill-pirate')).toBeUndefined();
    expect(
      [1, 2, 3, 4, 5].map((level) => holding('telemetry-hill-lodge', level).unitSlotBonus),
    ).toEqual([80, 110, 140, 170, 230]);
    expect(kindsAt('telemetry-hill-lodge', 5)).toEqual(['unit_slots']);
    expect(holding('telemetry-hill-lodge', 5).intimidationFlat).toBe(0);
  });
});
