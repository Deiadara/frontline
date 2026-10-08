import { describe, expect, it } from 'vitest';
import {
  BUNDLE_VALUE,
  GRADES,
  capsTilted,
  canRecall,
  recallWindowMs,
  FAILED_MISSION_XP_SHARE,
  FAILURE_REWARD_SHARE,
  GOVERNMENT,
  kindPayFactor,
  MISSION_MAX_DURATION_MINUTES,
  MISSION_MIN_DURATION_MINUTES,
  MISSION_TEMPLATES,
  MissionTemplateSchema,
  REWARD_BASELINE_MINUTES,
  TRAVEL_BAND_MINUTES,
  fightPremiumPercent,
  findMissionTemplate,
  formatCountdown,
  formatDuration,
  hastenedMinutes,
  hastenedRoadMinutes,
  isMissionDue,
  missionCompletesAt,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  missionRewards,
  missionTimings,
  offerOfMission,
  RESOURCE_CAP_VALUE,
  RESOURCE_KEYS,
  rewardScale,
  scaledSpoils,
  templateTimings,
  type Mission,
  type MissionTemplate,
  type PartialResources,
  type ResourceKey,
} from './index.js';

const START = '2026-08-13T10:00:00.000Z';

/** A mission launched at `START`; travel/duration in minutes. */
function missionAt(travelMinutes: number, durationMinutes: number): Mission {
  return {
    id: 'mission-1',
    baseId: 'base-1',
    templateId: 'scrap-run',
    areaId: 'misc',
    vehicles: {},
    pricedMinutes: 0,
    payPercent: 0,
    xp: 240,
    force: { razors: 4 },
    startedAt: START,
    travelMinutes,
    durationMinutes,
    status: 'active',
    officerId: null,
    grade: null,
    overseerLed: false,
    lost: {},
    reported: true,
    outcome: null,
    rewards: {},
    spoils: {},
    resolvedAt: null,
    recalledAt: null,
    pagePrize: null,
    pageWon: null,
    found: {},
  };
}

const at = (minutesAfterStart: number) => new Date(Date.parse(START) + minutesAfterStart * 60_000);

/** A bundle's worth in caps, at the market's valuation. */
const capsValue = (bundle: PartialResources): number =>
  RESOURCE_KEYS.reduce((total, key) => total + (bundle[key] ?? 0) * RESOURCE_CAP_VALUE[key], 0);

describe('travel bands (§E6)', () => {
  it('is close 5m, further 20m, furthest 1h', () => {
    expect(TRAVEL_BAND_MINUTES).toEqual({ close: 5, further: 20, furthest: 60 });
  });
});

