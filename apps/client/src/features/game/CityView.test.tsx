import { CITIES, districtsOfCity, findAssetSpec } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { CITY_PLATES, PAINTED_CITY_IDS, districtsWithoutAMark } from './CityView';

/**
 * The city paintings are hand-placed, and that is the one thing about them that can rot.
 *
 * Every other list on this screen is derived from the atlas, so a new district turns up on its
 * own. The marks cannot be: somebody has to look at the painting and decide the new place is on
 * the smokestacks rather than the water. A district with no mark simply is not drawn, and because
 * the screen is a picture rather than a list, nothing about it looks wrong: the way in is just
 * missing. This is the trip-wire for that, and it runs over every city the screen can draw rather
 * than over Ashfall alone, which is how Terminus would otherwise have shipped with twelve
 * districts and no way into any of them.
 */
describe('the city paintings', () => {
  it.each(PAINTED_CITY_IDS)('has a mark for every district in %s', (cityId) => {
    expect(districtsWithoutAMark(cityId)).toEqual([]);
  });

  it.each(PAINTED_CITY_IDS)('is checking a city that actually has districts in it', (cityId) => {
    // Guards the assertion above against passing because the list it walks is empty.
    expect(districtsOfCity(cityId).length).toBeGreaterThan(5);
  });

  it.each(PAINTED_CITY_IDS)('draws %s from a plate the art manifest carries', (cityId) => {
    expect(findAssetSpec(`plate-${CITY_PLATES[cityId]}`), cityId).toBeDefined();
  });

  /**
   * A city a player can walk into and a city this screen can paint have to be the same set.
   *
   * An open city with no plate is a `/game` index that throws on `plateAspect`; a plate for a shut
   * city is a painting nothing renders. Both have to be decided here rather than discovered.
   */
  it('paints exactly the cities that are open', () => {
    const open = CITIES.filter((city) => city.open).map((city) => city.id);
    expect([...PAINTED_CITY_IDS].sort()).toEqual([...open].sort());
  });
});
