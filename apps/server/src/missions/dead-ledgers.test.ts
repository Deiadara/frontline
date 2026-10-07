import { infamyForKills, noCrewEffects, type Army } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { fightMissionBattle, missionInfamySurcharge } from './battle.js';

/**
 * Reliquary's two ledgers of the enemy's dead reach a battle job (maintainer, 2026-10-06: "all
 * units that were intimidated").
 *
 * The declared-fight settle paid the Fight Pit's surcharge on the enemy's intimidated dead and
 * SPECTACLE's on the Dancer's kills, and a battle job, which is a fight on the same engine, paid
 * neither. The first block pins that the job files the two ledgers at all; the second, what the
 * surcharge is worth at the job's half rate. What the settle does with them is
 * `dead-ledgers-settle.test.ts`, which holds the fight still.
 */

const n = (army: Army): number => Object.values(army).reduce((sum, count) => sum + count, 0);
const SEEDS = Array.from({ length: 30 }, (_, index) => index + 1);

describe('the ledgers a battle job files', () => {
  /*
   * Twenty Juggernauts against an F-, the middle of the band: swept over thirty seeds, ten,
   * twenty and thirty of them file intimidated dead on every seed at F- and twenty and thirty do
   * at E; ten at E file none, and from D up only thirty do. Forty Razors are the control, a force
   * with nothing to intimidate anybody with.
   */
  it('files the enemy dead that fell too intimidated to fire, inside the kills', () => {
    for (const seed of SEEDS) {
      const fought = fightMissionBattle({
        seed,
        jobName: 'The pit',
        force: { juggernauts: 20 },
        vehicles: {},
        grade: 'F-',
        anyRide: false,
        territory: noCrewEffects(),
      });
      expect(n(fought.intimidatedKills), `seed ${seed}`).toBeGreaterThan(0);
      for (const [unitId, count] of Object.entries(fought.intimidatedKills)) {
        expect(count, `${unitId} on seed ${seed}`).toBeLessThanOrEqual(fought.killed[unitId] ?? 0);
      }
      const calm = fightMissionBattle({
        seed,
        jobName: 'The pit',
        force: { razors: 40 },
        vehicles: {},
        grade: 'F-',
        anyRide: false,
        territory: noCrewEffects(),
      });
      expect(calm.intimidatedKills, `seed ${seed}`).toEqual({});
    }
  });

  /*
   * The Dancer and ten Razors against an E, at the Stage's level 3 and level 2: thirty of thirty
   * seeds file her kills at 3 and none do at 2. The band is narrow (twenty Razors at D file on 29
   * seeds, forty at any grade on fewer than half), because she has to be the one making the kills.
   */
  it('credits SPECTACLE her kills at level 3 of the Stage, and not at 2', () => {
    const show = (seed: number, level: number) =>
      fightMissionBattle({
        seed,
        jobName: 'The show',
        force: { the_crimson_dancer: 1, razors: 10 },
        vehicles: {},
        grade: 'E',
        anyRide: false,
        territory: { ...noCrewEffects(), doorLevels: { the_crimson_dancer: level } },
      });
    for (const seed of SEEDS) {
      expect(n(show(seed, 3).spectacleKills), `seed ${seed}`).toBeGreaterThan(0);
      expect(show(seed, 2).spectacleKills, `seed ${seed}`).toEqual({});
    }
  });
});

describe('what the surcharge pays', () => {
  const ledgers = (intimidated: Army, spectacle: Army) => ({
    intimidatedKills: intimidated,
    spectacleKills: spectacle,
  });
  const half = (points: number) => Math.ceil(points / 2);

  it('pays nothing on empty ledgers, and nothing for the intimidated without a Pit', () => {
    expect(missionInfamySurcharge(ledgers({}, {}), 100)).toBe(0);
    expect(missionInfamySurcharge(ledgers({ razors: 6 }, {}), 0)).toBe(0);
  });

  it('pays the intimidated by the Pit percent and the Dancer whole, at the job half rate', () => {
    const six = infamyForKills({ razors: 6 });
    expect(missionInfamySurcharge(ledgers({ razors: 6 }, {}), 100)).toBe(half(six));
    expect(missionInfamySurcharge(ledgers({ razors: 6 }, {}), 50)).toBe(half(six / 2));
    expect(missionInfamySurcharge(ledgers({}, { razors: 6 }), 0)).toBe(half(six));
  });

  it('rounds up once on the whole surcharge, like the figure it sits on', () => {
    // One Razor is worth one point; a half each, rounded apart, would pay two for one.
    const one = infamyForKills({ razors: 1 });
    expect(one).toBe(1);
    expect(missionInfamySurcharge(ledgers({ razors: 1 }, { razors: 1 }), 100)).toBe(1);
  });
});