describe('the mission board', () => {
  it('has a unique, schema-valid entry per template', () => {
    for (const template of MISSION_TEMPLATES) {
      expect(() => MissionTemplateSchema.parse(template)).not.toThrow();
    }
    const ids = MISSION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Names as well as ids. An id collision is loud, because the second entry becomes unreachable
    // through `findMissionTemplate`; a name collision is silent and lands on the player, who gets
    // two cards reading `Ration Run` that pay different amounts and cannot tell which is which.
    const names = MISSION_TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * And no two jobs that are the same job with a different name.
   *
   * Ids and names are what a machine trips over; this is what a *player* trips over. A board of
   * three is a choice, and two cards with the same kind, ground, clock, odds and haul are not a
   * choice however differently they read. The catalogue is thirty-eight entries now, which is
   * comfortably past the size where you can hold it all in your head while adding to it.
   */
  it('has no two jobs with the same shape and numbers', () => {
    const shape = (template: MissionTemplate) =>
      [
        template.kind,
        template.grades.join('..'),
        template.travelBand,
        template.durationMinutes,
        Object.entries(template.spoils)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, amount]) => `${key}:${amount}`)
          .join(','),
      ].join('|');

    const byShape = new Map<string, string[]>();
    for (const template of MISSION_TEMPLATES) {
      const key = shape(template);
      byShape.set(key, [...(byShape.get(key) ?? []), template.id]);
    }
    const twins = [...byShape.values()].filter((ids) => ids.length > 1);
    expect(
      twins,
      `jobs that are the same job: ${twins.map((ids) => ids.join('/')).join(', ')}`,
    ).toEqual([]);
  });

  it('offers every distance band and both kinds', () => {
    expect(new Set(MISSION_TEMPLATES.map((t) => t.travelBand))).toEqual(
      new Set(Object.keys(TRAVEL_BAND_MINUTES)),
    );
    expect(new Set(MISSION_TEMPLATES.map((t) => t.kind))).toEqual(new Set(['standard', 'battle']));
  });

  /*
   * §A3, after `stance` was deleted (2026-09-12).
   *
   * The field used to carry this claim as data and two tests read it back. It carried nothing else:
   * no officer asked which way a job pointed, no screen kept a tally, and the reputation system it
   * was the driver for is gone. What is left is the fiction, which is where it always actually
   * lived, so this reads the briefs instead. Most of the paying work is against the one antagonist
   * NPC content has, and a board that drifted into generic scavenging would fail here.
   */
  it('is written against the Combine, in the briefs (§A3)', () => {
    const named = MISSION_TEMPLATES.filter((t) => t.brief.includes(GOVERNMENT.adjective));
    expect(named.length).toBeGreaterThan(MISSION_TEMPLATES.length / 2);
    // And it is not the whole board: honest scavenging the state has no opinion about is what
    // makes the rest read as a city rather than a campaign.
    expect(named.length).toBeLessThan(MISSION_TEMPLATES.length);
    // Both kinds of work name it, so the antagonist is not just the battle board's problem.
    expect(new Set(named.map((t) => t.kind))).toEqual(new Set(['standard', 'battle']));
  });

  it('spans §E7: a couple of minutes at one end, a full day at the other', () => {
    const durations = MISSION_TEMPLATES.map((t) => t.durationMinutes);
    expect(Math.min(...durations)).toBeLessThanOrEqual(3);
    expect(Math.max(...durations)).toBe(MISSION_MAX_DURATION_MINUTES);
    for (const duration of durations) {
      expect(duration).toBeGreaterThanOrEqual(MISSION_MIN_DURATION_MINUTES);
      expect(duration).toBeLessThanOrEqual(MISSION_MAX_DURATION_MINUTES);
    }
  });

  it('pays every template something thematic, and nothing off the resource list', () => {
    for (const template of MISSION_TEMPLATES) {
      const spoils = Object.entries(template.spoils);
      expect(spoils.length).toBeGreaterThan(0);
      for (const [, amount] of spoils) expect(amount).toBeGreaterThan(0);
      expect(Object.keys(missionRewards(template)).length).toBeGreaterThan(0);
    }
  });

  it('resolves templates by id, and only real ones', () => {
    expect(findMissionTemplate('scrap-run')?.name).toBe('Scrap Run');
    expect(findMissionTemplate('not-a-mission')).toBeUndefined();
  });
});

describe('the road leg (§C3)', () => {
  /**
   * The job cap is 50 and a Rotorcraft alone is 52: under the job cap the top of the Garage's
   * ladder bought nothing over a Gas Balloon. The road has its own ceiling, twice as high.
   */
  it('lets a machine past the job cap, and stops at the road cap', () => {
    // 52 points bend to about 44 on the job leg (2026-10-05): 60 / 1.44 is 42.
    expect(hastenedMinutes(60, 52)).toBe(42);
    expect(hastenedRoadMinutes(60, 52)).toBe(39);
    expect(hastenedRoadMinutes(60, 100)).toBe(30);
    expect(hastenedRoadMinutes(60, 150)).toBe(30);
    expect(hastenedRoadMinutes(60, 0)).toBe(60);
  });
});

describe('total elapsed time (§E8)', () => {
  it('charges travel twice plus the mission itself', () => {
    expect(missionTimings({ travelMinutes: 20, durationMinutes: 45 }).totalMinutes).toBe(85);
  });

  it('holds for every template on the board', () => {
    for (const template of MISSION_TEMPLATES) {
      const { travelMinutes, durationMinutes, totalMinutes } = templateTimings(template);
      expect(travelMinutes).toBe(TRAVEL_BAND_MINUTES[template.travelBand]);
      expect(durationMinutes).toBe(template.durationMinutes);
      expect(totalMinutes).toBe(2 * travelMinutes + durationMinutes);
    }
  });
});

