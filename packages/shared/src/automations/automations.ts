import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { ResourceKeySchema } from '../resources.js';
import { findUnit, isCombatUnit } from '../units/catalog.js';

/**
 * The Right Hand runs things in your absence (§C2b, maintainer 2026-09-22).
 *
 * The chair's sheet used to reach nothing outside its own research track. This is the third and
 * largest of the three things it now buys, and the only one with a screen: standing orders the
 * Right Hand carries out while nobody is looking, on the world clock, the same clock that already
 * lands a fight on its mark and brings a crew home for a player who is asleep.
 *
 * ## Built to have things attached to it
 *
 * The maintainer asked for this to be composable, so nothing here says "mission" in its shape.
 * An automation is a **slot** holding a `kind`, a force to commit, and a cooldown; the settler
 * that knows how to spend one is looked up by `kind` on the server (`automations/runners.ts`).
 * Adding a second thing the Right Hand can be told to do, a standing scout rotation, a standing
 * buy order at the Bar, is a new `kind`, a new runner and nothing else: no new table, no new
 * screen, no change to the unlock ladder or the cooldown.
 *
 * ## What it is never allowed to do
 *
 * It never calls a fight on a location. A battle here means a **battle-kind mission**, which is a
 * job off the board that happens to involve shooting, and which pays infamy. Attacking ground is
 * the one decision in this game that takes something off another player, and a standing order is
 * not how that should ever be made. `AUTOMATION_KINDS` has no entry for it and the runner table
 * has nowhere to put one.
 */

/** What a slot can be told to do. One entry per runner on the server. */
export const AUTOMATION_KINDS = ['missions'] as const;
export type AutomationKind = (typeof AUTOMATION_KINDS)[number];
export const AutomationKindSchema = z.enum(AUTOMATION_KINDS);

/**
 * Which jobs a slot will take, and in what order when it is told to take both.
 *
 * `missions` is every job that is not a fight, which is all a slot may take before the ladder's
 * ninth rung. `battles` is battle-kind jobs off the same board. `mixed` takes both and alternates:
 * a mission, then a fight, then a mission, and so on for as long as it is on.
 *
 * It replaced a pair of weighted sequences ("one mission then two battles" and its mirror) at the
 * maintainer's call on 2026-09-23. Two ratios nobody could feel the difference between were two
 * lines in a picker and two more paths through the runner, and the thing a player actually wants
 * from the tenth rung is "do both", which is one line and one path.
 */
export const AUTOMATION_ORDERS = ['missions', 'battles', 'mixed'] as const;
export type AutomationOrder = (typeof AUTOMATION_ORDERS)[number];
export const AutomationOrderSchema = z.enum(AUTOMATION_ORDERS);

/** The repeating pattern each order runs, as the kinds of job in sequence. */
export const ORDER_SEQUENCES: Readonly<Record<AutomationOrder, readonly ('mission' | 'battle')[]>> =
  {
    missions: ['mission'],
    battles: ['battle'],
    mixed: ['mission', 'battle'],
  };

/**
 * The gap between one party walking in and the next walking out.
 *
 * The maintainer's figures. It exists so a standing order is worth less per hour than a player
 * sitting at the screen: the whole feature is convenience, not a better rate, and without a gap a
 * slot would out-earn a human simply by never pausing.
 */
export const AUTOMATION_COOLDOWN_MS = 15 * 60_000;
export const AUTOMATION_FAST_COOLDOWN_MS = 5 * 60_000;

/**
 * The ladder, on the Right Hand's own research track.
 *
 * Rung 6 carries the shorter cooldown. The maintainer asked for it "as an upgrade after level 5"
 * without naming the rung, and 6 is the only step the ladder had not already spoken for.
 */
