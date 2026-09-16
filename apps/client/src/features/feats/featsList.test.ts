import { FEATS, findFeat, type FeatProgress } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import {
  ALL_FEATS,
  countMatching,
  featBlocks,
  filterBlocks,
  ladderTitle,
  rungMatches,
} from './featsList';

/**
 * The join and the grouping (maintainer request, 2026-09-13).
 *
 * These two decisions are the whole of what the feats screen computes, and both of them fail
 * silently: a chain drawn as four unrelated rows still renders, and a progress row for a feat this
 * build has never heard of still renders, as a card with no name on it. Neither is caught by
 * looking at the page unless you already know what you are looking for.
 */

const BOARD = F.featsBoard.progress;
const blockFor = (chain: string) => featBlocks(BOARD).find((block) => block.chain === chain);

/** The fixture's one four-rung ladder, which is the one carrying all four states. */
const RUNS = ['runs_1', 'runs_2', 'runs_3', 'runs_4'] as const;

describe('the ladders', () => {
  it('groups the consecutive steps of a chain into one block, in catalogue order', () => {
    const runs = blockFor('runs');
    expect(runs).toBeDefined();
    expect(runs?.rungs.map((rung) => rung.spec.id)).toEqual([...RUNS]);
    expect(runs?.steps).toBe(4);
    expect(runs?.rungs.map((rung) => rung.step)).toEqual([1, 2, 3, 4]);
  });

  /**
   * Taken off the catalogue rather than named.
   *
   * This used to hard-code `area_neon_docks`, which was a standalone feat until the district work
   * grew a second rung and then silently became a test about a ladder. The property under test is
   * "a feat with no chain gets a block to itself", and that is true of whichever one happens to be
   * first, so the fixture asks the catalogue instead of remembering an answer.
   */
  it('gives a feat that stands alone a block of its own', () => {
    const solo = FEATS.find((feat) => feat.chain === null);
    expect(solo, 'the catalogue must still hold at least one standalone feat').toBeDefined();

    const blocks = featBlocks(BOARD);
    const alone = blocks.find((block) => block.key === solo!.id);
    expect(alone?.chain).toBeNull();
    expect(alone?.steps).toBe(1);
    expect(alone?.rungs).toHaveLength(1);
  });

  it('draws every feat in the catalogue exactly once, across all the blocks', () => {
    const drawn = featBlocks(BOARD).flatMap((block) => block.rungs.map((rung) => rung.spec.id));
    expect(drawn).toHaveLength(FEATS.length);
    expect(new Set(drawn).size).toBe(FEATS.length);
  });

  it('drops a progress row the catalogue has no feat for', () => {
    const stranger: FeatProgress = {
      id: 'a-feat-from-a-later-deploy',
      state: 'ready',
      value: 3,
      target: 3,
      progress: 1,
    };
    const drawn = featBlocks([...BOARD, stranger]).flatMap((block) => block.rungs);
    expect(drawn).toHaveLength(FEATS.length);
    expect(drawn.some((rung) => rung.spec.id === stranger.id)).toBe(false);
  });

  it('draws a feat with no progress row as untouched, and a chained one as shut', () => {
    const none = featBlocks([]);
    const alone = none.flatMap((block) => block.rungs).find((rung) => rung.spec.chain === null);
    expect(alone?.progress.state).toBe('open');
    expect(alone?.progress.value).toBe(0);

    const second = none.flatMap((block) => block.rungs).find((rung) => rung.spec.after !== null);
    // Not `open`: only the server knows whether the step before it is finished, and guessing open
    // would put a CLAIM button in reach of a rung the claim route is going to refuse.
    expect(second?.progress.state).toBe('locked');
  });
});

describe('a shut rung', () => {
  it('carries no figure of its own, because the server sends it none', () => {
    const last = blockFor('runs')?.rungs.at(-1);
    expect(last?.progress.state).toBe('locked');
    expect(last?.progress.value).toBe(0);
    expect(last?.progress.progress).toBe(0);
    // The target on the row is the catalogue's, which the page must not draw for a shut rung.
    expect(last?.progress.target).toBe(findFeat('runs_4')?.target);
  });
});

