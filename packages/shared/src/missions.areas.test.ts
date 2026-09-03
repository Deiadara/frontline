import { describe, expect, it } from 'vitest';
import {
  BASE_CONCURRENT_MISSIONS,
  MISC_AREA_ID,
  MISSIONS_PER_AREA,
  FAILED_MISSION_XP_SHARE,
  MIN_SCALED_SUCCESS,
  areaIsOpen,
  areasOffering,
  areaPayPercent,
  carriedHome,
  concurrentMissionSlots,
  levelPayPercent,
  missionCarry,
  missionXp,
  missionForceRefusal,
  missionBoardDay,
  missionOffers,
  openAreas,
  payoutSlots,
  scaledSpoils,
  scaledSuccessChance,
} from './missions.areas.js';
import { CITY_DISTRICTS } from './city/index.js';
import { MISSION_TEMPLATES } from './missions.js';
import { RESOURCE_KG } from './raid.js';
import { MILESTONE_THIRD_CREW, playerUnlocksBetween } from './progression/index.js';

const AREAS = [MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)];

describe('the boards work comes off (§E)', () => {
  it('offers three jobs in every area, including the one that is always open', () => {
    for (const areaId of AREAS) {
      expect(missionOffers(areaId), areaId).toHaveLength(MISSIONS_PER_AREA);
    }
  });

  /**
   * The board's own rule: one battle and two standard, or two battle and one standard. Never
   * three of a kind either way, which is what makes a board readable by a crew with an army and
   * by one without.
   */
  it('always mixes the kinds: one or two fights, never none and never three', () => {
    for (const areaId of AREAS) {
      const battles = missionOffers(areaId).filter((t) => t.kind === 'battle').length;
      expect(battles, areaId).toBeGreaterThanOrEqual(1);
      expect(battles, areaId).toBeLessThanOrEqual(2);
    }
  });

  /** And both mixes actually turn up: a coin that always lands the same way is not a coin. */
  it('flips between the two mixes across the city', () => {
    const shapes = new Set(
      AREAS.map((areaId) => missionOffers(areaId).filter((t) => t.kind === 'battle').length),
    );
    expect(shapes).toEqual(new Set([1, 2]));
  });

  it('never offers the same job twice in one area', () => {
    for (const areaId of AREAS) {
      const ids = missionOffers(areaId).map((template) => template.id);
      expect(new Set(ids).size, areaId).toBe(ids.length);
    }
  });

  it('is a pure function of the area: the same three, every time it is asked', () => {
    for (const areaId of AREAS) {
      expect(missionOffers(areaId).map((t) => t.id)).toEqual(
        missionOffers(areaId).map((t) => t.id),
      );
    }
  });

  /**
   * A board that offered every district the same three jobs would make the arrows decoration.
   * Measured across the whole map rather than pairwise: what matters is that the city as a whole
   * offers variety, not that any two neighbours differ.
   */
  it('does not give every area the same three jobs', () => {
    const shapes = new Set(
      AREAS.map((areaId) =>
        missionOffers(areaId)
          .map((t) => t.id)
          .join(),
      ),
    );
    expect(shapes.size).toBeGreaterThan(AREAS.length / 2);
  });
});

