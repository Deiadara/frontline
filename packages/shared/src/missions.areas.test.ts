import { describe, expect, it } from 'vitest';
import {
  FIGHTS_PER_AREA,
  BASE_CONCURRENT_MISSIONS,
  MISC_AREA_ID,
  MISC_BOARD_ROTATION_MINUTES,
  MISSIONS_PER_AREA,
  FAILED_MISSION_XP_SHARE,
  areaIsOpen,
  areasOffering,
  areaPayPercent,
  carriedHome,
  concurrentMissionSlots,
  launchableBoardKeys,
  missionCarry,
  missionXp,
  missionForceRefusal,
  missionBoardDay,
  missionBoardKey,
  missionDealer,
  missionOffers,
  openAreas,
  payoutSlots,
  scaledSpoils,
  missionWalkMinutes,
} from './missions.areas.js';
import {
  ALL_DISTRICTS,
  CITY_DISTRICTS,
  INTER_CITY_MINUTES,
  TERMINUS_CITY_ID,
  districtsOfCity,
  isContested,
  rawMinutesBetween,
  type District,
} from './city/index.js';
import { MISSION_TEMPLATES, missionRewards } from './missions.js';
import { GRADES, gradeIndex, gradePeakLevel } from './missions.grade.js';
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
   * The board's own rule (maintainer, 2026-09-23): one fight and two plain jobs, every board.
   * Never three of a kind, which is what makes a board readable by a crew with an army and by
   * one without, and never two fights either, which is what the coin used to deal.
   */
  it('deals exactly one fight and two plain jobs on every board', () => {
    for (const areaId of AREAS) {
      const offers = missionOffers(areaId);
      expect(offers, areaId).toHaveLength(MISSIONS_PER_AREA);
      expect(offers.filter((job) => job.template.kind === 'battle').length, areaId).toBe(
        FIGHTS_PER_AREA,
      );
      expect(FIGHTS_PER_AREA).toBe(1);
    }
  });

  it('never offers the same job twice in one area', () => {
    for (const areaId of AREAS) {
      const ids = missionOffers(areaId).map((job) => job.template.id);
      expect(new Set(ids).size, areaId).toBe(ids.length);
    }
  });

  it('is a pure function of the area: the same three, every time it is asked', () => {
    for (const areaId of AREAS) {
      expect(missionOffers(areaId)).toEqual(missionOffers(areaId));
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
          .map((job) => job.template.id)
          .join(),
      ),
    );
    expect(shapes.size).toBeGreaterThan(AREAS.length / 2);
  });
});

