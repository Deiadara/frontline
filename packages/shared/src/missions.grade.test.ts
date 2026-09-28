import { describe, expect, it } from 'vitest';
import {
  FIGHT_CATEGORIES,
  GRADES,
  GRADE_DEAL_REACH,
  GRADE_ENEMY_STRENGTH,
  GRADE_PAY_LEVEL,
  MAYHEM_SHARE,
  gradePeakLevel,
  MAYHEM_UNLOCK_LEVEL,
  dealCentre,
  dealGrade,
  enemyStrength,
  fightCategory,
  fightLift,
  gradePay,
  gradeOdds,
  gradedChance,
  gradedDurationMinutes,
  type Grade,
} from './missions.grade.js';
import { MISSION_TEMPLATES } from './missions.js';
import { covers, missionOffers } from './missions.areas.js';

/** The grade dealt most often at this level. */
const top = (level: number): Grade =>
  GRADES.reduce((best, grade) => (gradeOdds(level)[grade] > gradeOdds(level)[best] ? grade : best));

describe('the grade ladder', () => {
  it('names a fight by its letter: Skirmish, Battle, Siege, Mayhem', () => {
    expect(fightCategory('F-')).toBe('skirmish');
    expect(fightCategory('E+')).toBe('skirmish');
    expect(fightCategory('D-')).toBe('battle');
    expect(fightCategory('C+')).toBe('battle');
    expect(fightCategory('B-')).toBe('siege');
    expect(fightCategory('A+')).toBe('siege');
    expect(fightCategory('S-')).toBe('mayhem');
    expect(FIGHT_CATEGORIES).toEqual(['skirmish', 'battle', 'siege', 'mayhem']);
  });

  it('fields, pays and peaks more at every mark than the one under it', () => {
    for (let index = 1; index < GRADES.length; index += 1) {
      const [low, high] = [GRADES[index - 1]!, GRADES[index]!];
      expect(enemyStrength(high), high).toBeGreaterThan(enemyStrength(low));
      expect(gradePay(high), high).toBeGreaterThan(gradePay(low));
      expect(fightLift(high), high).toBeGreaterThanOrEqual(fightLift(low));
      expect(GRADE_PAY_LEVEL[high], high).toBeGreaterThan(GRADE_PAY_LEVEL[low]);
      expect(gradePeakLevel(high), high).toBeGreaterThan(gradePeakLevel(low));
    }
    expect(GRADE_ENEMY_STRENGTH['F-']).toBe(1_600);
  });

  it('keeps a job longer on site for every mark above its lowest, never past the ceiling', () => {
    const job = { durationMinutes: 100, grades: ['D-', 'C+'] as const };
    expect(gradedDurationMinutes(job, 'D-', 1440)).toBe(100);
    expect(gradedDurationMinutes(job, 'C+', 1440)).toBe(140);
    expect(gradedDurationMinutes({ durationMinutes: 1400, grades: ['C', 'B+'] }, 'B+', 1440)).toBe(
      1440,
    );
  });
});

describe('the odds on a card', () => {
  it('hits the anchors within a point, and is certain from five marks over', () => {
    expect(gradedChance(0)).toBeCloseTo(0.75, 2);
    expect(gradedChance(-3)).toBeCloseTo(0.3, 2);
    expect(gradedChance(3)).toBeCloseTo(0.95, 2);
    expect(gradedChance(5)).toBe(1);
    expect(gradedChance(-12)).toBeGreaterThan(0);
    expect(gradedChance(-12)).toBeLessThan(0.005);
  });
});

