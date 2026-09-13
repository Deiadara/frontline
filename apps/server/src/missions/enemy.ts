import {
  enemyStrength,
  fieldStrength,
  mulberry32,
  seedFrom,
  type Army,
  type BattleTier,
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
 * - **Worth what the tier says it is worth.** `enemyStrength` is the yardstick the card's band is
 *   read off (`missions.leading.ts`), so a force that came out 40% under it would make the band a
 *   lie. The composition behind the figure is the job's secret; the weight is not.
 *
 * What is *not* here is a difficulty knob. A siege is a siege at level 1 and at level 40; what
 * changes with the crew's level is the figure `enemyStrength` returns, which is the same curve the
 * odds already scale on.
 */

/** One line of a tier's order of battle: who, and what share of the tier's strength they are. */
export interface EnemyDraw {
  unitId: string;
  /** Share of the tier's total strength, before the roll moves it. The lines sum to 1. */
  share: number;
}

/**
 * What each tier fields.
 *
 * A skirmish is the street: razors and scrapers, people with a pipe and a grudge. A fight puts
 * Combine muscle behind them, ash walkers who do not stop and a warden squad holding the middle.
 * A siege is what the Combine sends when it means it, and it is mostly armour: wardens, breakers,
 * a sniper on something high, and juggernauts.
 */
export const ENEMY_TIER_ROSTERS: Readonly<Record<BattleTier, readonly EnemyDraw[]>> = {
  skirmish: [
    { unitId: 'razors', share: 0.65 },
    { unitId: 'scrapers', share: 0.35 },
  ],
  fight: [
    { unitId: 'razors', share: 0.35 },
    { unitId: 'scrapers', share: 0.15 },
    { unitId: 'ash_walkers', share: 0.2 },
    { unitId: 'wardens', share: 0.3 },
  ],
  siege: [
    { unitId: 'wardens', share: 0.3 },
    { unitId: 'breakers', share: 0.25 },
    { unitId: 'snipers', share: 0.15 },
    { unitId: 'juggernauts', share: 0.3 },
  ],
};

/**
 * How far the roll moves one line's share, either way.
 *
 * A quarter, so the same tier at the same level is not the same fight twice: a skirmish that comes
 * out mostly scrapers is a different problem from one that comes out mostly razors, and neither is
 * a harder or an easier one, because the total is corrected back to the tier's figure afterwards.
 */
export const ENEMY_MIX_VARIANCE = 0.25;

/**
 * How close to the tier's figure the built force lands, as a share of it.
 *
 * Bodies are lumpy: the cheapest sheet on the skirmish roster is worth 175 on `fieldStrength` and
 * a skirmish fields 1,400, so a whole body is an eighth of the job. The fill below adds and drops
 * that cheapest sheet while doing so moves the total *closer* to the figure, which bounds the
 * error at half a body, and this is that bound written as a fraction of the smallest tier.
 */
export const ENEMY_STRENGTH_TOLERANCE = 0.07;

/** What one of these is worth on the same yardstick the tier figures are quoted in. */
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
 * The force a battle job fields, at a crew's level, off the mission's own seed.
 *
 * Every line gets at least one body: a roster that rolled a line down to nothing would quietly
 * turn a siege into a fight with more wardens in it, and the composition is the half of this the
 * card deliberately does not print.
 */
export function enemyForce(tier: BattleTier, level: number, seed: string): Army {
  const roster = ENEMY_TIER_ROSTERS[tier];
  const target = enemyStrength(tier, level);
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
