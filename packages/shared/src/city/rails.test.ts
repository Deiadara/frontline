import { describe, expect, it } from 'vitest';
import { ALL_DISTRICTS, TERMINUS_CITY_ID, districtsOfCity, findDistrict } from './atlas.js';
import { DEFAULT_CITY_ID } from './cities.js';
import {
  INTER_CITY_MINUTES,
  MIN_TRAVEL_MINUTES,
  rawMinutesBetween,
  travelMinutesBetween,
} from './geography.js';
import { RAIL_LINK_MINUTES } from './locations.js';
import { partyCanRide, railwayOffer, railwayOfferBetween, stationDistricts } from './rails.js';

/**
 * Terminus's railway, and the frontier it runs inside (maintainer, 2026-09-24).
 *
 * Two rules are held here and they are easy to confuse. The **frontier** is what stops a march
 * between two cities being measured as if the two maps were printed on top of each other, which is
 * what it was. The **railway** is what a crew buys by holding platforms, and it only ever applies
 * inside Terminus.
 */

const at = (id: string) => {
  const district = findDistrict(id);
  expect(district, id).toBeDefined();
  return district!;
};

/** Every Station in Terminus, as location ids: what a crew that owned the whole line would hold. */
const EVERY_STATION = districtsOfCity(TERMINUS_CITY_ID).flatMap((district) =>
  district.locations.filter((one) => one.kind === 'rail_station').map((one) => one.id),
);

describe('the frontier between two cities', () => {
  it('is a real journey rather than a coincidence of two overlapping maps', () => {
    /*
     * The defect this pins, with the exact pair that showed it.
     *
     * Positions are normalised inside their own city, so Ashfall's Ashen Terraces at (0.84, 0.62)
     * and Terminus's Last Platform at (0.80, 0.34) are a fifth of a unit square apart on paper and
     * four hours apart in the world. Before the frontier term this came to the two-minute floor.
     */
    const home = at('ashen-terraces');
    const away = at('last-platform');
    expect(home.cityId).not.toBe(away.cityId);
    // A crew with no pace and no holdings pays the figure itself (maintainer, 2026-10-07).
    expect(travelMinutesBetween(home, away)).toBe(INTER_CITY_MINUTES);
  });

  it('costs more than any journey inside either city', () => {
    const longestAtHome = longestRoadIn(DEFAULT_CITY_ID);
    const longestAbroad = longestRoadIn(TERMINUS_CITY_ID);
    const crossing = rawMinutesBetween(at('kettle-row'), at('coldwater-halt'));
    expect(crossing).toBeGreaterThan(longestAtHome);
    expect(crossing).toBeGreaterThan(longestAbroad);
  });

  it('still spends the column pace and the crew bonuses on the whole of it', () => {
    // It is a road, not a rule: a crew with vehicles and a Rail Yard gets there sooner.
    const slow = travelMinutesBetween(at('kettle-row'), at('coldwater-halt'));
    const fast = travelMinutesBetween(at('kettle-row'), at('coldwater-halt'), {
      speed: 60,
      reductionPercent: 20,
    });
    expect(fast).toBeLessThan(slow);
  });
});

describe('who is on the line', () => {
  it('puts a platform in seven of the eight contested districts, and not on the Hill', () => {
    const stations = stationDistricts(EVERY_STATION);
    expect(stations.size).toBe(7);
    expect(stations.has('telemetry-hill')).toBe(false);
    expect(stations.has('coldwater-halt')).toBe(true);
    expect(stations.has('blockhouse')).toBe(true);
  });

  it('counts only the platforms a crew actually holds', () => {
    expect(stationDistricts([]).size).toBe(0);
    expect(stationDistricts(['coldwater-halt-platform']).size).toBe(1);
    // A location that is not a Station is not a platform, however much it sounds like one.
    expect(stationDistricts(['marshalling-yards-hump']).size).toBe(0);
  });
});

