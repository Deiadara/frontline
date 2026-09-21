import { describe, expect, it } from 'vitest';
import {
  BASE_CONCURRENT_MISSIONS,
  MISC_AREA_ID,
  MISC_BOARD_ROTATION_MINUTES,
  MISSIONS_PER_AREA,
  FAILED_MISSION_XP_SHARE,
  MIN_SCALED_SUCCESS,
  areaIsOpen,
  areasOffering,
  areaPayPercent,
  carriedHome,
  concurrentMissionSlots,
  launchableBoardKeys,
  levelPayPercent,
  missionCarry,
  missionXp,
  missionForceRefusal,
  missionBoardDay,
  missionBoardKey,
  missionOffers,
  openAreas,
  payoutSlots,
  scaledSpoils,
  scaledSuccessChance,
} from './missions.areas.js';
import { CITY_DISTRICTS } from './city/index.js';
import { MISSION_TEMPLATES, missionRewards } from './missions.js';
import { RESOURCE_KG, lootCapacityOf } from './raid.js';
import { RESOURCE_KEYS } from './resources.js';
import { findUnit } from './units/index.js';
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
   * And from any starting day, not just from the one this file happens to name.
   *
   * The test above starts on 2026-01-01 and covers the whole catalogue in three days, so it says
   * very little about the walk: a job reachable only in January would sail through it. This asks
   * the property a player actually has, which is that whenever they start playing, every job in
   * the game turns up on a board in front of them soon.
   *
   * Three weeks rather than the fortnight above because the measured worst window is twelve days
   * and the margin is the point: a catalogue that grows past the walk's ability to circulate it
   * fails here first, while the entries are still content nobody has built a system on.
   */
  it('reaches every job from every starting day of a year', () => {
    const WINDOW = 21;
    const dayAt = (index: number) => missionBoardDay(new Date(Date.UTC(2026, 0, 1 + index)));

    for (let start = 0; start < 365; start += 1) {
      const seen = new Set<string>();
      for (let day = start; day < start + WINDOW; day += 1) {
        for (const areaId of AREAS) {
          for (const template of missionOffers(areaId, dayAt(day))) seen.add(template.id);
        }
      }
      const unreachable = MISSION_TEMPLATES.filter((template) => !seen.has(template.id));
      expect(
        unreachable.map((template) => template.id),
        `no board offered these in the ${WINDOW} days from ${dayAt(start)}`,
      ).toEqual([]);
    }
  });

  /**
   * Every day has an easy job and a hard job somewhere in the city.
   *
   * Not a content nicety: it is the property the server's test fixtures stand on. Those tests used
   * to name a template outright, and because the boards turn over daily a named id is a fixture
   * with a hidden expiry date. Measured over these two years, `scrap-run` is on no board on 19% of
   * days, `convoy-ambush` 15% and `deep-expedition` 24%, so the suite was red about one day in
   * four for a reason nobody had changed. They ask the maintainer for a job of the kind they need now,
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
    expect(areasOffering('a-job-that-was-retired', new Date())).toEqual([]);
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
  const contested = CITY_DISTRICTS.find((d) => d.kind === 'contested')!;
  const residential = CITY_DISTRICTS.find((d) => d.kind === 'residential')!;

  it('needs a scout, and closes once one party holds the whole thing', () => {
    expect(areaIsOpen(contested, { scouted: false, heldWhole: false })).toBe(false);
    expect(areaIsOpen(contested, { scouted: true, heldWhole: true })).toBe(false);
    expect(areaIsOpen(contested, { scouted: true, heldWhole: false })).toBe(true);
  });

  /**
   * A residential district is somebody's plot (maintainer, 2026-09-21).
   *
   * The four of them hold no capturable locations at all, which `districts.ts` guards at module
   * load, so `heldWhole` can never be true of one and the scout is the only other condition: with
   * the kind unchecked, every scouted plot in the city posted three jobs a day.
   */
  it('never offers work on a plot, however open it looks', () => {
    expect(residential.locations).toHaveLength(0);
    expect(areaIsOpen(residential, { scouted: true, heldWhole: false })).toBe(false);
  });

  it('lists open contested districts in map order, and no plots', () => {
    const open = openAreas((district) => ({
      scouted: district.difficulty <= 3,
      heldWhole: false,
    }));
    expect(open.length).toBeGreaterThan(0);
    expect(open.map((d) => d.id)).toEqual(
      CITY_DISTRICTS.filter((d) => d.kind === 'contested' && d.difficulty <= 3).map((d) => d.id),
    );
    expect(open.every((d) => d.kind === 'contested')).toBe(true);
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

  it('adds up what a crew can carry, off the same sheets a raid reads', () => {
    expect(missionCarry({})).toBe(0);
    /*
     * The sheet, and the two doors agreeing on it.
     *
     * This used to assert the Scavengers carried *more* than their printed ten, because the
     * `picker` mark put a flat load on top. The mark was removed on 2026-09-19 and a Scavenger
     * now carries exactly what its sheet says. What the test is still for is the seam the 2026-09-16
     * bug was in: the job path read 30 for three of them while the raid path read 66 off the
     * same sheets, and the fix was to make one function answer both.
     */
    expect(missionCarry({ scavengers: 3 })).toBe(lootCapacityOf({ scavengers: 3 }));
    expect(missionCarry({ scavengers: 3 })).toBe(
      3 * (findUnit('scavengers')?.stats.lootCapacity ?? 0),
    );
    expect(missionCarry({ scavengers: 1 })).toBeLessThan(missionCarry({ haulers: 1 }));
  });

  /**
   * The bag a card promises on the roster is the bag the job honours.
   *
   * Three cards in `units/modifications.ts` move `lootCapacity`, so a force is read at its fitted
   * sheet. Bolted to the Scavengers it moves their carry and nobody else's; an id the catalogue
   * does not know pays nothing; and with no loadouts passed the figure is the printed one.
   */
  it('reads the bag off the fitted sheet, for the unit it is fitted to', () => {
    const printed = missionCarry({ scavengers: 3, haulers: 2 });
    const hooked = missionCarry(
      { scavengers: 3, haulers: 2 },
      { scavengers: ['hook_and_line', null, null] },
    );
    expect(hooked).toBe(printed + 3 * 12);
    expect(missionCarry({ haulers: 2 }, { scavengers: ['hook_and_line'] })).toBe(
      missionCarry({ haulers: 2 }),
    );
    expect(missionCarry({ scavengers: 3 }, { scavengers: ['armour_1'] })).toBe(
      missionCarry({ scavengers: 3 }),
    );
  });

  /**
   * The job and the raid carry the same bag, which is what this function's own doc always claimed.
   *
   * It was a second arithmetic: the fitted sheet was ignored and the crew's `lootCapacityPercent`
   * (the Pawn Shop, the raid modifications, `sig_scavenger_king`) was ignored, so a Scavenger
   * carried one figure on a raid and another on a job off the same sheet and the Pawn Shop was
   * worth nothing at all to a crew that ran jobs.
   *
   * The `picker` mark was the third thing it used to miss. It was removed from the game on
   * 2026-09-19, so what is left to agree on is the sheet, the refits and the crew's bag.
   */
  it('carries exactly what a raid carries, refits and crew bag included', () => {
    const force = { scavengers: 3, haulers: 2 };
    expect(missionCarry(force)).toBe(lootCapacityOf(force));

    // The sheet and nothing but: no flat load rides on top of it any more.
    expect(missionCarry({ scavengers: 3 })).toBe(
      3 * (findUnit('scavengers')?.stats.lootCapacity ?? 0),
    );

    // ...the workshop's bag, which both doors read off the fitted sheet.
    expect(missionCarry({ haulers: 2 }, { haulers: ['counterweight_harness'] })).toBeGreaterThan(
      missionCarry({ haulers: 2 }),
    );

    // ...and the crew's own bag on top of the base, the same way a raid spends it.
    expect(missionCarry(force, {}, 50)).toBeGreaterThan(missionCarry(force));
    expect(missionCarry(force, {}, 50)).toBe(lootCapacityOf(force, 50));
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

  /**
   * And it fills the bag, rather than flooring every line and walking home with slack in it.
   *
   * The trim used to be a proportional floor and nothing else, which left the remainders on the
   * floor: 2.4 slots on an average trim across the board, nine on the Deep Expedition. At the
   * bottom it was worse than untidy. A crew with one slot free and seventeen scrap on offer
   * carried `floor(17 * 1/32) = 0` and came home with an empty bag, having walked to the edge of
   * the map for it.
   */
  it('fills the last slots instead of flooring them away', () => {
    const payout = { scrap: 17, planks: 13, caps: 2 };

    // One slot, one unit of something that fits in it. Never an empty bag.
    expect(payoutSlots(carriedHome(payout, 1, RESOURCE_KG), RESOURCE_KG)).toBe(1);

    // And an exact fill wherever the weights allow one.
    for (const room of [2, 5, 10, 20, 31]) {
      const carried = carriedHome(payout, room, RESOURCE_KG);
      expect(payoutSlots(carried, RESOURCE_KG), `room ${room}`).toBe(room);
    }
  });

  /** Filling it must not invent anything, nor overload the crew. */
  it('never carries more of a line than was on offer, nor more than the bags hold', () => {
    const payout = { scrap: 9, highQualityMetal: 4, supplies: 3 };
    const needed = payoutSlots(payout, RESOURCE_KG);
    for (let room = 0; room <= needed + 5; room += 1) {
      const carried = carriedHome(payout, room, RESOURCE_KG);
      expect(payoutSlots(carried, RESOURCE_KG), `room ${room}`).toBeLessThanOrEqual(
        Math.min(room, needed),
      );
      for (const [key, amount] of Object.entries(carried)) {
        expect(amount, `${key} at room ${room}`).toBeLessThanOrEqual(
          payout[key as keyof typeof payout] ?? 0,
        );
      }
    }
  });

  /**
   * The only slots left empty are ones nothing fits in.
   *
   * A crew can finish with room and still leave something: when every line that is left weighs
   * more than the gap, the last bar of good metal stays on the ground. What must not happen is
   * room going spare while a one-slot line is still on offer.
   */
  it('leaves a slot empty only when nothing on offer fits in it', () => {
    for (const template of MISSION_TEMPLATES) {
      const payout = missionRewards(template, 'success');
      const needed = payoutSlots(payout, RESOURCE_KG);
      if (needed <= 1) continue;
      for (const fraction of [0.25, 0.5, 0.75, 0.95]) {
        const room = Math.floor(needed * fraction);
        const carried = carriedHome(payout, room, RESOURCE_KG);
        const spare = room - payoutSlots(carried, RESOURCE_KG);
        const couldStillFit = RESOURCE_KEYS.some(
          (key) => (payout[key] ?? 0) > (carried[key] ?? 0) && RESOURCE_KG[key] <= spare,
        );
        expect(couldStillFit, `${template.id} at ${room} slots left ${spare} spare`).toBe(false);
      }
    }
  });
});

/**
 * §E4: the misc board turns over hourly, and the districts do not (maintainer, 2026-09-19).
 *
 * "Make the misc missions be a big pool, not the same over and over, and different ones are
 * chosen each time."
 *
 * The pool was never small: thirty-eight templates, and the pick already walked it from a seeded
 * start. What made it feel like the same three every time is that the key was the *day*, so a
 * player who opened the page five times in an evening saw one board five times. The districts
 * keep that on purpose, because a district's board is a fact about ground somebody scouted and
 * came back for; `misc` is the board with no address, always open, and its whole job is to be
 * the thing there is always something new on.
 */
describe('how often a board turns over', () => {
  const at = (iso: string) => new Date(iso);

  it('gives misc a fresh key every hour and a district the same key all day', () => {
    const morning = at('2026-09-19T08:00:00.000Z');
    const later = at('2026-09-19T11:00:00.000Z');
    const district = CITY_DISTRICTS[0]?.id;
    if (!district) throw new Error('the map has no districts');

    expect(missionBoardKey(MISC_AREA_ID, morning)).not.toBe(missionBoardKey(MISC_AREA_ID, later));
    expect(missionBoardKey(district, morning)).toBe(missionBoardKey(district, later));
    // ...and a district's key is still exactly the day it always was, so nothing that reads one
    // has quietly changed meaning.
    expect(missionBoardKey(district, morning)).toBe(missionBoardDay(morning));
  });

  it('is stable inside one slot, so two players see the same three', () => {
    const early = at('2026-09-19T08:00:10.000Z');
    const late = at('2026-09-19T08:59:50.000Z');
    expect(missionBoardKey(MISC_AREA_ID, early)).toBe(missionBoardKey(MISC_AREA_ID, late));
  });

  it('actually puts different jobs up, rather than a new key on one board', () => {
    const start = at('2026-09-19T00:00:00.000Z').getTime();
    const boards = Array.from({ length: 12 }, (_, hour) => {
      const when = new Date(start + hour * 60 * 60 * 1000);
      return missionOffers(MISC_AREA_ID, missionBoardKey(MISC_AREA_ID, when))
        .map((offer) => offer.id)
        .join(',');
    });
    // Not a claim that every hour differs from the last, which a hash cannot promise: a claim
    // that half a day is not one board over and over, which is what was being complained about.
    expect(new Set(boards).size).toBeGreaterThan(8);
  });

  it('lets a job be launched one slot after it was read, and not two', () => {
    const now = at('2026-09-19T08:30:00.000Z');
    const keys = launchableBoardKeys(MISC_AREA_ID, now);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(missionBoardKey(MISC_AREA_ID, now));
    expect(keys[1]).toBe(
      missionBoardKey(MISC_AREA_ID, new Date(now.getTime() - MISC_BOARD_ROTATION_MINUTES * 60_000)),
    );
    // A district has one board and one key: a day-old card is a day out of date.
    const district = CITY_DISTRICTS[0]?.id;
    if (!district) throw new Error('the map has no districts');
    expect(launchableBoardKeys(district, now)).toEqual([missionBoardKey(district, now)]);
  });
});
