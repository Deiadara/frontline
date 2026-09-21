import { z } from 'zod';
import { ITEM_CATALOG, type ItemCost, type ItemId } from '../items/index.js';
import { RESOURCE_CAP_VALUE } from '../market/offers.js';
import { PartialResourcesSchema, RESOURCE_KEYS, type PartialResources } from '../resources.js';
import { ArmySchema, type Army } from '../units/training.js';
import { findUnit } from '../units/index.js';

/**
 * What finishing a feat pays, and how the whole catalogue is held to a budget.
 *
 * ## One currency for the balance check, not for the player
 *
 * A feat can pay six different things and the maintainer asked for all of them. That makes "is this
 * reward fair" impossible to answer by eye across five hundred entries, so everything is
 * priced into one number, caps-equivalent, and every feat declares which band it is supposed to
 * land in. `catalog.test.ts` then checks the whole catalogue in one pass, which is the only way a
 * balance claim about a table this size survives its first edit.
 *
 * The player never sees this number. It exists so that an author adding a feat cannot quietly hand
 * out a Heli-Porter for winning one fight.
 *
 * ## The exchange rates, and why each one is what it is
 *
 * Resources use `RESOURCE_CAP_VALUE`, the game's own table, so a feat and a market listing agree
 * about what a pile of scrap is worth. Units and items are priced at what they cost to make or
 * buy. The two rates below are the ones that had to be chosen rather than read off something.
 */

/**
 * What one point of experience is worth in caps.
 *
 * Read off the board itself. A `checkpoint-shakedown` pays 271 caps of spoils and 166 XP for the
 * same twenty-five minutes, which is 1.63 caps to the point; a `courier-contract` is 433 and 388,
 * which is 1.12. The middle of that is the rate, and it is deliberately a *low* one: experience is
 * the reward a player cannot buy anywhere else, so overpaying it here would make feats the fastest
 * way to level and turn the rest of the game into the slow path.
 */
export const CAPS_PER_XP = 1.4;

/**
 * What one point of infamy is worth in caps.
 *
 * Infamy has one real sink, the back room, where a good costs 120 to 520 infamy and hands over a
 * bundle worth a few thousand caps. That puts the street rate near ten, and ten is what this uses.
 * It is worth more than the arithmetic suggests, because infamy is not farmable: the only faucets
 * are fights and a battle mission landing, so a feat paying infamy is paying in the one currency a
 * patient player cannot simply wait for.
 */
export const CAPS_PER_INFAMY = 10;

/**
 * What a one-time battle boost is worth.
 *
 * Priced off the back room it comes from: the shelf sells these for 120 to 520 infamy, so the
 * middle of the shelf at the rate above is about three thousand, and a feat handing one over is
 * handing over a back-room visit nobody had to spend infamy on.
 */
export const CAPS_PER_BOOST = 3_000;

export const FeatRewardSchema = z
  .object({
    resources: PartialResourcesSchema.optional(),
    /** Blueprint pages, parts and relics, by catalogue id. */
    items: z.record(z.string(), z.number().int().positive()).optional(),
    /** Units, delivered straight onto the roster at home rather than into the training queue. */
    units: ArmySchema.optional(),
    xp: z.number().int().positive().optional(),
    infamy: z.number().int().positive().optional(),
    /** One-time battle boosts, into the stash the back room fills. By black-market good id. */
    boosts: z.array(z.string().min(1)).nonempty().optional(),
  })
  .refine(
    (reward) => Object.values(reward).some((value) => value !== undefined),
    'a feat has to pay something',
  );
export type FeatReward = z.infer<typeof FeatRewardSchema>;

function resourcesValue(resources: PartialResources | undefined): number {
  if (resources === undefined) return 0;
  return RESOURCE_KEYS.reduce(
    (total, key) => total + (resources[key] ?? 0) * RESOURCE_CAP_VALUE[key],
    0,
  );
}

function itemsValue(items: ItemCost | undefined): number {
  if (items === undefined) return 0;
  return Object.entries(items).reduce((total, [id, count]) => {
    const spec = ITEM_CATALOG[id as ItemId] as { capsValue: number } | undefined;
    // An unknown id prices at nothing rather than throwing. The catalogue test refuses one
    // outright, so reaching this means a retired item on a live save, and a feat that pays a
    // little less than it says is better than a screen that cannot render.
    return total + (spec?.capsValue ?? 0) * (count ?? 0);
  }, 0);
}

function unitsValue(units: Army | undefined): number {
  if (units === undefined) return 0;
  return Object.entries(units).reduce((total, [id, count]) => {
    const spec = findUnit(id);
    return total + resourcesValue(spec?.cost) * (count ?? 0);
  }, 0);
}

