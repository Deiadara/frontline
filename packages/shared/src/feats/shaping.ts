import { storageCapacityFor } from '../building/production.js';
import { BLUEPRINTS, pageRarity } from '../blueprints/catalog.js';
import { ITEM_CATALOG, type ItemId } from '../items/catalog.js';
import type { ResourceKey } from '../resources.js';
import { seedFrom } from '../rng.js';
import { findUnit } from '../units/index.js';
import { UNIT_MODIFICATIONS } from '../units/modifications.js';
import { BUILDING_PART_GATES } from '../building/parts.js';
import type { FeatSpec } from './feats.js';
import {
  CAPS_PER_BOOST,
  CAPS_PER_RANDOM_PAGE,
  CAPS_PER_XP,
  featRewardValue,
  type FeatEra,
  type FeatReward,
} from './rewards.js';

/**
 * What a feat pays, by era (maintainer ruling P8-A, 2026-10-02).
 *
 * The helpers in `catalog.ts` price a reward; this decides what it is paid **in**. The ruling:
 *
 *   * early: about half caps and experience, half resources, early units and useful early items;
 *   * mid: about a fifth resources, half caps or experience, and the rest mid units, a random
 *     page, a consumable or a trap;
 *   * late: about a third large sums of caps and experience, and the rest rarer units, specific
 *     rare pages and other hard-to-get things.
 *
 * Each reward a helper built is paid in **one** of its era's kinds, and the kinds are dealt out
 * across the era's feats on those shares exactly, so the board reads as the mix the ruling asks
 * for rather than every rung paying a sliver of everything. A feat whose helper already paid in
 * one of the era's kinds keeps it where the share has room (a kill ladder paying bodies stays a
 * kill ladder paying bodies), and the rest are dealt off a hash of the id, so the deal is the
 * same on every server running the same catalogue. Adding or removing a feat of an era can move
 * other feats of that era to another kind, since the quotas and the deal are the era's.
 *
 * The value stays what the helper priced: the bands in `rewards.ts` and the climb along a chain
 * hold as they did. What the kind cannot carry (beds run out, a page is one page, a store has a
 * ceiling) is paid in caps, which have no ceiling, as the ruling's option (a) says. Resources are
 * capped at what a store of the feat's era holds, so a claim never asks the player to waste half
 * of it (126 feats did, and `caps_10` threw away 27,490 scrap on every claim).
 *
 * Rewards written out by hand in the catalogue (the opening squad, a specific page, contraband by
 * name) are a decision about that one feat and are left exactly as written.
 */

export const REWARD_KINDS = [
  'coin',
  'stores',
  'units',
  'kit',
  'page',
  'consumable',
  'trap',
  'rare_pages',
  'parts',
] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

/** The ruling's shares, by count of feats in the era. */
export const ERA_REWARD_MIX: Readonly<Record<FeatEra, Partial<Record<RewardKind, number>>>> = {
  early: { coin: 0.5, stores: 0.25, units: 0.15, kit: 0.1 },
  mid: { coin: 0.5, stores: 0.2, units: 0.12, page: 0.08, consumable: 0.05, trap: 0.05 },
  late: { coin: 0.3, units: 0.35, rare_pages: 0.2, parts: 0.15 },
};

/**
 * The Apothecary level a store of each era stands at: what "a store of that era holds" means.
 * Early is the opening fortnight's, mid a district half built, late the top of the ladder with no
 * storage cards fitted, which every crew can reach.
 */
export const ERA_STORE_LEVEL: Readonly<Record<FeatEra, number>> = { early: 6, mid: 12, late: 20 };

/** What a store of this era holds of one resource. `Infinity` for caps. */
export function eraStoreCeiling(era: FeatEra, key: ResourceKey): number {
  return storageCapacityFor(
    [{ id: 'era-store', kind: 'apothecary', level: ERA_STORE_LEVEL[era], modifications: [] }],
    key,
  );
}

/** How the stores kind spreads its value, by era: what each stage of the game runs short of. */
const STORES_MIX: Readonly<Record<FeatEra, Partial<Record<ResourceKey, number>>>> = {
  early: { planks: 0.35, oil: 0.25, scrap: 0.2, supplies: 0.2 },
  mid: { scrap: 0.3, planks: 0.3, oil: 0.25, supplies: 0.15 },
  late: { scrap: 0.3, planks: 0.25, oil: 0.25, highQualityMetal: 0.2 },
};