describe('the two filters', () => {
  const blocks = featBlocks(BOARD);

  it('narrows a ladder to the rungs of one era, keeping their real step numbers', () => {
    const [mid] = filterBlocks(blocks, { era: 'mid', done: 'all' }).filter(
      (block) => block.chain === 'runs',
    );
    expect(mid?.rungs.map((rung) => rung.spec.id)).toEqual(['runs_3']);
    // Still step three of four, not renumbered to one of one: every chain in the catalogue spans
    // eras, so a filtered ladder that renumbered itself would lie about where a rung sits.
    expect(mid?.rungs[0]?.step).toBe(3);
    expect(mid?.steps).toBe(4);
  });

  it('counts a finished feat as completed whether or not it has been collected', () => {
    const done = filterBlocks(blocks, { era: 'all', done: 'done' })
      .flatMap((block) => block.rungs)
      .map((rung) => rung.progress.state);
    expect(new Set(done)).toEqual(new Set(['ready', 'claimed']));

    const todo = filterBlocks(blocks, { era: 'all', done: 'todo' })
      .flatMap((block) => block.rungs)
      .map((rung) => rung.progress.state);
    expect(new Set(todo)).toEqual(new Set(['open', 'locked']));
  });

  it('combines: the two together leave only the rungs that answer to both', () => {
    const both = filterBlocks(blocks, { era: 'early', done: 'todo' }).flatMap(
      (block) => block.rungs,
    );
    expect(both.length).toBeGreaterThan(0);
    for (const rung of both) {
      expect(rung.spec.era).toBe('early');
      expect(['open', 'locked']).toContain(rung.progress.state);
    }
    /*
     * And each filter is really being applied, rather than one of them quietly winning.
     *
     * Both bounds are needed and neither on its own would do: an implementation that ignored the
     * era would land on the second figure and one that ignored the state would land on the first,
     * and a test checking only one of them would pass for half the bugs it exists to catch.
     */
    expect(both.length).toBeLessThan(countMatching(blocks, { era: 'early', done: 'all' }));
    expect(both.length).toBeLessThan(countMatching(blocks, { era: 'all', done: 'todo' }));
  });

  it('keeps a finished early rung under early and completed, and nowhere else', () => {
    const both = filterBlocks(blocks, { era: 'early', done: 'done' }).flatMap(
      (block) => block.rungs,
    );
    expect(both.map((rung) => rung.spec.id)).toContain('runs_2');
    for (const rung of both) {
      expect(rung.spec.era).toBe('early');
      expect(['ready', 'claimed']).toContain(rung.progress.state);
    }
    const elsewhere = filterBlocks(blocks, { era: 'mid', done: 'done' }).flatMap(
      (block) => block.rungs,
    );
    expect(elsewhere.map((rung) => rung.spec.id)).not.toContain('runs_2');
  });

  it('drops a block whose every rung the filter refused, and keeps the rest', () => {
    const kept = filterBlocks(blocks, { era: 'late', done: 'done' });
    expect(kept.every((block) => block.rungs.length > 0)).toBe(true);
    expect(kept.length).toBeLessThan(blocks.length);
  });

  it('leaves everything alone when nothing is set', () => {
    expect(countMatching(blocks, ALL_FEATS)).toBe(FEATS.length);
    expect(filterBlocks(blocks, ALL_FEATS)).toHaveLength(blocks.length);
  });

  it('agrees with the per-rung answer the chips are counted from', () => {
    const probe = { era: 'mid', done: 'todo' } as const;
    const byRung = blocks
      .flatMap((block) => block.rungs)
      .filter((rung) => rungMatches(rung, probe)).length;
    expect(countMatching(blocks, probe)).toBe(byRung);
  });
});

describe("a ladder's name", () => {
  const titleOf = (id: string) => {
    const spec = findFeat(id);
    expect(spec, `${id} is not in the catalogue`).toBeDefined();
    return ladderTitle(spec!);
  };

  it('names an unscoped ladder after its measure', () => {
    expect(titleOf('runs_1')).toBe('Missions done');
    expect(titleOf('clean_1')).toBe('Missions won');
    expect(titleOf('fights_1')).toBe('Battles fought');
  });

  /**
   * One measure id still says "bodies" (a persisted tally key, so it keeps its spelling), and the
   * board must not: the game stopped using the word (maintainer, 2026-09-15). The title takes the
   * measure's own unit instead, which for this one is a head count and so reads "units".
   */
  it('says units where the measure id still says bodies', () => {
    expect(titleOf('roster_1')).toBe('Army units');
    expect(titleOf('deployed_1')).toBe('Units deployed');
  });

  /** ...and the ladder that really is counting slots says so, off the same one field. */
  it('says unit slots for the measures that count them', () => {
    expect(titleOf('beds_1')).toBe('Army unit slots');
    expect(titleOf('muster_1')).toBe('Unit slots deployed');
  });

  it('names a scoped one after the scope, opened out of whatever hand wrote it', () => {
    expect(titleOf('area_neon_docks')).toBe('Neon Docks missions');
    expect(titleOf('nexus_1')).toBe('Nexus levels');
    expect(titleOf('metal_1')).toBe('High Quality Metal earned');
  });

  /**
   * The failure this exists for: the first version titled a card with the measure's `unit`, and
   * thirteen different chains count "missions". Four cards in a row wore the same word.
   */
  it('tells the thirteen ladders that all count missions apart', () => {
    const missions = featBlocks(BOARD).filter(
      (block) => block.rungs[0] !== undefined && block.rungs[0].spec.measure.startsWith('missions'),
    );
    expect(missions.length).toBeGreaterThan(5);
    const names = missions.map((block) => ladderTitle(block.rungs[0]!.spec));
    expect(new Set(names).size).toBe(names.length);
  });
});