describe('finding a board a job is on', () => {
  /**
   * Every job circulates, for a crew at the level its grades are dealt (2026-09-28), or it is
   * content nobody can ever take.
   *
   * Asked per level rather than for the city as a whole, because boards are a crew's own now: a
   * Mayhem job is never on a level-one crew's board and is not meant to be. Each job is asked at
   * the level where the middle of its range is dealt most. Two claims, because with three hundred
   * jobs "every one inside a fixed window from every start" is a claim about luck: every job turns
   * up several times a year, and from any starting day almost all of them turn up within four
   * weeks.
   */
  it('circulates every job through a year, and nearly all of them inside four weeks', () => {
    const WINDOW = 28;
    const dayAt = (index: number) => missionBoardDay(new Date(Date.UTC(2026, 0, 1 + index)));
    const levelFor = (template: (typeof MISSION_TEMPLATES)[number]) => {
      const middle = Math.round(
        (gradeIndex(template.grades[0]) + gradeIndex(template.grades[1])) / 2,
      );
      return gradePeakLevel(GRADES[middle]!);
    };
    const byLevel = new Map<number, (typeof MISSION_TEMPLATES)[number][]>();
    for (const template of MISSION_TEMPLATES) {
      const level = levelFor(template);
      byLevel.set(level, [...(byLevel.get(level) ?? []), template]);
    }
    for (const [level, templates] of byLevel) {
      const daily = Array.from({ length: 365 }, (_, day) => {
        const dealt: string[] = [];
        for (const areaId of AREAS) {
          for (const job of missionOffers(areaId, dayAt(day), level)) dealt.push(job.template.id);
        }
        return dealt;
      });
      const yearly = new Map<string, number>();
      for (const id of daily.flat()) yearly.set(id, (yearly.get(id) ?? 0) + 1);
      for (const template of templates) {
        expect(
          yearly.get(template.id) ?? 0,
          `${template.id} at level ${String(level)}`,
        ).toBeGreaterThanOrEqual(6);
      }
      for (let start = 0; start + WINDOW <= daily.length; start += 1) {
        const seen = new Set(daily.slice(start, start + WINDOW).flat());
        const share =
          templates.filter((template) => seen.has(template.id)).length / templates.length;
        expect(share, `level ${String(level)} from ${dayAt(start)}`).toBeGreaterThan(0.9);
      }
    }
  });

  it('deals a new crew nothing past E- on any day of two years', () => {
    const start = Date.UTC(2026, 0, 1);
    for (let index = 0; index < 730; index += 1) {
      const day = missionBoardDay(new Date(start + index * 86_400_000));
      for (const job of AREAS.flatMap((areaId) => missionOffers(areaId, day, 1))) {
        expect(
          gradeIndex(job.grade),
          `${job.template.id} at ${job.grade} on ${day}`,
        ).toBeLessThanOrEqual(gradeIndex('E-'));
      }
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
        .map((job) => job.template.id)
        .join();
    expect(ids(monday)).toBe(ids(alsoMonday));
    expect(ids(tuesday)).not.toBe(ids(monday));
  });

  it('says nothing at all for a job that is not in the catalogue', () => {
    expect(areasOffering('a-job-that-was-retired', new Date(), 30)).toEqual([]);
  });
});

describe('what an area pays (§A4)', () => {
  it('pays least on the board that is always open', () => {
    expect(areaPayPercent(MISC_AREA_ID)).toBe(0);
  });

  it('pays more the harder the ground', () => {
    const contested = CITY_DISTRICTS.filter(isContested);
    const easiest = [...contested].sort((a, b) => a.difficulty - b.difficulty)[0]!;
    const hardest = [...contested].sort((a, b) => b.difficulty - a.difficulty)[0]!;
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

describe('the XP a job pays (§I1)', () => {
  const template = MISSION_TEMPLATES.find((candidate) => candidate.kind === 'standard')!;

  it('pays off the clock, the risk and the grade, and nothing off who reads the card', () => {
    const short = missionXp(template, 30, 'F-');
    expect(short).toBeGreaterThan(0);
    expect(missionXp(template, 600, 'F-')).toBeGreaterThan(short);
    expect(missionXp(template, 30, 'C')).toBeGreaterThan(short);
    // A battle of the same length is worth more, because it can come home with nothing.
    const battle = MISSION_TEMPLATES.find((t) => t.kind === 'battle')!;
    expect(missionXp(battle, 60, 'F-')).toBeGreaterThan(missionXp(template, 60, 'F-'));
  });

  it('pays a fifth of it for a run that came home empty', () => {
    expect(FAILED_MISSION_XP_SHARE).toBeGreaterThan(0);
    expect(FAILED_MISSION_XP_SHARE).toBeLessThan(1);
    expect(Math.round(missionXp(template, 30, 'F-') * FAILED_MISSION_XP_SHARE)).toBeGreaterThan(0);
  });
});

describe('which areas are open', () => {
  const contested = CITY_DISTRICTS.find((d) => d.kind === 'contested')!;
  const residential = CITY_DISTRICTS.find((d) => d.kind === 'residential')!;

  /**
   * Maintainer, 2026-10-07: "only in districts that you or your faction control entirely".
   *
   * It replaced the foothold rule of 2026-09-29, under which one location opened the board. The
   * rule has no degrees now, which is why {@link AreaAvailability} carries a boolean: a crew
   * holding all but one plot is in the position of a crew holding none.
   */
  it('opens only on the whole district, not on a foothold in it', () => {
    expect(areaIsOpen(contested, { heldWhole: false })).toBe(false);
    expect(areaIsOpen(contested, { heldWhole: true })).toBe(true);
  });

  /**
   * A residential district is somebody's plot (maintainer, 2026-09-21).
   *
   * The four of them hold no capturable locations at all, which `districts.ts` guards at module
   * load, so a crew can never hold one there; the kind is checked anyway, so a count that arrived
   * wrong could not post three jobs a day on somebody's home.
   */
  it('never offers work on a plot, however open it looks', () => {
    expect(residential.locations).toHaveLength(0);
    expect(areaIsOpen(residential, { heldWhole: true })).toBe(false);
  });

  /*
   * Maintainer, 2026-09-29: a city that is not open has no work in it, whatever is held there.
   * No shut city has ground since Arca opened (2026-10-07), so one of Arca's districts is moved
   * into shut Redline for the check: the same district is open where it really stands.
   */
  it('never offers work in a city that is not open', () => {
    const ground = ALL_DISTRICTS.find(
      (d) => d.kind === 'contested' && d.cityId === 'arca' && d.locations.length > 0,
    );
    if (!ground) throw new Error('fixture: Arca has no contested ground');
    expect(areaIsOpen(ground, { heldWhole: true })).toBe(true);
    expect(areaIsOpen({ ...ground, cityId: 'redline' }, { heldWhole: true })).toBe(false);
  });

  it('lists open contested districts in map order, and no plots', () => {
    const soft = (district: District) => isContested(district) && district.difficulty <= 3;
    const open = openAreas((district) => ({ heldWhole: soft(district) }));
    expect(open.length).toBeGreaterThan(0);
    expect(open.map((d) => d.id)).toEqual(CITY_DISTRICTS.filter(soft).map((d) => d.id));
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

  /**
   * ...unless the crew has put them in the line (bug pass, 2026-09-29). Under `carriers_fight` a
   * porter fights at its full sheet, the declared-battle door already sends one, and the settle
   * fights them on a job too; the job's door was the one still asking `isCombatUnit`.
   */
  it('lets porters take a fight alone once the crew fields them (`carriers_fight`)', () => {
    const porters = { haulers: 12 };
    const roster = { haulers: 12 };
    const fielded = { carriersFight: true, unitMarks: {} };
    expect(missionForceRefusal(porters, roster, 'battle', fielded)).toBeNull();
    expect(missionForceRefusal(porters, roster, 'battle')).toBe('needs_fighters');
    // It only opens the fighter gate: the roster still has to cover the party.
    expect(missionForceRefusal({ haulers: 13 }, roster, 'battle', fielded)).toBe(
      'not_enough_units',
    );
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
   * tier worth mustering rather than a curiosity: two Razors bring back a quarter of what six
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
 * keep that on purpose, because a district's board is a fact about ground somebody holds and
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
        .map((offer) => offer.template.id)
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

/** "Add the walk" (maintainer, 2026-09-29): a job in another city is the road a move there walks. */
describe('the walk to a job in another city', () => {
  const home = CITY_DISTRICTS[0]!;
  const abroad = districtsOfCity(TERMINUS_CITY_ID)[0]!;

  it('is the cross-city road, which is the flat four hours', () => {
    expect(missionWalkMinutes(home.id, abroad.id)).toBe(
      Math.round(rawMinutesBetween(home, abroad)),
    );
    expect(missionWalkMinutes(home.id, abroad.id)).toBe(INTER_CITY_MINUTES);
  });

  /**
   * The ruling of 2026-10-07 read off the board rather than off `geography.ts`: a job abroad is
   * four hours away whichever district posted it, so the walk cannot be used to shop for the
   * nearest-looking city on the map.
   */
  it('is the same walk to every district in every other city', () => {
    const away = ALL_DISTRICTS.filter((district) => district.cityId !== home.cityId);
    expect(away.length).toBeGreaterThan(8);
    for (const district of away) {
      expect(missionWalkMinutes(home.id, district.id), district.id).toBe(INTER_CITY_MINUTES);
    }
  });

  it('is nothing inside one city and nothing on the misc board', () => {
    for (const district of CITY_DISTRICTS) expect(missionWalkMinutes(home.id, district.id)).toBe(0);
    expect(missionWalkMinutes(home.id, MISC_AREA_ID)).toBe(0);
  });
});

/**
 * A board is a crew's own (maintainer, 2026-10-08: "Missions should be randomized and varied even
 * in the beginning ... I just got the same 3 twice when starting a new game").
 *
 * The deal was seeded by the area, the key and the slot, so every crew in the world and every new
 * game on the same day opened on the same three cards.
 */
describe('whose board it is', () => {
  const cardsOf = (dealer: string, day: string, level = 1) =>
    missionOffers(MISC_AREA_ID, day, level, dealer).map((job) => `${job.template.id}@${job.grade}`);
  const DAYS = Array.from({ length: 30 }, (_, at) => `2026-10-${String(at + 1).padStart(2, '0')}`);
  const differing = (a: string, b: string) =>
    DAYS.filter((day) => cardsOf(a, day).join() !== cardsOf(b, day).join()).length;

  it('deals two crews different boards on the same day, at the very first level', () => {
    const one = missionDealer({ id: 'crew-a', createdAt: '2026-10-08T10:00:00.000Z' });
    const two = missionDealer({ id: 'crew-b', createdAt: '2026-10-08T10:00:00.000Z' });
    // Most days, not every day: two random draws of three can coincide.
    expect(differing(one, two)).toBeGreaterThanOrEqual(25);
  });

  it('deals a new game a new board, though the crew keeps its id', () => {
    const before = missionDealer({ id: 'crew-a', createdAt: '2026-10-08T10:00:00.000Z' });
    const after = missionDealer({ id: 'crew-a', createdAt: '2026-10-08T10:05:00.000Z' });
    expect(differing(before, after)).toBeGreaterThanOrEqual(25);
  });

  it('keeps one crew’s board the same however often it is read', () => {
    const dealer = missionDealer({ id: 'crew-a', createdAt: '2026-10-08T10:00:00.000Z' });
    for (const day of DAYS) expect(cardsOf(dealer, day)).toEqual(cardsOf(dealer, day));
  });
});