/**
 * The units each era pays, and how many unit slots one reward may fill.
 *
 * Sized under what a district of the era houses, so a claim fills part of the beds rather than all
 * of them: at 1,500 slots a late rung emptied the beds a late crew has, and claim-all passed over
 * every such rung for a crew whose beds were full (review, 2026-10-02).
 */
const ERA_UNITS: Readonly<Record<FeatEra, { ids: readonly string[]; slots: number }>> = {
  early: { ids: ['razors', 'scrapers', 'scavengers'], slots: 30 },
  mid: { ids: ['breakers', 'ironsides', 'snipers', 'sluggers'], slots: 120 },
  late: {
    ids: ['juggernauts', 'kite_crews', 'cyber_dogs', 'demolishers', 'hollow_men'],
    slots: 400,
  },
};

/** Useful early components, and the most of each one reward hands over. */
const EARLY_KIT: Readonly<Record<string, number>> = {
  scrap_servo: 4,
  optic_cluster: 3,
  weld_rod: 4,
};

/**
 * The hard-to-get components, and the most of each one reward hands over.
 *
 * Every component reward, across the whole catalogue, is also held to what the game will ever ask
 * for of it ({@link lifetimePartDemand}): the deal spends that budget as it goes, so the parts the
 * feats hand over add up to at most one crew's whole appetite. They added up to four times it
 * (88 Neural Shunts against a demand of 20; review, 2026-10-02).
 */
const LATE_PARTS: Readonly<Record<string, number>> = {
  rotor_hub: 1,
  targeting_core: 1,
  neural_shunt: 2,
  coolant_cell: 2,
  pressure_valve: 1,
  gyro_assembly: 1,
  signal_relay: 1,
  hydraulic_ram: 2,
};

/** Everything the game will ever ask for of each component: building gates and the unit cards. */
export function lifetimePartDemand(): Map<string, number> {
  const need = new Map<string, number>();
  const add = (cost: Readonly<Record<string, number | undefined>>) => {
    for (const [id, count] of Object.entries(cost))
      need.set(id, (need.get(id) ?? 0) + (count ?? 0));
  };
  for (const levels of Object.values(BUILDING_PART_GATES)) {
    for (const cost of Object.values(levels ?? {})) add(cost);
  }
  for (const card of UNIT_MODIFICATIONS) add(card.parts ?? {});
  return need;
}

/** What is left of {@link lifetimePartDemand} for the rest of the deal, by component. */
type PartsBudget = Map<string, number>;

const MID_TRAPS = ['trap_pressure_plates', 'trap_razor_wire', 'trap_gas_shell'] as const;
const CONSUMABLES = [
  'adrenaline_syringes',
  'biochemical_infusers',
  'combat_stims',
  'banned_explosives',
] as const;

/** Rare pages: the advanced and masterpiece sheets, one of which a late feat may name. */
const RARE_PAGES: readonly string[] = BLUEPRINTS.flatMap((blueprint) =>
  blueprint.pages
    .filter((page) => {
      const rarity = pageRarity(blueprint, page);
      return rarity === 'advanced' || rarity === 'masterpiece';
    })
    .map((page) => page.id),
);

const itemValue = (id: string): number =>
  (ITEM_CATALOG[id as ItemId] as { capsValue: number } | undefined)?.capsValue ?? 0;

const unitValue = (id: string): number => featRewardValue({ units: { [id]: 1 } });

/** A stable pick off a feat id: the same feat pays the same thing on every server. */
const pick = <T>(list: readonly T[], id: string, salt: string): T =>
  list[seedFrom(`${salt}:${id}`) % list.length]!;

