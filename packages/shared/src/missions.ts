import { z } from 'zod';
import { InventorySchema } from './items/inventory.js';
import { cancelWindowMs, cancelWindowOpen } from './time/cancel.js';
import { FleetSchema } from './building/vehicles.js';
import { OfficerMarkSchema } from './crew/marks.js';
import { fightPayFactor, gradePay, gradedDurationMinutes, type Grade } from './missions.grade.js';
import { MissionLeaningSchema } from './missions.leading.js';
import { RESOURCE_CAP_VALUE } from './market/offers.js';
import { CORE_JOBS } from './mission-catalog/core.js';
import { STREET_JOBS } from './mission-catalog/street.js';
import { DISTRICT_JOBS } from './mission-catalog/district.js';
import { STRONGHOLD_JOBS } from './mission-catalog/stronghold.js';
import { MAYHEM_JOBS } from './mission-catalog/mayhem.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { PartialResourcesSchema, type PartialResources, type ResourceKey } from './resources.js';
import { ArmySchema } from './units/index.js';
import { effortScale, EFFORT_BASELINE_MINUTES } from './progression/effort.js';
import { roadMinutes } from './time/speed.js';
import { missionSpeedCut } from './economy/soft-bounds.js';
import { BlueprintCategorySchema, BlueprintPageIdSchema } from './blueprints/catalog.js';

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
 * pays nothing and can cost you the crew you sent, where a standard run that goes wrong still
 * limps home with a salvage share.
 */
export const MissionKindSchema = z.enum(['standard', 'battle']);
export type MissionKind = z.infer<typeof MissionKindSchema>;

export const MissionOutcomeSchema = z.enum(['success', 'failure']);
export type MissionOutcome = z.infer<typeof MissionOutcomeSchema>;

export const MissionStatusSchema = z.enum(['active', 'resolved']);

/**
 * Which board a job came off: a district id, or `misc` (`missions.areas.ts`).
 *
 * Declared here rather than beside the areas themselves, and it has to be: the area module reads
 * the template catalogue below, so a schema imported the other way is a cycle, and a cycle in a
 * module that runs at import time is a `Cannot read properties of undefined` at boot.
 */
export const MissionAreaIdSchema = z.string().min(1);

export const MissionTemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  /** One line of flavour for the pre-commit screen (§E4). */
  brief: z.string().min(1),
  kind: MissionKindSchema,
  /**
   * The lowest and highest grade this job is dealt at (maintainer, 2026-09-28).
   *
   * A job is not one difficulty: the same scrap run can be an easy F- in a quiet week and a tense
   * E when the yard has a guard on it. The board deals a grade from the crew's level
   * (`missions.grade.ts`) and puts a job on the card whose range covers it, and the grade then
   * sets the odds, the force a fight fields, the pay and how much longer than `durationMinutes`
   * the work takes. A fight's range stays inside one of Skirmish, Battle, Siege or Mayhem.
   */
  grades: z.tuple([OfficerMarkSchema, OfficerMarkSchema]),
  travelBand: TravelBandSchema,
  durationMinutes: z
    .number()
    .int()
    .min(MISSION_MIN_DURATION_MINUTES)
    .max(MISSION_MAX_DURATION_MINUTES),
  /**
   * The thematic mix (§E1): which resources a job pays in, and in what proportion. A Timber Pull
   * comes home with timber.
   *
   * ## Only the proportions are authored
   *
   * **What a bundle is worth is not.** `missionRewards` prices every mix to {@link BUNDLE_VALUE}
   * caps at `REWARD_BASELINE_MINUTES` before the §E5 clock curve, the kind and the grade move it,
   * so two jobs of the same length, kind and grade pay the same whatever they pay it in.
   *
   * It used to be priced by hand: each bundle authored so that its value times its success chance
   * came to 143, give or take 15%. That held a catalogue of thirty-eight together and would not
   * have held three hundred, and the success chance it was priced against stopped being a fact
   * about the job when the odds moved to the leader's grade.
   */
  spoils: PartialResourcesSchema,
  /**
   * What the job leans on in whoever leads it (`missions.leading.ts`), one to three. A fight
   * always leans on `fight`; plain work never does.
   */
  leanings: z.array(MissionLeaningSchema).min(1).max(3),
});
export type MissionTemplate = z.infer<typeof MissionTemplateSchema>;

