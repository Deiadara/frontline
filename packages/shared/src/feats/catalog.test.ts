import { describe, expect, it } from 'vitest';
import {
  BUILDING_KINDS,
  BUILDING_MAX_LEVEL,
  MAX_MODIFICATION_SLOTS,
  modificationsFittingIn,
  storageCapacityFor,
} from '../building/index.js';
import { BUILDING_PART_GATES } from '../building/parts.js';
import { UNIT_MODIFICATIONS } from '../units/modifications.js';
import { CITY_DISTRICTS } from '../city/districts.js';
import { OFFICER_MARKS } from '../crew/marks.js';
import { ITEM_CATALOG } from '../items/catalog.js';
import { BLACK_MARKET_GOOD_IDS } from '../market/blackmarket.js';
import { MISC_AREA_ID } from '../missions.areas.js';
import { RESOURCE_KEYS, type ResourceKey } from '../resources.js';
import { findUnit } from '../units/index.js';
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

  /** A guard on the guard: a demand table that came out empty would make the above vacuous. */
  it('knows what the district and the unit bench actually ask for', () => {
    expect(Object.keys(LIFETIME_PART_DEMAND).length).toBeGreaterThan(5);
    expect(LIFETIME_PART_DEMAND['rotor_hub']).toBe(1);
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
        case 'building_level':
          expect(BUILDING_KINDS, feat.id).toContain(scope);
          break;
        case 'resources_held':
        case 'resources_earned':
          expect(RESOURCE_KEYS, feat.id).toContain(scope);
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
    // Two rungs each, ten jobs then fifty, and both generated from the same city row. Pinned as a
    // multiple rather than as a total so that adding a contested district to the map cannot
    // silently leave it without work: the arithmetic moves with `CITY_DISTRICTS`.
    expect(areaFeats.length).toBe(contested.length * 2);
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
      expect(rungs.length, district.id).toBe(2);
      // A real ladder, not two feats that happen to share a scope: the second is locked behind
      // the first and asks for more.
      expect(rungs[0]?.after, district.id).toBeNull();
      expect(rungs[1]?.after, district.id).toBe(rungs[0]?.id);
      expect(rungs[1]?.target, district.id).toBeGreaterThan(rungs[0]?.target ?? 0);
      expect(rungs[0]?.chain, district.id).toBe(rungs[1]?.chain);
    }
  });
});
