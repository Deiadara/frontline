/**
 * The geometry the readings are drawn from.
 *
 * Split out of the component because an arc is the one thing on this page that is arithmetic rather
 * than taste: a sweep flag set from the wrong comparison draws the *complement* of the fraction it
 * was given, which is a gauge reading 80% when the faction has one seat of five filled, and it
 * looks entirely plausible on a screenshot.
 */

/** The dial is drawn on a 100 by 100 box, like every other mark in this game. */
const CENTRE = 50;

/** Where a fraction of the way round the ring lands, clockwise from twelve o'clock. */
function pointAt(fraction: number, radius: number): [x: number, y: number] {
  const angle = fraction * Math.PI * 2 - Math.PI / 2;
  return [CENTRE + radius * Math.cos(angle), CENTRE + radius * Math.sin(angle)];
}

/** One tick per seat, evenly spaced, each a short stroke pointing at the centre. */
export function seatTicks(count: number, radius: number, length: number): readonly string[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const [outerX, outerY] = pointAt(index / count, radius);
    const [innerX, innerY] = pointAt(index / count, radius - length);
    return `M${outerX} ${outerY} L${innerX} ${innerY}`;
  });
}
