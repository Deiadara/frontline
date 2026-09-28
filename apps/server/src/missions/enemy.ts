import {
  enemyStrength,
  fieldStrength,
  mulberry32,
  seedFrom,
  type Army,
  type Grade,
} from '@frontline/shared';

/**
 * Who is waiting at a battle job (maintainer, 2026-09-10).
 *
 * A battle job no longer rolls against a number: the crew fights a real force with the real
 * engine. That force has to be built from somewhere, and the two properties it needs are the ones
 * every other hidden roll in the game has:
 *
 * - **Deterministic on the row's seed.** Two reads of the same finished run cannot disagree about
 *   what the crew walked into, and a player who closes the tab gets the fight they would have got
 *   watching the timer.
 * - **Worth what the grade says it is worth.** `enemyStrength` is the yardstick the card's band is
 *   read off (`missions.grade.ts`), so a force that came out 40% under it would make the band a
 *   lie. The composition behind the figure is the job's secret; the weight is not.
 *
 * What is *not* here is a difficulty knob. A B+ is a B+ whoever meets it: the crew's level decides
 * which grades it is dealt and nothing about the fight (maintainer, 2026-09-28).
 */

/** One line of a grade's order of battle: who, and what share of its strength they are. */
export interface EnemyDraw {
  unitId: string;
  /** Share of the grade's total strength, before the roll moves it. The lines sum to 1. */
  share: number;
}

/**
 * Who a fight fields, by its grade's letter (2026-09-28).
 *
 * The six rosters the Fight I to V ladder and the Siege used, one per letter from F to A, and a
 * seventh for Mayhem with the heaviest sheet at the front. The letter sets who turns up and the
 * grade sets how many (`GRADE_ENEMY_STRENGTH`), so a C- and a C+ are the same people in different
 * numbers.
 */
export const ENEMY_ROSTERS: Readonly<Record<string, readonly EnemyDraw[]>> = {
  // F is the street: razors and scrapers, people with a pipe and a grudge.
  F: [
    { unitId: 'razors', share: 0.65 },
    { unitId: 'scrapers', share: 0.35 },
  ],
  // E: the street with ash walkers behind it, who do not stop.
  E: [
    { unitId: 'razors', share: 0.45 },
    { unitId: 'scrapers', share: 0.25 },
    { unitId: 'ash_walkers', share: 0.3 },
  ],
  // D puts Combine muscle in the middle: a warden squad holding the line.
  D: [
    { unitId: 'razors', share: 0.35 },
    { unitId: 'scrapers', share: 0.15 },
    { unitId: 'ash_walkers', share: 0.2 },
    { unitId: 'wardens', share: 0.3 },
  ],
  // C: wardens with breakers and a sniper on something high, and no street left.
  C: [
    { unitId: 'wardens', share: 0.35 },
    { unitId: 'ash_walkers', share: 0.2 },
    { unitId: 'breakers', share: 0.25 },
    { unitId: 'snipers', share: 0.2 },
  ],
  // B is what the Combine sends when it means it, and it is mostly armour.
  B: [
    { unitId: 'wardens', share: 0.3 },
    { unitId: 'breakers', share: 0.25 },
    { unitId: 'snipers', share: 0.15 },
    { unitId: 'juggernauts', share: 0.3 },
  ],
  // A: the armour, and more of the heaviest of it.
  A: [
    { unitId: 'wardens', share: 0.2 },
    { unitId: 'breakers', share: 0.25 },
    { unitId: 'snipers', share: 0.15 },
    { unitId: 'juggernauts', share: 0.4 },
  ],
  // S, Mayhem: the heaviest sheet at the front and the rest there to keep it standing.
  S: [
    { unitId: 'wardens', share: 0.15 },
    { unitId: 'breakers', share: 0.2 },
    { unitId: 'snipers', share: 0.15 },
    { unitId: 'juggernauts', share: 0.5 },
  ],
};

/** The roster a grade draws from, off its letter. */
export function rosterFor(grade: Grade): readonly EnemyDraw[] {
  const roster = ENEMY_ROSTERS[grade[0] ?? 'F'];
  if (!roster) throw new Error(`no enemy roster for grade ${grade}`);
  return roster;
}

/**
 * How far the roll moves one line's share, either way.
 *
 * A quarter, so the same grade is not the same fight twice: a skirmish that comes
 * out mostly scrapers is a different problem from one that comes out mostly razors, and neither is
 * a harder or an easier one, because the total is corrected back to the grade's figure afterwards.
 */
export const ENEMY_MIX_VARIANCE = 0.25;

/**
 * How close to the grade's figure the built force lands, as a share of it.
 *
 * Units are lumpy: the cheapest sheet on the skirmish roster is worth 175 on `fieldStrength` and
 * an F- fields 1,600, so a whole unit is a ninth of the job. The fill below adds and drops that
 * cheapest sheet while doing so moves the total *closer* to the figure, which bounds the error at
 * half a unit, and this is that bound written as a fraction of the smallest grade.
 */
export const ENEMY_STRENGTH_TOLERANCE = 0.07;

/** What one of these is worth on the same yardstick the grade figures are quoted in. */
function unitStrength(unitId: string): number {
  return fieldStrength({ [unitId]: 1 });
}

/** The lines the roll produced, as shares that sum to 1 again. */
function rolledShares(roster: readonly EnemyDraw[], next: () => number): number[] {
  const rolled = roster.map((draw) => draw.share * (1 + (next() * 2 - 1) * ENEMY_MIX_VARIANCE));
  const total = rolled.reduce((sum, share) => sum + share, 0);
  return total <= 0 ? roster.map((draw) => draw.share) : rolled.map((share) => share / total);
}

/**
 * The force a battle job fields at its grade, off the mission's own seed.
 *
 * Every line gets at least one body: a roster that rolled a line down to nothing would quietly
 * turn a siege into a fight with more wardens in it, and the composition is the half of this the
 * card deliberately does not print.
 */
export function enemyForce(grade: Grade, seed: string): Army {
  const roster = rosterFor(grade);
  const target = enemyStrength(grade);
  const next = mulberry32(seedFrom(`${seed}:enemy`));
  const shares = rolledShares(roster, next);

  const force: Army = {};
  roster.forEach((draw, index) => {
    const worth = unitStrength(draw.unitId);
    if (worth <= 0) return;
    force[draw.unitId] = Math.max(1, Math.round((target * (shares[index] ?? draw.share)) / worth));
  });

  return fillToStrength(force, roster, target);
}

/**
 * Adds and drops the cheapest sheet on the roster while that brings the total nearer the figure.
 *
 * The cheapest rather than a random one, because it is the finest grain available: correcting with
 * a juggernaut would overshoot by more than the error it was fixing. It never drops a line to
 * zero, for the reason on `enemyForce`.
 */
function fillToStrength(force: Army, roster: readonly EnemyDraw[], target: number): Army {
  const cheapest = roster.reduce((low, draw) =>
    unitStrength(draw.unitId) < unitStrength(low.unitId) ? draw : low,
  );
  const filled: Army = { ...force };
  const miss = (army: Army) => Math.abs(fieldStrength(army) - target);
  const step = (by: number): boolean => {
    const count = filled[cheapest.unitId] ?? 0;
    if (count + by < 1) return false;
    const next = { ...filled, [cheapest.unitId]: count + by };
    if (miss(next) >= miss(filled)) return false;
    filled[cheapest.unitId] = count + by;
    return true;
  };
  while (step(1));
  while (step(-1));
  return filled;
}
