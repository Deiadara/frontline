import { describe, expect, it } from 'vitest';
import {
  MISC_AREA_ID,
  areaDifficulty,
  areaIsOpen,
  areaPayPercent,
  areasOffering,
  missionBoardKey,
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

  it('opens Terminus districts for a crew standing in Terminus', () => {
    const open = openAreas(() => ({ heldByCrew: 1 }), TERMINUS_CITY_ID);
    expect(open.map((district) => district.id)).toEqual(CONTESTED.map((district) => district.id));
    // The four plots are somebody's home and post nothing, the same as Ashfall's.
    expect(open.every((district) => district.kind === 'contested')).toBe(true);
  });

  it('leaves the default city answering exactly what it always did', () => {
    const open = openAreas(() => ({ heldByCrew: 1 }));
    expect(open.map((district) => district.id)).toEqual(
      CITY_DISTRICTS.filter((district) => areaIsOpen(district, { heldByCrew: 1 })).map(
        (district) => district.id,
      ),
    );
  });

  /** A city the world does not have is an empty board rather than a throw or a default. */
  it('answers nothing for a city that does not exist', () => {
    expect(openAreas(() => ({ heldByCrew: 1 }), 'no-such-city')).toEqual([]);
  });
});

/**
 * The two Terminus districts that pay mission speed (maintainer, 2026-09-24).
 *
 * `mission_speed` is a divisor channel: the job leg is `minutes / (1 + percent/100)`, the percent
 * bent under its ceiling (`missionSpeedCut`). The Yards pay 12 and the Blockhouse 25, and the rule the atlas
 * enforces is that a unified bonus may not repeat a kind found *inside its own district*, so two
 * districts paying the same kind is allowed and intended. What this checks is that the two add up
 * and that the total is nowhere near the clamp, because a pair that silently capped would make the
 * second district worth nothing.
 */
describe('holding both ends of the line', () => {
  const speedOf = (districtId: string): number => {
    const bonus = unifiedBonusFor(districtId)?.bonus;
    return bonus?.kind === 'mission_speed' ? bonus.percent : 0;
  };

  it('pays both districts, and the pair is still under the ceiling', () => {
    const yards = speedOf('marshalling-yards');
    const blockhouse = speedOf('blockhouse');
    expect(yards).toBe(12);
    expect(blockhouse).toBe(25);
    expect(yards + blockhouse).toBeLessThan(MISSION_SPEED_CEILING);
  });

  it('takes more off the clock for both than for either alone', () => {
    const yards = speedOf('marshalling-yards');
    const blockhouse = speedOf('blockhouse');
    const job = 240;
    const both = hastenedMinutes(job, yards + blockhouse);
    expect(both).toBeLessThan(hastenedMinutes(job, blockhouse));
    expect(hastenedMinutes(job, blockhouse)).toBeLessThan(hastenedMinutes(job, yards));
    expect(both).toBeGreaterThan(hastenedMinutes(job, 1_000));
  });
});