describe('finding a board a job is on', () => {
  /**
   * Every job in the catalogue reaches a board inside a fortnight, or it is content nobody can
   * ever take.
   *
   * The pool is larger than the city's fifty-nine slots on purpose, so this cannot be true on
   * any one day; the daily turnover is what makes it true over time, and this is the check that
   * says the walk actually circulates rather than favouring the same third of the list.
   */
  it('puts every job in the catalogue on a board within a fortnight', () => {
    const seen = new Set<string>();
    for (let day = 0; day < 14; day += 1) {
      const key = missionBoardDay(new Date(Date.UTC(2026, 0, 1) + day * 86_400_000));
      for (const areaId of AREAS) {
        for (const template of missionOffers(areaId, key)) seen.add(template.id);
      }
    }
    for (const template of MISSION_TEMPLATES) {
      expect(seen.has(template.id), template.id).toBe(true);
    }
  });

  /**
   * Every day has an easy job and a hard job somewhere in the city.
   *
   * Not a content nicety: it is the property the server's test fixtures stand on. Those tests used
   * to name a template outright, and because the boards turn over daily a named id is a fixture
   * with a hidden expiry date. Measured over these two years, `scrap-run` is on no board on 19% of
   * days, `convoy-ambush` 15% and `deep-expedition` 24%, so the suite was red about one day in
   * four for a reason nobody had changed. They ask the board for a job of the kind they need now,
   * and this is the check that the board can always answer.
   *
   * It is also a player-facing rule in its own right. A day whose whole city offered only fights
   * would be a day a crew with no army could not play, and one offering only errands would be a
   * day an army had nothing to do.
   */
  it('always has an easy job and a hard job open somewhere, on every day of two years', () => {
    const start = Date.UTC(2026, 0, 1);
    for (let index = 0; index < 730; index += 1) {
      const day = missionBoardDay(new Date(start + index * 86_400_000));
      const open = AREAS.flatMap((areaId) => missionOffers(areaId, day));
      expect(open.length, day).toBeGreaterThan(0);
      expect(
        open.some((template) => template.difficulty === 'easy'),
        `no easy job anywhere on ${day}`,
      ).toBe(true);
      expect(
        open.some((template) => template.difficulty === 'hard'),
        `no hard job anywhere on ${day}`,
      ).toBe(true);
    }
  });

  it('turns the board over at Athens midnight, and not before', () => {
    // August, so Athens is GMT+3 and the board turns at 21:00 UTC.
    const monday = missionBoardDay(new Date('2026-08-24T20:59:00.000Z'));
    const alsoMonday = missionBoardDay(new Date('2026-08-24T05:00:00.000Z'));
    const tuesday = missionBoardDay(new Date('2026-08-24T21:00:00.000Z'));
    expect(monday).toBe('2026-08-24');
    expect(tuesday).toBe('2026-08-25');
    expect(monday).toBe(alsoMonday);
    const ids = (day: string) =>
      missionOffers(MISC_AREA_ID, day)
        .map((t) => t.id)
        .join();
    expect(ids(monday)).toBe(ids(alsoMonday));
    expect(ids(tuesday)).not.toBe(ids(monday));
  });

  it('says nothing at all for a job that is not in the catalogue', () => {
    expect(areasOffering('a-job-that-was-retired')).toEqual([]);
  });
});

describe('what an area pays (§A4)', () => {
  it('pays least on the board that is always open', () => {
    expect(areaPayPercent(MISC_AREA_ID)).toBe(0);
  });

  it('pays more the harder the ground', () => {
    const easiest = [...CITY_DISTRICTS].sort((a, b) => a.difficulty - b.difficulty)[0]!;
    const hardest = [...CITY_DISTRICTS].sort((a, b) => b.difficulty - a.difficulty)[0]!;
    expect(areaPayPercent(hardest.id)).toBeGreaterThan(areaPayPercent(easiest.id));
  });

  it('scales a bundle by the premium and keeps it in whole units', () => {
    const paid = scaledSpoils({ scrap: 40, caps: 5 }, 50);
    expect(paid.scrap).toBe(60);
    expect(paid.caps).toBe(8);
    // A line that rounds away is dropped rather than paid as a zero.
    expect(scaledSpoils({ scrap: 0 }, 50).scrap).toBeUndefined();
  });

  it('leaves an unknown area at the bottom of the scale rather than throwing', () => {
    expect(areaPayPercent('a-district-that-was-renamed')).toBe(0);
  });
});

describe("what the crew's own level does to a job (§I, §E5)", () => {
  const template = MISSION_TEMPLATES[0]!;

  it('pays nothing extra at level one, and more at every level after', () => {
    expect(levelPayPercent(1)).toBe(0);
    expect(levelPayPercent(2)).toBeGreaterThan(0);
    expect(levelPayPercent(20)).toBeGreaterThan(levelPayPercent(10));
  });

  it('asks more of a higher-level crew, and never turns a job into a coin flip', () => {
    expect(scaledSuccessChance(0.9, 1)).toBe(0.9);
    expect(scaledSuccessChance(0.9, 30)).toBeLessThan(0.9);
    expect(scaledSuccessChance(0.7, 500)).toBe(MIN_SCALED_SUCCESS);
    expect(scaledSuccessChance(0.9, 1)).toBeLessThanOrEqual(1);
  });

  /** Both halves move together, or levelling is either a shortcut or a punishment. */
  it('moves pay and difficulty in step', () => {
    const early = { pay: levelPayPercent(1), odds: scaledSuccessChance(0.9, 1) };
    const late = { pay: levelPayPercent(40), odds: scaledSuccessChance(0.9, 40) };
    expect(late.pay).toBeGreaterThan(early.pay);
    expect(late.odds).toBeLessThan(early.odds);
  });

  it('pays XP off the clock and the risk, and more of it as the crew levels', () => {
    const short = missionXp(template, 30, 1);
    expect(short).toBeGreaterThan(0);
    expect(missionXp(template, 600, 1)).toBeGreaterThan(short);
    expect(missionXp(template, 30, 30)).toBeGreaterThan(short);
    // A battle of the same length is worth more, because it can come home with nothing.
    const battle = MISSION_TEMPLATES.find((t) => t.kind === 'battle')!;
    expect(missionXp(battle, 60, 1)).toBeGreaterThan(missionXp(template, 60, 1));
  });

  it('pays a fifth of it for a run that came home empty', () => {
    expect(FAILED_MISSION_XP_SHARE).toBeGreaterThan(0);
    expect(FAILED_MISSION_XP_SHARE).toBeLessThan(1);
    expect(Math.round(missionXp(template, 30, 1) * FAILED_MISSION_XP_SHARE)).toBeGreaterThan(0);
  });
});