/**
 * The mission board. Every distance band and both kinds are represented, and the durations span
 * §E7's full range: a three-minute scrap run at one end, a day-long expedition at the other.
 *
 * §A3: the Combine is the antagonist the board is written against, and that lives in the briefs.
 * It used to live in a `stance` field as well, which nothing read back: no officer cared which way
 * a job pointed, no screen kept a tally, and the reputation system it was the driver for is gone.
 * What a job asks of a crew is its kind, its distance and what it leans on, and those are here.
 */
export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  ...CORE_JOBS,
  ...STREET_JOBS,
  ...DISTRICT_JOBS,
  ...STRONGHOLD_JOBS,
  ...MAYHEM_JOBS,
];

/**
 * §A4: what the ground takes off a mission's clock.
 *
 * The Smuggler's Tunnel, essentially: there is a shorter way across the city and you own it. Bent
 * rather than capped since 2026-10-05 (`missionSpeedCut`): a mission that lands the moment it is
 * launched is a mission with no decision in it, so the bonus closes on 60 and never reaches it, and
 * the clock is floored at a minute for the same reason a build is.
 */
export function hastenedMinutes(minutes: number, speedPercent: number): number {
  // Bent, not stopped (`missionSpeedCut`, maintainer 2026-10-05).
  const bonus = missionSpeedCut(speedPercent);
  return Math.max(1, Math.round(minutes / (1 + bonus / 100)));
}

/**
 * §C3: the travel leg, which is the one leg a machine or a fast pair of legs can shorten.
 *
 * A thin name over {@link roadMinutes}, so the mission road and the battle road are the same
 * arithmetic rather than two that agree by inspection. `speed` is the column's pace and divides;
 * `reductionPercent` is the ground's own cut and multiplies on top. The job leg keeps its own
 * divisor and its own 50 (`hastenedMinutes`): a shorter way across the city does not make the work
 * at the far end go faster.
 */
export function hastenedRoadMinutes(
  minutes: number,
  speed = 0,
  reductionPercent = 0,
  flatMinutesOff = 0,
  /** The Cartographer's cut off the road's base (`roadMinutes`). */
  baseCutPercent = 0,
): number {
  return roadMinutes(minutes, speed, reductionPercent, flatMinutesOff, baseCutPercent);
}

