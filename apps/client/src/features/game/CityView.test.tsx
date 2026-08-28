import { CITY_DISTRICTS } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { districtsWithoutAMark } from './CityView';

/**
 * The city painting is hand-placed, and that is the one thing about it that can rot.
 *
 * Every other list on this screen is derived from `CITY_DISTRICTS`, so a new district turns up on
 * its own. The marks cannot be: somebody has to look at the painting and decide the new place is
 * on the smokestacks rather than the water. A district with no mark simply is not drawn, and
 * because the screen is a picture rather than a list, nothing about it looks wrong: the way in is
 * just missing. This is the trip-wire for that.
 */
describe('the city painting', () => {
  it('has a mark for every district in the city', () => {
    expect(districtsWithoutAMark()).toEqual([]);
  });

  it('is checking a city that actually has districts in it', () => {
    // Guards the assertion above against passing because the list it walks is empty.
    expect(CITY_DISTRICTS.length).toBeGreaterThan(5);
  });
});