describe('which areas are open', () => {
  it('needs a scout, and closes once there is nothing left in there to take', () => {
    expect(areaIsOpen({ scouted: false, ownedOutright: false })).toBe(false);
    expect(areaIsOpen({ scouted: true, ownedOutright: true })).toBe(false);
    expect(areaIsOpen({ scouted: true, ownedOutright: false })).toBe(true);
  });

  it('lists open districts in map order', () => {
    const open = openAreas((district) => ({
      scouted: district.difficulty <= 3,
      ownedOutright: false,
    }));
    expect(open.length).toBeGreaterThan(0);
    expect(open.map((d) => d.id)).toEqual(
      CITY_DISTRICTS.filter((d) => d.difficulty <= 3).map((d) => d.id),
    );
  });
});

describe('how many crews can be out (§E, §I3)', () => {
  it('starts at two and does not move until the milestone', () => {
    expect(concurrentMissionSlots(1)).toBe(BASE_CONCURRENT_MISSIONS);
    expect(concurrentMissionSlots(79)).toBe(BASE_CONCURRENT_MISSIONS);
  });

  it('lifts to three at the level the milestone says, and says so on the way past', () => {
    expect(concurrentMissionSlots(80)).toBe(BASE_CONCURRENT_MISSIONS + 1);
    const crossed = playerUnlocksBetween(79, 80).map((unlock) => unlock.id);
    expect(crossed).toContain(MILESTONE_THIRD_CREW);
  });
});

describe('who goes, and what they can carry (§A5, §E)', () => {
  it('refuses an empty crew and one the roster cannot cover', () => {
    expect(missionForceRefusal({}, { razors: 5 }, 'standard')).toBe('no_force');
    expect(missionForceRefusal({ razors: 6 }, { razors: 5 }, 'standard')).toBe('not_enough_units');
    expect(missionForceRefusal({ razors: 5 }, { razors: 5 }, 'standard')).toBeNull();
  });

  /** The support tier's whole shape: they may carry on any job, and fight on none. */
  it('lets porters run a standard job alone and never a battle alone', () => {
    const porters = { scavengers: 4 };
    const roster = { scavengers: 4, razors: 2 };
    expect(missionForceRefusal(porters, roster, 'standard')).toBeNull();
    expect(missionForceRefusal(porters, roster, 'battle')).toBe('needs_fighters');
    expect(missionForceRefusal({ ...porters, razors: 1 }, roster, 'battle')).toBeNull();
  });

  it('adds up what a crew can carry, and pays a Scavenger for being a Scavenger', () => {
    expect(missionCarry({})).toBe(0);
    expect(missionCarry({ scavengers: 3 })).toBe(30);
    expect(missionCarry({ scavengers: 1 })).toBeLessThan(missionCarry({ haulers: 1 }));
  });

  it('brings the whole payout home when the crew can lift it', () => {
    const payout = { scrap: 40, caps: 10 };
    expect(carriedHome(payout, 1000, RESOURCE_KG)).toEqual(payout);
  });

  /**
   * And trims it proportionally when they cannot. This is the one thing that makes the support
   * tier worth training rather than a curiosity: two Razors bring back a quarter of what six
   * Scavengers do off the same job.
   */
  it('trims a payout the crew cannot lift, across every line rather than the awkward ones', () => {
    const payout = { scrap: 100, highQualityMetal: 20 };
    const needed = payoutSlots(payout, RESOURCE_KG);
    const carried = carriedHome(payout, Math.floor(needed / 2), RESOURCE_KG);
    expect(payoutSlots(carried, RESOURCE_KG)).toBeLessThanOrEqual(Math.floor(needed / 2));
    expect(carried.scrap).toBeGreaterThan(0);
    expect(carried.highQualityMetal).toBeGreaterThan(0);
    expect(carried.scrap).toBeLessThan(100);
  });

  it('leaves nothing behind for a crew with no bags at all', () => {
    expect(carriedHome({ scrap: 100 }, 0, RESOURCE_KG)).toEqual({});
  });
});
