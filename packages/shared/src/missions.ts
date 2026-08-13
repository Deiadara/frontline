import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { PartialResourcesSchema, type PartialResources, type ResourceKey } from './resources.js';

/**
 * Missions, travel and timers — GDD §E.
 *
 * Everything here is pure arithmetic over a mission record and a clock reading. The server is the
 * only authority on *when* a mission started and *what* it rolled; this module answers "given that
 * record and this instant, where is the crew and what is it worth?" — which is why the client can
 * share it to render live timers without ever being able to move one.
 */

/** Travel time by distance band (§E6). One way — §E8 charges it twice. */
export const TRAVEL_BAND_MINUTES = {
  close: 5,
  further: 20,
  furthest: 60,
} as const satisfies Record<string, number>;

export const TravelBandSchema = z.enum(
  Object.keys(TRAVEL_BAND_MINUTES) as [TravelBand, ...TravelBand[]],
);
export type TravelBand = keyof typeof TRAVEL_BAND_MINUTES;

/** Mission time itself runs from a couple of minutes up to a full day (§E7). */
export const MISSION_MIN_DURATION_MINUTES = 2;
export const MISSION_MAX_DURATION_MINUTES = 24 * 60;

/**
 * Battles pay more than standard work and risk your people (§E5). The risk is real: a lost battle
 * pays nothing and costs morale, where a standard run that goes wrong still limps home with a
 * salvage share.
 */
export const MissionKindSchema = z.enum(['standard', 'battle']);
export type MissionKind = z.infer<typeof MissionKindSchema>;

export const MissionOutcomeSchema = z.enum(['success', 'failure']);
export type MissionOutcome = z.infer<typeof MissionOutcomeSchema>;

export const MissionStatusSchema = z.enum(['active', 'resolved']);
export type MissionStatus = z.infer<typeof MissionStatusSchema>;

export const MissionTemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** One line of flavour for the pre-commit screen (§E4). */
  brief: z.string().min(1),
  kind: MissionKindSchema,
  travelBand: TravelBandSchema,
  durationMinutes: z
    .number()
    .int()
    .min(MISSION_MIN_DURATION_MINUTES)
    .max(MISSION_MAX_DURATION_MINUTES),
  /**
   * The thematic mix (§E1), authored as the bundle this mission would pay at
   * `REWARD_BASELINE_MINUTES`. The *amounts* a run actually pays come from `missionRewards`,
   * so two missions sharing a mix but not a length pay differently, purely by the §E5 curve.
   */
  spoils: PartialResourcesSchema,
  /** Chance the run succeeds outright, before any W4 assignee/officer modifier. */
  successChance: z.number().min(0).max(1),
});
export type MissionTemplate = z.infer<typeof MissionTemplateSchema>;

/**
 * The mission board. Every distance band and both kinds are represented, and the durations span
 * §E7's full range — a three-minute scrap run at one end, a day-long expedition at the other.
 */
