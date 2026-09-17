import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY_ID } from '../city/cities.js';
import { SALTMARCH_CITY_ID, VERGE_CITY_ID } from '../city/atlas.js';
import { vendorStockFor } from './vendor.js';

/**
 * A barrow belongs to a city, and to the crews with a stake in it (maintainer, 2026-09-17).
 *
 * "If you own even a single location in a district, you can access its bar and its market", and
 * "you affect the drops as well if you can participate". Two rules, both of which have to be true
 * of the stock rather than only of the door: a market a visitor walks into has to be that city's
 * market, and the standing of the crews holding the city has to show up in what is on it.
 *
 * The default arguments are the load-bearing part. Every fixture and screenshot in the suite is the
 * open city's quiet barrow, and a change that shifted those would have been a rewrite of the market
 * to add a door nobody can walk through yet.
 */
describe('whose barrow it is', () => {
  const DAY = '2026-09-17';

  it('carries the barrow it always carried for the open city', () => {
    const plain = vendorStockFor(DAY);
    const named = vendorStockFor(DAY, DEFAULT_CITY_ID);
    expect(named.map((line) => line.id)).toEqual(plain.map((line) => line.id));
    expect(named.map((line) => line.price)).toEqual(plain.map((line) => line.price));
    // Unprefixed, which is what keeps every id already filed against a bid naming the same lot.
    expect(plain[0]?.id.startsWith(DAY)).toBe(true);
  });

  it('carries different stock in a different city on the same day', () => {
    const home = vendorStockFor(DAY);
    const away = vendorStockFor(DAY, SALTMARCH_CITY_ID);
    expect(away.map((line) => line.item)).not.toEqual(home.map((line) => line.item));
  });

  /**
   * And no two cities mint the same line id on the same day.
   *
   * This is the half that would be a real defect rather than a dull barrow: a bid is filed against
   * a line id, so two cities sharing one would have a crew bidding in Ashfall and collecting a
   * crate in Saltmarch.
   */
  it('never mints one line id in two cities', () => {
    const ids = [DEFAULT_CITY_ID, SALTMARCH_CITY_ID, VERGE_CITY_ID].flatMap((city) =>
      vendorStockFor(DAY, city).map((line) => line.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The barrow is a pure function of the day and the city, and nothing else.
   *
   * Written down as a test because the tempting next feature is to tilt the rarity draw by who
   * holds the city, the way the Bar's room is weighted. A lot has bids standing against it all day:
   * a barrow that read the live map would redraw itself the moment anybody took a location, and
   * every bid on a line that vanished would be a bid on nothing.
   */
  it('draws the same barrow twice for the same day and city', () => {
    const first = vendorStockFor(DAY, SALTMARCH_CITY_ID);
    const again = vendorStockFor(DAY, SALTMARCH_CITY_ID);
    expect(again).toEqual(first);
  });
});