export const AUTOMATION_RUNGS = {
  /** One slot, an exact force, a named officer, non-fight jobs only. */
  open: 'tech_the_open_door',
  /** Name a size instead of a force: it picks the best units and the best officer for the job. */
  bestFit: 'tech_loyalty_bonuses',
  /** The gap drops from fifteen minutes to five. */
  fastCooldown: 'tech_unled_runs_free',
  /** A second slot, so two parties can be out at once. */
  secondSlot: 'tech_the_word_goes_round',
  /** Pick a resource; it takes the job with the best return per minute in it. */
  optimise: 'tech_field_promotions',
  /** Battle-kind jobs off the board. Never a fight on a location. */
  battles: 'tech_succession_planning',
  /** The alternating order: a mission, then a fight, then a mission. */
  mixedOrders: 'tech_the_house_holds',
} as const;

/** Everything the crew's research says the Right Hand may do. One read, one shape. */
export interface AutomationPowers {
  /** False until the third rung: no screen, no slots, nothing. */
  readonly unlocked: boolean;
  /** How many slots may hold a standing order at once: 0, 1 or 2. */
  readonly slots: number;
  /** Milliseconds between a party arriving home and the next going out. */
  readonly cooldownMs: number;
  /** Whether a slot may name a size and let the Right Hand choose the force. */
  readonly bestFit: boolean;
  /** Whether a slot may be told to optimise for one resource. */
  readonly optimise: boolean;
  /** Which orders the crew may choose from. Always at least `missions`. */
  readonly orders: readonly AutomationOrder[];
}

export function automationPowers(technologies: readonly string[]): AutomationPowers {
  const has = (rung: string): boolean => technologies.includes(rung);
  const unlocked = has(AUTOMATION_RUNGS.open);
  const battles = has(AUTOMATION_RUNGS.battles);
  const orders: AutomationOrder[] = ['missions'];
  if (battles) orders.push('battles');
  // The alternating order needs both halves: a sequence naming battles is meaningless without them.
  if (battles && has(AUTOMATION_RUNGS.mixedOrders)) orders.push('mixed');
  return {
    unlocked,
    slots: unlocked ? (has(AUTOMATION_RUNGS.secondSlot) ? 2 : 1) : 0,
    cooldownMs: has(AUTOMATION_RUNGS.fastCooldown)
      ? AUTOMATION_FAST_COOLDOWN_MS
      : AUTOMATION_COOLDOWN_MS,
    bestFit: has(AUTOMATION_RUNGS.bestFit),
    optimise: has(AUTOMATION_RUNGS.optimise),
    orders,
  };
}

/**
 * One standing order.
 *
 * `force` and `unitSlots` are the two ways to say who goes, and exactly one is set. `force` is the
 * third rung's exact list: these units, this officer, or nothing happens. `unitSlots` is the
 * fifth's, where the Right Hand picks the best force of that size and the best officer free to
 * lead it.
 */
export const AutomationSchema = z.object({
  id: IdSchema,
  baseId: IdSchema,
  /** 0 or 1. The second is only usable once the ladder opens it. */
  slot: z.number().int().min(0).max(1),
  kind: AutomationKindSchema,
  enabled: z.boolean().default(false),
  order: AutomationOrderSchema.default('missions'),
  /** How far through `ORDER_SEQUENCES[order]` this slot is, so a mixed order keeps its place. */
  step: z.number().int().nonnegative().default(0),
  /** The exact party, by unit id, for a slot running the third rung's way. */
  force: z.record(z.string(), z.number().int().positive()).default({}),
  /** The officer who must lead, for the same. Null once the slot is choosing for itself. */
  officerId: IdSchema.nullable().default(null),
  /** The size to fill when the Right Hand is choosing. Null when `force` is the instruction. */
  unitSlots: z.number().int().positive().nullable().default(null),
  /** The resource to chase, or null for the best job overall. */
  optimiseFor: ResourceKeySchema.nullable().default(null),
  /** The run this slot is waiting on, or null when it is idle. */
  missionId: IdSchema.nullable().default(null),
  /** When the last party walked back in. The cooldown is measured from here. */
  restingSince: IsoDateTimeSchema.nullable().default(null),
  /** Why the slot did nothing last time it was asked, for the screen. Null when it is fine. */
  stalled: z.string().nullable().default(null),
});
export type Automation = z.infer<typeof AutomationSchema>;

