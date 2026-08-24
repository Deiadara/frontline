import { z } from 'zod';
import { MissionDifficultySchema } from './assignees/delegation.js';
import { MissionStanceSchema, type MissionStance } from './factions.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { PartialResourcesSchema, type PartialResources, type ResourceKey } from './resources.js';

/**
 * Missions, travel and timers: GDD §E.
 *
 * Everything here is pure arithmetic over a mission record and a clock reading. The server is the
 * only authority on *when* a mission started and *what* it rolled; this module answers "given that
 * record and this instant, where is the crew and what is it worth?", which is why the client can
 * share it to render live timers without ever being able to move one.
 */

/** Travel time by distance band (§E6). One way: §E8 charges it twice. */
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
  /**
   * §G6: hard runs require an officer; easy ones can go out on assignees alone. Authored per
   * mission rather than derived from `kind` or length: a day-long standard expedition beyond the
   * wire is not "easy" just because nobody shoots at you, and the board asked for a hard/easy
   * split, not a battle/standard one.
   */
  difficulty: MissionDifficultySchema,
  /**
   * §A3, who the job is aimed at. The Combine is the one antagonist NPC content has, so the
   * board is mostly work against it, some work that ignores it, and a little work *for* it. This
   * is also the §D8 driver: `recordMissionOutcome` reads it and nothing else.
   */
  stance: MissionStanceSchema,
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
 * §E7's full range: a three-minute scrap run at one end, a day-long expedition at the other.
 *
 * §A3: the Combine is the antagonist the board is written against: most of the paying work is a
 * blow against it, a little is honest scavenging it does not care about, and two jobs are the
 * Combine's own, taken for its caps. That last pair is what makes §D8's `Collaborator` a choice a
 * player can actually make rather than a word in a table.
 */
export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  {
    id: 'scrap-run',
    name: 'Scrap Run',
    brief:
      'The overpass came down in the spring and nobody has cleared it. Two blocks out. Take the crew, take the cutters, come back heavy.',
    kind: 'standard',
    difficulty: 'easy',
    stance: 'unaligned',
    travelBand: 'close',
    durationMinutes: 3,
    spoils: { scrap: 40, caps: 5 },
    successChance: 0.97,
  },
  {
    id: 'ration-run',
    name: 'Ration Run',
    brief:
      'There is a growing bay under the market that still has power. Whoever runs it keeps strange hours. Go while the lights are off.',
    kind: 'standard',
    difficulty: 'easy',
    stance: 'unaligned',
    travelBand: 'close',
    durationMinutes: 12,
    spoils: { food: 35, caps: 8 },
    successChance: 0.95,
  },
  {
    id: 'convoy-ambush',
    name: 'Convoy Ambush',
    brief:
      'Combine ration trucks take the ring road at dusk. Four minutes of work if it goes well. The escort is paid to make sure it does not.',
    kind: 'battle',
    difficulty: 'hard',
    stance: 'against_government',
    travelBand: 'close',
    durationMinutes: 25,
    spoils: { caps: 30, oil: 20 },
    successChance: 0.78,
  },
  {
    id: 'fuel-siphon',
    name: 'Fuel Siphon',
    brief:
      'Shift change at the Combine tank farm leaves twenty minutes with nobody watching the valves. Bring hose. Bring somebody who can stay quiet that long.',
    kind: 'standard',
    difficulty: 'easy',
    stance: 'against_government',
    travelBand: 'further',
    durationMinutes: 45,
    spoils: { oil: 45, scrap: 10 },
    successChance: 0.93,
  },
  {
    id: 'foundry-raid',
    name: 'Foundry Raid',
    brief:
      'The Combine smelter pours at two in the morning. Walk in while the metal is still moving and walk out with it finished. The floor crew will not thank you.',
    kind: 'battle',
    difficulty: 'hard',
    stance: 'against_government',
    travelBand: 'further',
    durationMinutes: 60,
    spoils: { highQualityMetal: 6, scrap: 25 },
    successChance: 0.74,
  },
  {
    id: 'courier-contract',
    name: 'Courier Contract',
    brief:
      'A Combine broker wants a sealed crate carried three districts over. He is not saying what is in it and you are not asking. Late is worse than light.',
    kind: 'standard',
    difficulty: 'easy',
    stance: 'for_government',
    travelBand: 'further',
    durationMinutes: 90,
    spoils: { caps: 55 },
    successChance: 0.91,
  },
  {
    id: 'curfew-sweep',
    name: 'Curfew Sweep',
    brief:
      'The Combine is short of bodies on the lower tiers, so it is paying crews to hold its curfew for it. Good money. Your neighbours will remember who took it.',
    kind: 'battle',
    difficulty: 'hard',
    stance: 'for_government',
    travelBand: 'close',
    durationMinutes: 40,
    // Combine pay: caps and the metal a state armoury can spare, never food it would rather ration.
    spoils: { caps: 70, highQualityMetal: 4 },
    successChance: 0.82,
  },
  {
    id: 'refinery-assault',
    name: 'Refinery Assault',
    brief:
      'Take the outer Combine refinery and sit on it long enough to empty the alloy store. Getting in is loud. Holding it is the hard part.',
    kind: 'battle',
    difficulty: 'hard',
    stance: 'against_government',
    travelBand: 'furthest',
    durationMinutes: 480,
    spoils: { highQualityMetal: 10, oil: 25, scrap: 20 },
    successChance: 0.7,
  },
  {
    id: 'deep-expedition',
    name: 'Deep Expedition',
    brief:
      'A full day out, past the last checkpoint, into ground nobody has mapped since the flood. No word from them until they are back at the gate.',
    kind: 'standard',
    difficulty: 'hard',
    stance: 'unaligned',
    travelBand: 'furthest',
    durationMinutes: MISSION_MAX_DURATION_MINUTES,
    spoils: { caps: 20, food: 20, oil: 15, scrap: 25, highQualityMetal: 3 },
    successChance: 0.88,
  },
];

