import { describe, expect, it } from 'vitest';
import {
  MISC_AREA_ID,
  areaDifficulty,
  areaIsOpen,
  areaPayPercent,
  areasOffering,
  missionCityPercentIn,
  missionBoardKey,
  missionCityOf,
  missionOffers,
  openAreas,
} from './missions.areas.js';
import { CITY_DISTRICTS, isContested } from './city/districts.js';
import { TERMINUS_CITY_ID, cityOf, districtsOfCity, unifiedBonusFor } from './city/atlas.js';
import { DEFAULT_CITY_ID } from './city/cities.js';
import { hastenedMinutes } from './missions.js';
import { MISSION_SPEED_CEILING } from './economy/soft-bounds.js';
import { GAME_TIMEZONE } from './time/zone.js';

/**
 * The board, in a world with more than one city in it (2026-09-24).
 *
 * Terminus is playable and every enumeration work came off read Ashfall's twelve districts. Two
 * separate failures lived in that, and only one of them was visible: the board showed the wrong
 * city's areas, and `areaDifficulty` quietly priced a Terminus board at the `misc` floor, which is
 * the cheapest pay in the game. The second is the one worth a test, because nothing on any screen
 * would have said the Blockhouse was paying like a scrap run.
 */

const NOW = new Date('2026-09-24T09:00:00.000Z');
const TERMINUS = districtsOfCity(TERMINUS_CITY_ID);
const CONTESTED = TERMINUS.filter(isContested);

describe('what a second city pays for work', () => {
  it('has a Terminus to ask about at all', () => {
    expect(TERMINUS.length).toBeGreaterThan(0);
    expect(CONTESTED.length).toBeGreaterThan(0);
  });

  /**
   * The one that was silent. `areaDifficulty` walked Ashfall's array, missed every `tm-` id and
   * fell through to its `?? 1`, so the whole city priced at the rate of the board that is always
   * open. The Blockhouse is the authored 10 and has to read as one.
   */
  it('prices a Terminus district at its own authored difficulty, not the misc floor', () => {
    for (const district of CONTESTED) {
      expect(areaDifficulty(district.id), district.id).toBe(district.difficulty);
    }
    const blockhouse = CONTESTED.find((district) => district.id === 'blockhouse');
    expect(blockhouse?.difficulty).toBe(10);
    expect(areaDifficulty('blockhouse')).toBe(10);
    expect(areaPayPercent('blockhouse')).toBeGreaterThan(areaPayPercent(MISC_AREA_ID));
  });

  /** The hardest ground in the world pays more than the softest, wherever either of them is. */
  it('pays more on the Blockhouse than on the cheapest ground in either city', () => {
    const softest = [...CITY_DISTRICTS, ...TERMINUS]
      .filter(isContested)
      .sort((a, b) => a.difficulty - b.difficulty)[0]!;
    expect(areaPayPercent('blockhouse')).toBeGreaterThan(areaPayPercent(softest.id));
  });

  it('still answers the misc floor for an area id the map does not have', () => {
    expect(areaDifficulty('tm-a-halt-that-was-closed')).toBe(1);
    expect(areaDifficulty(MISC_AREA_ID)).toBe(1);
  });
});

