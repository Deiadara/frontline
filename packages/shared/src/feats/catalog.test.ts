import { describe, expect, it } from 'vitest';
import { BUILDING_KINDS } from '../building/index.js';
import { CITY_DISTRICTS } from '../city/districts.js';
import { OFFICER_MARKS } from '../crew/marks.js';
import { ITEM_CATALOG } from '../items/catalog.js';
import { BLACK_MARKET_GOOD_IDS } from '../market/blackmarket.js';
import { MISC_AREA_ID } from '../missions.areas.js';
import { RESOURCE_KEYS } from '../resources.js';
import { findUnit } from '../units/index.js';
import { FEATS, findFeat } from './catalog.js';
import { FEAT_MEASURES, FEAT_MEASURE_SPECS, type FeatMeasure } from './measures.js';
import { FEAT_ERAS, featRewardBand, featRewardValue } from './rewards.js';

/**
 * The catalogue, held to the rules it was authored under.
 *
 * A hundred and sixty one entries cannot be kept honest by review: nobody rereads the whole file
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
    expect(areaFeats.length).toBe(contested.length);
    for (const district of contested) {
      expect(
        areaFeats.some((feat) => feat.scope === district.id),
        district.id,
      ).toBe(true);
    }
  });
});
