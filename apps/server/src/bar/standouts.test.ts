import {
  MAX_RECRUITMENT_ATTRIBUTE,
  askingWage,
  seedFrom,
  RECRUIT_MAX_MIN_FACTION_INFAMY,
  RECRUIT_MAX_MIN_INFAMY,
  RECRUIT_MIN_FACTION_INFAMY_GATE,
  RECRUIT_MIN_INFAMY_GATE,
  RECRUIT_MIN_NOTORIETY_GATE,
  RECRUIT_LEGEND_NOTORIETY,
  RECRUIT_MAX_MIN_NOTORIETY,
  assessJoin,
  perksWorth,
  type CrewStanding,
  type JoinRequirement,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import {
  BAR_OPEN_DOOR_FLOOR,
  BAR_ROSTER_SIZE,
  BAR_STANDOUT_SEATS,
  RECRUIT_GRADES,
  STANDOUT_CALIBRE_LIFT,
  STANDOUT_MIN_PERKS,
  barRoster,
  barSeatsFor,
  doorCeilingFor,
  gradeOf,
  isStandoutSeat,
} from './roster.js';

/**
 * §H3, extended: the two seats the good ones sit in (maintainer request, 2026-09-11).
 *
 * The room was eight people off one curve, so the best officer on a given night was the best of
 * eight ordinary rolls. Two seats are standouts now: better sheets, guaranteed perks, and all four
 * doors including the two that are not about the player alone. What is pinned here is the part a
 * player would notice if it broke: that the standouts really are better, that their doors really
 * are shut to a crew that has done nothing, and that none of it moved the room a new crew walks
 * into on their first night.
 */

const DAYS = Array.from({ length: 120 }, (_, index) =>
  new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
);

const NEW_CREW: CrewStanding = { notoriety: 0, level: 1, infamy: 0, factionInfamy: 0 };

/** The sum of a sheet, which is the only summary of "better" that does not pick a favourite. */
const total = (attributes: Record<string, number>): number =>
  Object.values(attributes).reduce((sum, value) => sum + value, 0);

/**
 * The room spreads across skill levels (maintainer request, 2026-09-11).
 *
 * Eight recruits drawn off one curve came out within a few percent of each other, because thirty-
 * five near-independent draws concentrate however wide each one is: measured at city level 0, the
 * tenth and ninetieth percentiles of an ordinary sheet were 638 and 686 points on a mean of 662.
 * A **grade** moves the mean the whole sheet is drawn from, which is the only thing that separates
 * two people, and it decides what they may ask a crew for as well.
 */
describe('the room spreads across skill levels', () => {
  const sheets = (cityLevel: number): number[] => {
    const points: number[] = [];
    for (const day of DAYS) {
      barRoster(day, BAR_ROSTER_SIZE, cityLevel).forEach((recruit, seat) => {
        if (!isStandoutSeat(seat)) points.push(total(recruit.attributes));
      });
    }
    return points.sort((a, b) => a - b);
  };
  const at = (points: readonly number[], share: number): number =>
    points[Math.floor(points.length * share)] as number;

  it('puts a real distance between the weakest and the strongest ordinary recruit', () => {
    for (const cityLevel of [0, 12]) {
      const points = sheets(cityLevel);
      // Measured at 377 points across both, against 48 before the grades. Half of that would
      // still be four times the old spread, so this fails long before the room re-flattens.
      expect(at(points, 0.9) - at(points, 0.1), `city level ${cityLevel}`).toBeGreaterThan(200);
    }
    /*
     * A mature city compresses the top rather than the whole ladder, and that is the ceiling
     * doing it: `MAX_CALIBRE` is what a sheet may be lifted by, so the good grades run into it
     * while the green ones still have room below. Measured at 257 points.
     */
    const mature = sheets(30);
    expect(at(mature, 0.9) - at(mature, 0.1)).toBeGreaterThan(150);
  });

  it('draws every grade, at about the weights the table gives them', () => {
    const seen = new Map<string, number>();
    let counted = 0;
    for (const day of DAYS) {
      for (let seat = 0; seat < BAR_ROSTER_SIZE; seat += 1) {
        if (isStandoutSeat(seat)) continue;
        const grade = gradeOf(seedFrom(`${day}:${seat}:0:grade`));
        seen.set(grade.id, (seen.get(grade.id) ?? 0) + 1);
        counted += 1;
      }
    }
    const weights = RECRUIT_GRADES.reduce((sum, grade) => sum + grade.weight, 0);
    for (const grade of RECRUIT_GRADES) {
      const share = (seen.get(grade.id) ?? 0) / counted;
      const wanted = grade.weight / weights;
      // Every grade turns up, and none of them is twice or half what the table asked for.
      expect(share, grade.id).toBeGreaterThan(wanted / 2);
      expect(share, grade.id).toBeLessThan(wanted * 2);
    }
  });

  /**
   * What a recruit asks for is what they are worth, sheet **and** tags.
   *
   * The sheet and the door used to come from independent rolls, so a green sheet could sit behind
   * the hardest rank in the game: a card nobody would ever take, which reads as a bug in the roll
   * rather than as a locked door. Tying the door to the grade fixed that and left the other half
   * out: a grade is a statement about attributes, and attributes are the half of a person a crew
   * can train up themselves. The tags a recruit carries are permanent, so they lift the ceiling
   * too (maintainer, 2026-09-16). See `doorCeilingFor`.
   */
  it('never lets a recruit ask for more rank than their grade and their tags allow', () => {
    for (const cityLevel of [0, 12, 30]) {
      for (const day of DAYS) {
        barRoster(day, BAR_ROSTER_SIZE, cityLevel).forEach((recruit, seat) => {
          if (isStandoutSeat(seat)) return;
          const grade = gradeOf(seedFrom(`${day}:${seat}:0:grade`));
          expect(
            recruit.requirement.minNotoriety,
            `${day} seat ${seat} (${grade.id})`,
          ).toBeLessThanOrEqual(doorCeilingFor(grade, recruit.perks));
        });
      }
    }
    // ...and the rule is not vacuous: the top of the ladder really does ask for the top rank.
    expect(Math.max(...RECRUIT_GRADES.map((grade) => grade.maxNotoriety))).toBe(
      RECRUIT_MAX_MIN_NOTORIETY,
    );
    expect(RECRUIT_GRADES.some((grade) => grade.maxNotoriety === 0)).toBe(true);
  });

  /**
   * And the tag half of that ceiling really moves, rather than being a term that is always zero.
   *
   * The bound above passes for an implementation that ignores the tags outright, because a wider
   * ceiling admits every door the narrower one did. This is the positive control: somewhere in a
   * hundred nights, a recruit stands behind a door their attributes alone would not have opened.
   */
  it('lets a middling sheet carrying a great tag ask for more than its grade would', () => {
    const lifted: string[] = [];
    for (const day of DAYS) {
      barRoster(day, BAR_ROSTER_SIZE, 12).forEach((recruit, seat) => {
        if (isStandoutSeat(seat)) return;
        const grade = gradeOf(seedFrom(`${day}:${seat}:0:grade`));
        if (recruit.requirement.minNotoriety > grade.maxNotoriety) {
          lifted.push(`${day} seat ${seat} (${grade.id}, ${perksWorth(recruit.perks).toFixed(1)})`);
        }
      });
    }
    expect(lifted.length, 'no tag ever bought a rung of the door').toBeGreaterThan(0);
  });

  /** A cheap person is cheap, which is the whole reason a spread of people is worth having. */
  it('prices the room across a range a player can feel', () => {
    const wages: number[] = [];
    for (const day of DAYS) {
      barRoster(day, BAR_ROSTER_SIZE, 12).forEach((recruit, seat) => {
        if (!isStandoutSeat(seat)) wages.push(askingWage(recruit.attributes));
      });
    }
    wages.sort((a, b) => a - b);
    // Measured at 33 and 167 caps a week. A room that priced everybody the same would fail here
    // however wide its sheets were, which is the thing a player actually reads off a card.
    expect(at(wages, 0.9) / at(wages, 0.1)).toBeGreaterThan(2.5);
  });

  /**
   * The ordinary ladder stops below the standout seats.
   *
   * Its top grade was +7 against the standouts' +6, so an ordinary seat rolled 1042 points against
   * a standout's 1027 on the same night with none of the standout's doors on it, which makes the
   * two chairs at the end of the room pointless.
   */
  it('keeps the best ordinary grade under the standout lift', () => {
    const veteran = RECRUIT_GRADES[RECRUIT_GRADES.length - 1];
    if (!veteran) throw new Error('expected a top grade');
    expect(veteran.calibre).toBeLessThan(STANDOUT_CALIBRE_LIFT);
  });
});

describe('the standout seats', () => {
  it('are the last two of the base roster, wherever the room ends', () => {
    for (let seat = 0; seat < BAR_ROSTER_SIZE; seat += 1) {
      expect(isStandoutSeat(seat), `seat ${seat}`).toBe(
        seat >= BAR_ROSTER_SIZE - BAR_STANDOUT_SEATS,
      );
    }
    /*
     * §H2: the room is the same for every player, so a crew whose Charisma has widened it must see
     * the same person behind the same doors as a crew that has not. Anything counted from the end
     * of a room whose length varies would break that, and this is the assertion that would fail.
     */
    const widest = barSeatsFor(1000);
    expect(widest).toBeGreaterThan(BAR_ROSTER_SIZE);
    for (let seat = BAR_ROSTER_SIZE; seat < widest; seat += 1) {
      expect(isStandoutSeat(seat), `widened seat ${seat}`).toBe(false);
    }
    const narrow = barRoster('2026-03-04', BAR_ROSTER_SIZE, 12);
    const wide = barRoster('2026-03-04', widest, 12);
    expect(wide.slice(0, BAR_ROSTER_SIZE)).toEqual(narrow);
  });

  /**
   * Measured at three city levels, and the third is the one that matters.
   *
   * The calibre lift is the whole difference in a young city and **none of it** in a mature one:
   * at city level 30 the room is already at `MAX_CALIBRE`, the lift clamps away, and an earlier
   * build of this feature put the standouts at 989 sheet points against the room's 986, which is
   * no difference at all. The extra strengths and the skipped weaknesses are what still works
   * there. Both figures are pinned so a retune that quietly re-flattens the top of the room fails
   * here rather than on somebody's screen.
   */
  it('roll better sheets and more perks than the room around them, at every city level', () => {
    for (const cityLevel of [0, 6, 30]) {
      let better = 0;
      let standoutPoints = 0;
      let ordinaryPoints = 0;
      for (const day of DAYS) {
        const roster = barRoster(day, BAR_ROSTER_SIZE, cityLevel);
        const standouts = roster.filter((_, seat) => isStandoutSeat(seat));
        const ordinary = roster.filter((_, seat) => !isStandoutSeat(seat));
        expect(standouts).toHaveLength(BAR_STANDOUT_SEATS);

        for (const recruit of standouts) {
          expect(recruit.perks.length, `${day} ${recruit.id}`).toBeGreaterThanOrEqual(
            STANDOUT_MIN_PERKS,
          );
        }
        const best = Math.max(...ordinary.map((recruit) => total(recruit.attributes)));
        if (standouts.every((recruit) => total(recruit.attributes) > best)) better += 1;
        standoutPoints +=
          standouts.reduce((sum, one) => sum + total(one.attributes), 0) / standouts.length;
        ordinaryPoints +=
          ordinary.reduce((sum, one) => sum + total(one.attributes), 0) / ordinary.length;
      }
      // Not "always", which would be a lie about a roll: an ordinary seat can come up lucky and
      // eight of them get eight chances to. Measured at 100%, 100% and 88%.
      expect(better / DAYS.length, `city level ${cityLevel}`).toBeGreaterThan(0.8);
      // And the gap itself, which is the part the clamp used to eat. Measured at 251, 254 and 60.
      expect(
        (standoutPoints - ordinaryPoints) / DAYS.length,
        `city level ${cityLevel}`,
      ).toBeGreaterThan(40);
    }
  });

  /**
   * §B2a: the recruitment ceiling is the bound the rest of the game reads a sheet against, and a
   * standout is better at *more* things rather than better than anybody is allowed to be.
   */
  it('never put an attribute past the recruitment ceiling', () => {
    for (const day of DAYS) {
      for (const cityLevel of [0, 30, 60]) {
        for (const recruit of barRoster(day, BAR_ROSTER_SIZE, cityLevel)) {
          const highest = Math.max(...Object.values(recruit.attributes));
          expect(highest, `${day} ${recruit.id}`).toBeLessThanOrEqual(MAX_RECRUITMENT_ATTRIBUTE);
        }
      }
    }
  });

  it('ask for the wallet and the badge, and every ordinary seat asks for neither', () => {
    for (const day of DAYS) {
      const roster = barRoster(day, BAR_ROSTER_SIZE, 10);
      roster.forEach((recruit, seat) => {
        const want: JoinRequirement = recruit.requirement;
        if (!isStandoutSeat(seat)) {
          expect(want.minInfamy, `${day} seat ${seat}`).toBe(0);
          expect(want.minFactionInfamy, `${day} seat ${seat}`).toBe(0);
          return;
        }
        expect(want.minInfamy).toBeGreaterThanOrEqual(RECRUIT_MIN_INFAMY_GATE);
        expect(want.minInfamy).toBeLessThanOrEqual(RECRUIT_MAX_MIN_INFAMY);
        expect(want.minFactionInfamy).toBeGreaterThanOrEqual(RECRUIT_MIN_FACTION_INFAMY_GATE);
        expect(want.minFactionInfamy).toBeLessThanOrEqual(RECRUIT_MAX_MIN_FACTION_INFAMY);
        /*
         * The rank door too, and above the softest rung: a standout anybody could sign on their
         * first night is not a standout.
         *
         * The ceiling is `RECRUIT_LEGEND_NOTORIETY` rather than the ordinary room's, and that is
         * the point of these two chairs: past `Marked` nothing in the game asked for a rank, so the
         * strongest sheets the Bar draws are what the top of the ladder now buys.
         */
        expect(want.minNotoriety).toBeGreaterThan(RECRUIT_MIN_NOTORIETY_GATE);
        expect(want.minNotoriety).toBeLessThanOrEqual(RECRUIT_LEGEND_NOTORIETY);
      });
    }
  });

  it('are shut to a crew with nothing, and the faction door needs a faction', () => {
    const roster = barRoster('2026-05-19', BAR_ROSTER_SIZE, 10);
    const standout = roster[BAR_ROSTER_SIZE - 1];
    if (!standout) throw new Error('expected a standout seat');

    expect(assessJoin(standout.requirement, NEW_CREW).interested).toBe(false);

    // Everything the player can get on their own, and still refused: the badge is the last door.
    const alone: CrewStanding = {
      notoriety: RECRUIT_LEGEND_NOTORIETY,
      level: 60,
      infamy: RECRUIT_MAX_MIN_INFAMY,
      factionInfamy: 0,
    };
    const solo = assessJoin(standout.requirement, alone);
    expect(solo.interested).toBe(false);
    expect(solo.blockers).toEqual(['faction']);
    expect(solo.meetsInfamy).toBe(true);
    expect(solo.meetsFaction).toBe(false);

    // ...and with a badge behind them, the table opens.
    const backed = assessJoin(standout.requirement, {
      ...alone,
      factionInfamy: RECRUIT_MAX_MIN_FACTION_INFAMY,
    });
    expect(backed.interested).toBe(true);
    expect(backed.blockers).toEqual([]);
  });

  /**
   * The floor the whole room rests on, re-checked with the standouts in it.
   *
   * A new crew is rank `Nobody` at level 1 with an empty wallet and no faction, so all four doors
   * are shut to them everywhere except the open seats. Adding two harder seats must not have eaten
   * into those: a Bar that is empty on the night a player first opens it reads as a broken screen.
   */
  it('leave a brand-new crew the open seats it has always had', () => {
    for (const day of DAYS) {
      for (const cityLevel of [0, 8, 30]) {
        const roster = barRoster(day, BAR_ROSTER_SIZE, cityLevel);
        const willing = roster.filter(
          (recruit) => assessJoin(recruit.requirement, NEW_CREW).interested,
        );
        expect(willing.length, `${day} at city level ${cityLevel}`).toBeGreaterThanOrEqual(
          BAR_OPEN_DOOR_FLOOR,
        );
        // And none of the open ones is a standout: the floor is seats, not luck.
        for (const recruit of willing) {
          const seat = roster.indexOf(recruit);
          expect(isStandoutSeat(seat), `${day} seat ${seat} is open and a standout`).toBe(false);
        }
      }
    }
  });
});
