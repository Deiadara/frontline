/**
 * Every district tag stands where it was placed, in the part of the city that is on screen.
 *
 * The city shares the district screen's rule now (maintainer request, 2026-09-15): always the
 * band's full width, height from the plate's own 21:10, and the overhang cropped by the standing
 * bar and the nav. It was drawn `whole` before, which left blurred surround down both sides at
 * every viewport in the matrix, and the maintainer read that as grey bars.
 *
 * What the change costs is a new failure mode, and this is the guard for it. `OnPlate` clamps a
 * mark into the visible window, so a tag can never go *under* a bar; what it can do instead is
 * slide away from the roof it names. That is silent: `visual.spec.ts` checks the tags are on
 * screen and not on top of each other, and a tag nudged forty pixels down the cathedral passes
 * both. So the clamp is measured here, in the same fractions the marks are written in.
 *
 * The arithmetic is `OnPlate`'s, restated rather than imported. A test that called the component's
 * own clamp would agree with whatever it happened to do, including the wrong thing.
 */
import { CITY_DISTRICTS, plateAspect } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { DISTRICT_MARKS } from './CityView';

/**
 * The band between the bars where it is widest for its height: 1280x720 with the standing bar
 * wrapped to two rows. The same reading `city/plateFit.test.ts` uses for the district screen, off
 * the same pass with `getBoundingClientRect` on 2026-09-15, and the worst case for a crop: the
 * others hide less, and at 1024x768 the band is taller than the plate and hides nothing at all.
 */
const WORST_BAND = { width: 1280, height: 484 } as const;

/** `CLEARANCE_PX` in `PlateRoom`, for a tag hung from its mark (`anchor="bottom"`). */
const CLEARANCE = { above: 78, below: 14 } as const;

/**
 * How far a mark may be pushed before it has left the thing it names, in pixels of the painting.
 *
 * Twenty-four is a little over the worst the current placements ask for and a good deal less than
 * a tag is tall, so a mark that trips it is one a player would see sitting off its roof rather than
 * on it. Raising it is not the fix: moving the mark up the painting is.
 */
const DRIFT_CEILING_PX = 24;

const ASPECT = plateAspect('city');
const PICTURE = { width: WORST_BAND.width, height: WORST_BAND.width / ASPECT };
/** The share of the plate each bar hides at that band. Nothing when the band is the taller one. */
const HIDDEN = Math.max(0, (PICTURE.height - WORST_BAND.height) / 2) / PICTURE.height;

function clampedY(y: number): number {
  const low = HIDDEN + CLEARANCE.above / PICTURE.height;
  const high = 1 - HIDDEN - CLEARANCE.below / PICTURE.height;
  return low > high ? (low + high) / 2 : Math.max(low, Math.min(high, y));
}

describe('the city tags survive the crop', () => {
  it('hides a tenth of the plate behind each bar at the worst band', () => {
    // The precondition for everything below: at a band that hid nothing, every case would pass by
    // having nothing to clamp, and this file would be green against any placement at all.
    expect(HIDDEN).toBeGreaterThan(0.05);
    expect(PICTURE.height).toBeGreaterThan(WORST_BAND.height);
  });

  it('leaves every district mark within a tag of where it was placed', () => {
    const drifted: string[] = [];
    for (const district of CITY_DISTRICTS) {
      const at = DISTRICT_MARKS[district.id];
      if (at === undefined) continue; // `CityView.test.ts` is the gate on a district with no mark.
      const moved = Math.abs(clampedY(at.y) - at.y) * PICTURE.height;
      if (moved > DRIFT_CEILING_PX) {
        drifted.push(`${district.id} at y ${at.y} moves ${Math.round(moved)}px`);
      }
    }
    expect(drifted, `tags the crop pushes off their mark: ${drifted.join(' | ')}`).toEqual([]);
  });

  /**
   * ...and the two that do move are named, so the number is a fact rather than a budget.
   *
   * Without this the ceiling above is the only thing on record and a placement pass could walk
   * every mark to the edge of it without failing anything.
   */
  it('moves only the two marks nearest the top and bottom edges, and barely', () => {
    const moved = CITY_DISTRICTS.flatMap((district) => {
      const at = DISTRICT_MARKS[district.id];
      if (at === undefined) return [];
      const px = Math.round(Math.abs(clampedY(at.y) - at.y) * PICTURE.height);
      return px > 0 ? [`${district.id}:${px}`] : [];
    });
    expect(moved.sort()).toEqual(['ashen-terraces:10', 'south-quay:16']);
  });
});
