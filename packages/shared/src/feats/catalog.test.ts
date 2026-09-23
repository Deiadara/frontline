import { BATTLE_TIERS } from '../missions.leading.js';
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
import { COMBINE_UNITS, UNIT_IDS } from '../units/catalog.js';
import { UNIT_UPGRADE_SLOTS } from '../units/loadout.js';
import { BUILDING_PART_GATES } from '../building/parts.js';
import { UNIT_MODIFICATIONS } from '../units/modifications.js';
import { COMBINE_LEADERS } from '../city/combine.js';
import { CITY_DISTRICTS, CITY_LOCATIONS } from '../city/districts.js';
import { OFFICER_MARKS } from '../crew/marks.js';
import { ITEM_CATALOG } from '../items/catalog.js';
import { BLACK_MARKET_GOOD_IDS } from '../market/blackmarket.js';
import { MISC_AREA_ID } from '../missions.areas.js';
import { RESOURCE_KEYS, type ResourceKey } from '../resources.js';
import { findUnit } from '../units/index.js';
import { isUnitUnlocked } from '../units/unlocks.js';
import type { LocationKind } from '../city/locations.js';
import { FEATS, findFeat } from './catalog.js';
import { FEAT_MEASURES, FEAT_MEASURE_SPECS, type FeatMeasure } from './measures.js';
import { FEAT_ERAS, featRewardBand, featRewardValue } from './rewards.js';

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
   * toll for Garage 12. The catalogue shipped paying 376 of them and 256 Targeting Cores against a
   * demand of two, and every existing test passed, because caps-equivalent is the wrong unit for a
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
   * again pays nothing. The catalogue shipped two rungs (`trained_10` and `faction_10`) paying 844
   * units worth 3,377 unit slots against a ceiling of 3,186, so the top of two ladders could not be
   * collected by anybody, ever (bug pass, 2026-09-17).
   *
   * Held to half the ceiling rather than to all of it, because a crew collecting a feat has an army
   * already: a reward that fits only into an empty district is a reward that has to be made room
   * for, which is not what a reward is. Half is also where the catalogue already sat: the biggest
   * bundle it has ever paid, `recruits('late', 'large')`, is 1,560 slots.
   */
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
    expect(LIFETIME_PART_DEMAND['rotor_hub']).toBe(1);
  });

  /**
   * Every reward is a whole number of whatever it pays.
   *
   * The schema only holds four of the five channels to it: `xp`, `infamy`, items and units are all
   * `z.number().int()`, and **resources are not**, because production settles in fractional carry
   * and the bundle has to be able to carry it. So a reward computed rather than typed can put a
   * fraction on a stockpile, and `addResources` adds it straight on: `rise(3, 'coin')` paid
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
      'the crew': 'trained',
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
    const areas = new Set([MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)]);
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
        case 'fights_won_at_tier':
          expect(BATTLE_TIERS, feat.id).toContain(scope);
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
    const holdableDistricts = CITY_DISTRICTS.filter(
      (district) => district.locations.length > 0,
    ).length;
    const CEILINGS: Partial<Record<FeatMeasure, number>> = {
      // Both sums walk the structures one at a time: eleven times the tallest structure would say
      // 220 standing levels and 33 brackets, and neither is a district anybody can build.
      buildings_total: BUILDING_KINDS.reduce((total, kind) => total + levelCeilingFor(kind), 0),
      // A district cannot finish a structure it does not have one of, so the whole board is the
      // list of kinds. The last rung of `finished` is exactly this number, on purpose.
      buildings_maxed: BUILDING_KINDS.length,
      modifications_fitted: BUILDING_KINDS.reduce(
        (total, kind) => total + modificationSlotsAt(levelCeilingFor(kind)),
        0,
      ),
      /*
       * A set is three cards of one family in one structure (`MODIFICATION_SET_SIZE`), so a
       * structure that never opens a third bracket can never hold one. The third opens at level 20
       * and the Garage and the Infirmary stop at 10, which puts the real maximum at nine sets
       * rather than eleven. An upper bound: a structure also needs three cards of one family that
       * fit it, which is a question about the deck rather than about the ladder.
       */
      modification_sets: BUILDING_KINDS.filter(
        (kind) => modificationSlotsAt(levelCeilingFor(kind)) >= MODIFICATION_SET_SIZE,
      ).length,
      unit_modifications_fitted: UNIT_IDS.length * UNIT_UPGRADE_SLOTS,
      unit_kinds_held: UNIT_IDS.length,
      officer_best_mark: OFFICER_MARKS.length - 1,
      officers_held: OFFICER_ROLES.length,
      overseer_skills_at: ATTRIBUTE_NAMES.length,
      overseer_best_skill: MAX_ATTRIBUTE,
      notoriety: MAX_NOTORIETY,
      research_done: RESEARCH_ITEMS.length,
      blueprints_unlocked: BLUEPRINTS.length,
      fleet_size: MAX_PER_VEHICLE * VEHICLE_IDS.length,
      districts_held_whole: holdableDistricts,
      /*
       * One short of the map, because a crew cannot scout the district it lives in.
       *
       * `sendScout` refuses `own_district` and no other path writes a `district_intel` row for
       * home, so the measure tops out at eleven of twelve. The last rung of `scouted` asked for
       * twelve and sat at 11/12 for ever, which is the failure the note above this test describes.
       */
      districts_scouted: CITY_DISTRICTS.length - 1,
      // The regime's ground, whole: six districts today, and the last rung of `annexed` asks for
      // exactly that many. The Chapel is one building, so a target past one is a feat for nobody.
      combine_districts_held: CITY_DISTRICTS.filter(
        (district) => district.allegiance === 'government' && district.locations.length > 0,
      ).length,
      chapel_held: CITY_LOCATIONS.filter((location) => location.kind === 'combine_chapel').length,
      locations_held: CITY_LOCATIONS.length,
      faction_seats: SEAT_SLOT_ORDER.length,
    };

    // The one figure here that is not read off the game, for the reason the ladder test above
    // gives: two of the eleven structures never open a third bracket, so a table that quietly
    // stopped covering `modification_sets` would leave the deepest deck feat unmeasured.
    expect(CEILINGS.modification_sets, 'structures that can hold a full set').toBe(9);
    // Likewise pinned by hand: a map that quietly lost a Combine district, or gained a second
    // chapel, would move the ceiling and the ladder with it and leave this green.
    expect(CEILINGS.combine_districts_held, 'the Combine holds six districts').toBe(6);
    expect(CEILINGS.chapel_held, 'there is one Chosen Chapel').toBe(1);

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
    expect(measures.has('districts_scouted'), 'the city').toBe(true);
    expect(measures.has('buildings_raised'), 'the district').toBe(true);
    expect(measures.has('officer_best_mark'), 'the crew').toBe(true);
    expect(measures.has('resources_earned'), 'the trade').toBe(true);
    expect(measures.has('research_done'), 'the name').toBe(true);
    expect(measures.has('messages_sent'), 'people').toBe(true);
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
      infamy: FEATS.some((feat) => feat.reward.infamy !== undefined),
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
      infamy: true,
      boosts: true,
      items: true,
      pages: true,
    });
  });

  it('gives the contested districts their own work, off the city rather than by hand', () => {
    const contested = CITY_DISTRICTS.filter((district) => district.kind === 'contested');
    const areaFeats = FEATS.filter(
      (feat) => feat.measure === 'missions_in_area' && feat.scope !== MISC_AREA_ID,
    );
    // Four rungs each, ten jobs then fifty then two hundred then six hundred, all generated from
    // the same city row. Pinned as a multiple rather than as a total so that adding a contested
    // district to the map cannot silently leave it without work: the arithmetic moves with
    // `CITY_DISTRICTS`.
    const AREA_RUNGS = 4;
    expect(areaFeats.length).toBe(contested.length * AREA_RUNGS);
    // The multiple alone is derived from the same filter the generator runs, so it holds for any
    // generator that walks the contested list, including one that walks it and writes the wrong
    // thing. One rung named by hand is the anchor that is not: Neon Docks is contested, and its
    // work has to be the two rungs the doc comment promises, under the ids and scope it promises.
    expect(contested.map((district) => district.id)).toContain('neon-docks');
    expect(findFeat('area_neon_docks')?.scope).toBe('neon-docks');
    expect(findFeat('area_neon_docks')?.target).toBe(10);
    expect(findFeat('area_neon_docks_2')?.after).toBe('area_neon_docks');
    expect(findFeat('area_neon_docks_2')?.target).toBe(50);
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
 * 512 of them for the second Nexus level. Until 2026-09-18 it also could not train a single unit,
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

  it('pays the very first feat in carriers a bare district can train', () => {
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
      // Trainable by a crew at its first second, or the reward teaches nothing: the point of it
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
   * An early feat never pays a unit an early crew could not have trained.
   *
   * `recruits('early', …)` paid four Haulers at `medium` and eight at `large`, and on the day the
   * carriers were re-gated on the Nexus that became a reward handing a beginner a unit they
   * cannot replace until Nexus 15. The band check saw nothing: a Hauler is worth 156 caps
   * whichever building signs it. Five is a generous reading of "early", and the point is the
   * order of magnitude rather than the exact level.
   */
  it('never pays an early feat in units an early crew cannot train', () => {
    const over: string[] = [];
    for (const feat of FEATS.filter((one) => one.era === 'early')) {
      for (const id of Object.keys(feat.reward.units ?? {})) {
        const unit = findUnit(id);
        if (unit && !isUnitUnlocked(unit, EARLY_DISTRICT)) {
          over.push(`${feat.id} pays ${id}, which a district five levels in cannot train`);
        }
      }
    }
    expect(over, over.join('\n')).toEqual([]);
    // A guard on the guard: a fixture that unlocked everything would make the above vacuous.
    expect(isUnitUnlocked(findUnit('haulers')!, EARLY_DISTRICT)).toBe(false);
  });

  /**
   * The early purse leads with caps and carries what the first evening runs out of.
   *
   * Caps have no producer at all, so a bundle of scrap is a bundle of the one thing a new crew is
   * not short of. Read off the feats rather than off the helper, because the helper is private
   * and what a player receives is the feat.
   */
  it('pays the early rungs in what the opening actually runs out of', () => {
    const paid = FEATS.filter(
      (feat) => feat.era === 'early' && feat.reward.resources?.caps !== undefined,
    );
    expect(paid.length, 'no early feat pays caps').toBeGreaterThan(10);
    for (const feat of paid) {
      const resources = feat.reward.resources ?? {};
      const caps = resources.caps ?? 0;
      const rest = RESOURCE_KEYS.filter((key) => key !== 'caps').reduce(
        (total, key) => total + (resources[key] ?? 0),
        0,
      );
      expect(caps, `${feat.id} pays more of everything else than it pays caps`).toBeGreaterThan(
        rest,
      );
    }
    // The small rung carries planks and oil as well, which are what runs out after caps.
    const small = findFeat('runs_1')?.reward.resources ?? {};
    expect(small.planks ?? 0).toBeGreaterThan(0);
    expect(small.oil ?? 0).toBeGreaterThan(0);
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
   * A leader dies once per world, so each one is a standalone with a target of one, and the
   * board's rule that a standalone is never locked means all three are open from the first
   * evening: a crew can go for Directive Xero before it has met the Syndic, if it likes.
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

  it('asks for the Chapel once, held, and never locks it', () => {
    const chapel = FEATS.filter((feat) => feat.measure === 'chapel_held');
    expect(chapel.length).toBe(1);
    expect(chapel[0]?.target).toBe(1);
    expect(chapel[0]?.chain).toBeNull();
    expect(chapel[0]?.after).toBeNull();
  });

  it('ends the held-districts ladder on the whole of the regime’s ground', () => {
    const rungs = FEATS.filter((feat) => feat.measure === 'combine_districts_held');
    expect(rungs.map((feat) => feat.target)).toEqual([1, 3, 6]);
  });
});
