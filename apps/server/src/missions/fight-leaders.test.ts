import {
  MISSION_TEMPLATES,
  createCommander,
  makeAttributes,
  noCrewEffects,
  researchEffects,
  type Base,
  type MissionTemplate,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { startingBase } from '../crew/starting.js';
import {
  LEADER_RANK_SAMPLES,
  bookUnder,
  chairOf,
  combatantFor,
  rankFightLeaders,
} from './fight-leaders.js';
import type { BenchMember } from './leaders.js';

/**
 * Who should lead a fight is whoever wins it (maintainer, 2026-09-28): the same force, under
 * each leader on the bench, over practice fights, with every rung and perk the real fight gets.
 */

const RAID_BOSS_RUNGS = [
  'tech_point_man',
  'tech_plate_carrier',
  'tech_loudest_in_the_room',
  'tech_hard_to_kill',
  'tech_second_wind',
  'tech_hits_like_a_truck',
];
const FIELD_COMMANDER_RUNGS = ['tech_marching_orders', 'tech_hold_the_line', 'tech_field_marshal'];

const fight = (): MissionTemplate => {
  const template = MISSION_TEMPLATES.find((one) => one.kind === 'battle');
  if (!template) throw new Error('no fight on the board');
  return template;
};

function crew(): Base {
  const base = startingBase({
    id: 'base-1',
    ownerId: 'user-1',
    name: 'The Ninth Street Crew',
    districtId: 'ashen-terraces',
    now: '2026-09-28T12:00:00.000Z',
  });
  return {
    ...base,
    commanders: [
      createCommander('boss', 'Vasco Renn', 'raid_boss'),
      createCommander('marshal', 'Halvard Nyx', 'field_commander'),
      createCommander('books', 'Odile Marchetti', 'consigliere'),
    ].map((one) => ({ ...one, attributes: makeAttributes(30) })),
  };
}

const bench = (base: Base): BenchMember[] => [
  { id: 'ov-1', name: 'Rook', kind: 'overseer', attributes: makeAttributes(30) },
  ...base.commanders.map((one) => ({
    id: one.id,
    name: one.name,
    kind: 'officer' as const,
    attributes: one.attributes,
  })),
];

describe('the chair and the sheet a leader brings', () => {
  it('names the chair off the books, and none for the Overseer', () => {
    const base = crew();
    expect(chairOf(base, { id: 'boss', kind: 'officer' })).toBe('raid_boss');
    expect(chairOf(base, { id: 'ov-1', kind: 'overseer' })).toBeNull();
    expect(chairOf(base, { id: 'stranger', kind: 'officer' })).toBeNull();
  });

  it("puts the Raid Boss's rungs on his sheet and the Field Commander's on the line", () => {
    const base = crew();
    const effects = researchEffects([...RAID_BOSS_RUNGS, ...FIELD_COMMANDER_RUNGS]);
    const [overseer, boss, marshal] = bench(base);
    expect(combatantFor(base, boss!, effects, 'mission').sheetBonus).toEqual({
      offensePercent: 55,
      vitalityPercent: 130,
      armorFlat: 15,
      targetSharePercent: 100,
      offenseTimes: 2,
      vitalityTimes: 2,
    });
    expect(combatantFor(base, marshal!, effects, 'mission').sheetBonus).toEqual({
      offensePercent: 0,
      vitalityPercent: 0,
      armorFlat: 0,
      targetSharePercent: 0,
      offenseTimes: 1,
      vitalityTimes: 1,
    });
    expect(bookUnder(base, marshal!, effects, 'mission').unitOffensePercent).toBe(25);
    expect(bookUnder(base, boss!, effects, 'mission').unitOffensePercent).toBe(0);
    // The Overseer is the crew: no chair, and none of the leading channels either.
    expect(combatantFor(base, overseer!, effects, 'mission').sheetBonus).toEqual(
      combatantFor(base, marshal!, effects, 'mission').sheetBonus,
    );
    expect(bookUnder(base, overseer!, { ...effects, leadOffensePercent: 9 }, 'mission')).toEqual({
      ...effects,
      leadOffensePercent: 9,
    });
  });
});

describe('the ranking', () => {
  it('rates every candidate over the same practice fights, best first, and the same way twice', () => {
    const base = crew();
    const args = {
      base,
      template: fight(),
      grade: 'D' as const,
      force: { razors: 12 },
      vehicles: {},
      candidates: bench(base),
      effects: noCrewEffects(),
      practice: 'practice-leader:test',
    };
    const first = rankFightLeaders(args);
    expect(first).toHaveLength(4);
    for (const rating of first) {
      expect(rating.fights).toBe(LEADER_RANK_SAMPLES);
      expect(rating.wins).toBeLessThanOrEqual(rating.fights);
      expect(rating.kept).toBeGreaterThanOrEqual(0);
      expect(rating.kept).toBeLessThanOrEqual(1);
      expect(rating.score).toBeCloseTo(rating.wins / rating.fights + 0.5 * rating.kept, 9);
    }
    for (let index = 1; index < first.length; index += 1) {
      expect(first[index - 1]!.score).toBeGreaterThanOrEqual(first[index]!.score);
    }
    expect(rankFightLeaders(args)).toEqual(first);
    // A tie keeps the bench's order, so the Overseer stands ahead of a stranger who fights alike.
    const tied = first.filter((one) => one.score === first[0]!.score).map((one) => one.id);
    if (tied.length > 1) expect(tied[0]).toBe('ov-1');
  });

  /**
   * Measured before it was pinned (2026-09-28): two officers with every attribute at eighty, two
   * Razors to four beside them at grade E, over eight practice keys. The Raid Boss with his six
   * rungs won every fight and the Consigliere with the same sheet won none. At thirty across the
   * board neither wins anything and the rungs move a hundredth of a survivor, so a pin there
   * would be a coin toss on the seed; this is the case where the sheet decides the fight.
   */
  it('prefers the Raid Boss once his track pays him, over the same sheet in another chair', () => {
    const base = crew();
    base.commanders = base.commanders.map((one) => ({ ...one, attributes: makeAttributes(80) }));
    const effects = researchEffects(RAID_BOSS_RUNGS);
    const [, boss, , books] = bench(base);
    for (let key = 0; key < 8; key += 1) {
      const ranked = rankFightLeaders({
        base,
        template: fight(),
        grade: 'E',
        force: { razors: 4 },
        vehicles: {},
        candidates: [books!, boss!],
        effects,
        practice: `practice-leader:chair:${key}`,
      });
      expect(ranked[0]!.id, `key ${key}`).toBe('boss');
      expect(ranked[0]!.wins - ranked[1]!.wins, `key ${key}`).toBeGreaterThanOrEqual(3);
      expect(ranked[0]!.score, `key ${key}`).toBeGreaterThan(ranked[1]!.score);
    }
  });
});
