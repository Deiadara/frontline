import { describe, expect, it } from 'vitest';
import { CITIES, DEFAULT_CITY_ID } from './cities.js';
import { TERMINUS_CITY_ID } from './atlas.js';
import { cityHomeOffer, cityHomeOffers, freeHomePlots, homePlots, pickHomePlot } from './homes.js';

/**
 * Where a new crew may move in (maintainer, 2026-09-24).
 *
 * The rules under the choose-a-city screen: a city with no map is not on offer, a city whose four
 * plots all hold a player crew is full, and choosing one puts the crew on a free plot at random.
 */

const SHUT_CITY = CITIES.find((city) => !city.open)!.id;

describe('the plots a city has', () => {
  it('gives every playable city four of them', () => {
    for (const city of CITIES.filter((one) => one.open)) {
      expect(homePlots(city.id), city.id).toHaveLength(4);
    }
  });

  it('has none for a city that is only a name', () => {
    // Redline and Deepcut are rows in `cities.ts` with nothing in the atlas behind them.
    expect(homePlots('redline')).toEqual([]);
  });
});

describe('whether a city is on offer', () => {
  it('refuses a city with no map, whatever is free', () => {
    const offer = cityHomeOffer(SHUT_CITY, []);
    expect(offer.available).toBe(false);
    expect(offer.refusal).toBe('unbuilt');
    // Nothing free is reported either: a shut city has no plots to advertise.
    expect(offer.free).toBe(0);
  });

  it('is full at four resident crews and not at three', () => {
    const plots = homePlots(DEFAULT_CITY_ID);

    const three = cityHomeOffer(DEFAULT_CITY_ID, plots.slice(0, 3));
    expect(three.available).toBe(true);
    expect(three.refusal).toBeNull();
    expect(three.free).toBe(1);

    const four = cityHomeOffer(DEFAULT_CITY_ID, plots);
    expect(four.available).toBe(false);
    expect(four.refusal).toBe('full');
    expect(four.free).toBe(0);
  });

  it('counts each city on its own', () => {
    // Ashfall full does not shut Terminus, which is the whole point of there being two.
    const offers = cityHomeOffers(homePlots(DEFAULT_CITY_ID));
    const ashfall = offers.find((offer) => offer.cityId === DEFAULT_CITY_ID)!;
    const terminus = offers.find((offer) => offer.cityId === TERMINUS_CITY_ID)!;

    expect(ashfall.refusal).toBe('full');
    expect(terminus.available).toBe(true);
    expect(terminus.free).toBe(4);
  });

  it('answers for every city in the world, in map order', () => {
    expect(cityHomeOffers([]).map((offer) => offer.cityId)).toEqual(CITIES.map((city) => city.id));
  });
});

describe('the plot a crew is given', () => {
  it('is one nobody lives on', () => {
    const plots = homePlots(DEFAULT_CITY_ID);
    const taken = plots.slice(0, 3);
    for (let at = 0; at < 50; at += 1) {
      expect(pickHomePlot(DEFAULT_CITY_ID, taken, `seed-${at}`)).toBe(plots[3]);
    }
  });

  it('answers nothing when the city is full', () => {
    expect(pickHomePlot(DEFAULT_CITY_ID, homePlots(DEFAULT_CITY_ID), 'seed')).toBeNull();
    expect(pickHomePlot(SHUT_CITY, [], 'seed')).toBeNull();
  });

  it('is the same plot for the same seed and spreads across the four', () => {
    expect(pickHomePlot(DEFAULT_CITY_ID, [], 'steady')).toBe(
      pickHomePlot(DEFAULT_CITY_ID, [], 'steady'),
    );

    /*
     * Every plot reachable, and none of them carrying the draw.
     *
     * A four-way pick off a hash is exactly where a modulus collapses (see `drawWeighted`), and a
     * test that only asserted "it returns a plot" would pass on a draw that answered `kettle-row`
     * nine times in ten. 400 draws at an expected 100 each: the band is wide enough not to flake
     * and narrow enough that a collapsed draw cannot sit inside it.
     */
    const counts = new Map(homePlots(DEFAULT_CITY_ID).map((id) => [id, 0]));
    for (let at = 0; at < 400; at += 1) {
      const plot = pickHomePlot(DEFAULT_CITY_ID, [], `crew-${at}`)!;
      counts.set(plot, counts.get(plot)! + 1);
    }
    for (const [plot, count] of counts) {
      expect(count, plot).toBeGreaterThan(50);
      expect(count, plot).toBeLessThan(160);
    }
  });

  it('leaves the free list alone as crews arrive', () => {
    const plots = homePlots(TERMINUS_CITY_ID);
    expect(freeHomePlots(TERMINUS_CITY_ID, [plots[1]!])).toEqual([plots[0], plots[2], plots[3]]);
  });
});