describe('who is dealt what', () => {
  it('centres each grade on its own peak level', () => {
    for (const grade of GRADES) {
      const level = gradePeakLevel(grade);
      if (grade[0] === 'S' && level < MAYHEM_UNLOCK_LEVEL) continue;
      expect(top(level), `level ${String(level)}`).toBe(grade);
      // Off the unrounded peak: a whole-number level lands a fraction of a mark either side.
      expect(dealCentre(GRADE_PAY_LEVEL[grade] / 0.75)).toBeCloseTo(GRADES.indexOf(grade), 1);
    }
  });

  /**
   * Three quarter pace (maintainer, 2026-09-28: the late cards dealt in the late game): a crew
   * meets each grade at a third above the level its pay is anchored at, so the grade a crew of
   * level L is centred on is the one whose pay level is three quarters of L. A literal, not the
   * constant, so a retune has to come through here.
   */
  it('climbs the ladder at three quarters of the crew’s level', () => {
    for (const level of [20, 40, 72, 120]) {
      const centre = dealCentre(level);
      const half = (level * 3) / 4;
      const below = GRADES.filter((grade) => GRADE_PAY_LEVEL[grade] <= half).length - 1;
      expect(Math.floor(centre), `level ${String(level)}`).toBe(below);
    }
  });

  it('gives Mayhem its flat share from level 90, bell or no bell', () => {
    const s = (level: number) =>
      gradeOdds(level)['S-'] + gradeOdds(level).S + gradeOdds(level)['S+'];
    expect(s(89)).toBe(0);
    expect(s(90)).toBeCloseTo(MAYHEM_SHARE, 9);
    expect(gradeOdds(90)['S-']).toBeGreaterThan(gradeOdds(90)['S+']);
  });

  it('sums to one everywhere, and deals no S before Mayhem opens', () => {
    for (const level of [1, 5, 20, 50, 89, 90, 125, 400]) {
      const odds = gradeOdds(level);
      const sum = GRADES.reduce((total, grade) => total + odds[grade], 0);
      expect(sum, `level ${String(level)}`).toBeCloseTo(1, 9);
      const s = odds['S-'] + odds.S + odds['S+'];
      if (level < MAYHEM_UNLOCK_LEVEL) expect(s, `level ${String(level)}`).toBe(0);
      else expect(s, `level ${String(level)}`).toBeGreaterThan(0);
    }
  });

  it('deals most cards within a mark of the crew’s own grade and none past three but Mayhem’s floor', () => {
    for (const level of [1, 12, 36, 70, 110]) {
      const centre = dealCentre(level);
      const odds = gradeOdds(level);
      const within = (reach: number) =>
        GRADES.filter((grade) => Math.abs(GRADES.indexOf(grade) - centre) <= reach).reduce(
          (total, grade) => total + odds[grade],
          0,
        );
      expect(within(1.5), `level ${String(level)}`).toBeGreaterThan(0.6);
      const floor = level >= MAYHEM_UNLOCK_LEVEL ? MAYHEM_SHARE : 0;
      expect(within(GRADE_DEAL_REACH), `level ${String(level)}`).toBeGreaterThanOrEqual(
        1 - floor - 1e-9,
      );
    }
  });

  it('deals the grades it is allowed and lands the roll where the odds say', () => {
    expect(dealGrade(0.5, 30, ['C'])).toBe('C');
    const level = 25;
    const counts: Partial<Record<Grade, number>> = {};
    const rolls = 20_000;
    for (let roll = 0; roll < rolls; roll += 1) {
      const grade = dealGrade((roll + 0.5) / rolls, level, GRADES);
      counts[grade] = (counts[grade] ?? 0) + 1;
    }
    for (const grade of GRADES) {
      expect(Math.abs((counts[grade] ?? 0) / rolls - gradeOdds(level)[grade]), grade).toBeLessThan(
        0.001,
      );
    }
  });
});

describe('the board a crew reads', () => {
  it('deals one fight and two plain jobs, each covering the grade on its card', () => {
    for (const level of [1, 10, 40, 95]) {
      for (let day = 0; day < 40; day += 1) {
        const board = missionOffers('misc', `2026-10-${String(day)}`, level);
        expect(board).toHaveLength(3);
        expect(board.filter((job) => job.template.kind === 'battle')).toHaveLength(1);
        expect(new Set(board.map((job) => job.template.id)).size).toBe(3);
        for (const job of board)
          expect(covers(job.template, job.grade), job.template.id).toBe(true);
      }
    }
  });

  it('is the same board on a second read, and a harder one for a higher crew', () => {
    expect(missionOffers('kettle-row', '2026-10-01', 30)).toEqual(
      missionOffers('kettle-row', '2026-10-01', 30),
    );
    const mean = (level: number) => {
      let total = 0;
      let cards = 0;
      for (let day = 0; day < 200; day += 1) {
        for (const job of missionOffers('misc', `d${String(day)}`, level)) {
          total += GRADES.indexOf(job.grade);
          cards += 1;
        }
      }
      return total / cards;
    };
    expect(mean(40)).toBeGreaterThan(mean(10) + 3);
  });

  /**
   * Every grade has work of both kinds (maintainer, 2026-09-28: "make sure there exist different
   * missions for each letter and symbol combination"), and enough of it that one board does not
   * look like the last.
   */
  it('has at least eight jobs of each kind at every grade', () => {
    expect(MISSION_TEMPLATES.length).toBeGreaterThanOrEqual(300);
    for (const grade of GRADES) {
      for (const kind of ['standard', 'battle'] as const) {
        const count = MISSION_TEMPLATES.filter(
          (template) => template.kind === kind && covers(template, grade),
        ).length;
        expect(count, `${kind} at ${grade}`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('keeps every fight inside one category and every range the right way up', () => {
    for (const template of MISSION_TEMPLATES) {
      const [from, to] = template.grades;
      expect(GRADES.indexOf(from), template.id).toBeLessThanOrEqual(GRADES.indexOf(to));
      if (template.kind === 'battle') {
        expect(fightCategory(from), template.id).toBe(fightCategory(to));
      }
    }
  });
});