describe('whose boards a crew is shown', () => {
  it('offers the districts of the city it was asked about, and nobody else, misc aside', () => {
    const district = CONTESTED[0]!;
    const { template } = missionOffers(district.id, missionBoardKey(district.id, NOW), 30)[0]!;

    /*
     * Asked of the atlas rather than of the id's spelling.
     *
     * This read `id.startsWith('tm-')`, which was true only while every Terminus district carried
     * the city in its id. The ids are the names the tags show now (2026-09-25), so the Blockhouse
     * is `blockhouse` and nothing about the string says which city it is in. `cityOf` is the
     * question that was always being asked.
     */
    const here = areasOffering(template.id, NOW, 30, GAME_TIMEZONE, TERMINUS_CITY_ID);
    expect(here).toContain(district.id);
    expect(here.every((id) => id === MISC_AREA_ID || cityOf(id) === TERMINUS_CITY_ID)).toBe(true);

    const home = areasOffering(template.id, NOW, 30, GAME_TIMEZONE, DEFAULT_CITY_ID);
    expect(home.some((id) => cityOf(id) === TERMINUS_CITY_ID)).toBe(false);
  });

  it('opens Terminus districts for a crew that holds them whole', () => {
    const open = openAreas(() => ({ heldWhole: true }), TERMINUS_CITY_ID);
    expect(open.map((district) => district.id)).toEqual(CONTESTED.map((district) => district.id));
    // The four plots are somebody's home and post nothing, the same as Ashfall's.
    expect(open.every((district) => district.kind === 'contested')).toBe(true);
  });

  it('leaves the default city answering exactly what it always did', () => {
    const open = openAreas(() => ({ heldWhole: true }));
    expect(open.map((district) => district.id)).toEqual(
      CITY_DISTRICTS.filter((district) => areaIsOpen(district, { heldWhole: true })).map(
        (district) => district.id,
      ),
    );
  });

  /** A city the world does not have is an empty board rather than a throw or a default. */
  it('answers nothing for a city that does not exist', () => {
    expect(openAreas(() => ({ heldWhole: true }), 'no-such-city')).toEqual([]);
  });
});

/**
 * Neither the Yards nor the Blockhouse pays on a mission clock any more: the Blockhouse is a level
 * of ANTI-COMBINE (2026-10-07) and the Yards make Heavies stronger (maintainer, 2026-10-09; they
 * paid 12 on `mission_speed` until then). Pinned so a board that still quoted the old speed would
 * fail here rather than on a player's clock.
 */
describe('the Yards and the Blockhouse on a mission clock', () => {
  it('pays neither on the job: the Yards build Heavies and the Blockhouse is ANTI-COMBINE', () => {
    expect(unifiedBonusFor('marshalling-yards')?.bonus).toEqual({
      kind: 'tier_strength',
      tier: 'heavy',
      percent: 10,
    });
    expect(unifiedBonusFor('blockhouse')?.bonus.kind).toBe('anti_combine');
    const speedPayers = TERMINUS.filter(
      (district) => unifiedBonusFor(district.id)?.bonus.kind === 'mission_speed',
    );
    expect(speedPayers).toEqual([]);
    // The channel itself still bends under its ceiling for whatever pays it.
    expect(hastenedMinutes(240, 25)).toBeLessThan(240);
    expect(MISSION_SPEED_CEILING).toBeGreaterThan(25);
  });
});

/**
 * Coldwater Halt held whole pays more on every job worked in Terminus (maintainer, 2026-10-09).
 * The scope is the city the job is worked in; the misc board has no address, so it counts as the
 * crew's own city.
 */
describe('pay scoped to one city', () => {
  const byCity = { [TERMINUS_CITY_ID]: 5 };
  const terminusHome = 'carriage';
  const ashfallHome = CITY_DISTRICTS.find((district) => !isContested(district))!.id;

  it('is the Halt`s unified bonus, five per cent on jobs in its city', () => {
    expect(unifiedBonusFor('coldwater-halt')?.bonus).toEqual({
      kind: 'mission_spoils',
      percent: 5,
      inCity: true,
    });
  });

  it('pays on every Terminus board and on the misc board of a crew living there', () => {
    expect(cityOf(terminusHome)).toBe(TERMINUS_CITY_ID);
    expect(missionCityOf(terminusHome, MISC_AREA_ID)).toBe(TERMINUS_CITY_ID);
    expect(missionCityPercentIn(byCity, terminusHome, MISC_AREA_ID)).toBe(5);
    for (const district of CONTESTED) {
      expect(missionCityPercentIn(byCity, terminusHome, district.id), district.id).toBe(5);
    }
  });

  it('pays nothing on work in another city', () => {
    expect(cityOf(ashfallHome)).toBe(DEFAULT_CITY_ID);
    expect(missionCityPercentIn(byCity, ashfallHome, MISC_AREA_ID)).toBe(0);
    const ashfallBoard = CITY_DISTRICTS.find(isContested)!.id;
    expect(missionCityPercentIn(byCity, terminusHome, ashfallBoard)).toBe(0);
    expect(missionCityPercentIn({}, terminusHome, MISC_AREA_ID)).toBe(0);
  });
});
