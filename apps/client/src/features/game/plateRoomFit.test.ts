/**
 * `fitting`: the three ways a painting is put into the band, and what separates them.
 *
 * The two that look alike are `cover` and `width`, and they agree at every viewport in the e2e
 * matrix, which is exactly why this is a unit test rather than something the browser run would
 * catch. They come apart only in a band **taller** than the plate: cover takes the larger fit and
 * runs the picture past both side edges, width keeps the width and letterboxes instead. That case
 * is a window grown past the fold or a portrait screen, and the district screen's own note is the
 * record of why it matters: a picture run past the side edges takes the marks near `x: 0` and
 * `x: 1` off screen with it.
 *
 * Bands are written as plain numbers rather than read off a plate, so a retuned plate cannot make
 * these agree by accident.
 */
import { describe, expect, it } from 'vitest';
import { fitting } from './PlateRoom';

/** 21:10, the shape the city, the district plates and the faction room are all painted at. */
const ASPECT = 2.1;
/** Wider than the plate: the ordinary desktop band. */
const WIDE = { width: 1280, height: 484 };
/** Taller than the plate: a window grown past the fold. */
const TALL = { width: 1024, height: 700 };

const round = (box: { width: number; height: number }) => ({
  width: Math.round(box.width),
  height: Math.round(box.height),
});

describe('fitting a plate into the band', () => {
  it('has no size at all before the room has been measured', () => {
    expect(fitting({ width: 0, height: 0 }, ASPECT, 'width')).toEqual({ width: 0, height: 0 });
    expect(fitting({ width: 1280, height: 0 }, ASPECT, 'cover')).toEqual({ width: 0, height: 0 });
  });

  it('draws the picture at its own aspect in every mode', () => {
    for (const fit of ['cover', 'whole', 'width'] as const) {
      for (const room of [WIDE, TALL]) {
        const box = fitting(room, ASPECT, fit);
        expect(box.width / box.height, `${fit} in ${room.width}x${room.height}`).toBeCloseTo(
          ASPECT,
          6,
        );
      }
    }
  });

  it('fills a wide band edge to edge under both cover and width, and they agree there', () => {
    expect(round(fitting(WIDE, ASPECT, 'width'))).toEqual({ width: 1280, height: 610 });
    expect(round(fitting(WIDE, ASPECT, 'cover'))).toEqual(round(fitting(WIDE, ASPECT, 'width')));
    // ...and the picture really is taller than the band, so the bars have something to crop.
    expect(fitting(WIDE, ASPECT, 'width').height).toBeGreaterThan(WIDE.height);
  });

  it('leaves a wide band short down both sides under whole, which is the grey-bar case', () => {
    const box = fitting(WIDE, ASPECT, 'whole');
    expect(round(box)).toEqual({ width: 1016, height: 484 });
    expect(WIDE.width - box.width).toBeGreaterThan(200);
  });

  /** The one that matters, and the only place `width` and `cover` disagree. */
  it('keeps the width in a tall band where cover would run past both side edges', () => {
    expect(round(fitting(TALL, ASPECT, 'width'))).toEqual({ width: 1024, height: 488 });
    expect(round(fitting(TALL, ASPECT, 'cover'))).toEqual({ width: 1470, height: 700 });
    expect(fitting(TALL, ASPECT, 'cover').width).toBeGreaterThan(TALL.width);
    expect(fitting(TALL, ASPECT, 'width').width).toBe(TALL.width);
    // In a tall band `whole` has nothing to give up either, so it lands on the same box as width.
    expect(round(fitting(TALL, ASPECT, 'whole'))).toEqual(round(fitting(TALL, ASPECT, 'width')));
  });
});
