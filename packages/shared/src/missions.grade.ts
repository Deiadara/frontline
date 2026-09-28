import { OFFICER_MARKS, markIndex, type OfficerMark } from './crew/marks.js';

/**
 * How hard a job is, on the same twenty-one marks an officer is graded on (maintainer,
 * 2026-09-28).
 *
 * A grade is a fact about the job, the same for everybody who reads the card: the odds a leader
 * faces, the force a fight fields, how long the work takes and what it pays all come off it, and
 * none of them off the reading crew's level. What the level still does is decide which grades a
 * crew is dealt (`gradeOdds`), so a crew that levels up sees harder work turn up and earns more by
 * taking it.
 *
 * The marks are the officers' own on purpose. A plain job's odds compare its grade with its
 * leader's grade for that job (`gradedChance`), so a B+ officer on a B+ job is the even case the
 * whole curve is anchored on, and a player who knows what their people are graded knows what they
 * can take.
 */
export type Grade = OfficerMark;
export const GRADES = OFFICER_MARKS;

/** Where a grade sits on the ladder, 0 for F-. */
export function gradeIndex(grade: Grade): number {
  return markIndex(grade);
}

// --- fights ---

/**
 * What a fight is called, by its grade's letter (maintainer, 2026-09-28).
 *
 * Replaced the Fight I to Fight V ladder and the Siege tier above it. Skirmish is everything in F
 * and E, Battle is D and C, Siege is B and A, and Mayhem is S, which opens at
 * {@link MAYHEM_UNLOCK_LEVEL}.
 */
export const FIGHT_CATEGORIES = ['skirmish', 'battle', 'siege', 'mayhem'] as const;
export type FightCategory = (typeof FIGHT_CATEGORIES)[number];

export const FIGHT_CATEGORY_LABELS: Readonly<Record<FightCategory, string>> = {
  skirmish: 'Skirmish',
  battle: 'Battle',
  siege: 'Siege',
  mayhem: 'Mayhem',
};

export function fightCategory(grade: Grade): FightCategory {
  const letter = grade[0];
  if (letter === 'F' || letter === 'E') return 'skirmish';
  if (letter === 'D' || letter === 'C') return 'battle';
  if (letter === 'B' || letter === 'A') return 'siege';
  return 'mayhem';
}

/** The level the S grades open at, fights and plain work alike. Nothing below it is dealt one. */
export const MAYHEM_UNLOCK_LEVEL = 90;

/**
 * The force a fight of each grade fields, on `fieldStrength`'s yardstick.
 *
 * Read off the ladder this replaced so the fights a crew meets did not jump when it went: each
 * figure is what the old tier deal fielded on average at the level where this grade is most often
 * dealt ({@link GRADE_PAY_LEVEL}), tier odds and the old per-level growth included. The S grades
 * are a quarter above the old top end, which is what makes Mayhem its own thing rather than a
 * fourth A.
 */
export const GRADE_ENEMY_STRENGTH: Readonly<Record<Grade, number>> = {
  'F-': 1_600,
  F: 1_750,
  'F+': 2_050,
  'E-': 2_400,
  E: 3_000,
  'E+': 3_650,
  'D-': 4_550,
  D: 5_500,
  'D+': 6_900,
  'C-': 8_250,
  C: 10_000,
  'C+': 12_000,
  'B-': 14_700,
  B: 17_500,
  'B+': 20_300,
  'A-': 23_100,
  A: 25_100,
  'A+': 27_100,
  'S-': 37_700,
  S: 42_500,
  'S+': 47_200,
};

export function enemyStrength(grade: Grade): number {
  return GRADE_ENEMY_STRENGTH[grade];
}

// --- who is dealt what ---

/**
 * The level each grade's pay is anchored at, and the ladder the deal climbs at `GRADE_DEAL_PACE`.
 *
 * A grade pays what the old crew-level premium paid at this level (`gradePay`), and the deal is
 * centred on this ladder read at a fraction of the crew's level (`dealCentre`), so a grade is
 * dealt most at {@link gradePeakLevel}. Closer together at the bottom because a crew moves through
 * its first levels in hours and its last ones in weeks.
 */
export const GRADE_PAY_LEVEL: Readonly<Record<Grade, number>> = {
  'F-': 1,
  F: 2,
  'F+': 4,
  'E-': 6,
  E: 9,
  'E+': 12,
  'D-': 16,
  D: 20,
  'D+': 25,
  'C-': 30,
  C: 36,
  'C+': 42,
  'B-': 49,
  B: 56,
  'B+': 63,
  'A-': 70,
  A: 78,
  'A+': 86,
  'S-': 95,
  S: 110,
  'S+': 125,
};