describe('what the railway is worth', () => {
  const wholeLine = stationDistricts(EVERY_STATION);

  it('is fifteen flat minutes when you board and alight where you are going', () => {
    const offer = railwayOffer(at('coldwater-halt'), at('blockhouse'), wholeLine);
    expect(offer).not.toBeNull();
    expect(offer!.boardAt.id).toBe('coldwater-halt');
    expect(offer!.alightAt.id).toBe('blockhouse');
    expect(offer!.toPlatform).toBe(0);
    expect(offer!.fromPlatform).toBe(0);
    expect(offer!.minutes).toBe(RAIL_LINK_MINUTES);
  });

  it('beats the road it replaces across the length of the city', () => {
    const road = travelMinutesBetween(at('coldwater-halt'), at('blockhouse'));
    const offer = railwayOffer(at('coldwater-halt'), at('blockhouse'), wholeLine);
    // A guard on the fixture: a rail rule that is not faster than walking proves nothing.
    expect(road).toBeGreaterThan(RAIL_LINK_MINUTES * 2);
    expect(offer!.minutes).toBeLessThan(road);
  });

  it('charges the walk at both ends when neither end is on the line', () => {
    /*
     * The maintainer's clause: the platform is not always where you are or where you are going.
     * Telemetry Hill holds no Station at all, so a journey that ends there always pays a walk off
     * the far platform, and that walk is what stops the Hill being fifteen minutes from anywhere.
     */
    const offer = railwayOffer(at('coldwater-halt'), at('telemetry-hill'), wholeLine);
    expect(offer).not.toBeNull();
    expect(offer!.alightAt.id).not.toBe('telemetry-hill');
    expect(offer!.fromPlatform).toBeGreaterThan(0);
    expect(offer!.minutes).toBe(offer!.toPlatform + RAIL_LINK_MINUTES + offer!.fromPlatform);
  });

  it('picks the platform that makes the whole journey shortest, not the nearest one', () => {
    const offer = railwayOffer(at('carriage'), at('telemetry-hill'), wholeLine);
    expect(offer).not.toBeNull();
    const every = [...wholeLine].map((districtId) => {
      const alight = railwayOffer(
        at('carriage'),
        at('telemetry-hill'),
        new Set([districtId, 'coldwater-halt']),
      );
      return alight?.minutes ?? Number.POSITIVE_INFINITY;
    });
    expect(offer!.minutes).toBeLessThanOrEqual(Math.min(...every));
  });

  it('offers nothing on one platform, because a line needs two ends', () => {
    expect(
      railwayOffer(at('coldwater-halt'), at('blockhouse'), new Set(['coldwater-halt'])),
    ).toBeNull();
    expect(railwayOffer(at('coldwater-halt'), at('blockhouse'), new Set())).toBeNull();
  });

  it('does not run over the frontier', () => {
    // A train is a thing inside one city. Crossing to another is a march, whatever you hold.
    expect(railwayOfferBetween('kettle-row', 'blockhouse', wholeLine)).toBeNull();
    expect(railwayOfferBetween('blockhouse', 'kettle-row', wholeLine)).toBeNull();
  });

  it('exists nowhere but Terminus, because nowhere else has a platform', () => {
    const elsewhere = ALL_DISTRICTS.filter((district) => district.cityId !== TERMINUS_CITY_ID);
    for (const district of elsewhere) {
      expect(
        district.locations.some((one) => one.kind === 'rail_station'),
        district.id,
      ).toBe(false);
    }
  });

  it('answers nothing for ground the map does not have', () => {
    expect(railwayOfferBetween('nowhere', 'blockhouse', wholeLine)).toBeNull();
    expect(railwayOfferBetween('coldwater-halt', 'nowhere', wholeLine)).toBeNull();
  });
});

describe('who may board', () => {
  it('turns away the machines and takes everybody else', () => {
    expect(partyCanRide({ vehicles: 0, unridables: 0 })).toBe(true);
    expect(partyCanRide({ vehicles: 1, unridables: 0 })).toBe(false);
    expect(partyCanRide({ vehicles: 0, unridables: 1 })).toBe(false);
    expect(partyCanRide({ vehicles: 2, unridables: 3 })).toBe(false);
  });
});

/** The longest road inside one city, for the frontier comparison above. */
function longestRoadIn(cityId: string): number {
  const districts = districtsOfCity(cityId);
  let worst = 0;
  for (const from of districts) {
    for (const to of districts) {
      worst = Math.max(worst, rawMinutesBetween(from, to));
    }
  }
  return worst;
}

/**
 * A percentage is spent identically however a road is cut up, because a share of a sum is the sum
 * of the shares. That is the whole of the rule now: the flat cut this block also measured went on
 * 2026-10-07, when the three things that paid it became points on the travel channel, so a rail
 * journey and the same journey on foot can no longer disagree about what a bonus is worth.
 */
describe('what the road bonuses are worth on a ride', () => {
  const wholeLine = stationDistricts(EVERY_STATION);
  /** Two ends that are both off the line, so both legs are real walks rather than zero. */
  const FROM = 'carriage';
  const TO = 'telemetry-hill';

  it('never spends a percentage on the fifteen minutes in the middle', () => {
    const legless = { speed: 100, reductionPercent: 0 };
    const cut = { speed: 100, reductionPercent: 60 };
    // Coldwater to the Blockhouse is a platform at either end, so the whole journey is the link.
    const plain = railwayOfferBetween('coldwater-halt', 'blockhouse', wholeLine, legless);
    const hastened = railwayOfferBetween('coldwater-halt', 'blockhouse', wholeLine, cut);
    // Nothing makes a train faster and nothing makes it slower: the same journey, the same clock,
    // with the best pace and the biggest reduction in the game spent on it.
    expect(plain?.minutes).toBe(RAIL_LINK_MINUTES);
    expect(hastened?.minutes).toBe(RAIL_LINK_MINUTES);
  });

  it('never drives a leg to nothing, however hard the percentage is pressed', () => {
    const huge = railwayOfferBetween(FROM, TO, wholeLine, { speed: 100, reductionPercent: 300 });
    expect(huge).not.toBeNull();
    // A leg that exists is never free, and the fifteen is untouched by a road bonus of any size.
    expect(huge!.toPlatform).toBeGreaterThanOrEqual(MIN_TRAVEL_MINUTES);
    expect(huge!.fromPlatform).toBeGreaterThanOrEqual(MIN_TRAVEL_MINUTES);
    expect(huge!.minutes).toBeGreaterThanOrEqual(RAIL_LINK_MINUTES + 2 * MIN_TRAVEL_MINUTES);
  });
});
