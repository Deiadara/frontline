import { describe, expect, it } from 'vitest';
import {
  FAILURE_REWARD_SHARE,
  GOVERNMENT,
  KIND_REWARD_MULTIPLIER,
  MISSION_MAX_DURATION_MINUTES,
  MISSION_MIN_DURATION_MINUTES,
  MISSION_STANCES,
  MISSION_TEMPLATES,
  MissionTemplateSchema,
  REWARD_BASELINE_MINUTES,
  TRAVEL_BAND_MINUTES,
  findMissionTemplate,
  formatCountdown,
  formatDuration,
  isMissionDue,
  missionCompletesAt,
  missionPhaseAt,
  missionProgressAt,
  missionRemainingMs,
  missionRewards,
  missionTimings,
  rewardScale,
  templateTimings,
  type Mission,
  type MissionStance,
  type MissionTemplate,
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
    payPercent: 0,
    xp: 240,
    force: { razors: 4 },
    startedAt: START,
    travelMinutes,
    durationMinutes,
    status: 'active',
    officerId: null,
    outcome: null,
    rewards: {},
    resolvedAt: null,
    recalledAt: null,
  };
}

const at = (minutesAfterStart: number) => new Date(Date.parse(START) + minutesAfterStart * 60_000);

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
  });

  it('offers every distance band and both kinds', () => {
    expect(new Set(MISSION_TEMPLATES.map((t) => t.travelBand))).toEqual(
      new Set(Object.keys(TRAVEL_BAND_MINUTES)),
    );
    expect(new Set(MISSION_TEMPLATES.map((t) => t.kind))).toEqual(new Set(['standard', 'battle']));
  });

  it('is written against the Combine, but offers both other stances too (§A3)', () => {
    const byStance = (stance: MissionStance) =>
      MISSION_TEMPLATES.filter((t) => t.stance === stance);

    expect(new Set(MISSION_TEMPLATES.map((t) => t.stance))).toEqual(new Set(MISSION_STANCES));
    // "The main enemy": more of the board points at the government than any other way.
    expect(byStance('against_government').length).toBeGreaterThan(byStance('unaligned').length);
    expect(byStance('against_government').length).toBeGreaterThan(
      byStance('for_government').length,
    );
    // §D8 `Collaborator` has to be a real choice rather than one repeatable errand, so state work
    // comes in more than one flavour.
    expect(byStance('for_government').length).toBeGreaterThan(1);
    expect(new Set(byStance('for_government').map((t) => t.kind)).size).toBeGreaterThan(1);
  });

  it('names the Combine in the brief of every job that touches it (§A3)', () => {
    // Mission fiction hangs off the one antagonist: a stance the brief never mentions would move a
    // §D8 counter the player was never told about.
    for (const template of MISSION_TEMPLATES.filter((t) => t.stance !== 'unaligned')) {
      expect(template.brief, template.id).toContain(GOVERNMENT.adjective);
    }
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
    expect(rewardScale(REWARD_BASELINE_MINUTES, 'standard')).toBe(1);
  });

  it('pays a battle more than standard work for identical time', () => {
    expect(rewardScale(120, 'battle')).toBeGreaterThan(rewardScale(120, 'standard'));
    expect(rewardScale(120, 'battle') / rewardScale(120, 'standard')).toBeCloseTo(
      KIND_REWARD_MULTIPLIER.battle,
    );
  });

  it('pays a longer mission more in total but less per minute', () => {
    const short = rewardScale(30, 'standard');
    const long = rewardScale(1440, 'standard');
    expect(long).toBeGreaterThan(short);
    expect(long / 1440).toBeLessThan(short / 30);
  });

  it('scales an authored mix by the curve rather than paying it flat', () => {
    const expedition = findMissionTemplate('deep-expedition') as MissionTemplate;
    const scale = rewardScale(templateTimings(expedition).totalMinutes, expedition.kind);
    expect(scale).toBeGreaterThan(10);

    const rewards = missionRewards(expedition);
    for (const [key, authored] of Object.entries(expedition.spoils) as [ResourceKey, number][]) {
      expect(rewards[key]).toBe(Math.round(authored * scale));
    }
  });

  it('sends a failed standard run home with a salvage share and a failed battle with nothing', () => {
    const scrapRun = findMissionTemplate('scrap-run') as MissionTemplate;
    const salvage = missionRewards(scrapRun, 'failure');
    expect(salvage.scrap).toBeGreaterThan(0);
    expect(salvage.scrap).toBeLessThan(missionRewards(scrapRun, 'success').scrap ?? 0);
    expect(FAILURE_REWARD_SHARE.battle).toBe(0);

    for (const battle of MISSION_TEMPLATES.filter((t) => t.kind === 'battle')) {
      expect(missionRewards(battle, 'failure')).toEqual({});
    }
  });

  it('drops a line that rounds to zero instead of paying a phantom resource', () => {
    const template: MissionTemplate = {
      id: 'test-only',
      name: 'Test',
      brief: 'Test',
      kind: 'standard',
      difficulty: 'easy',
      stance: 'unaligned',
      travelBand: 'close',
      durationMinutes: 2,
      spoils: { scrap: 100, highQualityMetal: 1 },
      successChance: 1,
    };
    const rewards = missionRewards(template, 'failure');
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

  it('renders a countdown mm:ss, adding hours only when there are some', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5000)).toBe('00:00');
    expect(formatCountdown(59_000)).toBe('00:59');
    expect(formatCountdown(299_000)).toBe('04:59');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(3_899_000)).toBe('1:04:59');
  });
});
