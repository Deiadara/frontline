import { describe, expect, it } from 'vitest';
import { DEFAULT_ATTRIBUTES } from '../attributes.js';
import { noTerritoryEffects, type TerritoryEffects } from '../city/locations.js';
import type { Army } from '../units/index.js';
import type { UnitLoadouts } from '../units/loadout.js';
import { bareBattlefield } from './battlefield.js';
import { simulate, type SideSetup } from './engine.js';
import type { BattleOfficer } from './officer.js';

/**
 * Two properties every bonus in the game has to have, across scales (2026-09-17 consistency pass).
 *
 * `channels.test.ts` asks whether a bonus is *wired*. These two ask whether it is wired **right**,
 * and they are the questions a single fixture cannot answer:
 *
 *  - **Monotone.** More of a thing is never worse. A bonus that turns on you somewhere in its range
 *    is a sign error, a clamp on the wrong side of a subtraction, or a term that flips.
 *  - **Composable.** Two bonuses together are never worse than either alone. This is the overwrite
 *    bug, and it is easy: the first draft of this file spread two `Partial<SideSetup>` objects
 *    together, each carrying a whole `noTerritoryEffects()`, so the second one's zeros wiped the
 *    first one's bonus and every pair silently measured one of them. A harness that reproduces the
 *    defect it hunts is worth a comment.
 *
 * Both are measured as win counts over many seeds rather than as a single fight. A bonus does not
 * make a *particular* fight better; it makes a distribution better. The tolerances below are set
 * against that noise, not against the effect: they are loose enough that a real reversal has to be
 * substantial to be called, which is the right way round for a test that would otherwise flake.
 */

const SEEDS = 120;

function wins(attacker: Army, defender: Army, side: Partial<SideSetup>): number {
  let n = 0;
  for (let i = 0; i < SEEDS; i += 1) {
    const sim = simulate({
      seed: `composition-${i}`,
      battlefield: bareBattlefield(),
      attacker: { name: 'A', army: attacker, defending: false, ...side },
      defender: { name: 'D', army: defender, defending: true },
    });
    if (sim.winner === 'attacker') n += 1;
  }
  return n;
}

const terr = (patch: Partial<TerritoryEffects>): TerritoryEffects => ({
  ...noTerritoryEffects(),
  ...patch,
});

const officer = (rating: number): BattleOfficer => ({
  officerId: 'o1',
  name: 'Lead',
  attributes: Object.fromEntries(
    Object.keys(DEFAULT_ATTRIBUTES).map((key) => [key, rating]),
  ) as BattleOfficer['attributes'],
});

const KIT: UnitLoadouts = { razors: ['taped_grips', 'filed_sights', 'scrap_vest'] };

/**
 * Three scales, and the middle one is not the interesting one.
 *
 * Under the ground's frontage numbers decide a fight; over it they stop counting and the sheets do
 * (`engagedUnits`). A bonus can behave differently on the two sides of that line, and a sweep that
 * only ever measured one scale would not know: cohesion, for instance, is correctly worth nothing
 * at all below the frontage and decisive above it.
 */
const SCALES: [string, Army, Army][] = [
  ['a skirmish', { razors: 6, snipers: 1 }, { wardens: 4, sparks: 2 }],
  ['a raid', { razors: 30, snipers: 7 }, { wardens: 22, sparks: 8 }],
  ['a war', { razors: 169, snipers: 42 }, { wardens: 60, sparks: 20 }],
];