/**
 * §A4: what the ground takes off a mission's clock.
 *
 * The Smuggler's Tunnel, essentially: there is a shorter way across the city and you own it. Capped
 * hard, because a mission that lands the moment it is launched is a mission with no decision in it,
 * and floored at a minute for the same reason a build is.
 */
export const MAX_MISSION_SPEED_BONUS = 50;

export function hastenedMinutes(minutes: number, speedPercent: number): number {
  const bonus = Math.min(MAX_MISSION_SPEED_BONUS, Math.max(0, speedPercent));
  return Math.max(1, Math.round(minutes / (1 + bonus / 100)));
}

export function findMissionTemplate(templateId: string): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find((template) => template.id === templateId);
}

/** How long a run takes, broken out the way §E4 requires it to be shown. */
export interface MissionTimings {
  /** One-way travel (§E6). */
  travelMinutes: number;
  /** Time on site, excluding travel (§E7). */
  durationMinutes: number;
  /** §E8: total elapsed is two legs of travel plus the mission itself. */
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
 *
 * `totalMinutes` defaults to the template's *current* timings, which is what the board wants when
 * it quotes an unlaunched mission. A run already in flight must pass the total frozen on its row
 * instead, so retuning the board cannot re-price a crew that is already out: see the invariant on
 * `MissionSchema`.
 *
 * Residue (deliberate, needs a schema change to close): `kind` and `spoils` are still read live off
 * the template, so a retune of either still moves an in-flight payout, as do the failure share and
 * the morale delta that hang off `kind`. Closing that needs a `kind` column on the mission row and
 * a migration number allocated by the CTO per R8, so it is out of scope here.
 */
export function missionRewards(
  template: MissionTemplate,
  outcome: MissionOutcome = 'success',
  totalMinutes: number = templateTimings(template).totalMinutes,
): PartialResources {
  const share = outcome === 'success' ? 1 : FAILURE_REWARD_SHARE[template.kind];
  const factor = rewardScale(totalMinutes, template.kind) * share;

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
 * lost one costs the most. That is where "risking your people" lands until W4's assignee pool
 * gives casualties somebody to happen to.
 */
export const MISSION_MORALE_DELTA: Record<MissionKind, Record<MissionOutcome, number>> = {
  standard: { success: 1, failure: -2 },
  battle: { success: 4, failure: -8 },
};

/**
 * Infamy moved by a mission coming home (§D7, §A3): keyed on which way the job pointed at the
 * Combine rather than on how hard it was, because infamy is about *who you crossed*, not effort.
 *
 * Only anti-government work is loud, and only when it lands: a failed run at the state is already
 * priced in morale and in `Reckless`, and counting it here would let a crew build a reputation out
 * of things it did not manage to do. Work *for* the Combine moves nothing: collaboration is a
 * §D8 reputation matter, and being useful to the state does not make the street afraid of you.
 */
export const MISSION_INFAMY_DELTA: Record<MissionStance, Record<MissionOutcome, number>> = {
  against_government: { success: 2, failure: 0 },
  for_government: { success: 0, failure: 0 },
  unaligned: { success: 0, failure: 0 },
};

/**
 * A launched mission.
 *
 * `travelMinutes` and `durationMinutes` are copied off the template at launch and never re-read
 * from it: a run already in flight must keep the clock it was launched under, so retuning the
 * board cannot retime or refund somebody's day-long expedition halfway through.
 *
 * Note what is *not* here: the roll seed. It lives in a server-only column so that holding a
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
  /**
   * §G6: the officer leading the run, or `null` for a delegation of assignees alone.
   *
   * Frozen at launch like the clock and the odds: this records *who went*, so dismissing an
   * officer or reshuffling placements mid-flight cannot rewrite who was out. It is what
   * `characterXpForActivity` (INTERFACES §2 R2) pays when the crew comes home.
   */
  officerId: IdSchema.nullable(),
  /** Null until the mission resolves. */
  outcome: MissionOutcomeSchema.nullable(),
  /** What was actually banked. Empty until the mission resolves. */
  rewards: PartialResourcesSchema,
  resolvedAt: IsoDateTimeSchema.nullable(),
  /**
   * When the crew was turned around, or `null` if they were left to finish.
   *
   * A recall does not stop a mission; it *reverses* it. The crew is however far out they had got,
   * and getting back takes exactly as long as getting there did, so the new arrival is
   * `recalledAt + (recalledAt - startedAt)`, and it is derived from this rather than written into
   * the clock. Keeping the original `startedAt`, `travelMinutes` and `durationMinutes` intact is
   * what lets the report say how long they were out and how far they got.
   *
   * They come home with nothing. They never reached the site.
   */
  recalledAt: IsoDateTimeSchema.nullable().default(null),
});
export type Mission = z.infer<typeof MissionSchema>;