/** The minutes a run's pay and XP are priced on: what the card quoted, or the row's own clock. */
export function pricedTotalMinutes(mission: {
  pricedMinutes: number;
  travelMinutes: number;
  durationMinutes: number;
}): number {
  return mission.pricedMinutes > 0 ? mission.pricedMinutes : missionTimings(mission).totalMinutes;
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

/**
 * A job's clock at a grade: the road for its band and its time on site, which grows with each mark
 * above the job's lowest (`gradedDurationMinutes`). The job's lowest grade when a caller has none.
 */
export function templateTimings(
  template: MissionTemplate,
  grade: Grade = template.grades[0],
): MissionTimings {
  return missionTimings({
    travelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
    durationMinutes: gradedDurationMinutes(template, grade, MISSION_MAX_DURATION_MINUTES),
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
/**
 * Re-exported rather than re-declared: the curve is `progression/effort.ts` and belongs to every
 * system with a clock on it, not to this one. Kept under these names because §E5 and a good deal of
 * content and test code reads them.
 */
export const REWARD_BASELINE_MINUTES = EFFORT_BASELINE_MINUTES;

/**
 * What a run that came home empty pays: nothing, either kind (§E5).
 *
 * A failed standard run used to limp home with a quarter of the salvage. It does not any more:
 * the maintainer's rule is that a failure banks **no resources at all** and pays a fifth of the XP
 * instead (`FAILED_MISSION_XP_SHARE`), which is a cleaner trade and the one the mission cards
 * quote. Kept as a table rather than folded into `missionRewards` as a literal zero, because it
 * is the one place the rule is written down and the settler reads it through this function.
 */
export const FAILURE_REWARD_SHARE: Record<MissionKind, number> = {
  standard: 0,
  battle: 0,
};

/**
 * What every mix is priced to, in caps, at `REWARD_BASELINE_MINUTES` on a plain F- job.
 *
 * 190 is the old hand-priced target (143 expected) over the 75% a leader graded level with the
 * job lands at, so a crew matched to its work earns about what it earned before the regrade.
 */
export const BUNDLE_VALUE = 190;

/** A mix's worth in caps, at the market's own valuation. */
export function spoilsValue(spoils: PartialResources): number {
  return (Object.entries(spoils) as [ResourceKey, number][]).reduce(
    (total, [key, amount]) => total + amount * RESOURCE_CAP_VALUE[key],
    0,
  );
}

/**
 * What a job's kind does to its pay: nothing for plain work, the fight premium for a battle (§E5).
 * Battles pay more than standard work for the same time on the clock, by more the harder the
 * grade (`fightPayFactor`, maintainer 2026-09-30).
 */
export function kindPayFactor(kind: MissionKind, grade: Grade): number {
  return kind === 'battle' ? fightPayFactor(grade) : 1;
}

/**
 * The clock curve, the kind's premium and the grade's pay (maintainer, 2026-09-28).
 *
 * The grade replaced two things: the crew-level pay premium and the fight tier ladder. A grade
 * pays what the level premium paid at the level the grade is most often dealt (`gradePay`), and a
 * fight takes its premium over that on top (`kindPayFactor`).
 */
export function rewardScale(totalMinutes: number, kind: MissionKind, grade: Grade): number {
  return effortScale(totalMinutes) * kindPayFactor(kind, grade) * gradePay(grade);
}

/**
 * The share of a job's non-caps worth that is paid in caps instead, by kind (maintainer,
 * 2026-10-01: "slightly buff the caps missions give so that the loot is more or less the same as
 * before but with more caps, especially for battles").
 *
 * Moved at the market's own valuation (`RESOURCE_CAP_VALUE`), so a mix is worth what it was worth
 * and only its shape changes. Measured over 40 days of every board at five levels: plain work went
 * from 23% caps to 31% and fights from 24% to 43%, with the total worth unchanged and the weight
 * within one percent.
 */
export const MISSION_CAPS_TILT: Readonly<Record<MissionKind, number>> = {
  standard: 0.1,
  battle: 0.25,
};

/** A job's authored mix with {@link MISSION_CAPS_TILT} of its non-caps worth moved into caps. */
export function capsTilted(spoils: PartialResources, kind: MissionKind): PartialResources {
  const tilt = MISSION_CAPS_TILT[kind];
  const mix: PartialResources = {};
  let moved = 0;
  for (const [key, amount] of Object.entries(spoils) as [ResourceKey, number][]) {
    if (key === 'caps') continue;
    mix[key] = amount * (1 - tilt);
    moved += amount * tilt * RESOURCE_CAP_VALUE[key];
  }
  const caps = (spoils.caps ?? 0) + moved / RESOURCE_CAP_VALUE.caps;
  if (caps > 0) mix.caps = caps;
  return mix;
}

/**
 * What a run pays out: the template's thematic mix (§E1) scaled by the §E5 time curve, then by
 * the share the outcome earns. Amounts are whole units, and a share that rounds a line to zero
 * drops it rather than paying a phantom resource.
 *
 * `totalMinutes` defaults to the template's *current* timings, which is what the maintainer wants when
 * it quotes an unlaunched mission. A run already in flight must pass the total frozen on its row
 * instead, so retuning the board cannot re-price a crew that is already out: see the invariant on
 * `MissionSchema`.
 *
 * Residue (deliberate, needs a schema change to close): `kind` and `spoils` are still read live off
 * the template, so a retune of either still moves an in-flight payout, as do the failure share and
 * the morale delta that hang off `kind`. Closing that needs a `kind` column on the mission row and
 * a migration number allocated centrally per R8, so it is out of scope here.
 */
export function missionRewards(
  template: MissionTemplate,
  outcome: MissionOutcome = 'success',
  totalMinutes: number = templateTimings(template).totalMinutes,
  /** The grade the card was dealt and the row froze. The job's lowest when a caller has none. */
  grade: Grade = template.grades[0],
): PartialResources {
  const share = outcome === 'success' ? 1 : FAILURE_REWARD_SHARE[template.kind];
  const mix = capsTilted(template.spoils, template.kind);
  const worth = spoilsValue(mix);
  const priced = worth > 0 ? BUNDLE_VALUE / worth : 0;
  const factor = rewardScale(totalMinutes, template.kind, grade) * share * priced;

  const rewards: PartialResources = {};
  for (const [key, amount] of Object.entries(mix) as [ResourceKey, number][]) {
    const scaled = Math.round(amount * factor);
    if (scaled > 0) rewards[key] = scaled;
  }
  return rewards;
}

/**
 * Infamy moved by a mission coming home (§D7): a fight is loud, quiet work is not.
 *
 * It used to be keyed on `stance`, paying 2 for a job aimed at the Combine and nothing for the
 * rest. Stance is gone (2026-09-12), so this hangs off the half of it the maintainer kept, which is the
 * better reading anyway: infamy is a name on the street, and a name is made by shooting at
 * somebody, not by which flag the person you shot at was under.
 *
 * Only when it lands. A failed run is already priced in morale and in `Reckless`, and counting it
 * here would let a crew build a reputation out of things it did not manage to do.
 *
 * A battle job's row is zero on both sides since 2026-09-15: it pays for what it killed instead,
 * half a point a unit slot rounded up (`missionInfamyForKills` in `economy/infamy.ts`), won or
 * lost, the way a declared fight pays both sides. The flat two it used to pay for landing was a
 * name for turning up, and the maintainer's rule is that a name is made by killing.
 */
export const MISSION_INFAMY_DELTA: Record<MissionKind, Record<MissionOutcome, number>> = {
  battle: { success: 0, failure: 0 },
  standard: { success: 0, failure: 0 },
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
  /**
   * Which board this came off: a district id, or `misc` (`missions.areas.ts`).
   *
   * Frozen at launch like everything else on the row. It is what closes the other two jobs in
   * that area for as long as this crew is out, and what a player is looking at when they arrow
   * across the board. Defaulted so a run launched before areas existed parses as miscellaneous
   * work, which is what it was.
   */
  areaId: MissionAreaIdSchema.default('misc'),
  /**
   * Percentage points on the payout, frozen at launch (`missions.areas.ts`).
   *
   * The ground's premium plus the crew's level, added up once when the crew leaves. Frozen for
   * exactly the reason the clock and the odds are: a crew that is already out must keep the terms
   * it went under. Without it the pay depended on *when the settle happened*, so a player who
   * watched their fleet come home was paid differently from one who slept through it, because
   * levelling mid-fleet moved the premium under the later crews.
   */
  payPercent: z.number().nonnegative().default(0),
  /**
   * The Bounty Wall's bounty on this run, frozen at launch (maintainer, 2026-10-07): the percent
   * a golden job pays on top, or 0. Absent on a run from before the wall, which reads as 0.
   */
  goldenPercent: z.number().int().nonnegative().optional(),
  /**
   * §I1: allegiance XP a clean run of this pays, frozen at launch for the same reason.
   *
   * What actually lands is this, or `FAILED_MISSION_XP_SHARE` of it for a run that came home
   * empty. Zero on a row written before missions priced their own XP, which reads as "fall back
   * to the table entry".
   */
  xp: z.number().int().nonnegative().default(0),
  /**
   * What the return actually banked: `xp` above (or a failure's share of it) with the district's
   * and the crew's XP bonus on top (`boostedXp`). Absent until the run is home, and on any run that
   * came home before it was kept (bug pass, 2026-10-02), where the report falls back to `xp`.
   */
  xpPaid: z.number().int().nonnegative().optional(),
  /** The infamy the return banked (a battle job's beaten enemy). Absent before 0137 and on plain work. */
  infamyPaid: z.number().int().nonnegative().optional(),
  /** The Bone Market's caps for the crew's own dead, as the return banked them. Absent before 0137. */
  refund: PartialResourcesSchema.optional(),
  /**
   * What the crew that walked home could lift between them, as the settle worked it out at the
   * mark (`missionCarry`). Kept rather than recomputed on the report, which read today's loadouts,
   * bag and marks and could say "all 300, out of the 200 they could lift". Absent before 0147.
   */
  carryCapacity: z.number().nonnegative().optional(),
  /**
   * The units that went (§E, §A5).
   *
   * A mission is people now, not an abstraction: they leave `base.army` at launch and come back
   * into it when the crew is home, so a crew that is out cannot also be defending the district.
   * What they can carry between them is what caps the payout. Defaulted empty so a run launched
   * before missions took units parses as the delegation it was.
   */
  force: ArmySchema.default({}),
  /**
   * §C3: the machines carrying them, out of the Garage and back into it.
   *
   * Frozen on the row like the force and the clock, because the speed they bought was priced at
   * launch: a machine built or lost while a crew is on the road must not re-time a run already
   * under way. Defaulted empty, so a run launched before the Garage existed parses as the walk it
   * was.
   *
   * A mission never destroys one. A vehicle is lost when everybody riding it dies, and a mission
   * does not kill anybody (see `missions/resolve.ts`): what a failed run costs is the clock and
   * the pay. So these always come home, on a clean run and on a disaster alike.
   */
  vehicles: FleetSchema.default({}),
  /**
   * §C3: the clock the pay was quoted on, which is not the clock the crew is running to.
   *
   * `missionRewards` and `missionXp` scale with the total minutes, and the row's `travelMinutes`
   * has the machines' cut already taken off it. Pricing off the row therefore paid a crew *less*
   * for riding, about 12% on a long road, while the card and this module's own notes both said the
   * pay was untouched by vehicles. This is the total the card quoted: the crew's own speed and any
   * delegation terms applied, the machines not. Zero on a row written before it existed, which
   * reads as "price off the row's own clock", the way `xp: 0` falls back to the table.
   */
  pricedMinutes: z.number().int().nonnegative().default(0),
  startedAt: IsoDateTimeSchema,
  travelMinutes: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive(),
  status: MissionStatusSchema,
  /**
   * The officer leading the run, `null` when the Overseer led it (or, on a row from before every
   * run needed a leader, when nobody did).
   *
   * Frozen at launch like the clock and the odds: this records *who went*, so dismissing an
   * officer or reshuffling placements mid-flight cannot rewrite who was out. It is what says an
   * officer is unavailable while the crew is away, and what the settle reads to put them in the
   * line when the job turns out to be a fight.
   */
  officerId: IdSchema.nullable(),
  /**
   * The grade the card was dealt, frozen when the crew left (maintainer, 2026-09-28).
   *
   * Kept for the reason the clock, the odds and the pay are: nothing that happens while the crew
   * is out may change what is waiting for them or what it pays. It sets what a fight fields and
   * what either kind pays. Null on a row from before grades, which reads as the job's lowest.
   */
  grade: OfficerMarkSchema.nullable().default(null),
  /**
   * Whether the Overseer led this run (maintainer, 2026-09-10). The Overseer is not on the books, so
   * they cannot be named by `officerId`; the two together say who was in charge. Only a row from
   * before every run needed a leader has neither. Defaulted so a row written before leaders parses
   * as the run it was.
   */
  overseerLed: z.boolean().default(false),
  /**
   * The units that did not come home from a battle job, by unit. Empty on every standard run
   * and on a battle nobody died in; `force` less this is what walked back into the district.
   */
  lost: ArmySchema.default({}),
  /**
   * Whether anybody came back to tell it. A battle job that loses the whole force sends no
   * report: the row settles, the units are gone, and the player learns the outcome from the
   * silence. Standard runs always report.
   */
  reported: z.boolean().default(true),
  /** Null until the mission resolves. */
  outcome: MissionOutcomeSchema.nullable(),
  /**
   * What the crew carried home. Empty until the mission resolves.
   *
   * Not all of it is necessarily in the stores: `wasted` is the part that had no room.
   */
  rewards: PartialResourcesSchema,
  /**
   * What came home and was thrown away because the stores were full (maintainer ruling,
   * 2026-09-28). `rewards` less this is what landed. Absent or empty on a run that fitted, and on
   * a run settled before the stores became a hard ceiling.
   */
  wasted: PartialResourcesSchema.optional(),
  /**
   * What the job paid before the crew's carrying capacity was applied (§E).
   *
   * `rewards` is this, capped by what the units sent could lift (`missionCarry`). The two are equal
   * on a run with enough porters, and the difference is what a player needs in order to learn that
   * they are under-crewing: it is the whole feedback loop for the carry mechanic.
   *
   * Empty on a mission resolved before this was recorded, which the report reads as "not known"
   * rather than as "nothing was left behind".
   */
  spoils: PartialResourcesSchema,
  /**
   * What the crew turned up, as opposed to what it was paid: salvage, pages, the odd relic.
   *
   * Written so the report can name it. It went straight into the inventory and was recorded
   * nowhere, so a player who came home with a Rotor Hub learned that by counting the inventory.
   * Defaulted empty: a run settled before this existed found nothing it can prove.
   */
  found: InventorySchema.default({}),
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
  /**
   * §F1b: the category of page this run was offered, frozen at launch.
   *
   * Carried on the mission and not re-derived from the board, for the same reason the clock and the
   * odds are: the board turns over at midnight and a crew that is still out must not have its
   * promised reward rewritten under it.
   */
  pagePrize: BlueprintCategorySchema.nullable().default(null),
  /**
   * §F1f: the page the run actually won, or null.
   *
   * Written by the settler on arrival and never before: this is the field the mission report reads
   * to name the page. Null while the crew is out, null on a run that failed, and null on a run that
   * was never carrying one.
   */
  pageWon: BlueprintPageIdSchema.nullable().default(null),
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
  // A recalled crew turns round where it stands, so the walk home is however far from home it is.
  //
  // Which is not the time since launch, and that is the whole subtlety. Time since launch is the
  // distance only during the outbound leg; a crew standing on the site is one leg out however long
  // it has been there, and a crew already walking back gets *closer* every minute. Charging time
  // since launch in all three cases sent a crew further away the longer the job had been running:
  // recalled a minute from the gate on a two hour job, they turned round and walked two more.
  if (mission.recalledAt !== null) {
    const recalledAt = Date.parse(mission.recalledAt);
    const elapsed = recalledAt - Date.parse(mission.startedAt);
    return new Date(recalledAt + minutesFromHome(mission, elapsed));
  }
  const { totalMinutes } = missionTimings(mission);
  return new Date(Date.parse(mission.startedAt) + totalMinutes * MINUTE_MS);
}

/**
 * How long the walk home is, in milliseconds, for a crew `elapsed` into its run.
 *
 * Clamped at both ends: a recall recorded before the launch (a clock skew, a hand-edited row)
 * cannot produce a negative leg, and one recorded after the run was already over cannot produce a
 * crew that arrives before it was told to turn round.
 */
function minutesFromHome(
  leg: { travelMinutes: number; durationMinutes: number },
  elapsed: number,
): number {
  const { travelMinutes, durationMinutes, totalMinutes } = missionTimings(leg);
  const out = travelMinutes * MINUTE_MS;
  if (elapsed <= 0) return 0;
  if (elapsed < out) return elapsed;
  if (elapsed < (travelMinutes + durationMinutes) * MINUTE_MS) return out;
  return Math.max(0, totalMinutes * MINUTE_MS - elapsed);
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
/**
 * Whether the crew can still be turned round: the first tenth of the way *out* (maintainer request,
 * 2026-09-12; `time/cancel.ts`).
 *
 * It was open right up to the gate, which made a run a thing you could abandon at any moment
 * for nothing. A run is a commitment now, the way a build and a batch are: ten percent of the
 * outbound leg to notice the wrong job, and after that they do it. The walk home is still the
 * distance covered (`missionCompletesAt`), so a recall in the window costs exactly the time spent.
 */
/**
 * A tenth of the **whole run**, not a tenth of the road out (maintainer, 2026-09-22).
 *
 * `totalMinutes` is two legs of travel plus the time on site, which is what a player is told the
 * run costs them and therefore the thing a tenth should be a tenth of. Measuring the outbound leg
 * alone made the window vary with the shape of the job rather than its size: a long job close by
 * could be called off for a shorter time than a short job far away, which is exactly backwards,
 * and on the Anyride templates, where travel is a fraction of the total, the window was a few
 * seconds on a run lasting hours. The same rule now holds for every clock in the game.
 */
function recallTotalMs(mission: Mission): number {
  return missionTimings(mission).totalMinutes * MINUTE_MS;
}

export function canRecall(mission: Mission, now: Date): boolean {
  return (
    mission.status === 'active' &&
    mission.recalledAt === null &&
    cancelWindowOpen(Date.parse(mission.startedAt), recallTotalMs(mission), now.getTime())
  );
}

/** How long is left to decide, or zero once the run is past the tenth of its whole clock. */
export function recallWindowMs(mission: Mission, now: Date): number {
  if (mission.status !== 'active' || mission.recalledAt !== null) return 0;
  return cancelWindowMs(Date.parse(mission.startedAt), recallTotalMs(mission), now.getTime());
}

/** True once the clock is up but the payout has not been banked: what the resolver looks for. */
export function isMissionDue(mission: Mission, now: Date): boolean {
  return mission.status === 'active' && missionRemainingMs(mission, now) === 0;
}

/** `1h 05m`, `12m`, `2m`: compact enough for a timer column, exact to the minute. */
export function formatDuration(totalMinutes: number): string {
  // Rounded before it is split (bug pass, 2026-10-06): rounding the minutes after the hours were
  // taken off read 119.6 as "1h 60m".
  const whole = Math.round(totalMinutes);
  const hours = Math.floor(whole / 60);
  const minutes = whole % 60;
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
