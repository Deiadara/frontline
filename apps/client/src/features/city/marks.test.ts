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
import { findDistrict } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { GATE_MARK, LOCATION_MARKS, type Mark } from './marks';

/** The districts with a delivered painting dense enough to need leader lines. */
const PAINTED = ['neon-docks', 'rustyard', 'chrome-row'] as const;

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
        // Every location the catalogue gives the district, plus its gate. Read off the catalogue
        // rather than typed as a number: Chrome Row has eight locations where the first two had
        // seven, and a fixed count would have passed with one sign missing there.
        const catalogue = findDistrict(district);
        expect(catalogue, district).toBeDefined();
        expect(marks.length).toBe((catalogue?.locations.length ?? 0) + 1);
      });

      it('stands every sign on its own mark, with no leader line to anywhere', () => {
        for (const [id, mark] of marks) {
          expect(
            'plate' in mark,
            `${id} still carries a plate offset, which is a leader line by another name`,
          ).toBe(false);
        }
      });

      it('keeps every sign inside the painting, allowing for its own width', () => {
        // A sign is about a tenth of the frame wide at the width these were placed at. A centred
        // sign needs half of that either side; a clamped one needs all of it on its inner side.
        const HALF = 0.05;
        for (const [id, mark] of marks) {
          const left =
            mark.side === 'left'
              ? mark.x - 2 * HALF
              : mark.side === 'right'
                ? mark.x
                : mark.x - HALF;
          const right =
            mark.side === 'left'
              ? mark.x
              : mark.side === 'right'
                ? mark.x + 2 * HALF
                : mark.x + HALF;
          expect(left, `${id} runs off the left edge`).toBeGreaterThan(0);
          expect(right, `${id} runs off the right edge`).toBeLessThan(1);
          expect(mark.y, `${id} y`).toBeGreaterThan(0);
          // The plate room crops the bottom tenth of the painting at 1024x768 (`PlateRoom`), so a
          // sign below nine tenths is a sign a laptop never shows.
          expect(mark.y, `${id} sits in the band the shortest viewport crops off`).toBeLessThan(
            0.9,
          );
        }
      });

      /*
       * Two signs on one spot is one sign the player cannot read. A plate is about a tenth of the
       * frame wide and a twenty-fifth tall, so two whose centres are closer than that in both axes
       * overlap on screen.
       */
      it('never stands two signs on top of each other', () => {
        for (let i = 0; i < marks.length; i += 1) {
          for (let j = i + 1; j < marks.length; j += 1) {
            const [a, ma] = marks[i]!;
            const [b, mb] = marks[j]!;
            const apart = Math.abs(ma.x - mb.x) >= 0.11 || Math.abs(ma.y - mb.y) >= 0.05;
            expect(apart, `${a} and ${b} overlap`).toBe(true);
          }
        }
      });
    });
  }
});
