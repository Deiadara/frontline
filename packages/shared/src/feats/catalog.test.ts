import { FIGHT_CATEGORIES } from '../missions.grade.js';
import { describe, expect, it } from 'vitest';
import {
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  MAX_MODIFICATION_SLOTS,
  MODIFICATION_SET_SIZE,
  levelCeilingFor,
  modificationSlotsAt,
  modificationsFittingIn,
  storageCapacityFor,
  type BuildingKind,
} from '../building/index.js';
import { BLUEPRINTS } from '../blueprints/catalog.js';
import { HOUSING_BASE, HOUSING_PER_QUARTERS_LEVEL } from '../building/production.js';
import { UNIT_SLOTS_PER_LOCATION, UNIT_SLOTS_PER_LOCATION_LEVEL } from '../building/unit-slots.js';
import { MAX_LOCATION_LEVEL } from '../city/locations.js';
import { MAX_PER_VEHICLE, VEHICLE_IDS } from '../building/vehicles.js';
import { MAX_NOTORIETY } from '../economy/notoriety.js';
import { RESEARCH_ITEMS } from '../research/tracks.js';
import { SEAT_SLOT_ORDER } from '../factions/cards.js';
import { ATTRIBUTE_NAMES, MAX_ATTRIBUTE } from '../attributes.js';
import { OFFICER_ROLES } from '../roles.js';
import { COMBINE_UNITS, PLAYER_UNITS } from '../units/catalog.js';
import { UNIT_UPGRADE_SLOTS } from '../units/loadout.js';
import { BUILDING_PART_GATES } from '../building/parts.js';
import { UNIT_MODIFICATIONS } from '../units/modifications.js';
import { COMBINE_LEADERS, EXECUTIONER_THRESHOLD } from '../city/combine.js';
import { startingGarrison } from '../city/control.js';
import { CITY_LOCATIONS } from '../city/districts.js';
import { OFFICER_MARKS, OFFICER_MARK_BAND, OFFICER_MARK_FLOOR, markIndex } from '../crew/marks.js';
import { chairPassivePercent } from '../crew/passives.js';
import { ITEM_CATALOG } from '../items/catalog.js';
import { BLACK_MARKET_GOOD_IDS, blackMarketTakesPerDay } from '../market/blackmarket.js';
import { maxOpenAuctionsFor } from '../bar/auction.js';
import { MISC_AREA_ID, areaPayPercent, concurrentMissionSlots } from '../missions.areas.js';
import { MISSION_TEMPLATES, missionRewards, templateTimings } from '../missions.js';
import { productionRates } from '../building/production.js';
import { noCrewEffects } from '../crew/effects.js';
import { ALL_DISTRICTS } from '../city/index.js';
import { RESOURCE_KEYS, type ResourceKey } from '../resources.js';
import { blueprintForUnit } from '../blueprints/requirements.js';
import { NOTORIETY_TO_FIELD } from '../economy/infamy.js';
import { findUnit, isCombatUnit } from '../units/index.js';
import { isUnitUnlocked } from '../units/unlocks.js';
import type { LocationKind } from '../city/locations.js';
import { FEATS, findFeat } from './catalog.js';
import { MODIFICATIONS } from '../building/modifications.js';
import { PAYROLL_PERCENT_PER_QUARTERS_LEVEL } from '../building/standing.js';
import { payrollCapacity, payrollStepCost } from '../economy/payroll.js';
import { playerXpToNextLevel } from '../progression/curve.js';
import {
  CHAPEL_LOCATIONS,
  COMBINE_DISTRICTS,
  GARRISONED_DISTRICTS,
  HOLDABLE_DISTRICTS,
  PLAYABLE_CITY_COUNT,
  PLAYABLE_CONTESTED,
  PLAYABLE_DISTRICTS,
  PLAYABLE_LOCATIONS,
  RAIL_STATIONS,
  reachableAbroad,
} from './world.js';
import { FEAT_MEASURES, FEAT_MEASURE_SPECS, type FeatMeasure } from './measures.js';
import { FEAT_ERAS, FeatRewardSchema, featRewardBand, featRewardValue } from './rewards.js';
import { splitFeatReward } from './waste.js';
import { ERA_REWARD_MIX, eraStoreCeiling, type RewardKind } from './shaping.js';
import { maxBaseStorageFor } from '../building/production.js';

/**
 * The catalogue, held to the rules it was authored under.
 *
 * Two hundred entries cannot be kept honest by review: nobody rereads the whole file
 * to add one feat, and the mistakes that matter here (a reward out by ten, a chain pointing at the
 * wrong step, a scope naming a district that was renamed) all look perfectly ordinary in a diff.
 * Every rule the file claims for itself is checked here instead.
 */

const ERA_ORDER = { early: 0, mid: 1, late: 2 } as const;

