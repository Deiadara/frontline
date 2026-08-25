import { describe, expect, it } from 'vitest';
import {
  CITY_LOCATIONS,
  LOCATION_CATALOG,
  noTerritoryEffects,
  territoryEffectsFor,
} from '../city/index.js';
import { UNIT_CATALOG, findUnit } from '../units/index.js';
import { startingAssignees } from '../assignees/index.js';
import { HOUSING_BASE, populationCapacity } from './production.js';
import {
  POPULATION_PER_LOCATION,
  districtPopulationCapacity,
  populationCostOf,
  populationDraw,
} from './population.js';
import type { Building } from './state.js';

const build = (kind: Building['kind'], level: number): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications: [],
  damage: 0,
  garrisons: 0,
});

const noGround = noTerritoryEffects();

describe('what a district can house (§A1)', () => {
  it('houses somebody with nothing built at all', () => {
    expect(districtPopulationCapacity([], noGround)).toBe(HOUSING_BASE);
    expect(HOUSING_BASE).toBeGreaterThan(0);
  });

  it('rises with the Quarters, every level of them', () => {
    let last = districtPopulationCapacity([], noGround);
    for (const level of [1, 5, 10, 20]) {
      const next = districtPopulationCapacity([build('quarters', level)], noGround);
      expect(next, `quarters ${level}`).toBeGreaterThan(last);
      last = next;
    }
  });

  it('adds whatever the ground is worth, on top of the buildings', () => {
    const built = [build('quarters', 6)];
    expect(districtPopulationCapacity(built, { populationBonus: 60 })).toBe(
      populationCapacity(built) + 60,
    );
  });

  /** A negative fold would be a way to *lose* beds by holding ground. Floored, not trusted. */
  it('never lets a negative ground figure take beds away', () => {
    expect(districtPopulationCapacity([], { populationBonus: -500 })).toBe(HOUSING_BASE);
  });

  /**
   * §B5: the board's rule, through the real fold: taking a location is worth twenty people, and
   * a few locations are worth a good deal more on top.
   */
  it('pays twenty for any location held, and more for the ones people live on', () => {
    const camp = CITY_LOCATIONS.find((location) => location.kind === 'refugee_camp')!;
    const plain = CITY_LOCATIONS.find(
      (location) =>
        !LOCATION_CATALOG[location.kind].bonuses.some((bonus) => bonus.kind === 'population'),
    )!;
    const held = (locationId: string) =>
      territoryEffectsFor(
        'mine',
        CITY_LOCATIONS,
        new Map([
          [
            locationId,
            {
              locationId,
              holder: { kind: 'faction' as const, baseId: 'mine' },
              level: 1,
              upgradingUntil: null,
              fortification: 0,
              fortifyingUntil: null,
              garrison: {},
            },
          ],
        ]),
      ).populationBonus;

    expect(held(plain.id)).toBe(POPULATION_PER_LOCATION);
    expect(held(camp.id)).toBeGreaterThan(POPULATION_PER_LOCATION);
  });
});

describe('who is drawing on it', () => {
  const crew = {
    commanders: [{ id: 'o1' }, { id: 'o2' }],
    assignees: startingAssignees(),
    army: { razors: 6, juggernauts: 2 },
    trainingQueue: [],
  };

  it('counts officers, the army and the bench in one figure', () => {
    const draw = populationDraw(crew);
    expect(draw.officers).toBe(2);
    expect(draw.army).toBe(6 * populationCostOf('razors') + 2 * populationCostOf('juggernauts'));
    expect(draw.total).toBe(draw.officers + draw.assignees + draw.army + draw.training);
  });

  /** Ground is not a hiding place: a garrison three districts away is still somebody you feed. */
  it('counts a garrison standing out in the city', () => {
    const home = populationDraw(crew);
    const away = populationDraw({ ...crew, garrison: { razors: 4 } });
    expect(away.army - home.army).toBe(4 * populationCostOf('razors'));
  });

  it('is worth nothing for a unit id nothing answers to', () => {
    expect(populationCostOf('a_unit_that_was_retired')).toBe(0);
  });
});

/**
 * The board's design rule for the merged pool, as an assertion rather than an intention.
 *
 * "If something is five times as strong as another unit, it might take up four times the
 * population, giving it an advantage." So the heavy end of the roster has to be *efficient* per
 * bed, or a maxed district is an ocean of Razors and nothing else. Strength is taken as the crude
 * product a fight actually turns on: how hard it hits and how long it stands.
 */
describe('what a body costs against the pool (§A1)', () => {
  const strength = (id: string): number => {
    const unit = findUnit(id)!;
    return unit.stats.offense * unit.stats.vitality;
  };
  const perBed = (id: string): number => strength(id) / populationCostOf(id);

  it('pays a heavy unit more strength per bed than the cheapest thing on the street', () => {
    expect(perBed('juggernauts')).toBeGreaterThan(perBed('razors'));
    expect(perBed('the_colossus')).toBeGreaterThan(perBed('razors'));
  });

  it('holds across the roster: nothing in the catalogue is free, and the trend is upward', () => {
    for (const unit of UNIT_CATALOG) {
      expect(populationCostOf(unit.id), unit.id).toBeGreaterThan(0);
    }
    const rabble = UNIT_CATALOG.filter((unit) => unit.tier === 'rabble');
    const legends = UNIT_CATALOG.filter((unit) => unit.tier === 'legendary');
    const mean = (units: typeof UNIT_CATALOG) =>
      units.reduce((total, unit) => total + perBed(unit.id), 0) / units.length;
    expect(mean(legends)).toBeGreaterThan(mean(rabble));
  });
});