export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  {
    id: 'scrap-run',
    name: 'Scrap Run',
    brief: 'Strip the collapsed overpass two blocks out before anyone else calls it theirs.',
    kind: 'standard',
    travelBand: 'close',
    durationMinutes: 3,
    spoils: { scrap: 40, caps: 5 },
    successChance: 0.97,
  },
  {
    id: 'ration-run',
    name: 'Ration Run',
    brief: 'A hydroponics bay under the market still runs. Its owners keep irregular hours.',
    kind: 'standard',
    travelBand: 'close',
    durationMinutes: 12,
    spoils: { food: 35, caps: 8 },
    successChance: 0.95,
  },
  {
    id: 'convoy-ambush',
    name: 'Convoy Ambush',
    brief: 'A short, loud job on the ring road. They are armed and they will shoot back.',
    kind: 'battle',
    travelBand: 'close',
    durationMinutes: 25,
    spoils: { caps: 30, oil: 20 },
    successChance: 0.78,
  },
  {
    id: 'fuel-siphon',
    name: 'Fuel Siphon',
    brief: 'The old tank farm is unguarded at shift change. Bring hose and patience.',
    kind: 'standard',
    travelBand: 'further',
    durationMinutes: 45,
    spoils: { oil: 45, scrap: 10 },
    successChance: 0.93,
  },
  {
    id: 'foundry-raid',
    name: 'Foundry Raid',
    brief: 'Hit the smelter floor while the pour is hot and walk out with finished stock.',
    kind: 'battle',
    travelBand: 'further',
    durationMinutes: 60,
    spoils: { highQualityMetal: 6, scrap: 25 },
    successChance: 0.74,
  },
  {
    id: 'courier-contract',
    name: 'Courier Contract',
    brief: 'Move a sealed crate across three districts. Do not open it. Do not be late.',
    kind: 'standard',
    travelBand: 'further',
    durationMinutes: 90,
    spoils: { caps: 55 },
    successChance: 0.91,
  },
  {
    id: 'refinery-assault',
    name: 'Refinery Assault',
    brief: 'Take the outer refinery and hold it long enough to empty the alloy store.',
    kind: 'battle',
    travelBand: 'furthest',
    durationMinutes: 480,
    spoils: { highQualityMetal: 10, oil: 25, scrap: 20 },
    successChance: 0.7,
  },
  {
    id: 'deep-expedition',
    name: 'Deep Expedition',
    brief: 'A full day beyond the wire. They go dark until they are back at the gate.',
    kind: 'standard',
    travelBand: 'furthest',
    durationMinutes: MISSION_MAX_DURATION_MINUTES,
    spoils: { caps: 20, food: 20, oil: 15, scrap: 25, highQualityMetal: 3 },
    successChance: 0.88,
  },
];

export function findMissionTemplate(templateId: string): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find((template) => template.id === templateId);
}

/** How long a run takes, broken out the way §E4 requires it to be shown. */
export interface MissionTimings {
  /** One-way travel (§E6). */
  travelMinutes: number;
  /** Time on site, excluding travel (§E7). */
  durationMinutes: number;
  /** §E8 — total elapsed is two legs of travel plus the mission itself. */
  totalMinutes: number;
}

export function missionTimings(leg: {
  travelMinutes: number;
  durationMinutes: number;
}): MissionTimings {
  return { ...leg, totalMinutes: 2 * leg.travelMinutes + leg.durationMinutes };
}

export function templateTimings(template: MissionTemplate): MissionTimings {
  return missionTimings({
    travelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
    durationMinutes: template.durationMinutes,
  });
}

/**
 * Reward scaling (§E5).
 *
 * Yield grows with total elapsed time but sub-linearly, so a long run pays far more in absolute
 * terms while a short one stays the better rate. That is what keeps the board worth reading: if
 * the exponent were 1 every mission would pay the same per minute and only the longest would
 * matter; above 1, nothing but the longest would ever be worth launching.
 */
export const REWARD_BASELINE_MINUTES = 30;
export const REWARD_TIME_EXPONENT = 0.8;

/** Battles pay a premium over standard work for the same time on the clock (§E5). */
export const KIND_REWARD_MULTIPLIER: Record<MissionKind, number> = {
  standard: 1,
  battle: 1.6,
};

/** A failed *standard* run still comes home with something; a failed battle does not (§E5). */
export const FAILURE_REWARD_SHARE: Record<MissionKind, number> = {
  standard: 0.25,
  battle: 0,
};

export function rewardScale(totalMinutes: number, kind: MissionKind): number {
  return (
    (totalMinutes / REWARD_BASELINE_MINUTES) ** REWARD_TIME_EXPONENT * KIND_REWARD_MULTIPLIER[kind]
  );
}

/**
 * What a run pays out: the template's thematic mix (§E1) scaled by the §E5 time curve, then by
 * the share the outcome earns. Amounts are whole units, and a share that rounds a line to zero
 * drops it rather than paying a phantom resource.
 */