/**
 * How widely the deal spreads either side of a crew's own grade, in marks.
 *
 * About two thirds of cards land within one mark of the centre, so a board always has something
 * easy and something to stretch for.
 */
export const GRADE_DEAL_SPREAD = 1.4;

/**
 * And the furthest it ever reaches. The bell's tail is cut here: without it a level-one crew was
 * dealt a D- a few times a year, a card it has no leader for and no way to read.
 */
export const GRADE_DEAL_REACH = 3;

/**
 * How fast the deal climbs the ladder: a crew at level L is dealt round the grade whose pay level
 * is L times this.
 *
 * Three quarters (maintainer, 2026-09-28: the late game about two and a half months in, and the
 * late cards dealt in it). It was a half after the first simulation showed officers falling two
 * or three marks behind the full pace; that was before the Bar seated officers pitched at the
 * city's level and before a crew traded its weakest officer up. With both, the progression
 * simulation (`apps/server/scripts/progression-sim.ts`) holds the best leader within about a mark
 * of the average card at this pace, and a crew at level ninety is dealt round A- and A.
 */
export const GRADE_DEAL_PACE = 0.75;

/** The level a grade is dealt most often at: its pay level, reached at the deal's pace. */
export function gradePeakLevel(grade: Grade): number {
  return Math.max(1, Math.round(GRADE_PAY_LEVEL[grade] / GRADE_DEAL_PACE));
}

/** The mark a crew at this level is centred on, fractional between two pay levels. */
export function dealCentre(level: number): number {
  const at = Math.max(1, level * GRADE_DEAL_PACE);
  for (let index = 1; index < GRADES.length; index += 1) {
    const high = GRADE_PAY_LEVEL[GRADES[index]!];
    if (at <= high) {
      const low = GRADE_PAY_LEVEL[GRADES[index - 1]!];
      return index - 1 + (at - low) / (high - low);
    }
  }
  return GRADES.length - 1;
}

/**
 * The chance of each grade on a card at this level, summing to one.
 *
 * A bell round {@link dealCentre}, cut at {@link GRADE_DEAL_REACH}. The S grades are cut until
 * {@link MAYHEM_UNLOCK_LEVEL}, and from it they take at least {@link MAYHEM_SHARE} of the deal
 * whatever the bell says: Mayhem is a flat unlock at ninety (maintainer), and at the deal's pace
 * the bell alone would not reach an S grade until well past it.
 */
export function gradeOdds(level: number): Readonly<Record<Grade, number>> {
  const cached = ODDS_BY_LEVEL.get(level);
  if (cached) return cached;
  const odds = computeGradeOdds(level);
  ODDS_BY_LEVEL.set(level, odds);
  return odds;
}

/** Pure in the level, and read three times per board: worked out once per level asked. */
const ODDS_BY_LEVEL = new Map<number, Readonly<Record<Grade, number>>>();

/** The least share of the deal the S grades take once Mayhem opens, split S- heaviest. */
export const MAYHEM_SHARE = 0.05;
const MAYHEM_SPLIT: Readonly<Record<string, number>> = { 'S-': 0.6, S: 0.3, 'S+': 0.1 };