/** What `value` of caps-equivalent buys in this kind, before the caps that make up the rest. */
function goodsFor(
  kind: RewardKind,
  value: number,
  era: FeatEra,
  id: string,
  budget: PartsBudget,
): FeatReward | null {
  switch (kind) {
    case 'coin':
      return null;
    case 'stores': {
      const resources: Partial<Record<ResourceKey, number>> = {};
      for (const [key, share] of Object.entries(STORES_MIX[era]) as [ResourceKey, number][]) {
        const rate = featRewardValue({ resources: { [key]: 1 } });
        const amount = Math.min(
          Math.floor((value * share) / rate),
          Math.floor(eraStoreCeiling(era, key)),
        );
        if (amount > 0) resources[key] = amount;
      }
      return Object.keys(resources).length > 0 ? { resources } : null;
    }
    case 'units': {
      const { ids, slots } = ERA_UNITS[era];
      const first = pick(ids, id, 'unit-a');
      const second = pick(
        ids.filter((one) => one !== first),
        id,
        'unit-b',
      );
      const units: Record<string, number> = {};
      let beds = slots;
      for (const [unitId, share] of [
        [first, 0.6],
        [second, 0.4],
      ] as const) {
        const size = findUnit(unitId)?.unitSlots ?? 1;
        const count = Math.min(
          Math.floor((value * share) / unitValue(unitId)),
          Math.floor(beds / size),
        );
        if (count > 0) {
          units[unitId] = count;
          beds -= count * size;
        }
      }
      return Object.keys(units).length > 0 ? { units } : null;
    }
    case 'kit':
      return partsUpTo(EARLY_KIT, value, id, 'kit', budget);
    case 'parts':
      return partsUpTo(LATE_PARTS, value, id, 'parts', budget);
    case 'trap': {
      const trap = pick(MID_TRAPS, id, 'trap');
      const count = Math.min(2, Math.floor(value / itemValue(trap)));
      return count > 0 ? { items: { [trap]: count } } : null;
    }
    case 'consumable': {
      const count = Math.min(2, Math.floor(value / CAPS_PER_BOOST));
      if (count <= 0) return null;
      const first = pick(CONSUMABLES, id, 'boost-a');
      const second = pick(CONSUMABLES, id, 'boost-b');
      return { boosts: count === 1 ? [first] : [first, second] };
    }
    case 'page': {
      const count = Math.min(3, Math.floor(value / CAPS_PER_RANDOM_PAGE));
      return count > 0 ? { pages: count } : null;
    }
    case 'rare_pages': {
      const items: Record<string, number> = {};
      let left = value;
      for (const salt of ['page-a', 'page-b', 'page-c']) {
        const page = pick(RARE_PAGES, id, salt);
        if (items[page] !== undefined || itemValue(page) > left) continue;
        items[page] = 1;
        left -= itemValue(page);
      }
      return Object.keys(items).length > 0 ? { items } : null;
    }
  }
}

/**
 * One component off a table, as many as the value, the table's limit and what is left of the
 * catalogue's budget allow, and the budget spent. Null when nothing on the table is left to hand
 * over or affordable at this value.
 */
function partsUpTo(
  table: Readonly<Record<string, number>>,
  value: number,
  id: string,
  salt: string,
  budget: PartsBudget,
): FeatReward | null {
  const open = Object.keys(table).filter(
    (part) => (budget.get(part) ?? 0) > 0 && itemValue(part) <= value,
  );
  if (open.length === 0) return null;
  const part = pick(open, id, salt);
  const count = Math.min(
    table[part] ?? 0,
    budget.get(part) ?? 0,
    Math.floor(value / itemValue(part)),
  );
  budget.set(part, (budget.get(part) ?? 0) - count);
  return { items: { [part]: count } };
}

/**
 * `value` paid in one kind, the rest in caps and experience.
 *
 * The coin is split between caps and experience: half and half early and late, and either one or
 * the other in the mid game, which is the ruling's "caps or XP". Caps take whatever the rounding
 * leaves, so the reward is worth what the helper priced it at to within a cap.
 */
export function rewardOfKind(
  kind: RewardKind,
  value: number,
  era: FeatEra,
  id: string,
  budget: PartsBudget = lifetimePartDemand(),
): FeatReward {
  const goods = goodsFor(kind, value, era, id, budget) ?? {};
  const rest = value - featRewardValue(goods);
  const xpShare = era === 'mid' ? (seedFrom(`coin:${id}`) % 2 === 0 ? 1 : 0) : 0.5;
  // Only a coin reward pays experience: the others make up their rest in caps, so a rung that
  // pays a squad pays a squad and a purse rather than a squad, a purse and a lesson.
  const xp = kind === 'coin' ? Math.floor((rest * xpShare) / CAPS_PER_XP) : 0;
  const caps = Math.ceil(rest - xp * CAPS_PER_XP);
  return {
    ...goods,
    ...(caps > 0 ? { resources: { ...(goods.resources ?? {}), caps } } : {}),
    ...(xp > 0 ? { xp } : {}),
  };
}