describe('reward scaling (§E5)', () => {
  it('pays the authored mix exactly at the baseline length', () => {
    expect(rewardScale(REWARD_BASELINE_MINUTES, 'standard', 'F-')).toBe(1);
  });

  it('pays a battle its fight premium over standard work for identical time, at every grade', () => {
    for (const grade of GRADES) {
      const ratio = rewardScale(120, 'battle', grade) / rewardScale(120, 'standard', grade);
      expect(ratio, grade).toBeCloseTo(1 + fightPremiumPercent(grade) / 100, 10);
    }
    // The ruling's anchors, end to end through the pay: 10% extra at F-, three times at S.
    expect(rewardScale(120, 'battle', 'F-') / rewardScale(120, 'standard', 'F-')).toBeCloseTo(1.1);
    expect(rewardScale(120, 'battle', 'S') / rewardScale(120, 'standard', 'S')).toBeCloseTo(3);
  });

  it('pays a longer mission more in total but less per minute', () => {
    const short = rewardScale(30, 'standard', 'C');
    const long = rewardScale(1440, 'standard', 'C');
    expect(long).toBeGreaterThan(short);
    expect(long / 1440).toBeLessThan(short / 30);
  });

  it('scales an authored mix by the curve rather than paying it flat', () => {
    const expedition = findMissionTemplate('deep-expedition') as MissionTemplate;
    const [lowest] = expedition.grades;
    const scale = rewardScale(templateTimings(expedition).totalMinutes, expedition.kind, lowest);
    expect(scale).toBeGreaterThan(10);

    // The authored mix with its caps share moved in first (`capsTilted`, 2026-10-01).
    const mix = capsTilted(expedition.spoils, expedition.kind);
    const priced = BUNDLE_VALUE / capsValue(mix);
    const rewards = missionRewards(expedition);
    for (const [key, authored] of Object.entries(mix) as [ResourceKey, number][]) {
      expect(rewards[key]).toBe(Math.round(authored * scale * priced));
    }
  });

  /**
   * A run that came home empty banks nothing, whichever kind it was.
   *
   * A failed standard run used to limp home with a quarter of the salvage. The board's rule now is
   * no resources and a fifth of the XP, and this is the assertion that keeps the two halves of it
   * from drifting: the settler pays through `missionRewards`, so a share that crept back above
   * zero here would quietly start paying failures again.
   */
  it('sends every failed run home with nothing at all', () => {
    for (const kind of ['standard', 'battle'] as const) {
      expect(FAILURE_REWARD_SHARE[kind], kind).toBe(0);
    }
    for (const template of MISSION_TEMPLATES) {
      expect(missionRewards(template, 'failure'), template.id).toEqual({});
      // And a clean run still pays, or the assertion above would pass on a board that pays
      // nothing at all.
      expect(Object.keys(missionRewards(template, 'success')).length, template.id).toBeGreaterThan(
        0,
      );
    }
  });

  it('drops a line that rounds to zero instead of paying a phantom resource', () => {
    const template: MissionTemplate = {
      id: 'test-only',
      name: 'Test',
      brief: 'Test',
      kind: 'standard',
      grades: ['F-', 'F'],
      travelBand: 'close',
      durationMinutes: 2,
      spoils: { scrap: 100, highQualityMetal: 1 },
      leanings: ['haul'],
    };
    // A two-minute run is well under `REWARD_BASELINE_MINUTES`, so the §E5 curve scales the whole
    // bundle down: the scrap line survives and the single ingot rounds away. It used to be a
    // *failed* run that produced the fraction; failures pay nothing at all now, so the same
    // arithmetic is reached through a short successful one.
    const rewards = missionRewards(template, 'success');
    expect(rewards.scrap).toBeGreaterThan(0);
    expect(rewards).not.toHaveProperty('highQualityMetal');
  });
});

