import { describe, expect, it } from 'vitest';
import { DEFAULT_CITY_ID } from '../city/cities.js';
import { RELIQUARY_CITY_ID, TERMINUS_CITY_ID } from '../city/atlas.js';
import { CONTRABAND_PARTS } from './contraband.js';
import { VENDOR_GOODS, vendorStockFor } from './vendor.js';
import { BLACK_MARKET_GOODS } from './blackmarket.js';

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
    const away = vendorStockFor(DAY, RELIQUARY_CITY_ID);
    expect(away.map((line) => line.item)).not.toEqual(home.map((line) => line.item));
  });

  /**
   * And no two cities mint the same line id on the same day.
   *
   * This is the half that would be a real defect rather than a dull barrow: a bid is filed against
   * a line id, so two cities sharing one would have a crew bidding in Ashfall and collecting a
   * crate in Reliquary.
   */
  it('never mints one line id in two cities', () => {
    const ids = [DEFAULT_CITY_ID, RELIQUARY_CITY_ID, TERMINUS_CITY_ID].flatMap((city) =>
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
    const first = vendorStockFor(DAY, RELIQUARY_CITY_ID);
    const again = vendorStockFor(DAY, RELIQUARY_CITY_ID);
    expect(again).toEqual(first);
  });
});

// The contraband crates are sold as goods that never reach the Runner's barrow, and it stocked all
// five of their parts (maintainer, 2026-10-02). A year of stock, and none of them on it.
describe('what the Runner never carries', () => {
  it('keeps every contraband part off the barrow', () => {
    // The list is the crates' grants, so a new crate cannot sell a part the barrow still carries.
    const granted = new Set(
      Object.values(BLACK_MARKET_GOODS)
        .filter((good) => good.kind === 'contraband')
        .flatMap((good) => Object.keys(good.grants ?? {})),
    );
    expect([...CONTRABAND_PARTS].sort()).toEqual([...granted].sort());
    for (const part of CONTRABAND_PARTS) expect(VENDOR_GOODS).not.toContain(part);
    const start = Date.parse('2026-10-02T12:00:00.000Z');
    for (let day = 0; day < 365; day += 1) {
      const date = new Date(start + day * 86_400_000).toISOString().slice(0, 10);
      for (const line of vendorStockFor(date)) {
        expect(CONTRABAND_PARTS.has(line.item as never), `${date}: ${line.item}`).toBe(false);
      }
    }
  });
});