/**
 * Where the crew is (§E2): they travel out, work, and travel back, and they are *away* for all
 * three. `returned` means the clock is up; whether the payout has been banked yet is `status`.
 */
export const MissionPhaseSchema = z.enum(['outbound', 'onSite', 'returning', 'returned']);
export type MissionPhase = z.infer<typeof MissionPhaseSchema>;

const MINUTE_MS = 60_000;

export function missionCompletesAt(mission: Mission): Date {
  // A recalled crew is walking back the way they came: the return leg is exactly as long as the
  // time they had already been travelling when the order reached them.
  if (mission.recalledAt !== null) {
    const out = Date.parse(mission.recalledAt) - Date.parse(mission.startedAt);
    return new Date(Date.parse(mission.recalledAt) + out);
  }
  const { totalMinutes } = missionTimings(mission);
  return new Date(Date.parse(mission.startedAt) + totalMinutes * MINUTE_MS);
}

/** Milliseconds until the crew is back at the gate; never negative. */
export function missionRemainingMs(mission: Mission, now: Date): number {
  return Math.max(0, missionCompletesAt(mission).getTime() - now.getTime());
}

export function missionPhaseAt(mission: Mission, now: Date): MissionPhase {
  // Recalled crews only have two states: on the road home, or home.
  if (mission.recalledAt !== null) {
    return now.getTime() >= missionCompletesAt(mission).getTime() ? 'returned' : 'returning';
  }
  const elapsedMinutes = (now.getTime() - Date.parse(mission.startedAt)) / MINUTE_MS;
  const { travelMinutes, durationMinutes, totalMinutes } = missionTimings(mission);

  if (elapsedMinutes >= totalMinutes) return 'returned';
  if (elapsedMinutes >= travelMinutes + durationMinutes) return 'returning';
  if (elapsedMinutes >= travelMinutes) return 'onSite';
  return 'outbound';
}

/** Fraction of the whole round trip completed, clamped to 0..1: the timer bar on §E3's page. */
export function missionProgressAt(mission: Mission, now: Date): number {
  if (mission.recalledAt !== null) {
    const recalled = Date.parse(mission.recalledAt);
    const home = missionCompletesAt(mission).getTime();
    const leg = home - recalled;
    return leg <= 0 ? 1 : Math.min(1, Math.max(0, (now.getTime() - recalled) / leg));
  }
  const elapsedMs = now.getTime() - Date.parse(mission.startedAt);
  const totalMs = missionTimings(mission).totalMinutes * MINUTE_MS;
  return Math.min(1, Math.max(0, elapsedMs / totalMs));
}

/**
 * Whether a crew can still be turned around.
 *
 * Only while they are still out. Once the clock is up they are at the gate and the only thing left
 * is to bank whatever they came back with, so a recall at that point would be a way of *deleting*
 * a payout rather than cancelling a trip.
 */
export function canRecall(mission: Mission, now: Date): boolean {
  return (
    mission.status === 'active' &&
    mission.recalledAt === null &&
    now.getTime() < missionCompletesAt(mission).getTime()
  );
}

/** True once the clock is up but the payout has not been banked: what the resolver looks for. */
export function isMissionDue(mission: Mission, now: Date): boolean {
  return mission.status === 'active' && missionRemainingMs(mission, now) === 0;
}

/** `1h 05m`, `12m`, `2m`: compact enough for a timer column, exact to the minute. */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/** `04:59` under an hour, `1:04:59` over it: the live countdown on §E3's page. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