/** The kind of job this slot owes next, given where it is in its sequence. */
export function nextJobKind(automation: Pick<Automation, 'order' | 'step'>): 'mission' | 'battle' {
  const sequence = ORDER_SEQUENCES[automation.order];
  return sequence[automation.step % sequence.length] ?? 'mission';
}

/** When this slot may send again: now if it has never run, else the cooldown after it came home. */
export function readyAt(
  automation: Pick<Automation, 'restingSince'>,
  cooldownMs: number,
): number | null {
  if (automation.restingSince === null) return null;
  return Date.parse(automation.restingSince) + cooldownMs;
}

export function isResting(
  automation: Pick<Automation, 'restingSince'>,
  cooldownMs: number,
  now: Date,
): boolean {
  const ready = readyAt(automation, cooldownMs);
  return ready !== null && ready > now.getTime();
}

/**
 * The party the Right Hand fills a size with, or null when the yard cannot fill it.
 *
 * The fifth rung's rule, as the maintainer set it on 2026-09-23: the size is in **unit slots**,
 * the same currency the beds and the trucks count in, and it is filled by taking everything of the
 * most suitable unit at home, then everything of the next, until the slots are full. The last
 * stack is cut to whatever still fits, and a unit too big for the room left (a six-slot Juggernaut
 * against two slots) is skipped rather than jammed in.
 *
 * "Most suitable" is read off the job. A fight wants what hits hardest per slot, and only units
 * that fight at all; everything else wants what carries most per slot, since a job that is not a
 * fight is measured by what comes home. Nothing here is shown to the player: the sheet says
 * "best" and the Right Hand decides at the moment the party leaves.
 */
export function bestFitParty(
  army: Readonly<Record<string, number>>,
  unitSlots: number,
  kind: 'battle' | 'standard',
): Record<string, number> | null {
  const ranked = Object.entries(army)
    .flatMap(([unitId, count]) => {
      const unit = findUnit(unitId);
      if (!unit || count <= 0) return [];
      if (kind === 'battle' && !isCombatUnit(unit)) return [];
      const perSlot =
        kind === 'battle'
          ? (unit.stats.offense + unit.stats.vitality / 5) / unit.unitSlots
          : unit.stats.lootCapacity / unit.unitSlots;
      return [{ unitId, count, slots: unit.unitSlots, perSlot }];
    })
    .sort((a, b) => b.perSlot - a.perSlot || b.count - a.count);

  const picked: Record<string, number> = {};
  let filled = 0;
  for (const { unitId, count, slots } of ranked) {
    const room = Math.floor((unitSlots - filled) / slots);
    if (room <= 0) continue;
    const take = Math.min(count, room);
    picked[unitId] = take;
    filled += take * slots;
    if (filled >= unitSlots) break;
  }
  return filled < unitSlots ? null : picked;
}

/** Every unit slot at home: the ceiling on a size the Right Hand can be asked to fill. */
export function unitSlotsAtHome(army: Readonly<Record<string, number>>): number {
  return Object.entries(army).reduce(
    (sum, [unitId, count]) => sum + count * (findUnit(unitId)?.unitSlots ?? 1),
    0,
  );
}

/**
 * Whether the mission board belongs to the Right Hand right now.
 *
 * The maintainer's rule is the strong one: while **any** slot is switched on, the board is theirs
 * and nothing may be launched by hand, even if a crew slot is free. It is a rule a player can
 * state in one sentence, which is the argument for it over per-slot bookkeeping nobody can see.
 */
export function boardIsAutomated(automations: readonly Automation[]): boolean {
  return automations.some((one) => one.enabled);
}