/** The kind a helper's reward was already paid in, where the era offers it. */
function preferredKind(reward: FeatReward, era: FeatEra): RewardKind | undefined {
  const mix = ERA_REWARD_MIX[era];
  const valueOf = (part: FeatReward): number => featRewardValue(part);
  const channels: [RewardKind, number][] = [
    ['units', valueOf({ ...(reward.units ? { units: reward.units } : {}) })],
    [
      era === 'late' ? 'parts' : 'kit',
      valueOf({ ...(reward.items ? { items: reward.items } : {}) }),
    ],
    ['coin', (reward.xp ?? 0) * CAPS_PER_XP],
  ];
  const [kind, worth] = channels.reduce((best, one) => (one[1] > best[1] ? one : best));
  return worth > 0 && mix[kind] !== undefined ? kind : undefined;
}

/** How many of `count` feats each kind gets, by the largest remainder of its share. */
function quotas(era: FeatEra, count: number): Map<RewardKind, number> {
  const mix = Object.entries(ERA_REWARD_MIX[era]) as [RewardKind, number][];
  const exact = mix.map(([kind, share]) => [kind, share * count] as const);
  const out = new Map<RewardKind, number>(
    exact.map(([kind, amount]) => [kind, Math.floor(amount)]),
  );
  let left = count - [...out.values()].reduce((total, amount) => total + amount, 0);
  for (const [kind] of [...exact].sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (left <= 0) break;
    out.set(kind, (out.get(kind) ?? 0) + 1);
    left -= 1;
  }
  return out;
}

/**
 * Every helper-built reward, re-dealt into its era's mix; everything else as it was written.
 *
 * `generic` says which rewards a helper built. After the deal each chain is walked once and a rung
 * that came out a few caps under the one below it is topped up, because two rungs priced the same
 * may now be paid in kinds that round differently, and a ladder never pays less going up.
 */
export function shapeFeatRewards(
  feats: readonly FeatSpec[],
  generic: (reward: FeatReward) => boolean,
): FeatSpec[] {
  const kindOf = new Map<string, RewardKind>();
  const dealt = new Map<string, FeatReward>();
  const budget = lifetimePartDemand();
  for (const era of ['early', 'mid', 'late'] as const) {
    const pool = feats
      .filter((feat) => feat.era === era && generic(feat.reward))
      .sort((a, b) => seedFrom(`deal:${a.id}`) - seedFrom(`deal:${b.id}`));
    const left = quotas(era, pool.length);
    /*
     * A kind is taken only if it carries something at this value: a kind that would be all caps
     * under its name (a page worth more than the rung, the parts budget spent) is passed over for
     * the next. The reward is built here, once, because building a parts reward spends the budget.
     */
    const take = (feat: FeatSpec, kind: RewardKind): boolean => {
      if ((left.get(kind) ?? 0) <= 0) return false;
      const value = featRewardValue(feat.reward);
      if (kind !== 'coin' && goodsFor(kind, value, era, feat.id, new Map(budget)) === null) {
        return false;
      }
      left.set(kind, (left.get(kind) ?? 0) - 1);
      kindOf.set(feat.id, kind);
      dealt.set(feat.id, rewardOfKind(kind, value, era, feat.id, budget));
      return true;
    };
    for (const feat of pool) {
      const preferred = preferredKind(feat.reward, era);
      if (preferred !== undefined) take(feat, preferred);
    }
    for (const feat of pool) {
      if (kindOf.has(feat.id)) continue;
      const open = [...left.entries()]
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([kind]) => kind);
      if (!open.some((kind) => take(feat, kind))) {
        kindOf.set(feat.id, 'coin');
        dealt.set(
          feat.id,
          rewardOfKind('coin', featRewardValue(feat.reward), era, feat.id, budget),
        );
      }
    }
  }

  const shaped = feats.map((feat) => {
    const reward = dealt.get(feat.id);
    return reward === undefined ? feat : { ...feat, reward };
  });

  const previous = new Map<string, number>();
  return shaped.map((feat) => {
    if (feat.chain === null) return feat;
    const below = previous.get(feat.chain) ?? 0;
    const here = featRewardValue(feat.reward);
    const short = Math.ceil(below - here);
    const reward =
      short > 0
        ? {
            ...feat.reward,
            resources: {
              ...(feat.reward.resources ?? {}),
              caps: (feat.reward.resources?.caps ?? 0) + short,
            },
          }
        : feat.reward;
    previous.set(feat.chain, featRewardValue(reward));
    return reward === feat.reward ? feat : { ...feat, reward };
  });
}
