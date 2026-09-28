import { CITY_DISTRICTS, districtsOfCity, envLabel } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { locationKindOf, whenItHolds } from './characteristics';

/**
 * A chip's note has to be right in every city, not only in the first one.
 *
 * `whenItHolds` prints "Today's sky, not this ground" against a characteristic the weather put
 * there and the location would not carry on its own. Deciding that needs the location's kind, and
 * `locationKindOf` walked Ashfall's twelve districts while the world had thirteen more. A fight
 * over a Terminus sewer therefore answered `null`, which the note reads as "this ground carries
 * nothing", so a tunnel that is Wet in the dry was advertised as Wet until the rain stops: the
 * exact misreading the note exists to prevent.
 */

/** A sewer in the second city: Wet, Dark, Crammed and Toxic whatever the sky is doing. */
const AWAY_SEWER = 'ironmouth-shafts';
/** Ashfall's own, so the same assertion is made twice and the first city is the control. */
const HOME_SEWER = CITY_DISTRICTS.flatMap((district) => district.locations).find(
  (location) => location.kind === 'sewer_junction',
)!.id;

describe('locationKindOf', () => {
  it('knows a location in the crew’s own city', () => {
    expect(locationKindOf(HOME_SEWER)).toBe('sewer_junction');
  });

  it('knows a location in a city the crew does not live in', () => {
    expect(districtsOfCity('terminus').flatMap((one) => one.locations)).toContainEqual(
      expect.objectContaining({ id: AWAY_SEWER }),
    );
    expect(locationKindOf(AWAY_SEWER)).toBe('sewer_junction');
  });

  it('still answers null for a gate, a building or a home district', () => {
    expect(locationKindOf(undefined)).toBeNull();
    expect(locationKindOf('no-such-place')).toBeNull();
  });
});

describe('whenItHolds, on ground that is wet in the dry', () => {
  const wet = envLabel('wet', 2);

  it('says nothing about it at home', () => {
    expect(whenItHolds(locationKindOf(HOME_SEWER), 'rainy')(wet)).toBeUndefined();
  });

  it('says nothing about it abroad either', () => {
    expect(whenItHolds(locationKindOf(AWAY_SEWER), 'rainy')(wet)).toBeUndefined();
  });

  /** The control: a characteristic the sky really did put there is still called out. */
  it('still calls out what the sky put on that ground', () => {
    expect(whenItHolds(locationKindOf(AWAY_SEWER), 'rainy')(envLabel('cold', 1))).toContain(
      "Today's sky",
    );
  });
});
