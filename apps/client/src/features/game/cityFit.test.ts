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
import { districtsOfCity, plateAspect } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { CITY_PLATES, DISTRICT_MARKS, PAINTED_CITY_IDS } from './CityView';

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

/** One city's painting at the worst band, and the crop the two bars take out of it. */
function pictureOf(cityId: string) {
  const aspect = plateAspect(CITY_PLATES[cityId] ?? 'city');
  const picture = { width: WORST_BAND.width, height: WORST_BAND.width / aspect };
  // The share of the plate each bar hides at that band. Nothing when the band is the taller one.
  const hidden = Math.max(0, (picture.height - WORST_BAND.height) / 2) / picture.height;
  return { ...picture, hidden };
}

function clampedY(y: number, picture: ReturnType<typeof pictureOf>): number {
  const low = picture.hidden + CLEARANCE.above / picture.height;
  const high = 1 - picture.hidden - CLEARANCE.below / picture.height;
  return low > high ? (low + high) / 2 : Math.max(low, Math.min(high, y));
}

/** How far the crop pushes each marked district, in pixels of that city's painting. */
function driftOf(cityId: string): { id: string; px: number }[] {
  const picture = pictureOf(cityId);
  const marks = DISTRICT_MARKS[cityId] ?? {};
  return districtsOfCity(cityId).flatMap((district) => {
    const at = marks[district.id];
    // `CityView.test.tsx` is the gate on a district with no mark.
    if (at === undefined) return [];
    return [{ id: district.id, px: Math.abs(clampedY(at.y, picture) - at.y) * picture.height }];
  });
}

describe.each(PAINTED_CITY_IDS)('the %s tags survive the crop', (cityId) => {
  const picture = pictureOf(cityId);

  it('hides a tenth of the plate behind each bar at the worst band', () => {
    // The precondition for everything below: at a band that hid nothing, every case would pass by
    // having nothing to clamp, and this file would be green against any placement at all.
    expect(picture.hidden).toBeGreaterThan(0.05);
    expect(picture.height).toBeGreaterThan(WORST_BAND.height);
  });

  it('leaves every district mark within a tag of where it was placed', () => {
    const drifted = driftOf(cityId)
      .filter((moved) => moved.px > DRIFT_CEILING_PX)
      .map((moved) => `${moved.id} moves ${Math.round(moved.px)}px`);
    expect(drifted, `tags the crop pushes off their mark: ${drifted.join(' | ')}`).toEqual([]);
  });
});

/**
 * ...and the marks that do move are named, so the number is a fact rather than a budget.
 *
 * Without this the ceiling above is the only thing on record and a placement pass could walk every
 * mark to the edge of it without failing anything. Terminus contributes nothing: its twelve were
 * placed inside the window this file describes rather than at the edges of it, so the crop has
 * nothing to push, and a Terminus id appearing here means somebody moved one out of the band.
 */
describe('which marks the crop actually moves', () => {
  it('names every one of them, across both paintings', () => {
    const moved = PAINTED_CITY_IDS.flatMap((cityId) =>
      driftOf(cityId)
        .filter((drift) => Math.round(drift.px) > 0)
        .map((drift) => `${drift.id}:${Math.round(drift.px)}`),
    );
    /*
     * South Quay left this list on 2026-09-25 and that is the point of the change.
     *
     * Its mark was at `y: 0.9`, low enough on the quay that the bottom bar clamped it 16px up
     * every time the screen was drawn: the tag a player saw was never the tag the map placed. The
     * maintainer asked for it a tag's height higher, and at 0.871 the crop has nothing to push, so
     * the placement and the drawing finally agree about where it is.
     *
     * Ashen Terraces still moves 10px and is left alone: it is a *top*-edge clamp, under the
     * stockpile rather than over the switcher, and 10px is inside the ceiling the case above pins.
     */
    expect(moved.sort()).toEqual(['ashen-terraces:10']);
  });
});