/** Everything a feat pays, in caps-equivalent. See the note at the top: this is for the gate. */
export function featRewardValue(reward: FeatReward): number {
  return (
    resourcesValue(reward.resources) +
    itemsValue(reward.items) +
    unitsValue(reward.units) +
    (reward.xp ?? 0) * CAPS_PER_XP +
    (reward.infamy ?? 0) * CAPS_PER_INFAMY +
    (reward.boosts?.length ?? 0) * CAPS_PER_BOOST
  );
}

/**
 * The three pricing bands, and what happened to them (maintainer, 2026-09-17).
 *
 * These used to be a **player-facing mechanic**: every rung wore an Early / Mid / Late pill, and
 * the feats board's first filter was a row of era chips. Both are gone. The word was never
 * something a player could aim at, because an era is a rough weight class rather than a gate (a
 * crew that rushed the Gauntlet meets mid-era feats at level 8 while a slow builder is still on
 * early ones at 15), and on a board of ladders it was worse than useless: a chain's whole shape is
 * that it starts early and finishes late, so the chips split every ladder into three.
 *
 * What is left is what the field always actually was: the axis `FEAT_REWARD_BANDS` is keyed on,
 * next to the size, so that an author cannot pay a first rung what a last one pays. It is
 * catalogue bookkeeping and nothing reads it onto a screen. `FEAT_ERA_LABELS` and
 * `FEAT_ERA_BLURBS`, which existed only to print it, went with the chips.
 */
export const FEAT_ERAS = ['early', 'mid', 'late'] as const;
export const FeatEraSchema = z.enum(FEAT_ERAS);
export type FeatEra = z.infer<typeof FeatEraSchema>;

export const FEAT_SIZES = ['small', 'medium', 'large'] as const;
export const FeatSizeSchema = z.enum(FEAT_SIZES);
export type FeatSize = z.infer<typeof FeatSizeSchema>;

/**
 * What a feat of each size and era is allowed to pay, in caps-equivalent.
 *
 * Anchored on the survey of the live economy rather than invented. A **small** early reward is
 * about one short mission, which is what a crew earns in the minutes it took to finish the feat. A
 * **medium** is a level-one building. A **large** early is the whole opening stockpile, which is
 * the biggest thing a new crew can picture.
 *
 * Mid and late are anchored on production instead, because by then a crew earns while asleep: mid
 * small is an hour of a level-8 district, mid large is two and a half days of it. Late large is a
 * Heli-Porter, the most expensive single object in the game.
 *
 * It said Rotorcraft until 2026-09-18 and that was never true: the Heli-Porter costs 24,200 in
 * materials against the Rotorcraft's 17,600, and is gated a rung deeper. Worth correcting rather
 * than leaving, because an anchor is only useful if a reader can go and look the number up.
 *
 * The windows are wide, a factor of three or four, because these are guard rails and not targets.
 * An author should be able to pay a round number without the gate arguing; what the gate is there
 * to catch is the reward that is out by ten.
 */
export const FEAT_REWARD_BANDS: Readonly<
  Record<FeatEra, Record<FeatSize, { readonly min: number; readonly max: number }>>
> = {
  early: {
    small: { min: 80, max: 500 },
    medium: { min: 500, max: 2_400 },
    large: { min: 2_400, max: 8_000 },
  },
  mid: {
    small: { min: 800, max: 5_000 },
    medium: { min: 5_000, max: 28_000 },
    large: { min: 28_000, max: 110_000 },
  },
  late: {
    small: { min: 5_000, max: 26_000 },
    medium: { min: 26_000, max: 160_000 },
    /*
     * The ceiling was one machine's worth, 700,000, and a ladder that runs to tier X cannot live
     * under it.
     *
     * The deep rungs of a ten-step chain are all `late`/`large`: there is no band above this one to
     * climb into, so six rungs in a row would have had to pay inside a factor of 1.6 of each other
     * while asking for twenty times the work. That is the rung-that-pays-the-same problem §D7 found
     * on the notoriety ladder, and it is worse here, because a feat is claimed once and the only
     * thing a player weighs it by is what lands.
     *
     * So the top band holds a multiple of the dearest machine rather than one of them, and `deep` in the
     * catalogue is the only thing that spends the new headroom. Widening a ceiling cannot make an
     * existing feat fail this gate; what it costs is that the gate catches a little less, which is
     * why nothing else in the file was moved with it.
     */
    large: { min: 160_000, max: 1_500_000 },
  },
};

export function featRewardBand(era: FeatEra, size: FeatSize): { min: number; max: number } {
  return FEAT_REWARD_BANDS[era][size];
}