describe('mission phase (§E2)', () => {
  const mission = missionAt(20, 45); // out 0-20, on site 20-65, back 65-85

  it('walks outbound → on site → returning → returned', () => {
    expect(missionPhaseAt(mission, at(0))).toBe('outbound');
    expect(missionPhaseAt(mission, at(19.9))).toBe('outbound');
    expect(missionPhaseAt(mission, at(20))).toBe('onSite');
    expect(missionPhaseAt(mission, at(64.9))).toBe('onSite');
    expect(missionPhaseAt(mission, at(65))).toBe('returning');
    expect(missionPhaseAt(mission, at(84.9))).toBe('returning');
    expect(missionPhaseAt(mission, at(85))).toBe('returned');
    expect(missionPhaseAt(mission, at(10_000))).toBe('returned');
  });

  it('completes at start + 2×travel + duration', () => {
    expect(missionCompletesAt(mission).toISOString()).toBe(at(85).toISOString());
  });

  /**
   * A recall turns them round where they stand, so the way home is how far from home they are.
   *
   * The three phases give three different answers and only one of them is "time since launch":
   * a crew still walking out is exactly as far along as it has been travelling, a crew on site is
   * one full leg out however long it has been standing there, and a crew already walking back is
   * as far out as the leg it has left. Charging time-since-launch in all three cases sends the
   * crew *further away* the longer the job has been running, which is worst precisely where a
   * player is most likely to press it: one minute from the gate.
   */
  describe('recalling a crew (§E2)', () => {
    const recalledAt = (minutes: number): Mission => ({
      ...mission,
      recalledAt: at(minutes).toISOString(),
    });

    it('walks back the distance already covered when caught on the way out', () => {
      // 8 minutes out of a 20 minute leg: 8 minutes home, arriving at 16.
      expect(missionCompletesAt(recalledAt(8)).toISOString()).toBe(at(16).toISOString());
    });

    it('walks one full leg when caught on site, however long they have been there', () => {
      // On site from 20 to 65, and the distance home is 20 minutes throughout.
      expect(missionCompletesAt(recalledAt(20)).toISOString()).toBe(at(40).toISOString());
      expect(missionCompletesAt(recalledAt(64)).toISOString()).toBe(at(84).toISOString());
    });

    it('finishes the leg it is on when caught on the way home', () => {
      // At 80 they are 5 minutes from the gate, so a recall changes nothing about the arrival.
      expect(missionCompletesAt(recalledAt(80)).toISOString()).toBe(at(85).toISOString());
    });

    /**
     * The failure the board would have seen: `canRecall` is true until the last millisecond, so
     * this is a button a player can press one minute from home.
     */
    it('never sends a crew further away than it already is', () => {
      for (const minute of [1, 10, 20, 40, 64, 65, 70, 80, 84]) {
        const home = missionCompletesAt(recalledAt(minute)).getTime();
        const wouldHaveBeen = missionCompletesAt(mission).getTime();
        expect(
          home,
          `recalled at ${minute}m and got home later than by finishing the job`,
        ).toBeLessThanOrEqual(wouldHaveBeen);
        expect(home, `recalled at ${minute}m and arrived before the order`).toBeGreaterThanOrEqual(
          at(minute).getTime(),
        );
      }
    });
  });

  /**
   * The exact turnaround: the millisecond the recall button closes and the payout opens.
   *
   * The two rules are complements and they meet at one instant, so it is worth pinning that they
   * meet there and do not overlap. A gap would be a minute in which a crew can neither be recalled
   * nor banked; an overlap would let a player delete a payout by turning a crew round at the gate,
   * which is exactly what the note on `canRecall` says it is there to stop.
   */
  /**
   * The window is the first tenth of the **whole run** (maintainer, 2026-09-22; `time/cancel.ts`).
   *
   * It was open right up to the gate until 2026-09-12, which made a job a thing you could abandon
   * at any moment for nothing, and then a tenth of the road out until today. A tenth of the road
   * out made the window a property of the *shape* of a job rather than its size: on the Anyride
   * templates, where the travel is a sliver of a run lasting hours, it came to a few seconds.
   *
   * This fixture is twenty minutes out, forty-five on site and twenty back: 85 minutes, so the
   * window is 8.5. Open at the first second, open a millisecond before, shut on the mark.
   */
  it('offers the recall only in the first tenth of the whole run, and says how long is left', () => {
    const start = at(0).getTime();
    const window = 8.5 * 60_000;
    // The figure, written out rather than derived, so a change to `missionTimings` shows up here
    // as a failure rather than as this test quietly agreeing with it.
    expect(recallWindowMs(mission, at(0))).toBe(window);
    expect(canRecall(mission, at(0))).toBe(true);
    expect(canRecall(mission, new Date(start + window - 1))).toBe(true);
    expect(recallWindowMs(mission, new Date(start + window - 30_000))).toBe(30_000);
    expect(canRecall(mission, new Date(start + window))).toBe(false);
    expect(recallWindowMs(mission, new Date(start + window))).toBe(0);
    expect(canRecall(mission, at(10))).toBe(false);
    expect(canRecall(mission, at(84))).toBe(false);

    // A crew already recalled cannot be recalled again, at any point on its shortened clock.
    const turned = { ...mission, recalledAt: at(1).toISOString() };
    expect(canRecall(turned, at(1))).toBe(false);
    expect(recallWindowMs(turned, at(1))).toBe(0);
  });

  it('counts down to zero and never below', () => {
    expect(missionRemainingMs(mission, at(0))).toBe(85 * 60_000);
    expect(missionRemainingMs(mission, at(85))).toBe(0);
    expect(missionRemainingMs(mission, at(900))).toBe(0);
  });

  it('reports progress clamped to 0..1', () => {
    expect(missionProgressAt(mission, at(-10))).toBe(0);
    expect(missionProgressAt(mission, at(42.5))).toBeCloseTo(0.5);
    expect(missionProgressAt(mission, at(85))).toBe(1);
    expect(missionProgressAt(mission, at(500))).toBe(1);
  });

  it('is due only while active and past its clock', () => {
    expect(isMissionDue(mission, at(84))).toBe(false);
    expect(isMissionDue(mission, at(85))).toBe(true);
    expect(isMissionDue({ ...mission, status: 'resolved' }, at(85))).toBe(false);
  });
});

