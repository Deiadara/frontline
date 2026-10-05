import {
  BUILDING_KINDS,
  MUSTER_SPEED_KNEE,
  musterTimeReduction,
  PRODUCING_BUILDINGS,
  buildingProduction,
  storageCapacity,
  storageCapacityFor,
  musterSuppliesReduction,
  type Building,
  type BuildingKind,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { districtWith, structureBonus } from './bonus';

/**
 * The line the plot dialog quotes for "what does this level actually buy".
 *
 * The thing worth measuring is not the wording. It is that the line **moves with the level** and
 * that it moves because a shared function said so: a bonus row that quotes a constant looks exactly
 * like one that quotes a formula, right up until a player upgrades something and the dialog says
 * the same thing it said before.
 */

const at = (kind: BuildingKind, level: number): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications: [],
});

/** A district with a bit of everything, so the cross-structure bonuses have something to read. */
const DISTRICT: Building[] = [at('nexus', 8), at('generator', 4), at('greenhouse', 3)];

describe('what a structure is worth', () => {
  it('answers for every structure in the catalogue', () => {
    for (const kind of BUILDING_KINDS) {
      const bonus = structureBonus(kind, DISTRICT, 3);
      expect(bonus.label, kind).not.toHaveLength(0);
      expect(bonus.value, kind).not.toHaveLength(0);
    }
  });

  /**
   * The assertion this file exists for.
   *
   * Every kind has to say something *different* at level 1 and level 10, because a dialog whose
   * "what you get" line is the same either side of an upgrade is telling the player the upgrade is
   * worthless. This is the check that a `LINES` entry actually reads its level rather than quoting
   * a catalogue constant.
   */
  it('says something different at a higher level, for every structure', () => {
    for (const kind of BUILDING_KINDS) {
      const low = structureBonus(kind, DISTRICT, 1);
      const high = structureBonus(kind, DISTRICT, 10);
      expect(high.value, `${kind} is worth the same at level 1 and level 10`).not.toBe(low.value);
    }
  });

  /**
   * The figure is the shared function's, not a copy of it.
   *
   * Checked on the Apothecary because storage is the one bonus whose formula is exponential: a
   * hand-rolled linear stand-in would agree with it at the bottom of the curve and diverge by tens
   * of thousands at the top, which is exactly the drift a spot check at level 1 would miss.
   */
  it('quotes the shared formula rather than an approximation of it', () => {
    for (const level of [1, 20]) {
      const projected = districtWith(DISTRICT, 'apothecary', level);
      const bulk = storageCapacity(projected);
      expect(structureBonus('apothecary', DISTRICT, level).value).toBe(
        [
          bulk,
          storageCapacityFor(projected, 'oil', bulk),
          storageCapacityFor(projected, 'highQualityMetal', bulk),
        ]
          .map((figure) => figure.toLocaleString())
          .join(' \u00b7 '),
      );
    }
  });

  /**
   * The shelf is not flat, and the line has to say so.
   *
   * One number under a label reading "of each material" was wrong for four of the five capped
   * resources: `STORAGE_SHARES` gives oil and supplies two thirds of the bulk and HQ metal a third,
   * so an Apothecary 5 that quoted 2,162 was overstating the metal ceiling (721) threefold. Pinned
   * to the *smallest* shelf rather than the bulk, because that is the one a player loses goods to.
   */
  /**
   * The two muster lines quote what the bench does with them (bug pass, 2026-10-01).
   *
   * The Gauntlet's figure is a speed: `musterSecondsFor` divides the clock by `1 + speed`, so a
   * maxed Gauntlet's 40 takes 29% off, and the line printed 40. The Greenhouse and its cards taper
   * toward 70% off the supplies line (`suppliesLineCut`, 2026-10-01), and the line prints the
   * curve rather than the raw sum.
   */
  it('quotes the muster clock and the supplies cut as the bench charges them', () => {
    expect(structureBonus('gauntlet', DISTRICT, 20).value).toBe('29%');

    const fed: Building[] = [
      ...DISTRICT.filter((building) => building.kind !== 'greenhouse'),
      {
        id: 'b-greenhouse',
        kind: 'greenhouse',
        level: 20,
        modifications: ['greenhouse_sealed_growrooms', 'greenhouse_grey_water_loop'],
      },
    ];
    // 10 from the Greenhouse (half a point a level), 7 and 3 from the cards: 20 raw, 17.4 on the
    // curve. Before the nerf the same district was 51 raw.
    expect(musterSuppliesReduction(fed)).toBe(20);
    expect(structureBonus('greenhouse', fed, 20).value.split(' · ').at(-1)).toBe('-17%');
  });

  it('tapers the Gauntlet line past the knee rather than stopping it', () => {
    // A Gauntlet at 20 with a card in four structures: 40 + 14 + 8 + 8 + 7 = 77 speed. The curve
    // makes it 69.6, which is 41% off the clock; the raw sum would print 43% and the old stop 38%.
    const drilled: Building[] = [
      ...DISTRICT,
      {
        id: 'b-gauntlet',
        kind: 'gauntlet',
        level: 20,
        modifications: ['gauntlet_salvaged_simulators'],
      },
      { id: 'b-quarters', kind: 'quarters', level: 10, modifications: ['quarters_turnout_drills'] },
      {
        id: 'b-apothecary',
        kind: 'apothecary',
        level: 10,
        modifications: ['apothecary_stimulant_line'],
      },
      { id: 'b-lab', kind: 'lab', level: 10, modifications: ['lab_written_drill'] },
    ];
    expect(musterTimeReduction(drilled)).toBe(77);
    expect(musterTimeReduction(drilled)).toBeGreaterThan(MUSTER_SPEED_KNEE);
    expect(structureBonus('gauntlet', drilled, 20).value).toBe('41%');
  });

  it('quotes the metal shelf, not the bulk one, as the low figure', () => {
    const projected = districtWith(DISTRICT, 'apothecary', 5);
    const metal = storageCapacityFor(projected, 'highQualityMetal');
    expect(metal).toBeLessThan(storageCapacity(projected));
    const { label, value } = structureBonus('apothecary', DISTRICT, 5);
    expect(value.split(' \u00b7 ').at(-1)).toBe(metal.toLocaleString());
    expect(label).not.toContain('each material');
  });

  describe('the district it is measured against', () => {
    it('raises the structure that is already standing rather than adding a second one', () => {
      const projected = districtWith(DISTRICT, 'greenhouse', 9);
      expect(projected.filter((building) => building.kind === 'greenhouse')).toHaveLength(1);
      expect(projected.find((building) => building.kind === 'greenhouse')?.level).toBe(9);
    });

    it('stands up a structure the district does not have yet', () => {
      const projected = districtWith(DISTRICT, 'scrapyard', 1);
      expect(projected.find((building) => building.kind === 'scrapyard')?.level).toBe(1);
      // ...and leaves everything else exactly as it was, so the figure is this district's.
      expect(projected).toHaveLength(DISTRICT.length + 1);
    });

    it('leaves the district alone for a level-0 preview of something unbuilt', () => {
      expect(districtWith(DISTRICT, 'scrapyard', 0)).toEqual(DISTRICT);
    });
  });

  /**
   * The crew's line speed and a raid's cut, which the settle pays and the Production panel prints.
   * The window read the structure and its cards alone, so Engineering's +20% showed on the panel
   * and not on the Greenhouse, and a raid never showed there at all.
   */
  it('quotes a producer at the rate the settle pays it, crew and raid included', () => {
    const bare = structureBonus('greenhouse', DISTRICT, 10).value;
    const crewed = structureBonus('greenhouse', DISTRICT, 10, 0, {
      productionPercent: 20,
      storageCapacityPercent: 0,
    }).value;
    const raided = structureBonus('greenhouse', DISTRICT, 10, 0, {
      productionPercent: 0,
      storageCapacityPercent: 0,
      raidCutPercent: 50,
    }).value;
    const supplies = (value: string) =>
      Number(/([\d.,]+) supplies/.exec(value)?.[1]?.replace(',', ''));
    expect(supplies(crewed)).toBeCloseTo(supplies(bare) * 1.2, 0);
    expect(supplies(raided)).toBeCloseTo(supplies(bare) * 0.5, 0);
  });

  /** A structure that makes nothing yet says so, rather than quoting an empty rate. */
  it('says a producer at level 0 is not producing', () => {
    expect(structureBonus('scrapyard', DISTRICT, 0).value).toBe('nothing yet');
  });

  /**
   * Every producing structure quotes what it makes, the Generator included.
   *
   * It is the only source of oil in the game since the production split, and its line quoted the
   * build-clock discount alone: a player pressing the one plot that refines fuel was told about
   * somebody else's build queue and never about the fuel. Asserted over `PRODUCING_BUILDINGS`
   * rather than on the Generator by name, so the next structure to start making something cannot
   * ship with a line that does not mention it.
   */
  it('quotes its own output on every structure that produces something', () => {
    expect(PRODUCING_BUILDINGS.length, 'nothing produces anything').toBeGreaterThan(0);
    for (const kind of PRODUCING_BUILDINGS) {
      const level = 6;
      const made = buildingProduction(kind, districtWith(DISTRICT, kind, level));
      const keys = Object.keys(made) as (keyof typeof made)[];
      expect(keys.length, `${kind} is in PRODUCING_BUILDINGS and makes nothing`).toBeGreaterThan(0);

      const { value } = structureBonus(kind, DISTRICT, level);
      for (const key of keys) {
        const rate = made[key] ?? 0;
        const shown = Math.abs(rate) < 10 ? rate.toFixed(1) : String(Math.round(rate));
        expect(value, `${kind} never says what it makes of ${key}`).toContain(shown);
      }
    }
  });
});

/**
 * The Nexus's payroll (maintainer, 2026-10-01): every level adds 25 caps to the payroll book
 * (`PAYROLL_PER_NEXUS_LEVEL`) and the line said only how far it authorises the rest. Written out
 * rather than read back from the constant, so a retune shows up here as a decision.
 */
describe("the Nexus's line", () => {
  it('quotes the payroll its levels add, in plain caps and with no week in it', () => {
    expect(structureBonus('nexus', DISTRICT, 1).value).toBe('Nexus 1 · +25 caps payroll');
    expect(structureBonus('nexus', DISTRICT, 8).value).toBe('Nexus 8 · +200 caps payroll');
    expect(structureBonus('nexus', DISTRICT, 20).value).toBe('Nexus 20 · +500 caps payroll');
    expect(structureBonus('nexus', DISTRICT, 8).value).not.toMatch(/week/i);
    expect(structureBonus('nexus', DISTRICT, 8).label).toBe(
      'Authorises every other structure up to',
    );
  });
});
