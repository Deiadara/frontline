import { DEFAULT_CITY_ID } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { PAINTED_CITY_IDS, paintedCity } from './CityView';

/**
 * The map draws the city the player is looking at, and only while it can actually draw it.
 *
 * The remembered city is shared with the Bar, the market, the back room and the mission board, and
 * those will remember any city the server let the crew into. This screen paints from a table of
 * hand-placed marks, so a city missing from that table is a map with no way in and no way off it
 * except the world screen. The fallback is the crew's own city, which always has both.
 */
describe('which city the map paints', () => {
  const away = PAINTED_CITY_IDS.find((id) => id !== DEFAULT_CITY_ID);

  it('has two painted cities to choose between', () => {
    // A guard on the cases below: with one painted city, none of them proves anything.
    expect(away, 'needs a second painted city').toBeDefined();
  });

  it('paints the crew’s own city when nothing is being looked at', () => {
    expect(paintedCity(null, DEFAULT_CITY_ID)).toBe(DEFAULT_CITY_ID);
  });

  it('paints the city being looked at', () => {
    expect(paintedCity(away!, DEFAULT_CITY_ID)).toBe(away);
  });

  it('falls back to the crew’s own for a city it has no painting for', () => {
    // Reliquary is authored ground with no art behind it, and Redline and Deepcut are names with
    // no ground at all. All three are `open: false`, so none of them has a plate here.
    expect(paintedCity('reliquary', DEFAULT_CITY_ID)).toBe(DEFAULT_CITY_ID);
  });
});