describe('bonuses compose, at every scale', () => {
  /** Loose: a reversal has to be bigger than the spread between two runs of the same fight. */
  const NOISE = 10;

  it('never turns on the side that bought it', () => {
    const broken: string[] = [];
    for (const [label, attacker, defender] of SCALES) {
      for (const channel of [
        'unitOffensePercent',
        'unitVitalityPercent',
        'unitArmorPercent',
        'unitMoraleFlat',
        'unitEvasionFlat',
      ] as const) {
        const series = [0, 15, 30, 50, 80].map((value) => ({
          value,
          got: wins(attacker, defender, { territory: terr({ [channel]: value }) }),
        }));
        for (let i = 1; i < series.length; i += 1) {
          const before = series[i - 1]!;
          const after = series[i]!;
          if (after.got < before.got - NOISE) {
            broken.push(
              `${label} ${channel}: ${before.value} won ${before.got} but ${after.value} won ${after.got}`,
            );
          }
        }
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });

  it('is never worse for having a second bonus as well', () => {
    type Single = { name: string; terr?: Partial<TerritoryEffects>; side?: Partial<SideSetup> };
    const singles: Single[] = [
      { name: 'offense', terr: { unitOffensePercent: 20 } },
      { name: 'vitality', terr: { unitVitalityPercent: 20 } },
      { name: 'armour', terr: { unitArmorPercent: 15 } },
      { name: 'morale', terr: { unitMoraleFlat: 15 } },
      { name: 'an officer', side: { officer: officer(80) } },
      { name: 'fitted kit', side: { upgrades: KIT } },
    ];
    // Patches are composed, never spread as finished sides: see the note at the top of the file.
    const build = (...parts: Single[]): Partial<SideSetup> => {
      let patch: Partial<TerritoryEffects> = {};
      let side: Partial<SideSetup> = {};
      for (const part of parts) {
        patch = { ...patch, ...part.terr };
        side = { ...side, ...part.side };
      }
      return { ...side, ...(Object.keys(patch).length > 0 ? { territory: terr(patch) } : {}) };
    };

    const broken: string[] = [];
    for (const [label, attacker, defender] of SCALES) {
      for (let i = 0; i < singles.length; i += 1) {
        for (let j = i + 1; j < singles.length; j += 1) {
          const one = singles[i]!;
          const two = singles[j]!;
          const alone = [
            wins(attacker, defender, build(one)),
            wins(attacker, defender, build(two)),
          ];
          const together = wins(attacker, defender, build(one, two));
          const floor = Math.max(...alone);
          if (together < floor - NOISE) {
            broken.push(
              `${label}: ${one.name} won ${alone[0]}, ${two.name} won ${alone[1]}, together only ${together}`,
            );
          }
        }
      }
    }
    expect(broken, broken.join('\n')).toEqual([]);
  });
});

/**
 * Adding bodies to an army never collapses it (MOU bugpass, 2026-09-21).
 *
 * The third property, and the one that was broken. A rout charged the rest of the line
 * `ROUT_CASCADE` per *stack* that broke, so a small fragile stack was worth the same panic as
 * half the army running: sixty-two Razors beat a Combine line 45% of the time, and the same
 * sixty-two with three Sparks bolted on won **none of six hundred**. With twenty Sparks it won
 * 86%, so the shape was a pit rather than a slope, and nothing about the units involved was
 * unusual: eleven roster sheets sit under the 60-point `steady` line.
 *
 * Measured as a sweep rather than at a point, because a pit is invisible at either end of it. The
 * bar is deliberately about collapse and not about slope: a weak unit taking frontage from a
 * better one may genuinely cost a fight, and this is not a claim that more bodies always win.
 */
describe('a force is never ruined by the bodies added to it', () => {
  const FRAGILE = { ...bareBattlefield('a cascade'), frontage: 20 };
  const DEFENCE: Army = { greycoat: 22, suppressor: 6 };
  const SWEEP_SEEDS = 240;

  const rate = (army: Army): number => {
    let n = 0;
    for (let i = 0; i < SWEEP_SEEDS; i += 1) {
      const sim = simulate({
        seed: `cascade-${i}`,
        battlefield: FRAGILE,
        attacker: { name: 'A', army, defending: false },
        defender: { name: 'D', army: DEFENCE, defending: true },
      });
      if (sim.winner === 'attacker') n += 1;
    }
    return n / SWEEP_SEEDS;
  };

  it('does not fall off a cliff when a small fragile stack is added', () => {
    const readings = [0, 1, 2, 3, 4, 6, 10, 20].map((sparks) => ({
      sparks,
      rate: rate(sparks === 0 ? { razors: 62 } : { razors: 62, sparks }),
    }));
    const say = readings.map((r) => `+${r.sparks}=${r.rate.toFixed(3)}`).join(' ');

    // The control: the sweep reaches a force that plainly wins, so a flat line of zeroes cannot
    // pass this by being uniformly hopeless.
    expect(readings.at(-1)?.rate, `nothing in this sweep wins: ${say}`).toBeGreaterThan(0.5);

    // No reading may be worse than a tenth of the best one before it. At the defect this went
    // 0.445 -> 0.000, and the pit bottomed out at zero for every base size tried.
    let best = 0;
    for (const reading of readings) {
      expect(
        reading.rate,
        `adding ${reading.sparks} Sparks collapsed a force that was winning: ${say}`,
      ).toBeGreaterThanOrEqual(best * 0.1);
      best = Math.max(best, reading.rate);
    }
  });
});