export function missionRewards(
  template: MissionTemplate,
  outcome: MissionOutcome = 'success',
): PartialResources {
  const share = outcome === 'success' ? 1 : FAILURE_REWARD_SHARE[template.kind];
  const factor = rewardScale(templateTimings(template).totalMinutes, template.kind) * share;

  const rewards: PartialResources = {};
  for (const [key, amount] of Object.entries(template.spoils) as [ResourceKey, number][]) {
    const scaled = Math.round(amount * factor);
    if (scaled > 0) rewards[key] = scaled;
  }
  return rewards;
}

/**
 * Morale moved by a mission coming home (§D4). W2 parked this driver as a `TODO-LATER` in
 * `economy/meters.ts` and named W3 as its owner; this is it. A won battle lifts the crew most, a
 * lost one costs the most — that is where "risking your people" lands until W4's assignee pool
 * gives casualties somebody to happen to.
 */
export const MISSION_MORALE_DELTA: Record<MissionKind, Record<MissionOutcome, number>> = {
  standard: { success: 1, failure: -2 },
  battle: { success: 4, failure: -8 },
};

/**
 * A launched mission.
 *
 * `travelMinutes` and `durationMinutes` are copied off the template at launch and never re-read
 * from it: a run already in flight must keep the clock it was launched under, so retuning the
 * board cannot retime or refund somebody's day-long expedition halfway through.
 *
 * Note what is *not* here — the roll seed. It lives in a server-only column so that holding a
 * mission id tells you nothing about how it is going to end.
 */
export const MissionSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  templateId: IdSchema,
  startedAt: IsoDateTimeSchema,
  travelMinutes: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive(),
  status: MissionStatusSchema,
  /** Null until the mission resolves. */
  outcome: MissionOutcomeSchema.nullable(),
  /** What was actually banked. Empty until the mission resolves. */
  rewards: PartialResourcesSchema,
  resolvedAt: IsoDateTimeSchema.nullable(),
});
export type Mission = z.infer<typeof MissionSchema>;

/**
 * Where the crew is (§E2) — they travel out, work, and travel back, and they are *away* for all
 * three. `returned` means the clock is up; whether the payout has been banked yet is `status`.
 */
export const MissionPhaseSchema = z.enum(['outbound', 'onSite', 'returning', 'returned']);
export type MissionPhase = z.infer<typeof MissionPhaseSchema>;

const MINUTE_MS = 60_000;

export function missionCompletesAt(mission: Mission): Date {
  const { totalMinutes } = missionTimings(mission);
  return new Date(Date.parse(mission.startedAt) + totalMinutes * MINUTE_MS);
}

/** Milliseconds until the crew is back at the gate; never negative. */
export function missionRemainingMs(mission: Mission, now: Date): number {
  return Math.max(0, missionCompletesAt(mission).getTime() - now.getTime());
}

export function missionPhaseAt(mission: Mission, now: Date): MissionPhase {
  const elapsedMinutes = (now.getTime() - Date.parse(mission.startedAt)) / MINUTE_MS;
  const { travelMinutes, durationMinutes, totalMinutes } = missionTimings(mission);

  if (elapsedMinutes >= totalMinutes) return 'returned';
  if (elapsedMinutes >= travelMinutes + durationMinutes) return 'returning';
  if (elapsedMinutes >= travelMinutes) return 'onSite';
  return 'outbound';
}

/** Fraction of the whole round trip completed, clamped to 0..1 — the timer bar on §E3's page. */
export function missionProgressAt(mission: Mission, now: Date): number {
  const elapsedMs = now.getTime() - Date.parse(mission.startedAt);
  const totalMs = missionTimings(mission).totalMinutes * MINUTE_MS;
  return Math.min(1, Math.max(0, elapsedMs / totalMs));
}

/** True once the clock is up but the payout has not been banked — what the resolver looks for. */
export function isMissionDue(mission: Mission, now: Date): boolean {
  return mission.status === 'active' && missionRemainingMs(mission, now) === 0;
}

/** `1h 05m`, `12m`, `2m` — compact enough for a timer column, exact to the minute. */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** `04:59` under an hour, `1:04:59` over it — the live countdown on §E3's page. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