describe('the feat catalogue', () => {
  it('is the size the maintainer asked for, and spread across the whole game', () => {
    // "More than 100 total", and not a hundred of them in one era.
    expect(FEATS.length).toBeGreaterThan(100);
    for (const era of FEAT_ERAS) {
      const inEra = FEATS.filter((feat) => feat.era === era);
      expect(inEra.length, era).toBeGreaterThan(25);
    }
  });

  it('has no id, name or blurb used twice', () => {
    const ids = FEATS.map((feat) => feat.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = FEATS.map((feat) => feat.name);
    expect(new Set(names).size).toBe(names.length);
    // Two feats with the same sentence under them are two feats a player cannot tell apart.
    const blurbs = FEATS.map((feat) => feat.blurb);
    expect(new Set(blurbs).size).toBe(blurbs.length);
  });

  it('finds every feat by id, and nothing else', () => {
    for (const feat of FEATS) expect(findFeat(feat.id)).toBe(feat);
    expect(findFeat('not-a-feat')).toBeUndefined();
  });

  /**
   * The balance gate, and the reason `featRewardValue` exists.
   *
   * One pass over everything. An author who pays a `medium` early feat what a `large` late one
   * pays finds out here rather than in a save file.
   */
  it('pays every feat inside the band its era and size allow', () => {
    const out: string[] = [];
    for (const feat of FEATS) {
      const value = featRewardValue(feat.reward);
      const band = featRewardBand(feat.era, feat.size);
      if (value < band.min || value > band.max) {
        out.push(
          `${feat.id} (${feat.era}/${feat.size}) pays ${Math.round(value)}, band ${band.min}..${band.max}`,
        );
      }
    }
    expect(out, out.join('\n')).toEqual([]);
  });

  /**
   * The whole demand for every component in the game, counted off the two things that spend them.
   *
   * Derived rather than written down, so it moves when the building gates or the card catalogue
   * move and this file starts failing instead of quietly going stale.
   */
  const LIFETIME_PART_DEMAND = ((): Record<string, number> => {
    const need: Record<string, number> = {};
    for (const levels of Object.values(BUILDING_PART_GATES)) {
      for (const cost of Object.values(levels ?? {})) {
        for (const [id, count] of Object.entries(cost)) need[id] = (need[id] ?? 0) + (count ?? 0);
      }
    }
    for (const card of UNIT_MODIFICATIONS) {
      for (const [id, count] of Object.entries(card.parts ?? {})) {
        need[id] = (need[id] ?? 0) + (count ?? 0);
      }
    }
    return need;
  })();

  /**
   * A parts reward has to be spendable, and the band check cannot see that.
   *
   * `featRewardValue` prices everything in caps-equivalent, so `rotor_hub: 100` is a correctly
   * priced reward and a meaningless one: the game asks for exactly **one** Rotor Hub, ever, as the
   * toll for the Garage’s top level. The catalogue shipped paying 376 of them and 256 Targeting
   * Cores against a demand of two, and every existing test passed, because caps-equivalent is the wrong unit for a
   * thing whose whole design is scarcity (`building/parts.ts`: resources are the pace, parts are
   * the gate).
   *
   * A single feat may hand over the game's entire appetite for a component, which is a real and
   * bounded "you are done with parts" reward. It may never hand over more.
   */
  it('never pays more of a component than the game can ever spend', () => {
    const over: string[] = [];
    for (const feat of FEATS) {
      for (const [id, count] of Object.entries(feat.reward.items ?? {})) {
        if (ITEM_CATALOG[id as keyof typeof ITEM_CATALOG]?.kind !== 'component') continue;
        const demand = LIFETIME_PART_DEMAND[id] ?? 0;
        if ((count ?? 0) > demand) {
          over.push(`${feat.id} pays ${count} ${id}, and the game spends ${demand} in a lifetime`);
        }
      }
    }
    expect(over, over.join('\n')).toEqual([]);
  });

  /**
   * The beds a crew could ever have, off the two things that make them.
   *
   * The absolute ceiling: a maxed Quarters at home plus every location in the city, held at once by
   * one crew, at the top level. Nobody reaches it, which is the point of using it as a bound.
   */
  const HOUSING_CEILING =
    HOUSING_BASE +
    HOUSING_PER_QUARTERS_LEVEL * BUILDING_MAX_LEVEL +
    CITY_LOCATIONS.length *
      (UNIT_SLOTS_PER_LOCATION + UNIT_SLOTS_PER_LOCATION_LEVEL * MAX_LOCATION_LEVEL);

  /**
   * A unit reward has to be one a district can take, and the band check cannot see that.
   *
   * §A1 refuses a payout of units while there is nowhere to put them, and the feat stays **ready**:
   * the backlog does not empty, the count on the Collect-all button does not move, and pressing it
   * again pays nothing. The catalogue shipped two rungs (`mustered_10` and `faction_10`) paying 844
   * units worth 3,377 unit slots against a ceiling of 3,186, so the top of two ladders could not be
   * collected by anybody, ever (bug pass, 2026-09-17).
   *
   * Held to half the ceiling rather than to all of it, because a crew collecting a feat has an army
   * already: a reward that fits only into an empty district is a reward that has to be made room
   * for, which is not what a reward is. Half is also where the catalogue already sat: the biggest
   * bundle it has ever paid, `recruits('late', 'large')`, is 1,560 slots.
   */
  /**
   * ...and across the whole catalogue, at most the game's whole appetite for each one (review,
   * 2026-10-02). The per-feat check above passed a catalogue that paid 88 Neural Shunts against a
   * lifetime demand of 20.
   */
  it('never pays more of a component across every feat than the game can ever spend', () => {
    const paid: Record<string, number> = {};
    for (const feat of FEATS) {
      for (const [id, count] of Object.entries(feat.reward.items ?? {})) {
        if (ITEM_CATALOG[id as keyof typeof ITEM_CATALOG]?.kind !== 'component') continue;
        paid[id] = (paid[id] ?? 0) + (count ?? 0);
      }
    }
    const over = Object.entries(paid)
      .filter(([id, count]) => count > (LIFETIME_PART_DEMAND[id] ?? 0))
      .map(
        ([id, count]) => `${id}: ${count} paid, ${LIFETIME_PART_DEMAND[id] ?? 0} ever asked for`,
      );
    expect(over, over.join('\n')).toEqual([]);
    expect(Object.keys(paid).length, 'no feat pays a component at all').toBeGreaterThan(3);
  });

  it('never pays more units than a district could house', () => {
    const over: string[] = [];
    let biggest = 0;
    for (const feat of FEATS) {
      const slots = Object.entries(feat.reward.units ?? {}).reduce(
        (total, [id, count]) => total + (findUnit(id)?.unitSlots ?? 0) * (count ?? 0),
        0,
      );
      biggest = Math.max(biggest, slots);
      if (slots > HOUSING_CEILING / 2) {
        over.push(
          `${feat.id} pays ${slots} unit slots of units, half the ceiling is ${HOUSING_CEILING / 2}`,
        );
      }
    }
    expect(over, over.join('\n')).toEqual([]);
    // A guard on the guard: with no unit rewards in the catalogue this proves nothing.
    expect(biggest, 'nothing pays in units').toBeGreaterThan(0);
  });

  /** A guard on the guard: a demand table that came out empty would make the above vacuous. */
  it('knows what the district and the unit bench actually ask for', () => {
    expect(Object.keys(LIFETIME_PART_DEMAND).length).toBeGreaterThan(5);
    // One for the Garage's top level and two for the fence's Rotor Drop Rig.
    expect(LIFETIME_PART_DEMAND['rotor_hub']).toBe(3);
  });

  /**
   * Every reward is a whole number of whatever it pays.
   *
   * The schema only holds three of the four counted channels to it: `xp`, items and units are all
   * `z.number().int()`, and **resources are not**, because production settles in fractional carry
   * and the bundle has to be able to carry it. So a reward computed rather than typed can put a
   * fraction on a stockpile, and the stores' credit adds it straight on: `rise(3, 'coin')` paid
   * 14000.000000000002 scrap, which a crew then held for ever (bug pass, 2026-09-17).
   */
  it('pays a whole number of everything, including the channel the schema lets be fractional', () => {
    const fractional: string[] = [];
    for (const feat of FEATS) {
      for (const [key, amount] of Object.entries(feat.reward.resources ?? {})) {
        if (!Number.isInteger(amount)) fractional.push(`${feat.id} pays ${amount} ${key}`);
      }
      for (const [key, amount] of Object.entries(feat.reward.units ?? {})) {
        if (!Number.isInteger(amount)) fractional.push(`${feat.id} pays ${amount} ${key}`);
      }
    }
    expect(fractional, fractional.join('\n')).toEqual([]);
  });

  /**
   * Every reward survives the claim split untouched when there is room for it.
   *
   * A confirmed claim pays through `splitFeatReward`, which clamps to the ceilings and discards
   * the rest (maintainer ruling, 2026-09-23). With the ceilings out of the way it has to be the
   * identity, and it is worth checking against the whole catalogue rather than against a handful
   * of hand-built rewards: a channel the split forgot to carry would silently stop being paid on
   * every feat that uses it, and nothing else in the suite would notice.
   */
  it('hands every reward over whole when the district has room for it', () => {
    const unlimited = {
      resources: Object.fromEntries(
        RESOURCE_KEYS.map((key) => [key, Number.POSITIVE_INFINITY]),
      ) as Record<ResourceKey, number>,
      unitSlots: Number.POSITIVE_INFINITY,
    };
    for (const feat of FEATS) {
      const split = splitFeatReward(feat.reward, unlimited);
      expect(split.wasted, feat.id).toBeUndefined();
      expect(split.paid, feat.id).toEqual(feat.reward);
    }
  });

  /**
   * And it never invents anything: what lands plus what is lost is what the catalogue promised.
   *
   * Measured against a district with nothing left, which is the other end of the same function.
   * Resources are the channel worth summing, because they are the one the clamp cuts by a
   * fraction rather than by a whole object.
   */
  it('loses exactly the difference when the district has no room at all', () => {
    const nothing = {
      // Caps keep their `Infinity`, the way `storageCapacityFor` answers for them: the currency
      // has no ceiling, so "no room at all" is not a state the wallet can be in.
      resources: Object.fromEntries(
        RESOURCE_KEYS.map((key) => [key, key === 'caps' ? Number.POSITIVE_INFINITY : 0]),
      ) as Record<ResourceKey, number>,
      unitSlots: 0,
    };
    for (const feat of FEATS) {
      const split = splitFeatReward(feat.reward, nothing);
      for (const key of RESOURCE_KEYS) {
        const owed = feat.reward.resources?.[key] ?? 0;
        const paid = split.paid.resources?.[key] ?? 0;
        const lost = split.wasted?.resources?.[key] ?? 0;
        expect(paid + lost, `${feat.id} ${key}`).toBe(owed);
      }
      // The wallet is paid in full even with every other shelf empty, which is the half of the
      // ruling a player relies on: a feat's caps always arrive.
      expect(split.paid.resources?.caps ?? 0, feat.id).toBe(feat.reward.resources?.caps ?? 0);
    }
  });

  it('pays something real for every feat', () => {
    for (const feat of FEATS) {
      expect(featRewardValue(feat.reward), feat.id).toBeGreaterThan(0);
    }
  });

  /** Nothing may pay in a resource, unit, item or boost the game does not have. */
  it('pays only in things that exist', () => {
    for (const feat of FEATS) {
      for (const key of Object.keys(feat.reward.resources ?? {})) {
        expect(RESOURCE_KEYS, `${feat.id} resource`).toContain(key);
      }
      for (const key of Object.keys(feat.reward.items ?? {})) {
        expect(
          ITEM_CATALOG[key as keyof typeof ITEM_CATALOG],
          `${feat.id} item ${key}`,
        ).toBeDefined();
      }
      for (const key of Object.keys(feat.reward.units ?? {})) {
        expect(findUnit(key), `${feat.id} unit ${key}`).toBeDefined();
      }
      for (const id of feat.reward.boosts ?? []) {
        expect(BLACK_MARKET_GOOD_IDS, `${feat.id} boost`).toContain(id);
      }
    }
  });
});

describe('chains', () => {
  it('locks only the steps of a chain, and never a feat that stands alone', () => {
    for (const feat of FEATS) {
      if (feat.chain === null) {
        // The board's rule: "the only ones that are locked are those that are totally ordered".
        expect(feat.after, feat.id).toBeNull();
      }
    }
  });

  it('points every step at the one before it, with no gaps and no cycles', () => {
    const byChain = new Map<string, typeof FEATS>();
    for (const feat of FEATS) {
      if (feat.chain === null) continue;
      byChain.set(feat.chain, [...(byChain.get(feat.chain) ?? []), feat]);
    }
    expect(byChain.size).toBeGreaterThan(30);

    for (const [chainId, steps] of byChain) {
      expect(steps.length, chainId).toBeGreaterThan(1);
      expect(steps[0]?.after, `${chainId} head`).toBeNull();
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index]?.after, `${chainId} step ${index}`).toBe(steps[index - 1]?.id);
      }
    }
  });

  it('asks the same question with a bigger number each time', () => {
    const byChain = new Map<string, typeof FEATS>();
    for (const feat of FEATS) {
      if (feat.chain === null) continue;
      byChain.set(feat.chain, [...(byChain.get(feat.chain) ?? []), feat]);
    }
    for (const [chainId, steps] of byChain) {
      // One measure and one scope per chain, or the ladder is a ladder of different things.
      expect(new Set(steps.map((step) => step.measure)).size, chainId).toBe(1);
      expect(new Set(steps.map((step) => step.scope ?? '')).size, chainId).toBe(1);
      for (let index = 1; index < steps.length; index += 1) {
        expect(steps[index]!.target, `${chainId} step ${index}`).toBeGreaterThan(
          steps[index - 1]!.target,
        );
      }
    }
  });

  /**
   * A rung never pays less than the one below it.
   *
   * The deep rungs (tier IV and up, added 2026-09-16) are the reason this is a rule now. They all
   * sit in `late`/`large`, a band six hundred thousand caps wide at the time, and the natural way
   * to write them was to reach for the same helpers the rest of the file uses. Do that and a
   * ladder pays 402,790 at tier IV, 183,200 at tier V and 200,000 at tier VI: every gate in this
   * file passes, because every one of those is inside its band, and the ladder still asks a player
   * to do four times the work for half the money.
   *
   * Equal is allowed. Two rungs of one chain may pay the same bundle in different currencies.
   */
  it('never pays a rung less than the rung below it', () => {
    const byChain = new Map<string, typeof FEATS>();
    for (const feat of FEATS) {
      if (feat.chain === null) continue;
      byChain.set(feat.chain, [...(byChain.get(feat.chain) ?? []), feat]);
    }
    const fell: string[] = [];
    for (const [chainId, steps] of byChain) {
      for (let index = 1; index < steps.length; index += 1) {
        const below = featRewardValue(steps[index - 1]!.reward);
        const here = featRewardValue(steps[index]!.reward);
        if (here < below) {
          fell.push(
            `${chainId}: ${steps[index]!.id} pays ${Math.round(here)} under ${Math.round(below)}`,
          );
        }
      }
    }
    expect(fell, fell.join('\n')).toEqual([]);
  });

  /**
   * Every part of the game has one ladder that runs the whole way up (maintainer, 2026-09-16).
   *
   * The catalogue was chains of two, three and four, which meant a crew that had been playing for
   * months had collected the top rung of everything and had nothing left on the board. One ladder
   * per group climbs to ten instead, so there is always a rung above the one you are on.
   *
   * Pinned per group rather than as a total, so that folding a group into another one, or dropping
   * the ladder that carries it, fails here instead of quietly leaving that part of the game with a
   * board that stops at four.
   */
  it('gives every part of the game one ladder that climbs to tier X', () => {
    const TEN: Readonly<Record<string, string>> = {
      'the work': 'runs',
      fighting: 'kills',
      'the city': 'taken',
      'the district': 'addons',
      'the crew': 'mustered',
      'the trade': 'caps',
      'the name': 'infamy',
      people: 'faction',
    };
    for (const [group, chainId] of Object.entries(TEN)) {
      const steps = FEATS.filter((feat) => feat.chain === chainId);
      expect(steps.length, `${group} (${chainId})`).toBe(10);
    }
  });

  it('never sends a chain backwards through the game', () => {
    const byChain = new Map<string, typeof FEATS>();
    for (const feat of FEATS) {
      if (feat.chain === null) continue;
      byChain.set(feat.chain, [...(byChain.get(feat.chain) ?? []), feat]);
    }
    for (const [chainId, steps] of byChain) {
      for (let index = 1; index < steps.length; index += 1) {
        // A later, harder step may sit in the same era as the one before it, never an earlier one.
        expect(ERA_ORDER[steps[index]!.era], `${chainId} step ${index}`).toBeGreaterThanOrEqual(
          ERA_ORDER[steps[index - 1]!.era],
        );
      }
    }
  });

  /**
   * A chain's steps have to be next to each other in the catalogue.
   *
   * `evaluateFeats` resolves a whole chain in one pass by relying on it, and the screen groups a
   * ladder by the run of entries that share a chain id. A chain split in two would evaluate wrong
   * *and* draw wrong, and neither symptom would point at the ordering.
   */
  it('keeps every chain contiguous, in step order', () => {
    const seen = new Set<string>();
    let current: string | null = null;
    for (const feat of FEATS) {
      if (feat.chain === current) continue;
      if (feat.chain !== null) {
        expect(seen.has(feat.chain), `${feat.chain} is split across the catalogue`).toBe(false);
        seen.add(feat.chain);
      }
      current = feat.chain;
    }
  });
});

