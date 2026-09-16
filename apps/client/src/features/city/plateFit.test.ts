/**
 * Every sign on a contested district stands in the part of the plate that is on screen.
 *
 * `ContestedDistrict` cover-fits the plate to the band between the standing bar and the nav: the
 * band is wider than 21:10 at every viewport in the e2e matrix, so the plate runs edge to edge and
 * gives up a sliver of its top and bottom to the bars. A sign is placed in fractions of the plate,
 * so a mark inside one of those slivers is a sign under a bar: drawn, unreadable, and unclickable,
 * because the bar is a real control and eats the pointer. Nothing else fails when that happens.
 * `painting.spec.ts` measures signs against the *plate*, and the plate is fine.
 *
 * So the geometry is pinned here, against the worst band in the matrix, in the same fractions the
 * marks are written in. A mark that fails this is placed too close to an edge for the screen it is
 * on, whatever the picture says.
 */
import { CITY_DISTRICTS, plateAspect } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { GATE_MARK, LOCATION_MARKS, type Mark } from './marks';

/**
 * The band between the bars at the viewport where it is widest for its height: 1280x720, with the
 * standing bar wrapped to two rows (126px) and the nav at 110px. Read off the page with
 * `getBoundingClientRect` across 1024x768, 1280x720, 1280x800, 1440x900 and 1920x1080 on
 * 2026-09-15; the others crop between 0.7% (1920x1080) and 3.7% (1280x800) off each edge.
 */
const WORST_BAND = { width: 1280, height: 484 } as const;

/**
 * The share of a 21:10 plate's height that each bar hides in that band: the plate is 1280 wide and
 * 609.5 tall, the band 484, and the 125.5px overhang is split evenly. `hiddenShare` below is the
 * same arithmetic for a plate of any aspect; this is the number for the report and the comment.
 */
export const HIDDEN_SHARE = 0.103;
/** What is left between the bars: the top and bottom 10.3% of the plate are under them. */
export const VISIBLE_FRACTION = 1 - 2 * HIDDEN_SHARE;

/**
 * How tall a sign stands below its mark, in pixels. `Sign` hangs its plate *down* from `y`, so
 * the sign's top is the mark and its bottom is the mark plus this. Measured at 1280x720: a plain
 * sign is 18.5px; a shut gate's carries a lock icon and stands 26px.
 */
const SIGN_PX = 18.5;
const SHUT_GATE_SIGN_PX = 26;

/**
 * The ground box's toggle, in band pixels: right-aligned, `17rem` wide plus the 16px inset, from
 * 12px to 43px under the band's top. It floats over the plate at `z-20` and takes the pointer, so a
 * sign under it cannot be clicked. Chrome Row's Overlook sat exactly there at 1280x720 (bug pass,
 * 2026-09-15) and nothing measured it, because the sign was inside the visible band.
 */
const TOGGLE_CORNER = { fromRight: 17 * 16 + 16, top: 12, bottom: 43 } as const;

/** Whether a sign hung at `mark` at the worst band would sit under the toggle's corner box. */
function underToggle(mark: Mark, aspect: number, px: number): boolean {
  const plate = plateHeight(aspect);
  const hidden = hiddenShare(aspect);
  const signTop = (mark.y - hidden) * plate;
  const signBottom = signTop + px;
  const inColumn = mark.x * WORST_BAND.width > WORST_BAND.width - TOGGLE_CORNER.fromRight;
  return inColumn && signBottom > TOGGLE_CORNER.top && signTop < TOGGLE_CORNER.bottom;
}

function plateHeight(aspect: number): number {
  return WORST_BAND.width / aspect;
}

function hiddenShare(aspect: number): number {
  return (plateHeight(aspect) - WORST_BAND.height) / 2 / plateHeight(aspect);
}

/** Where a sign's top and bottom fall on the plate, as fractions of its height. */
function signSpan(mark: Mark, aspect: number, px: number): { top: number; bottom: number } {
  return { top: mark.y, bottom: mark.y + px / plateHeight(aspect) };
}

const painted = CITY_DISTRICTS.filter(
  (district) =>
    GATE_MARK[district.id] !== undefined ||
    district.locations.some((location) => LOCATION_MARKS[location.id] !== undefined),
);

describe('the signs stand in the visible part of a cover-fitted plate', () => {
  it('states the hidden share for a 21:10 plate correctly', () => {
    expect(Number(hiddenShare(21 / 10).toFixed(3))).toBe(HIDDEN_SHARE);
  });

  it('sweeps every mark in the file', () => {
    // A location mark whose district is not in the city would escape the loop below silently.
    const swept = new Set(
      painted.flatMap((district) => district.locations.map((location) => location.id)),
    );
    const strays = Object.keys(LOCATION_MARKS).filter((id) => !swept.has(id));
    expect(strays, 'marks on no district').toEqual([]);
    expect(Object.keys(GATE_MARK).filter((id) => !painted.some((d) => d.id === id))).toEqual([]);
  });

  for (const district of painted) {
    describe(district.id, () => {
      const aspect = plateAspect(`district-${district.id}`);
      const hidden = hiddenShare(aspect);
      const limit = { top: hidden, bottom: 1 - hidden };

      it('keeps every location sign between the bars', () => {
        const under: string[] = [];
        for (const location of district.locations) {
          const mark = LOCATION_MARKS[location.id];
          if (mark === undefined) continue;
          const span = signSpan(mark, aspect, SIGN_PX);
          if (span.top < limit.top || span.bottom > limit.bottom) {
            under.push(
              `${location.id}: y ${mark.y}, sign ${span.top.toFixed(3)}..${span.bottom.toFixed(3)}, visible ${limit.top.toFixed(3)}..${limit.bottom.toFixed(3)}`,
            );
          }
        }
        expect(under, `signs under a bar at ${WORST_BAND.width}x${WORST_BAND.height}`).toEqual([]);
      });

      it('keeps every sign out from under the ground box toggle', () => {
        const covered: string[] = [];
        for (const location of district.locations) {
          const mark = LOCATION_MARKS[location.id];
          if (mark !== undefined && underToggle(mark, aspect, SIGN_PX)) {
            covered.push(`${location.id}: x ${mark.x}, y ${mark.y}`);
          }
        }
        const gate = GATE_MARK[district.id];
        if (gate !== undefined && underToggle(gate, aspect, SHUT_GATE_SIGN_PX)) {
          covered.push(`gate: x ${gate.x}, y ${gate.y}`);
        }
        expect(covered, 'signs the toggle would cover at the worst band').toEqual([]);
      });

      it('keeps the gate sign between the bars, lock icon included', () => {
        const mark = GATE_MARK[district.id];
        if (mark === undefined) return;
        const span = signSpan(mark, aspect, SHUT_GATE_SIGN_PX);
        expect(span.top, `gate y ${mark.y} above the visible band`).toBeGreaterThanOrEqual(
          limit.top,
        );
        expect(
          span.bottom,
          `gate y ${mark.y} plus its plate runs under the nav`,
        ).toBeLessThanOrEqual(limit.bottom);
      });
    });
  }
});
