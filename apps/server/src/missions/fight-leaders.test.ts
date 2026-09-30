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
   * The case where the sheet decides the fight: two officers with every attribute at eighty,
   * fifteen Razors beside them at grade E, which is about the size of what an E fields. Over thirty
   * practice keys (re-measured 2026-09-29) the Raid Boss with his six rungs wins 133 of 180 and the
   * Consigliere with the same sheet 20, and the Raid Boss ranks first on all thirty. The same
   * sweep at seventy and ninety, and at sixteen and seventeen Razors, ranks him first on every key.
   *
   * It used to be four Razors against the same grade, where a loud enough leader routed a line
   * three times his party's size. Intimidation now reaches 1.5 enemy slots per slot of its own
   * side (`INTIMIDATION_REACH`), so a party of four cannot frighten fifteen whoever leads it, and
   * both officers lost every fight there. The rungs still pay; they pay in a fight they can tip.
   */
  it('prefers the Raid Boss once his track pays him, over the same sheet in another chair', () => {
    const base = crew();
    base.commanders = base.commanders.map((one) => ({ ...one, attributes: makeAttributes(80) }));
    const effects = researchEffects(RAID_BOSS_RUNGS);
    const [, boss, , books] = bench(base);
    const keys = 30;
    let first = 0;
    let margin = 0;
    for (let key = 0; key < keys; key += 1) {
      const ranked = rankFightLeaders({
        base,
        template: fight(),
        grade: 'E',
        force: { razors: 15 },
        vehicles: {},
        // The Consigliere first, so a tie would rank him ahead and never count for the Raid Boss.
        candidates: [books!, boss!],
        effects,
        practice: `practice-leader:chair:${key}`,
      });
      const bossRating = ranked.find((one) => one.id === 'boss')!;
      const booksRating = ranked.find((one) => one.id === 'books')!;
      // Never worse: the rungs can fail to matter on a key, never cost him a fight.
      expect(bossRating.wins, `key ${key}`).toBeGreaterThanOrEqual(booksRating.wins);
      if (ranked[0]!.id === 'boss') first += 1;
      margin += bossRating.wins - booksRating.wins;
    }
    expect(first).toBeGreaterThanOrEqual(keys - 3);
    expect(margin).toBeGreaterThanOrEqual(60);
  });
});
