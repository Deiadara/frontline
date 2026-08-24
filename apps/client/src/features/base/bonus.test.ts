import {
  BUILDING_KINDS,
  storageCapacity,
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
  damage: 0,
  garrisons: 0,
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
   * Checked on the Apothecary because storage is the one bonus whose formula is exponential — a
   * hand-rolled linear stand-in would agree with it at the bottom of the curve and diverge by tens
   * of thousands at the top, which is exactly the drift a spot check at level 1 would miss.
   */
  it('quotes the shared formula rather than an approximation of it', () => {
    for (const level of [1, 20]) {
      const expected = storageCapacity(districtWith(DISTRICT, 'apothecary', level));
      expect(structureBonus('apothecary', DISTRICT, level).value).toBe(expected.toLocaleString());
    }
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

  /** A structure that makes nothing yet says so, rather than quoting an empty rate. */
  it('says a producer at level 0 is not producing', () => {
    expect(structureBonus('scrapyard', DISTRICT, 0).value).toBe('nothing yet');
  });
});
