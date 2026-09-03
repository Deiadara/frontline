/**
 * The rules a sign placement has to obey, which are not the rules a browser can check.
 *
 * `painting.spec.ts` renders both districts at four widths and proves no sign leaves the frame, no
 * two collide and no name is cut. All of that was green the whole time every plate on the Neon
 * Docks was sitting on an awning, a hull or a lit wall: where a plate lands relative to the
 * *painting* is invisible to a test that only knows about boxes.
 *
 * Whether a given plate covers a building is a fact about a picture, and it was settled by measuring
 * the masters: a plate is 144px wide, which is 425 pixels of the Docks' 3780-wide master, and the
 * only region of that picture quiet enough to take a box that size is the open water on the far
 * left. Hence the convention these tests pin: on a painted district a plate does **not** hang beside
 * its point, it hangs somewhere quieter with a leader line back to it.
 *
 * These do not re-measure the paintings. An edge-energy gate was written and thrown away first,
 * because it could not fail on a real regression: the Crane Site's old position, which was one of
 * the ones sitting on the dock, measured quieter (4.17) than the Wet Galley's corrected one (4.77),
 * so any threshold that passed the good placements also passed several of the bad ones. A gate that
 * cannot go red is worse than no gate, because it is read as coverage. What is pinned here instead
 * is the convention and the geometry, both of which do fail when somebody undoes them.
 */
import { describe, expect, it } from 'vitest';
import { GATE_MARK, LOCATION_MARKS, type Mark } from './marks';

/** The districts with a delivered painting dense enough to need leader lines. */
const PAINTED = ['neon-docks', 'rustyard'] as const;

function marksOf(district: string): [string, Mark][] {
  const gate = GATE_MARK[district];
  return [
    ...Object.entries(LOCATION_MARKS).filter(([id]) => id.startsWith(`${district}-`)),
    ...(gate ? ([[`${district}-gate`, gate]] as [string, Mark][]) : []),
  ];
}

describe('where the district signs stand', () => {
  for (const district of PAINTED) {
    describe(district, () => {
      const marks = marksOf(district);

      it('has a mark for every sign the painting carries', () => {
        // Seven locations and a gate. If this drops, the sweeps below measure fewer things while
        // still passing, which is the failure mode a fixture-shaped test has.
        expect(marks.length).toBe(8);
      });

      it('hangs every plate off its point rather than beside it', () => {
        const beside = marks.filter(([, mark]) => mark.plate === undefined).map(([id]) => id);
        expect(
          beside,
          'these plates hang beside their own point, which on this painting means on top of the thing they name',
        ).toEqual([]);
      });

      it('keeps the point and the plate inside the painting', () => {
        for (const [id, mark] of marks) {
          // A plate-less mark is the test above's to report. Dereferencing it here would turn one
          // clear failure into three, two of them a `TypeError` that names nothing.
          const places: [string, { x: number; y: number }][] = [
            ['point', { x: mark.x, y: mark.y }],
          ];
          if (mark.plate) places.push(['plate', mark.plate]);
          for (const [what, at] of places) {
            expect(at.x, `${id} ${what} x`).toBeGreaterThan(0);
            expect(at.x, `${id} ${what} x`).toBeLessThan(1);
            expect(at.y, `${id} ${what} y`).toBeGreaterThan(0);
            expect(at.y, `${id} ${what} y`).toBeLessThan(1);
          }
        }
      });

      /*
       * A leader line is a thread, not a journey.
       *
       * The plate has to be far enough from the point to be off the building and near enough that
       * the eye joins them without following the line across the picture. Measured: the longest
       * placement is about a tenth of the frame, so a fifth is a ceiling with room in it and still
       * catches a plate that has wandered.
       */
      it('keeps every leader line short enough to read as one sign', () => {
        for (const [id, mark] of marks) {
          if (!mark.plate) continue;
          const { plate } = mark;
          const length = Math.hypot(plate.x - mark.x, plate.y - mark.y);
          expect(length, `${id} runs a leader line right across the painting`).toBeLessThan(0.2);
          expect(length, `${id} is offset by nothing, so the line is invisible`).toBeGreaterThan(0);
        }
      });
    });
  }
});