describe('measures and scopes', () => {
  it('gives a scope to exactly the measures that take one', () => {
    for (const feat of FEATS) {
      const scoped = FEAT_MEASURE_SPECS[feat.measure].scoped;
      expect(feat.scope !== undefined, `${feat.id} (${feat.measure})`).toBe(scoped);
    }
  });

  it('scopes only things the game has', () => {
    // Every district of every open city, not Ashfall's twelve: a mission area is a district and
    // the second city's districts are districts (2026-09-24).
    const areas = new Set([MISC_AREA_ID, ...PLAYABLE_DISTRICTS.map((district) => district.id)]);
    for (const feat of FEATS) {
      const scope = feat.scope;
      if (scope === undefined) continue;
      switch (feat.measure) {
        case 'missions_in_area':
          expect(areas.has(scope), `${feat.id} area ${scope}`).toBe(true);
          break;
        case 'missions_of_kind':
          expect(['battle', 'standard'], feat.id).toContain(scope);
          break;
        case 'fights_won_in_category':
          expect(FIGHT_CATEGORIES, feat.id).toContain(scope);
          break;
        case 'jobs_won_at_letter':
          expect(['F', 'E', 'D', 'C', 'B', 'A', 'S'], feat.id).toContain(scope);
          break;
        case 'building_level':
          expect(BUILDING_KINDS, feat.id).toContain(scope);
          break;
        case 'resources_held':
        case 'resources_earned':
          expect(RESOURCE_KEYS, feat.id).toContain(scope);
          break;
        case 'combine_kills_of':
          // A unit the regime fields. A player unit here would be a ladder nothing can climb,
          // because `tallyCombineFight` only counts the dead that `isCombineUnit` says are theirs.
          expect(
            COMBINE_UNITS.map((unit) => unit.id),
            `${feat.id} scopes ${scope}`,
          ).toContain(scope);
          break;
        case 'combine_leaders_slain':
          expect(
            COMBINE_LEADERS.map((leader) => leader.unitId),
            `${feat.id} scopes ${scope}`,
          ).toContain(scope);
          break;
        case 'overseer_skills_at':
          // A threshold, so it has to read back as a number a sheet could reach.
          expect(Number.isFinite(Number(scope)), feat.id).toBe(true);
          expect(Number(scope), feat.id).toBeGreaterThan(0);
          expect(Number(scope), feat.id).toBeLessThanOrEqual(100);
          break;
        default:
          throw new Error(`${feat.id} scopes ${feat.measure}, which this check does not know`);
      }
    }
  });

  /**
   * Every measure is asked for by somebody.
   *
   * A measure with no feat is a counter the server pays to keep and nothing ever reads, which is
   * the exact shape of the dead tables this codebase already has one of. Either a feat wants it or
   * it should not be in the vocabulary.
   */
  /**
   * A `resources_held` target has to be inside the store, or nobody can ever claim it.
   *
   * `stock_3` asked for 400,000 scrap. The widest store the game can build is an Apothecary at
   * twenty with every structure's storage cards fitted, which is 93,056 of a bulk resource: the
   * last rung of the chain had no route to it at all, and nothing said so because a feat sitting at
   * 23% forever looks exactly like a feat nobody has got round to.
   *
   * Measured against a district assembled here rather than against a number typed here, so a
   * retune of `STORAGE_GROWTH`, a new storage card or a wider `fits` list moves the bound with it.
   * Caps are exempt by having no ceiling at all (`storageCapacityFor` answers `Infinity`), which is
   * the same rule production runs under.
   */
  it('never asks a crew to hold more of a resource than a district can store', () => {
    const widest = BUILDING_KINDS.map((kind) => ({
      id: `b-${kind}`,
      kind,
      level: BUILDING_MAX_LEVEL,
      modifications: modificationsFittingIn(kind)
        .filter((spec) => spec.effect === 'storage_percent')
        .sort((a, b) => b.magnitude - a.magnitude)
        .slice(0, MAX_MODIFICATION_SLOTS)
        .map((spec) => spec.id),
      damage: 0,
    }));

    const held = FEATS.filter((feat) => feat.measure === 'resources_held');
    // A guard on the guard: with nothing measuring a stockpile this proves nothing.
    expect(held.length, 'nothing measures a held stockpile').toBeGreaterThan(0);
    for (const feat of held) {
      const ceiling = storageCapacityFor(widest, feat.scope as ResourceKey);
      expect(
        feat.target,
        `${feat.id} wants ${feat.target} ${feat.scope} against a ceiling of ${ceiling}`,
      ).toBeLessThanOrEqual(ceiling);
    }
  });

  /**
   * Every structure ladder finishes on a structure that has nowhere left to go.
   *
   * That was one number, twenty, for all nine of them, and it stopped being one number when the
   * Garage was held to 10: `garage_3` and `garage_4` asked for 16 and 20 and became rungs nobody
   * could ever stand on. The rule is the one the ladders were written under rather than a list of
   * targets, and it reads `levelCeilingFor`, so the next structure whose ceiling moves fails here
   * on the same line.
   *
   * The Garage's four rungs are pinned outright underneath it, because 1 / 4 / 7 / 10 is a
   * maintainer's call (2026-09-18) and only the last of them is derivable from anything.
   */
  it('finishes every structure ladder on a maxed structure', () => {
    const ladders = new Map<string, number[]>();
    for (const feat of FEATS) {
      if (feat.measure !== 'building_level' || feat.scope === undefined) continue;
      ladders.set(feat.scope, [...(ladders.get(feat.scope) ?? []), feat.target]);
    }
    // A guard on the guard: no ladders found would make every assertion below vacuous.
    expect(ladders.size).toBeGreaterThan(5);
    for (const [kind, rungs] of ladders) {
      expect(rungs.at(-1), `${kind} ladder tops out at ${rungs.at(-1)}`).toBe(
        levelCeilingFor(kind as BuildingKind),
      );
    }
    // The one figure here that is not read off the game: a maintainer's call, so a ceiling moving
    // under the ladder cannot quietly take the rungs with it and leave this green.
    expect(ladders.get('garage')).toEqual([1, 4, 7, 10]);
  });

  /**
   * A target has to be a number the game can actually reach (bug pass, 2026-09-17).
   *
   * `resources_held` already had this check, for the reason the note above it gives: `stock_3`
   * asked for 400,000 scrap against a widest-possible store of 93,056 and sat at 23% for ever,
   * which looks exactly like a feat nobody has got round to. Growing the ladders to ten rungs made
   * that failure mode much likelier, because the deep rungs are all guesses at how far a thing can
   * go, so every **capped** measure is now held to its own ceiling rather than only that one.
   *
   * Derived from the tables rather than typed here, so shrinking the map, dropping a building kind
   * or shortening the mark ladder fails this test instead of quietly stranding a rung.
   */
  it('never asks for more of a capped measure than the game can ever hold', () => {
    const holdableDistricts = HOLDABLE_DISTRICTS.length;
    const CEILINGS: Partial<Record<FeatMeasure, number>> = {
      // Both sums walk the structures one at a time: eleven times the tallest structure would say
      // 220 standing levels and 33 brackets, and neither is a district anybody can build.
      buildings_total: BUILDING_KINDS.reduce((total, kind) => total + levelCeilingFor(kind), 0),
      // A district cannot finish a structure it does not have one of, so the whole board is the
      // list of kinds. The last rung of `finished` is exactly this number, on purpose.
      buildings_maxed: BUILDING_KINDS.length,
      modifications_fitted: BUILDING_KINDS.reduce(
        (total, kind) => total + modificationSlotsAt(levelCeilingFor(kind), kind),
        0,
      ),
      /*
       * A set is three cards of one family in one structure (`MODIFICATION_SET_SIZE`), so a
       * structure that never opens a third bracket can never hold one. Every structure opens all
       * three somewhere on its own ladder since 2026-09-29 (the Garage and the Infirmary at 10), so
       * this is eleven. An upper bound: a structure also needs three cards of one family that fit
       * it, which is a question about the deck rather than about the ladder.
       */
      modification_sets: BUILDING_KINDS.filter(
        (kind) => modificationSlotsAt(levelCeilingFor(kind), kind) >= MODIFICATION_SET_SIZE,
      ).length,
      // A crew can hold and fit only its own sheets; the Combine's are in `UNIT_IDS` too.
      unit_modifications_fitted: PLAYER_UNITS.length * UNIT_UPGRADE_SLOTS,
      unit_kinds_held: PLAYER_UNITS.length,
      officer_best_mark: OFFICER_MARKS.length - 1,
      officers_held: OFFICER_ROLES.length,
      overseer_skills_at: ATTRIBUTE_NAMES.length,
      overseer_best_skill: MAX_ATTRIBUTE,
      notoriety: MAX_NOTORIETY,
      research_done: RESEARCH_ITEMS.length,
      blueprints_unlocked: BLUEPRINTS.length,
      fleet_size: MAX_PER_VEHICLE * VEHICLE_IDS.length,
      districts_held_whole: holdableDistricts,
      // The regime's ground, whole: ten districts across the two open cities, and the last rung of
      // `annexed` asks for exactly that many.
      combine_districts_held: COMBINE_DISTRICTS.length,
      // Two chapels, a city apart, and the top of the `chapels` ladder asks for both.
      chapel_held: CHAPEL_LOCATIONS.length,
      locations_held: PLAYABLE_LOCATIONS.length,
      /*
       * The frontier measures, every one bounded from the *worst* home a player could have picked.
       *
       * `reachableAbroad` takes the world total minus the largest city's share, which is the crew
       * who lives in the biggest place and has the least foreign ground left. Sizing these off the
       * world total would write rungs only half the playerbase could stand on, and which city
       * somebody started in is not a thing a feat should charge for.
       */
      locations_held_abroad: reachableAbroad((district) => district.locations.length),
      districts_held_whole_abroad: reachableAbroad((district) =>
        district.locations.length > 0 ? 1 : 0,
      ),
      cities_held: PLAYABLE_CITY_COUNT,
      // Seven platforms: the line does not climb Telemetry Hill, which is authored and not an
      // oversight (`atlas.ts`).
      rail_stations_held: RAIL_STATIONS.length,
      faction_seats: SEAT_SLOT_ORDER.length,
      location_level_held: MAX_LOCATION_LEVEL,
    };

    // The one figure here that is not read off the game, for the reason the ladder test above
    // gives: a table that quietly stopped covering `modification_sets` would leave the deepest
    // deck feat unmeasured. Every structure opens three brackets since 2026-09-29, so both deck
    // ceilings are the whole board: eleven sets, and 33 brackets, which the top fitting rung asks
    // for exactly.
    expect(CEILINGS.modification_sets, 'structures that can hold a full set').toBe(11);
    expect(CEILINGS.modifications_fitted, 'three brackets on each of eleven structures').toBe(33);
    expect(
      Math.max(
        ...FEATS.filter((feat) => feat.measure === 'modifications_fitted').map((f) => f.target),
      ),
      'the top fitting rung is every bracket',
    ).toBe(CEILINGS.modifications_fitted);
    /*
     * Likewise pinned by hand: a map that quietly lost a Combine district, or a chapel, would move
     * the ceiling and the ladder with it and leave this green.
     *
     * Both moved on 2026-09-24 and neither moved because anybody edited a feat. The regime's
     * ground went from six districts to ten when Terminus opened, and there are two chapels now:
     * the Chosen Chapel over Ashfall and the Frontier Chapel inside Control. A `chapel_held`
     * standalone at a target of one then quietly meant "hold either", on a measure counting both.
     */
    expect(CEILINGS.combine_districts_held, 'the Combine holds ten districts').toBe(10);
    expect(CEILINGS.chapel_held, 'there are two Combine chapels').toBe(2);
    // The two cities that are open, and the seven platforms on the one railway in the game.
    expect(CEILINGS.cities_held, 'Ashfall and Terminus').toBe(2);
    expect(CEILINGS.rail_stations_held, 'seven of eight contested districts have a Station').toBe(
      7,
    );

    const over: string[] = [];
    let checked = 0;
    for (const feat of FEATS) {
      // `building_level` is the one scoped measure here, and its ceiling is the structure's own.
      const ceiling =
        feat.measure === 'building_level'
          ? levelCeilingFor(feat.scope as BuildingKind)
          : CEILINGS[feat.measure];
      if (ceiling === undefined) continue;
      checked += 1;
      if (feat.target > ceiling) {
        over.push(`${feat.id} wants ${feat.target} ${feat.measure}, ceiling ${ceiling}`);
      }
    }
    expect(over, over.join('\n')).toEqual([]);
    // A guard on the guard: a ceiling table that stopped matching any measure proves nothing.
    expect(checked, 'no feat measures anything capped').toBeGreaterThan(30);
  });

  it('uses every measure it declares', () => {
    const used = new Set<FeatMeasure>(FEATS.map((feat) => feat.measure));
    const unused = FEAT_MEASURES.filter((measure) => !used.has(measure));
    expect(unused, `measures no feat asks for: ${unused.join(', ')}`).toEqual([]);
  });

  it('asks for a mark that exists, on the mark chain', () => {
    for (const feat of FEATS.filter((one) => one.measure === 'officer_best_mark')) {
      expect(feat.target, feat.id).toBeLessThan(OFFICER_MARKS.length);
      expect(feat.target, feat.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('asks for a whole number of everything countable', () => {
    for (const feat of FEATS) {
      expect(Number.isInteger(feat.target), `${feat.id} target ${feat.target}`).toBe(true);
      expect(feat.target, feat.id).toBeGreaterThan(0);
    }
  });
});

describe('the shape of the set', () => {
  it('covers every way of playing, not just fighting', () => {
    const measures = new Set(FEATS.map((feat) => feat.measure));
    // One per group named in the catalogue's own doc block. If a whole group is dropped, this says so.
    expect(measures.has('missions_done'), 'the work').toBe(true);
    expect(measures.has('battles_won'), 'fighting').toBe(true);
    expect(measures.has('districts_emptied'), 'the week').toBe(true);
    expect(measures.has('spy_jobs_returned'), 'the city').toBe(true);
    expect(measures.has('locations_held_abroad'), 'the frontier').toBe(true);
    expect(measures.has('buildings_raised'), 'the district').toBe(true);
    expect(measures.has('officer_best_mark'), 'the crew').toBe(true);
    expect(measures.has('resources_earned'), 'the trade').toBe(true);
    expect(measures.has('research_done'), 'the name').toBe(true);
  });

  it('opens most ladders with something a new player can do at once', () => {
    const heads = FEATS.filter((feat) => feat.chain !== null && feat.after === null);
    // An instructor asks for one, three or five of something. A ladder that opens at a hundred is
    // a ladder nobody starts.
    const gentle = heads.filter((feat) => feat.target <= 10);
    expect(gentle.length / heads.length).toBeGreaterThan(0.5);
  });

  it('pays in every channel the maintainer asked for', () => {
    const paid = {
      resources: FEATS.some((feat) => feat.reward.resources !== undefined),
      units: FEATS.some((feat) => feat.reward.units !== undefined),
      xp: FEATS.some((feat) => feat.reward.xp !== undefined),
      boosts: FEATS.some((feat) => feat.reward.boosts !== undefined),
      items: FEATS.some((feat) => feat.reward.items !== undefined),
      pages: FEATS.some((feat) =>
        Object.keys(feat.reward.items ?? {}).some(
          (id) => ITEM_CATALOG[id as keyof typeof ITEM_CATALOG]?.kind === 'page',
        ),
      ),
    };
    expect(paid).toEqual({
      resources: true,
      units: true,
      xp: true,
      boosts: true,
      items: true,
      pages: true,
    });
  });

  /**
   * Feats pay no infamy (maintainer, 2026-09-29). A name is made in fights and on battle jobs and
   * nowhere else; the 130 feats that used to pay one now pay units, experience or resources of the
   * same band value.
   *
   * Two halves, because there are two ways back in. The catalogue half catches a reward that
   * carries the key at runtime, which a cast or a spread from an untyped helper would get past the
   * compiler. The schema half catches the channel being put back: a reward that arrives with the
   * key has to lose it on the way through.
   */
  it('never pays infamy', () => {
    const paying = FEATS.filter((feat) => 'infamy' in feat.reward).map((feat) => feat.id);
    expect(paying, paying.join(', ')).toEqual([]);
    expect(FeatRewardSchema.parse({ xp: 1, infamy: 50 })).toEqual({ xp: 1 });
  });

  it('gives the contested districts their own work, off the city rather than by hand', () => {
    const contested = PLAYABLE_CONTESTED;
    const areaFeats = FEATS.filter(
      (feat) => feat.measure === 'missions_in_area' && feat.scope !== MISC_AREA_ID,
    );
    // Four rungs each, ten jobs then fifty then two hundred then six hundred, all generated from
    // the same map row. Pinned as a multiple rather than as a total so that adding a contested
    // district cannot silently leave it without work: the arithmetic moves with the map.
    const AREA_RUNGS = 4;
    expect(areaFeats.length).toBe(contested.length * AREA_RUNGS);
    // The multiple alone is derived from the same filter the generator runs, so it holds for any
    // generator that walks the contested list, including one that walks it and writes the wrong
    // thing. Two rungs named by hand are the anchor that is not: Neon Docks is contested, and its
    // work has to be the two rungs the doc comment promises, under the ids and scope it promises.
    expect(contested.map((district) => district.id)).toContain('neon-docks');
    expect(findFeat('area_neon_docks')?.scope).toBe('neon-docks');
    expect(findFeat('area_neon_docks')?.target).toBe(10);
    expect(findFeat('area_neon_docks_2')?.after).toBe('area_neon_docks');
    expect(findFeat('area_neon_docks_2')?.target).toBe(50);
    /*
     * ...and the same anchor in the second city, which is the half that was missing.
     *
     * The generator walked `CITY_DISTRICTS`, so the eight contested districts of Terminus arrived
     * with no work on the board at all and every gate above stayed green: a total derived from
     * the same array it generates from cannot see a map it does not look at. Coldwater Halt is
     * difficulty 1, so its first rung is an `early` feat, which is the other thing the generator
     * has to get right for a city whose ladder starts below Ashfall's.
     */
    expect(contested.map((district) => district.id)).toContain('coldwater-halt');
    expect(findFeat('area_coldwater_halt')?.scope).toBe('coldwater-halt');
    expect(findFeat('area_coldwater_halt')?.target).toBe(10);
    expect(findFeat('area_coldwater_halt')?.era).toBe('early');
    expect(findFeat('area_blockhouse')?.era, 'the Blockhouse is difficulty 10').toBe('late');
    for (const district of contested) {
      const rungs = areaFeats.filter((feat) => feat.scope === district.id);
      expect(rungs.length, district.id).toBe(AREA_RUNGS);
      // A real ladder, not two feats that happen to share a scope: the second is locked behind
      // the first and asks for more.
      expect(rungs[0]?.after, district.id).toBeNull();
      for (let step = 1; step < rungs.length; step += 1) {
        expect(rungs[step]?.after, district.id).toBe(rungs[step - 1]?.id);
        expect(rungs[step]?.target, district.id).toBeGreaterThan(rungs[step - 1]?.target ?? 0);
        expect(rungs[step]?.chain, district.id).toBe(rungs[0]?.chain);
      }
    }
  });
});

/**
 * The first hour, which is the one stretch of the game a player can walk out of.
 *
 * A new crew stands a Nexus and a Generator, holds 600 caps, produces no caps at all and needs
 * 512 of them for the second Nexus level. Until 2026-09-18 it also could not muster a single unit,
 * because every unit answered to a Gauntlet that answers to Nexus 3 and Quarters 2. The board's
 * opening feats are what pays for the way out of that, so what they pay is pinned here rather
 * than left to the band check, which cannot tell caps from scrap or a Scavenger from a Hauler.
 */
describe('the opening', () => {
  /** A district five levels into every tree and nothing else: no ground held, no documents. */
  const EARLY_DISTRICT = {
    buildings: BUILDING_KINDS.map((kind) => ({
      id: `b-${kind}`,
      kind,
      level: 5,
      modifications: [],
    })),
    heldPlaceKinds: new Set<LocationKind>(),
    buildableVehicles: new Set<string>(),
    inventory: {},
  };

  it('pays the very first feat in carriers a bare district can muster', () => {
    const first = findFeat('overseer_taken');
    expect(first?.measure).toBe('overseer_taken');
    expect(first?.target).toBe(1);
    // Standalone, because the measure can never reach two: a second character is refused.
    expect(first?.chain).toBeNull();
    expect(first?.after).toBeNull();
    expect(first?.era).toBe('early');

    const paid = Object.entries(first?.reward.units ?? {});
    expect(paid.length, 'the opening feat has to pay units').toBeGreaterThan(0);
    const opening = {
      ...EARLY_DISTRICT,
      buildings: [{ id: 'b-nexus', kind: 'nexus' as const, level: 1, modifications: [] }],
    };
    for (const [id, count] of paid) {
      const unit = findUnit(id);
      // Musterable by a crew at its first second, or the reward teaches nothing: the point of it
      // is that the player can go and buy more of what just landed.
      expect(isUnitUnlocked(unit!, opening), id).toBe(true);
      expect(count ?? 0, id).toBeGreaterThanOrEqual(5);
    }
  });

  it('pays a second lot of carriers for the first few jobs', () => {
    const second = findFeat('first_jobs');
    expect(second?.measure).toBe('missions_of_kind');
    expect(second?.scope).toBe('standard');
    // Ten minutes of play, not an evening: the Scrap Run is three minutes long.
    expect(second?.target).toBeLessThanOrEqual(5);
    expect(second?.era).toBe('early');
    expect(Object.keys(second?.reward.units ?? {}).length).toBeGreaterThan(0);
    // ...and caps, which is the resource nothing in a new district produces.
    expect(second?.reward.resources?.caps ?? 0).toBeGreaterThan(0);
    // The head of the haulage ladder, so the board draws it as the first rung of that card and
    // not as a second card with the same title. Nothing is in front of it.
    expect(second?.chain).toBe('hauls');
    expect(second?.after).toBeNull();
    expect(findFeat('hauls_1')?.after).toBe('first_jobs');
  });

  /**
   * The first mission feats pay fighters (maintainer, 2026-09-29).
   *
   * Scavengers cannot hold ground, so a crew with no fighter has no foothold, no district board
   * and no misc fight card until a Gauntlet it reaches in about half a day. The first three
   * mission rungs pay Razors instead: a fighter with no blueprint and no notoriety to field. The
   * route-level half (the crew really can walk onto open ground and take the fight card) is
   * `crew/first-fighters.test.ts` in the server.
   */
  it('pays the first fighters off the first few mission feats', () => {
    let fighters = 0;
    for (const id of ['oddjobs_1', 'runs_1', 'clean_1']) {
      const feat = findFeat(id);
      expect(feat?.era, id).toBe('early');
      expect(feat?.target ?? Infinity, id).toBeLessThanOrEqual(10);
      for (const [unitId, count] of Object.entries(feat?.reward.units ?? {})) {
        const unit = findUnit(unitId)!;
        expect(isCombatUnit(unit), `${id} pays ${unitId}`).toBe(true);
        expect(blueprintForUnit(unitId), `${id} pays ${unitId}`).toBeUndefined();
        expect(NOTORIETY_TO_FIELD[unit.tier], `${id} pays ${unitId}`).toBe(0);
        fighters += count ?? 0;
      }
    }
    expect(fighters).toBeGreaterThanOrEqual(8);
  });

  /**
   * An early feat never pays a unit an early crew could not have mustered.
   *
   * `recruits('early', …)` paid four Haulers at `medium` and eight at `large`, and on the day the
   * carriers were re-gated on the Nexus that became a reward handing a beginner a unit they
   * cannot replace until Nexus 15. The band check saw nothing: a Hauler is worth 156 caps
   * whichever building signs it. Five is a generous reading of "early", and the point is the
   * order of magnitude rather than the exact level.
   */
  it('never pays an early feat in units an early crew cannot muster', () => {
    const over: string[] = [];
    for (const feat of FEATS.filter((one) => one.era === 'early')) {
      for (const id of Object.keys(feat.reward.units ?? {})) {
        const unit = findUnit(id);
        if (unit && !isUnitUnlocked(unit, EARLY_DISTRICT)) {
          over.push(`${feat.id} pays ${id}, which a district five levels in cannot muster`);
        }
      }
    }
    expect(over, over.join('\n')).toEqual([]);
    // A guard on the guard: a fixture that unlocked everything would make the above vacuous.
    expect(isUnitUnlocked(findUnit('haulers')!, EARLY_DISTRICT)).toBe(false);
  });

  /**
   * The early resources are what the first evening runs out of (maintainer, 2026-09-18), and the
   * early coin leads with caps, which no structure produces. Since the era deal (P8-A) a reward
   * pays one or the other rather than a caps-led purse of both.
   */
  it('pays the early rungs in what the opening actually runs out of', () => {
    const early = FEATS.filter((feat) => feat.era === 'early');
    const stores = early.filter((feat) =>
      RESOURCE_KEYS.some((key) => key !== 'caps' && (feat.reward.resources?.[key] ?? 0) > 0),
    );
    expect(stores.length, 'no early feat pays resources').toBeGreaterThan(10);
    for (const feat of stores) {
      expect(feat.reward.resources?.planks ?? 0, `${feat.id} pays no planks`).toBeGreaterThan(0);
      expect(feat.reward.resources?.oil ?? 0, `${feat.id} pays no oil`).toBeGreaterThan(0);
    }
    const coin = early.filter((feat) => (feat.reward.resources?.caps ?? 0) > 100);
    expect(coin.length, 'no early feat pays caps').toBeGreaterThan(10);
    // The small rung carries planks and oil as well, which are what runs out after caps.
    const small = findFeat('runs_1')?.reward.resources ?? {};
    expect(small.planks ?? 0).toBeGreaterThan(0);
    expect(small.oil ?? 0).toBeGreaterThan(0);
  });
});

/**
 * What each era pays in (maintainer ruling P8-A, 2026-10-02): early about half caps and
 * experience, the rest resources, early units and useful items; mid about half caps or
 * experience, a fifth resources and the rest mid units, a random page, a consumable or a trap;
 * late about a third large sums, the rest rarer units, rare pages and hard-to-get parts.
 *
 * Read off what a feat pays rather than off the deal in `shaping.ts`, so the hand-written rewards
 * count too and a deal that silently fell back to coin shows up as a coin share out of band.
 */
describe('what each era pays', () => {
  const kindOf = (feat: (typeof FEATS)[number]): RewardKind => {
    const { reward } = feat;
    if (reward.units) return 'units';
    if (reward.pages) return 'page';
    if (reward.boosts) return 'consumable';
    const items = Object.keys(reward.items ?? {}).map(
      (id) => ITEM_CATALOG[id as keyof typeof ITEM_CATALOG],
    );
    if (items.some((item) => item?.kind === 'page')) return 'rare_pages';
    if (items.some((item) => item?.id.startsWith('trap_'))) return 'trap';
    if (items.length > 0) return feat.era === 'late' ? 'parts' : 'kit';
    if (RESOURCE_KEYS.some((key) => key !== 'caps' && (reward.resources?.[key] ?? 0) > 0)) {
      return 'stores';
    }
    return 'coin';
  };

  it('pays each era in the shares the ruling set', () => {
    const off: string[] = [];
    for (const era of FEAT_ERAS) {
      const feats = FEATS.filter((feat) => feat.era === era);
      for (const [kind, share] of Object.entries(ERA_REWARD_MIX[era]) as [RewardKind, number][]) {
        const paid = feats.filter((feat) => kindOf(feat) === kind).length / feats.length;
        if (Math.abs(paid - share) > 0.06) {
          off.push(
            `${era} pays ${kind} on ${Math.round(paid * 100)}% of its feats, not ${share * 100}%`,
          );
        }
      }
    }
    expect(off, off.join('\n')).toEqual([]);
  });

  it('never pays more of a resource than a store of its era holds', () => {
    const over: string[] = [];
    for (const feat of FEATS) {
      for (const key of RESOURCE_KEYS) {
        const amount = feat.reward.resources?.[key] ?? 0;
        const ceiling = eraStoreCeiling(feat.era, key);
        if (amount > ceiling)
          over.push(`${feat.id} pays ${amount} ${key}, a ${feat.era} store holds ${ceiling}`);
      }
    }
    expect(over, over.join('\n')).toEqual([]);
    // The widest store, every resource: the ruling's own test.
    for (const key of RESOURCE_KEYS) {
      expect(eraStoreCeiling('late', key)).toBeLessThanOrEqual(maxBaseStorageFor(key));
    }
  });

  it('pays the late game in rarer units than the early one', () => {
    const early = new Set(
      FEATS.filter((feat) => feat.era === 'early').flatMap((feat) =>
        Object.keys(feat.reward.units ?? {}),
      ),
    );
    const late = FEATS.filter((feat) => feat.era === 'late').flatMap((feat) =>
      Object.keys(feat.reward.units ?? {}),
    );
    expect(late.length).toBeGreaterThan(0);
    for (const id of late) expect(early.has(id), id).toBe(false);
  });
});

/**
 * The Combine's card (maintainer, 2026-09-19).
 *
 * The section is data like the rest and the generic gates above hold it to the same rules, so what
 * is pinned here is only its shape: the things a reader of `city/combine.ts` would expect to find
 * on the board and that no generic rule can ask for. A section that lost its Suppressor ladder, or
 * that locked the Executioner behind the Syndic, would pass every test above.
 */
describe('the Combine', () => {
  it('gives every common Combine unit a ladder of its own, and only those', () => {
    const ladders = new Map<string, typeof FEATS>();
    for (const feat of FEATS) {
      if (feat.measure !== 'combine_kills_of' || feat.scope === undefined) continue;
      ladders.set(feat.scope, [...(ladders.get(feat.scope) ?? []), feat]);
    }
    const common = COMBINE_UNITS.filter((unit) => !unit.unique).map((unit) => unit.id);
    expect(common, 'the four the regime fields in numbers').toEqual([
      'civic_levy',
      'greycoat',
      'street_enforcers',
      'suppressor',
    ]);
    expect([...ladders.keys()].sort()).toEqual([...common].sort());
    for (const [unitId, rungs] of ladders) {
      // A real ladder: at least three rungs, one chain, the first one open.
      expect(rungs.length, unitId).toBeGreaterThanOrEqual(3);
      expect(new Set(rungs.map((feat) => feat.chain)).size, unitId).toBe(1);
      expect(rungs[0]?.after, unitId).toBeNull();
    }
  });

  /**
   * One standalone per leader, at a target of one, and **not** because the counter cannot climb.
   *
   * It can, just: a leader who falls in a fight the regime wins is stood back up on Monday with
   * the rest of its army. Once his plot is taken he is gone for good, because nothing hands a taken
   * plot back to the regime (maintainer, 2026-09-29). The target is one because the first kill is
   * the whole of what there is to reward, and the board's rule that a standalone is never locked
   * means all three are open from the first evening: a crew can go for Directive Xero before it has
   * met the Syndic, if it likes.
   */
  it('stands one open feat per leader, at a target of one', () => {
    const slain = FEATS.filter((feat) => feat.measure === 'combine_leaders_slain');
    expect(slain.map((feat) => feat.scope).sort()).toEqual(
      COMBINE_LEADERS.map((leader) => leader.unitId).sort(),
    );
    for (const feat of slain) {
      expect(feat.chain, feat.id).toBeNull();
      expect(feat.after, feat.id).toBeNull();
      expect(feat.target, feat.id).toBe(1);
      // The end of a district, paid like one.
      expect(feat.era, feat.id).toBe('late');
      expect(feat.size, feat.id).toBe('large');
    }
  });

  /**
   * The copy against the power, not against the copy (maintainer, 2026-09-20).
   *
   * A feat's blurb is the only place a player is told what a legendary's power is worth, and it is
   * the one part of a mechanic that no gate moves when the mechanic moves. The Syndic's retune
   * proved it: the opening power was +20 penetration, +20 morale and 20 armour off the attacker,
   * and when the morale and the subtraction were dropped two blurbs went on selling both, on a
   * screen whose whole job is to tell a crew what there is to go and do.
   *
   * The permitted words are derived from `leader.power` itself rather than listed here, so a
   * leader who is given a stat back gets the word back with it and nothing has to be remembered.
   */
  const SHEET_WORDS: Readonly<Record<string, readonly string[]>> = {
    morale: ['morale'],
    penetration: ['penetration'],
    armor: ['armour', 'armor'],
    vitality: ['vitality'],
    speed: ['speed'],
    evasion: ['evasion'],
    range: ['range'],
    stealth: ['stealth'],
    intimidation: ['intimidation'],
  };

  /** Every feat whose own copy names this leader, by the name the roster gives him. */
  const naming = (unitId: string) => {
    const name = findUnit(unitId)?.name;
    if (name === undefined) throw new Error(`no sheet for ${unitId}`);
    return FEATS.filter((feat) => `${feat.name} ${feat.blurb}`.includes(name));
  };

  it('names no sheet stat in a leader’s copy that the leader’s power does not carry', () => {
    for (const leader of COMBINE_LEADERS) {
      const carried = new Set(Object.keys(leader.power));
      const forbidden = Object.entries(SHEET_WORDS)
        .filter(([stat]) => !carried.has(stat))
        .flatMap(([, words]) => words);
      const feats = naming(leader.unitId);
      // A leader nothing names would make the loop below vacuous.
      expect(feats.length, `nothing names ${leader.unitId}`).toBeGreaterThan(0);
      for (const feat of feats) {
        for (const word of forbidden) {
          expect(
            new RegExp(`\\b${word}\\b`, 'i').test(`${feat.name} ${feat.blurb}`),
            `${feat.id} sells ${leader.unitId}'s power on ${word}, which it does not have`,
          ).toBe(false);
        }
      }
    }
  });

  /**
   * ...and none of them says a power reaches across the line.
   *
   * Every `CombinePower` is points on the Combine's own units or a rule about what an exchange
   * leaves behind; not one of them names the attacker, and `battle/combine.test.ts` measures that
   * in the engine ("changes nothing on the sheet of whoever is sent against her"). Copy that says
   * a leader takes something off the player's sheet is describing a mechanic the game does not
   * have, and it is the half of the retune most likely to survive in prose.
   */
  it('claims no leader takes anything off the player’s own sheet', () => {
    const reaching = /\b(?:off|from)\s+(?:your|the attacker.s)\b/i;
    for (const feat of FEATS) {
      const text = `${feat.name} ${feat.blurb}`;
      const names = COMBINE_LEADERS.some((leader) => text.includes(findUnit(leader.unitId)!.name));
      if (!names) continue;
      expect(reaching.test(text), `${feat.id} takes points off the player's sheet`).toBe(false);
    }
  });

  /**
   * ...and the Executioner's line is quoted at the share the engine finishes at (bug pass,
   * 2026-09-29). It moved from a tenth to 30% on 2026-09-21 and `shadow_3` kept "a tenth of a
   * life", typed out where the Syndic's figures beside it are read off `city/combine.ts`.
   */
  it('quotes the Executioner’s line at the share the engine finishes at', () => {
    const line = `${Math.round(EXECUTIONER_THRESHOLD * 100)}%`;
    const quoting = FEATS.filter((feat) => /\bof (?:a|its) (?:life|vitality)\b/i.test(feat.blurb));
    expect(quoting.length, 'nothing quotes his line').toBeGreaterThan(0);
    for (const feat of quoting) expect(feat.blurb, feat.id).toContain(line);
  });

  /**
   * A blurb that calls a plot cheap names one nothing on the regime's ground undercuts (bug pass,
   * 2026-09-29). `liberated_1` sent a first crew to the Tideline Market, seven Levy, past three
   * plots on the same quay with four.
   */
  it('points a first crew at ground no Combine plot undercuts', () => {
    const regime = COMBINE_DISTRICTS.flatMap((district) =>
      district.locations.map((location) => ({
        name: location.name,
        bodies: Object.values(startingGarrison(location, district)).reduce((a, b) => a + b, 0),
      })),
    ).filter((plot) => plot.bodies > 0);
    const cheapest = Math.min(...regime.map((plot) => plot.bodies));
    const named = FEATS.filter((feat) => /\bcheap/i.test(feat.blurb)).flatMap((feat) =>
      regime.filter((plot) => feat.blurb.includes(plot.name)).map((plot) => ({ feat, plot })),
    );
    expect(named.length, 'no blurb names a cheap plot').toBeGreaterThan(0);
    for (const { feat, plot } of named)
      expect(plot.bodies, `${feat.id}: ${plot.name}`).toBe(cheapest);
  });

  /**
   * The chapel ladder ends on every chapel the regime has, which is no longer one.
   *
   * It was a standalone at a target of one, under the board's rule that a thing with no degrees
   * does not get a ladder, and that was right while there was one Chosen Chapel. Terminus put a
   * second `combine_chapel` inside Control, and the feat then read "hold the Chosen Chapel" on a
   * measure that counts both: a crew holding the Frontier Chapel and nothing else collected a feat
   * whose own sentence described a building in another city.
   *
   * The top rung is derived so a third chapel moves it rather than stranding it.
   */
  it('climbs the chapel ladder to every chapel the regime has', () => {
    const chapel = FEATS.filter((feat) => feat.measure === 'chapel_held');
    expect(CHAPEL_LOCATIONS.length, 'there is more than one Combine chapel').toBeGreaterThan(1);
    expect(chapel.map((feat) => feat.target)).toEqual([1, CHAPEL_LOCATIONS.length]);
    expect(chapel[0]?.after, 'the head of a ladder is never locked').toBeNull();
    expect(chapel[1]?.after).toBe(chapel[0]?.id);
  });

  /**
   * The map moves one way (maintainer, 2026-09-29). Nothing hands a plot back to the Combine or
   * the looters, and the copy said four times that it did: a leader "back the Monday after", a
   * ladder counting "every one they took back". A blurb that promises a retake is selling a
   * mechanic the game does not have.
   */
  it('promises no retake by the regime', () => {
    const retake = /\b(?:is|are|comes?) back\b|\btook (?:it |them )?back\b|\bretakes?\b/i;
    const regime = FEATS.filter((feat) => feat.measure.startsWith('combine_'));
    expect(regime.length).toBeGreaterThan(10);
    for (const feat of regime) {
      expect(retake.test(`${feat.name} ${feat.blurb}`), feat.id).toBe(false);
    }
  });

  /**
   * `liberated` counts a plot the first time a crew takes it off the regime, and the regime never
   * takes one back, so every crew draws on the same 74 plots in the open cities and each counts
   * once for the world. The ladder ran to 50, two thirds of all of it for one crew. Its top rung
   * is held to a fifth of the regime's ground.
   */
  it('sizes the liberated ladder for one crew among many', () => {
    const regimePlots = COMBINE_DISTRICTS.flatMap((district) =>
      district.locations.filter(
        (location) => Object.keys(startingGarrison(location, district)).length > 0,
      ),
    ).length;
    expect(regimePlots).toBe(74);
    const rungs = FEATS.filter((feat) => feat.measure === 'combine_locations_taken');
    expect(rungs.map((feat) => feat.target)).toEqual([1, 3, 6, 10, 15]);
    expect(rungs.at(-1)!.target).toBeLessThanOrEqual(Math.ceil(regimePlots / 5));
  });

  it('ends the held-districts ladder on the whole of the regime’s ground', () => {
    const rungs = FEATS.filter((feat) => feat.measure === 'combine_districts_held');
    // Ten and not six: the regime holds four districts in Terminus as well, so the rung that read
    // "the regime holds nothing" came to mean "the regime holds nothing here" on the day the
    // second city opened, without anybody touching a feat.
    expect(rungs.map((feat) => feat.target)).toEqual([1, 3, 6, COMBINE_DISTRICTS.length]);
    expect(COMBINE_DISTRICTS.length).toBe(10);
  });
});

/**
 * The frontier: the feats that only mean anything once there are two cities (2026-09-24).
 *
 * The generic gates above hold these to the same rules as everything else, so what is pinned here
 * is the shape no generic rule can ask for: that every ladder about foreign ground is reachable
 * from **either** home, that the railway ladder tops out on the platforms the map actually has,
 * and that the section exists at all. A board that silently lost this group would pass every other
 * test in the file.
 */
describe('the frontier', () => {
  const abroadMeasures: readonly FeatMeasure[] = [
    'locations_held_abroad',
    'districts_held_whole_abroad',
    'cities_held',
    'battles_won_abroad',
    'rail_stations_held',
    'rail_journeys',
  ];

  it('gives every frontier measure at least one feat', () => {
    for (const measure of abroadMeasures) {
      const asked = FEATS.filter((feat) => feat.measure === measure);
      expect(asked.length, `nothing asks for ${measure}`).toBeGreaterThan(0);
    }
  });

  /**
   * A foreign target is reachable from whichever city a crew happens to live in.
   *
   * The two open cities hold sixty locations each, so a target sized off the world total is a rung
   * nobody can stand on and a target sized off the bigger city is a rung half the players cannot.
   * Held against the smaller of the two shares, which is what `reachableAbroad` answers.
   */
  it('never asks for more foreign ground than the leaner home leaves', () => {
    const locations = reachableAbroad((district) => district.locations.length);
    const districts = reachableAbroad((district) => (district.locations.length > 0 ? 1 : 0));
    // A guard on the guard: with one open city there is no abroad and every assertion is vacuous.
    expect(locations, 'no foreign ground at all').toBeGreaterThan(0);
    for (const feat of FEATS.filter((one) => one.measure === 'locations_held_abroad')) {
      expect(feat.target, feat.id).toBeLessThanOrEqual(locations);
    }
    for (const feat of FEATS.filter((one) => one.measure === 'districts_held_whole_abroad')) {
      expect(feat.target, feat.id).toBeLessThanOrEqual(districts);
    }
  });

  /**
   * The railway ladder needs the rung that makes it a railway.
   *
   * One Station is a building. Two is the number `railwayOffer` refuses below (`city/rails.ts`:
   * "if (stations.size < 2) return null"), so a ladder running 1, 4, 7 would skip the only rung
   * whose reward is the mechanic itself, and the copy that sells the train would sit on a rung a
   * crew reaches long after it has been riding.
   */
  it('puts a rung on the second Station, which is where the train starts running', () => {
    const rungs = FEATS.filter((feat) => feat.measure === 'rail_stations_held');
    expect(rungs.map((feat) => feat.target)).toContain(2);
    expect(rungs.at(-1)?.target, 'the ladder ends on every platform').toBe(RAIL_STATIONS.length);
    expect(RAIL_STATIONS.length, 'seven platforms, and none on Telemetry Hill').toBe(7);
  });

  /** Every open city at once, and never more than the world has. */
  it('asks for ground in every open city and no more', () => {
    const rungs = FEATS.filter((feat) => feat.measure === 'cities_held');
    expect(rungs.length).toBe(1);
    expect(rungs[0]?.target).toBe(PLAYABLE_CITY_COUNT);
    // Standalone, because with two cities open there is exactly one interesting number here.
    expect(rungs[0]?.chain).toBeNull();
    expect(rungs[0]?.after).toBeNull();
  });

  /**
   * The two ladders a second city is supposed to have moved, and did not until it was made to.
   *
   * `holdings` topped out at forty five of what was then sixty locations, and `whole` at eight of
   * eight districts. Both were the whole of Ashfall and both quietly became a fraction of the
   * world. The rungs below cannot be reached without ground in a second city, which is the
   * property worth pinning rather than the numbers themselves.
   */
  it('takes the city ladders past what one city can give', () => {
    const perCity = Math.max(
      ...[...new Set(PLAYABLE_DISTRICTS.map((district) => district.cityId))].map(
        (cityId) =>
          PLAYABLE_LOCATIONS.filter(
            (location) =>
              PLAYABLE_DISTRICTS.find((district) => district.id === location.districtId)?.cityId ===
              cityId,
          ).length,
      ),
    );
    const holdings = FEATS.filter((feat) => feat.measure === 'locations_held');
    expect(
      holdings.at(-1)?.target ?? 0,
      'the holdings ladder fits inside one city',
    ).toBeGreaterThan(perCity);

    const districtsPerCity = Math.max(
      ...[...new Set(HOLDABLE_DISTRICTS.map((district) => district.cityId))].map(
        (cityId) => HOLDABLE_DISTRICTS.filter((district) => district.cityId === cityId).length,
      ),
    );
    const whole = FEATS.filter((feat) => feat.measure === 'districts_held_whole');
    expect(
      whole.at(-1)?.target ?? 0,
      'the whole-district ladder fits inside one city',
    ).toBeGreaterThan(districtsPerCity);
  });
});

/**
 * The week: the two mechanics that landed on 2026-09-24 and arrived with no feats at all.
 *
 * The regime's and the squatters' garrisons are now spent by the fights they turn up to
 * (`battle/resolve.ts`, `spendGarrisons`), and every plot no crew holds is put back to its
 * authored strength at Monday 00:00 Athens time (`city/regrowth.ts`). Together those turn the city
 * into something that runs down over a week and refills, which is a whole new way to play that the
 * board said nothing about: the one screen that tells a player what there is to do had no rung for
 * stripping a district and none for keeping ground through the reset.
 *
 * What is pinned here is the shape no generic rule can ask for: that both measures are asked for at
 * all, that a ladder about stripping districts cannot want more districts than the map garrisons,
 * and that a ladder about tenure cannot want more plot-weeks than the world can pay in the weeks
 * it is allowed.
 */
describe('the week', () => {
  const weekMeasures: readonly FeatMeasure[] = ['districts_emptied', 'plots_held_through_regrowth'];

  it('gives both halves of the weekly cycle a ladder', () => {
    for (const measure of weekMeasures) {
      const rungs = FEATS.filter((feat) => feat.measure === measure);
      expect(rungs.length, `nothing asks for ${measure}`).toBeGreaterThan(1);
      // A ladder and not two feats that share a measure: one chain, head open, targets climbing.
      expect(new Set(rungs.map((feat) => feat.chain)).size, measure).toBe(1);
      expect(rungs[0]?.chain, measure).not.toBeNull();
      expect(rungs[0]?.after, measure).toBeNull();
      // An instructor: the mechanic is invisible until somebody is paid to try it once.
      expect(rungs[0]?.target, `${measure} opens too high`).toBe(1);
    }
  });

  /**
   * A district can only be stripped if somebody garrisons it.
   *
   * `GARRISONED_DISTRICTS` is derived off `startingGarrison`, so it is the same reading the world
   * seeder and the Monday sweep take: sixteen of the twenty four playable districts have ground the
   * regime or the squatters stand on, and the other eight are residential blocks with no locations
   * in them at all. Sixteen is therefore the most a crew could strip in any one week, since Monday
   * puts every one of them back.
   *
   * The top rung is held to a stated number of those weeks rather than to a number typed here, so
   * a map that loses a garrisoned district moves the bound with it.
   */
  it('never asks for more districts than the map garrisons in the weeks it allows', () => {
    // Pinned by hand, like the Combine ceilings above it: a map that quietly stopped garrisoning a
    // district would move the bound and leave this green.
    expect(GARRISONED_DISTRICTS.length, 'sixteen districts have NPC ground on them').toBe(16);
    const rungs = FEATS.filter((feat) => feat.measure === 'districts_emptied');
    const WEEKS = 2;
    expect(rungs.at(-1)?.target ?? 0).toBeLessThanOrEqual(GARRISONED_DISTRICTS.length * WEEKS);
    // ...and it has to be worth more than one week of it, or the ladder ends before the mechanic
    // has asked anything of a player who plays past Sunday.
    expect(rungs.at(-1)?.target ?? 0).toBeGreaterThan(GARRISONED_DISTRICTS.length);
  });

  /**
   * Tenure is counted in plot-weeks, so its ceiling is the map times the weeks it may ask for.
   *
   * `plots_held_through_regrowth` goes up once per crew-held plot the Monday sweep walks past, so a
   * crew holding twenty five plots banks twenty five a week. The absolute ceiling is one crew
   * holding the whole world, which nobody will, which is exactly what makes it the honest upper
   * bound for a guard rail.
   */
  it('never asks for more plot-weeks than the whole world can pay in the weeks it allows', () => {
    const rungs = FEATS.filter((feat) => feat.measure === 'plots_held_through_regrowth');
    const WEEKS = 4;
    expect(PLAYABLE_LOCATIONS.length, 'a hundred and twenty plots').toBe(120);
    expect(rungs.at(-1)?.target ?? 0).toBeLessThanOrEqual(PLAYABLE_LOCATIONS.length * WEEKS);
    // More than one Monday's worth of the whole map, or the ladder is about how much you hold
    // rather than about how long you kept it, which `locations_held` already asks.
    expect(rungs.at(-1)?.target ?? 0).toBeGreaterThan(PLAYABLE_LOCATIONS.length);
  });
});

/**
 * A counter the game caps by the day has a top rung a committed player can reach (audit,
 * 2026-09-28).
 *
 * The ceilings test above bounds what a crew can ever *hold*. These measures are lifetime counts
 * and have no ceiling, but each can only climb so far in a day, and the catalogue shipped rungs
 * that would take years at that pace: 2,200 back-room lots at one or two a day, forty million
 * faction infamy at about 1,500. Each top rung is held to {@link DAYS_CEILING} days at the most the
 * game allows in one, read off the rule that sets it wherever the game has one.
 */
describe('the measures a day caps', () => {
  /**
   * The game lasts about three months (maintainer, 2026-10-02), so every top rung on a measure
   * the game paces has to be reachable inside ninety days by a committed crew. It was 250 days,
   * eight months, which put the top of the earned ladders out of the game's own life.
   */
  const DAYS_CEILING = 90;
  /** Every level milestone earned: the fence's second take, the Bar's third table. */
  const PAST_EVERY_MILESTONE = Number.POSITIVE_INFINITY;
  /**
   * The one rate here that no rule sets. Fight infamy has no daily cap; this is the audit's figure
   * for a crew that fights every day.
   */
  const FIGHT_INFAMY_PER_CREW_PER_DAY = 300;
  /**
   * ...with a B Field Commander's share on it, the basis the top infamy rungs are sized on
   * (maintainer, 2026-10-04): the chair's passive adds to every fight against a crew.
   */
  const FIGHT_INFAMY_WITH_A_B_COMMANDER =
    FIGHT_INFAMY_PER_CREW_PER_DAY *
    (1 +
      chairPassivePercent(
        'battle_infamy',
        OFFICER_MARK_FLOOR + markIndex('B') * OFFICER_MARK_BAND,
      ) /
        100);
  /** The Broker, the supplier and the Runner: one counterparty each (`tallyMarketDeal`). */
  const HOUSE_COUNTERS = 3;
  /**
   * The crews there are to trade with (maintainer ruling P18-C, 2026-10-02: "size the trading
   * feats on 12 crews in all"). The overseer pool holds thirty, but two cities of four plots hold
   * eight crews, and a market rung sized on thirty asked for 929 days of selling.
   */
  const TRADING_CREWS = 12;

  /**
   * What a committed late crew earns of one resource in a day, off the game's own tables.
   *
   * Its district at every structure's ceiling, producing round the clock, plus its parties on the
   * best-paying job for that resource, at the hardest area's pay, for a third of the day. A third
   * because nobody keeps a party on the shortest job all night: the board's best rate per minute
   * is the short jobs, and asleep a crew runs the long ones. An upper bound on the steady state,
   * which is the right side for a ceiling test to err on.
   */
  const lateDaily = (key: ResourceKey): number => {
    const buildings = BUILDING_KINDS.map((kind) => ({
      id: kind,
      kind,
      level: levelCeilingFor(kind),
      modifications: [],
    }));
    const produced = (productionRates(buildings, noCrewEffects())[key] ?? 0) * 24;
    const topPay = 1 + Math.max(...ALL_DISTRICTS.map((one) => areaPayPercent(one.id))) / 100;
    let perMinute = 0;
    for (const template of MISSION_TEMPLATES) {
      for (const grade of template.grades) {
        const minutes = templateTimings(template, grade).totalMinutes;
        const paid = missionRewards(template, 'success', minutes, grade)[key] ?? 0;
        perMinute = Math.max(perMinute, (paid * topPay) / minutes);
      }
    }
    const parties = concurrentMissionSlots(PAST_EVERY_MILESTONE);
    return produced + (perMinute * 24 * 60 * parties) / 3;
  };

  const MOST_PER_DAY: Partial<Record<FeatMeasure, number>> = {
    contraband_taken: blackMarketTakesPerDay(PAST_EVERY_MILESTONE),
    officers_hired: maxOpenAuctionsFor(PAST_EVERY_MILESTONE),
    // The member's own share since 2026-10-02 (P3-D), so one crew's fights rather than a table's.
    faction_infamy: FIGHT_INFAMY_WITH_A_B_COMMANDER,
    infamy_earned: FIGHT_INFAMY_WITH_A_B_COMMANDER,
    // One deal a day with each other crew.
    market_sales: TRADING_CREWS - 1,
    market_buys: TRADING_CREWS - 1 + HOUSE_COUNTERS,
  };

  it('reads the daily limits the game actually sets', () => {
    // Pinned by hand, like the map ceilings: a rule that quietly loosened would loosen the bound
    // with it and leave this green.
    expect(MOST_PER_DAY.contraband_taken, 'two lots a day from level 50').toBe(2);
    expect(MOST_PER_DAY.officers_hired, 'three tables a day from level 40').toBe(3);
    expect(MOST_PER_DAY.market_sales, 'eleven other crews').toBe(11);
  });

  it('puts every top rung within the days a committed player has', () => {
    const late: string[] = [];
    for (const [measure, perDay] of Object.entries(MOST_PER_DAY) as [FeatMeasure, number][]) {
      const rungs = FEATS.filter((feat) => feat.measure === measure);
      expect(rungs.length, `nothing asks for ${measure}`).toBeGreaterThan(0);
      const top = Math.max(...rungs.map((feat) => feat.target));
      const days = top / perDay;
      if (days > DAYS_CEILING) {
        late.push(`${measure} tops out at ${top}: ${Math.round(days)} days at ${perDay} a day`);
      }
    }
    expect(late, late.join('\n')).toEqual([]);
  });

  /**
   * The lifetime "earned" ladders (maintainer ruling P8-B, 2026-10-02). `caps_10` asked for 2.6
   * billion and `metal_7` for ten million, thousands of days at any rate the game pays.
   */
  it('puts every earned rung within the days a committed late crew has', () => {
    const earned = FEATS.filter((feat) => feat.measure === 'resources_earned');
    expect(earned.length).toBeGreaterThan(5);
    const late: string[] = [];
    for (const feat of earned) {
      const perDay = lateDaily(feat.scope as ResourceKey);
      expect(perDay, `nothing earns ${feat.scope}`).toBeGreaterThan(0);
      const days = feat.target / perDay;
      if (days > DAYS_CEILING) {
        late.push(
          `${feat.id} wants ${feat.target}: ${Math.round(days)} days at ${Math.round(perDay)} a day`,
        );
      }
    }
    expect(late, late.join('\n')).toEqual([]);
  });
});

/*
 * Three level feats quote the experience it took to get there, and those figures are the curve's
 * (`progression/curve.ts`). They went stale once already: the curve's power went from 1.6 to 1.41
 * on 2026-10-01 and the blurbs still said forty five thousand, a hundred and thirty thousand and
 * half a million. Each quoted figure has to sit within a tenth of the real total.
 */
describe('the level feats quote the curve', () => {
  const quoted: readonly { id: string; words: string; figure: number }[] = [
    { id: 'level_3', words: 'Twenty eight thousand', figure: 28_000 },
    { id: 'level_4', words: 'Seventy five thousand', figure: 75_000 },
    { id: 'level_5', words: 'A quarter of a million', figure: 250_000 },
  ];
  const xpToReach = (level: number) => {
    let total = 0;
    for (let from = 1; from < level; from += 1) total += playerXpToNextLevel(from);
    return total;
  };

  it.each(quoted)('$id says $words, which is what the curve asks', ({ id, words, figure }) => {
    const feat = findFeat(id);
    expect(feat?.blurb).toContain(words);
    const real = xpToReach(feat?.target ?? 0);
    expect(
      Math.abs(real - figure) / real,
      `${id}: ${real} to reach level ${feat?.target}`,
    ).toBeLessThan(0.1);
  });
});

/*
 * The late payroll rungs, sized for a crew with every payroll card fitted and expansions bought in
 * caps (maintainer, 2026-10-01). The counts and the prices are written out, so a card added to the
 * deck, a target moved or a price retuned shows up here.
 */
describe('the payroll ladder', () => {
  it('asks the full card stack for the expansions and caps the rungs were sized at', () => {
    const cards = MODIFICATIONS.filter((card) => card.effect === 'payroll_percent');
    const bonus =
      PAYROLL_PERCENT_PER_QUARTERS_LEVEL * levelCeilingFor('quarters') +
      cards.reduce((total, card) => total + card.magnitude, 0);
    // An A- Fixer, whose passive adds a share of the whole book (2026-10-04).
    const fixer = chairPassivePercent(
      'payroll',
      OFFICER_MARK_FLOOR + markIndex('A-') * OFFICER_MARK_BAND,
    );
    const expansionsFor = (target: number): number => {
      let bought = 0;
      while (payrollCapacity(levelCeilingFor('nexus'), bought, bonus, fixer) < target) bought += 1;
      return bought;
    };
    const capsFor = (count: number): number => {
      let spent = 0;
      for (let bought = 0; bought < count; bought += 1) spent += payrollStepCost(bought);
      return spent;
    };
    const late = ['payroll_3', 'payroll_4', 'payroll_5'].map((id) =>
      expansionsFor(findFeat(id)!.target),
    );
    expect(cards, 'the payroll cards the sizing counts').toHaveLength(11);
    expect(late).toEqual([24, 61, 122]);
    expect(late.map(capsFor)).toEqual([23_760, 128_100, 479_460]);
  });

  /** The two early rungs need no card past the Nexus's and the Quarters' own. */
  it('opens the early rungs to a crew without the late cards', () => {
    expect(payrollCapacity(12, 0)).toBeGreaterThanOrEqual(findFeat('payroll_1')!.target);
    const fourCards = MODIFICATIONS.filter(
      (card) =>
        card.effect === 'payroll_percent' &&
        (card.id.startsWith('nexus_') || card.id.startsWith('quarters_')),
    ).reduce((total, card) => total + card.magnitude, 0);
    const bonus = PAYROLL_PERCENT_PER_QUARTERS_LEVEL * levelCeilingFor('quarters') + fourCards;
    expect(fourCards).toBe(60);
    // With an A- Fixer, the basis every rung past the first is sized on (2026-10-04).
    const fixer = chairPassivePercent(
      'payroll',
      OFFICER_MARK_FLOOR + markIndex('A-') * OFFICER_MARK_BAND,
    );
    expect(payrollCapacity(levelCeilingFor('nexus'), 20, bonus, fixer)).toBeGreaterThanOrEqual(
      findFeat('payroll_2')!.target,
    );
    expect(payrollCapacity(levelCeilingFor('nexus'), 19, bonus, fixer)).toBeLessThan(
      findFeat('payroll_2')!.target,
    );
  });
});