function computeGradeOdds(level: number): Readonly<Record<Grade, number>> {
  const centre = dealCentre(level);
  const open = level >= MAYHEM_UNLOCK_LEVEL;
  const weights = GRADES.map((grade, index) => {
    if (grade[0] === 'S' && !open) return 0;
    if (Math.abs(index - centre) > GRADE_DEAL_REACH) return 0;
    const distance = (index - centre) / GRADE_DEAL_SPREAD;
    return Math.exp(-0.5 * distance * distance);
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const odds = {} as Record<Grade, number>;
  GRADES.forEach((grade, index) => {
    odds[grade] = weights[index]! / total;
  });
  const onS = GRADES.filter((grade) => grade[0] === 'S').reduce(
    (sum, grade) => sum + odds[grade],
    0,
  );
  if (open && onS < MAYHEM_SHARE) {
    // The rest of the deal gives up the difference in proportion, and the S grades take the floor.
    const keep = (1 - MAYHEM_SHARE) / (1 - onS);
    for (const grade of GRADES) {
      odds[grade] =
        grade[0] === 'S' ? MAYHEM_SHARE * (MAYHEM_SPLIT[grade] ?? 0) : odds[grade] * keep;
    }
  }
  return odds;
}

/**
 * The grade one card is dealt, off a roll in [0, 1).
 *
 * `allowed` is the grades the slot's pool has a job for; the odds are renormalised over them so a
 * slot never lands on a grade with nothing to deal. Falls back to the nearest allowed grade to the
 * centre when the bell puts no weight on any of them.
 */
export function dealGrade(roll: number, level: number, allowed: readonly Grade[]): Grade {
  const odds = gradeOdds(level);
  const open = GRADES.filter((grade) => allowed.includes(grade));
  const total = open.reduce((sum, grade) => sum + odds[grade], 0);
  if (open.length === 0) throw new Error('dealGrade: no grade to deal');
  if (total <= 0) {
    const centre = dealCentre(level);
    return open.reduce((best, grade) =>
      Math.abs(gradeIndex(grade) - centre) < Math.abs(gradeIndex(best) - centre) ? grade : best,
    );
  }
  let cumulative = 0;
  for (const grade of open) {
    cumulative += odds[grade] / total;
    if (roll < cumulative) return grade;
  }
  return open[open.length - 1]!;
}

// --- what it pays and how long it takes ---

/**
 * What a grade does to a job's pay and its XP, as a multiplier.
 *
 * The crew-level premium this replaced paid ten percent more per level. A grade pays what that
 * premium paid at its pay level ({@link GRADE_PAY_LEVEL}), so a card's pay is a fact about the card.
 * The deal runs at three-quarter pace ({@link GRADE_DEAL_PACE}), so a crew meets each grade at a
 * third past its pay level and earns more slowly than the old premium paid at the same level: the
 * price of odds it can win.
 */
export function gradePay(grade: Grade): number {
  return 1 + 0.1 * (GRADE_PAY_LEVEL[grade] - 1);
}

/**
 * A fight's premium on top, over plain work of the same grade.
 *
 * The old tier ladder paid 1 to 3.2 over Fight I to Fight V and 4.2 for a Siege; this is that
 * ladder read at each grade's pay level, and Mayhem takes the Siege's 4.2.
 */
const FIGHT_LADDER_ANCHORS: readonly { level: number; lift: number }[] = [
  { level: 1, lift: 1 },
  { level: 10, lift: 1.35 },
  { level: 25, lift: 1.8 },
  { level: 40, lift: 2.4 },
  { level: 70, lift: 3.2 },
];
export const MAYHEM_FIGHT_LIFT = 4.2;

export function fightLift(grade: Grade): number {
  if (fightCategory(grade) === 'mayhem') return MAYHEM_FIGHT_LIFT;
  const level = GRADE_PAY_LEVEL[grade];
  const anchors = FIGHT_LADDER_ANCHORS;
  const last = anchors[anchors.length - 1]!;
  if (level >= last.level) return last.lift;
  const next = anchors.find((anchor) => anchor.level >= level)!;
  const prev = [...anchors].reverse().find((anchor) => anchor.level <= level)!;
  const t = next.level === prev.level ? 0 : (level - prev.level) / (next.level - prev.level);
  return prev.lift + (next.lift - prev.lift) * t;
}

/** How much longer each mark above a job's lowest grade keeps a crew on site. */
export const GRADE_DURATION_STEP = 0.08;

/** A job's time on site at this grade: its authored time at its lowest grade, and more per mark. */
export function gradedDurationMinutes(
  template: { durationMinutes: number; grades: readonly [Grade, Grade] },
  grade: Grade,
  ceiling: number,
): number {
  const steps = Math.max(0, gradeIndex(grade) - gradeIndex(template.grades[0]));
  return Math.min(
    ceiling,
    Math.round(template.durationMinutes * (1 + GRADE_DURATION_STEP * steps)),
  );
}

// --- the odds a leader faces ---

/**
 * The chance a plain job lands, off how the leader grades for it against the job's own grade
 * (maintainer, 2026-09-28).
 *
 * The maintainer's anchors: an equal grade is 75%, three marks short is about 30%, three marks
 * over is 95%, and five or more over is certain. A logistic through the first three hits all
 * three within a point, and falls towards nothing below: an F leader on a B+ job is a tenth of a
 * percent, which the card reads as nil. It never reaches zero, because a long shot is still a
 * shot.
 *
 * `margin` is the leader's grade index minus the job's, fractional, since a leader's grade for a
 * job is a weighted score rather than a whole mark.
 */
export const GRADED_CHANCE_CENTRE = -1.694;
export const GRADED_CHANCE_SPREAD = 1.542;
/**
 * Under this chance a plain job landed is a long shot, for the feat that counts them
 * (`jobs_won_long_odds`). One in three is three marks short of an even grade.
 */
export const LONG_ODDS_CHANCE = 1 / 3;

/** From this many marks over the job, the run cannot fail. */
export const GRADED_CERTAIN_MARGIN = 5;

export function gradedChance(margin: number): number {
  if (margin >= GRADED_CERTAIN_MARGIN) return 1;
  return 1 / (1 + Math.exp(-(margin - GRADED_CHANCE_CENTRE) / GRADED_CHANCE_SPREAD));
}