describe('duration formatting', () => {
  it('renders minutes under the hour and h/mm over it', () => {
    expect(formatDuration(3)).toBe('3m');
    expect(formatDuration(59)).toBe('59m');
    expect(formatDuration(60)).toBe('1h 00m');
    expect(formatDuration(85)).toBe('1h 25m');
    expect(formatDuration(1560)).toBe('26h 00m');
  });

  // Bug pass, 2026-10-06: the minutes were rounded after the hours were split off.
  it('rounds a fractional minute into the next hour rather than printing sixty minutes', () => {
    expect(formatDuration(59.6)).toBe('1h 00m');
    expect(formatDuration(119.6)).toBe('2h 00m');
    expect(formatDuration(90.4)).toBe('1h 30m');
  });

  it('renders a countdown mm:ss, adding hours only when there are some', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5000)).toBe('00:00');
    expect(formatCountdown(59_000)).toBe('00:59');
    expect(formatCountdown(299_000)).toBe('04:59');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(3_899_000)).toBe('1:04:59');
  });
});

/**
 * §E5: which resources a job pays in is authored; what they are worth is not (2026-09-28).
 *
 * Every mix is priced to `BUNDLE_VALUE` in code, so the clock curve, the kind and the grade are
 * the only things that move pay. The failure this used to guard against by hand, raw bundles
 * varying 9.4x and multiplying with the curve until it inverted, cannot be authored any more; what
 * is left to check is that the pricing holds after rounding and that the curve still reads.
 */
describe('the board is priced on one rule (§E5)', () => {
  it('pays every job its bundle value at the baseline, give or take the rounding', () => {
    for (const template of MISSION_TEMPLATES) {
      const paid = capsValue(missionRewards(template, 'success', REWARD_BASELINE_MINUTES, 'F-'));
      const expected = BUNDLE_VALUE * kindPayFactor(template.kind, 'F-');
      expect(paid / expected, template.id).toBeGreaterThan(0.9);
      expect(paid / expected, template.id).toBeLessThan(1.1);
    }
  });

  it('pays a harder grade more for the same job and the same clock', () => {
    for (const kind of ['standard', 'battle'] as const) {
      for (let index = 1; index < GRADES.length; index += 1) {
        expect(rewardScale(120, kind, GRADES[index]!), GRADES[index]).toBeGreaterThan(
          rewardScale(120, kind, GRADES[index - 1]!),
        );
      }
    }
  });

  /** What "readable board" means as a number: at one grade, the hourly rate spread stays small. */
  it('keeps the whole board inside one order of magnitude on hourly rate, grade for grade', () => {
    const rates = MISSION_TEMPLATES.map((template) => {
      const minutes = templateTimings(template).totalMinutes;
      return (
        (BUNDLE_VALUE * rewardScale(minutes, template.kind, 'C')) /
        kindPayFactor(template.kind, 'C') /
        (minutes / 60)
      );
    });
    expect(Math.max(...rates) / Math.min(...rates)).toBeLessThan(10);
  });
});

/**
 * The card a run that is out was taken off, rebuilt from the row (`offerOfMission`).
 *
 * Its raw time on site is the figure the send window re-runs the launch from, and the board quotes
 * it at the card's grade (`offerFor`). The rebuilt card quoted the authored figure, which is the
 * job's lowest grade only, so the same job read two different raw clocks at any harder mark.
 */
describe('the card a running job was taken off', () => {
  it('quotes the raw time on site at the grade the row froze, as the board does', () => {
    // A job whose harder mark moves its clock by at least a whole minute.
    const template = MISSION_TEMPLATES.find(
      (one) => templateTimings(one, one.grades[1]).durationMinutes > one.durationMinutes,
    );
    if (!template) throw new Error('fixture: no job runs longer at its hardest mark');
    const grade = template.grades[1];
    const card = offerOfMission({ ...missionAt(5, 30), templateId: template.id, grade }, template);
    expect(card.rawDurationMinutes).toBe(templateTimings(template, grade).durationMinutes);
    expect(card.rawDurationMinutes).toBeGreaterThan(template.durationMinutes);
  });

  /*
   * Bug pass, 2026-10-07: the Bounty Wall's gold is frozen on the row at launch and paid by the
   * settle, and the rebuilt card carried the gold border and the plain haul, so the Missions page
   * quoted a run already out less than it was going to bring home.
   */
  it('quotes the Bounty Wall`s premium the settle will pay, on top of the area`s', () => {
    const template = MISSION_TEMPLATES[0]!;
    const row = { ...missionAt(5, 30), templateId: template.id, payPercent: 20 };
    const plain = offerOfMission(row, template);
    const golden = offerOfMission({ ...row, goldenPercent: 40 }, template);
    expect(golden.golden).toBe(true);
    expect(golden.goldenPercent).toBe(40);
    const keys = RESOURCE_KEYS.filter((key) => (plain.rewards[key] ?? 0) > 0);
    expect(keys.length, 'the fixture has to pay something').toBeGreaterThan(0);
    for (const key of keys) {
      expect(golden.rewards[key], key).toBe(scaledSpoils(plain.rewards, 40)[key]);
    }
    // ...and the slots the haul takes up move with it, since that is what the carry is measured on.
    expect(golden.payoutSlots).toBeGreaterThan(plain.payoutSlots);
  });

  // Bug pass, 2026-10-02: the return adds the crew's XP bonus, and the card quoted the row's figure.
  it('quotes the XP the return will bank, bonus on, for a win and for a failure', () => {
    const template = MISSION_TEMPLATES[0]!;
    const row = { ...missionAt(5, 30), templateId: template.id, xp: 200 };
    expect(offerOfMission(row, template).xp).toBe(200);
    const boosted = offerOfMission(row, template, 7);
    expect(boosted.xp).toBe(214);
    expect(boosted.failedXp).toBe(Math.round(Math.round(200 * FAILED_MISSION_XP_SHARE) * 1.07));
  });
});
