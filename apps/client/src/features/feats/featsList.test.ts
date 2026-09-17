import { FEATS, findFeat, type FeatProgress } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import {
  ALL_FEATS,
  countMatching,
  featBlocks,
  filterBlocks,
  ladderState,
  ladderTitle,
  type FeatBlock,
  type FeatFilter,
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

/** The fixture's ladder carrying all four states, and one of the eight that run to tier X. */
const RUNS = [
  'runs_1',
  'runs_2',
  'runs_3',
  'runs_4',
  'runs_5',
  'runs_6',
  'runs_7',
  'runs_8',
  'runs_9',
  'runs_10',
] as const;

describe('the ladders', () => {
  it('groups the consecutive steps of a chain into one block, in catalogue order', () => {
    const runs = blockFor('runs');
    expect(runs).toBeDefined();
    expect(runs?.rungs.map((rung) => rung.spec.id)).toEqual([...RUNS]);
    expect(runs?.steps).toBe(RUNS.length);
    expect(runs?.rungs.map((rung) => rung.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
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
    expect(last?.progress.target).toBe(findFeat('runs_10')?.target);
  });
});

describe('the one filter, over whole ladders', () => {
  const blocks = featBlocks(BOARD);
  const keysUnder = (filter: FeatFilter) => filterBlocks(blocks, filter).map((block) => block.key);

  /**
   * The states a ladder can be in, and the rule that decides them.
   *
   * `runs` is the fixture's mixed ladder: one rung collected, one waiting, the rest in hand. It is
   * `unclaimed`, because a rung waiting for the button is the only thing on this page asking a
   * player to do something and it outranks everything else about the chain.
   */
  it('calls a ladder with a rung waiting unclaimed, whatever else is true of it', () => {
    const runs = blocks.find((block) => block.chain === 'runs');
    expect(runs?.ready, 'the fixture ladder has nothing waiting').toBeGreaterThan(0);
    expect(runs?.claimed, 'and nothing collected either').toBeGreaterThan(0);
    expect(ladderState(runs!)).toBe('unclaimed');
  });

  it('calls a ladder with nothing waiting and nothing finished shut', () => {
    const shut = blocks.find((block) => block.ready === 0 && block.claimed < block.steps);
    expect(shut, 'the fixture has no ladder still in hand').toBeDefined();
    expect(ladderState(shut!)).toBe('shut');
  });

  it('calls a ladder claimed only when every rung of it is collected', () => {
    const whole: FeatBlock = {
      chain: 'x',
      steps: 3,
      claimed: 3,
      ready: 0,
      key: 'x',
      rungs: [],
    };
    expect(ladderState(whole)).toBe('claimed');
    // One short is not finished, however many of the others are in.
    expect(ladderState({ ...whole, claimed: 2 })).toBe('shut');
  });

  it('lists every ladder under All, and splits them across the other three', () => {
    const all = keysUnder('all');
    expect(all.length).toBe(blocks.length);
    const parts = (['claimed', 'unclaimed', 'shut'] as const).map((filter) => keysUnder(filter));
    // Every ladder in exactly one of the three, which is what makes the chips' counts add up.
    expect(parts.flat().length).toBe(all.length);
    expect(new Set(parts.flat()).size).toBe(all.length);
    for (const part of parts) expect(part.length).toBeGreaterThan(0);
  });

  it('keeps a ladder whole rather than narrowing it to the rungs that matched', () => {
    const runs = filterBlocks(blocks, 'unclaimed').find((block) => block.chain === 'runs');
    // Ten rungs, not the one that is waiting: the pane opens the whole ladder.
    expect(runs?.rungs).toHaveLength(runs?.steps ?? 0);
    expect(runs?.steps).toBe(RUNS.length);
  });

  it('counts ladders rather than rungs, so the chips agree with the list', () => {
    for (const filter of ['all', 'claimed', 'unclaimed', 'shut'] as const) {
      expect(countMatching(blocks, filter), filter).toBe(filterBlocks(blocks, filter).length);
    }
    // ...and the figure is a count of ladders, which is far short of the rungs in them.
    expect(countMatching(blocks, 'all')).toBeLessThan(FEATS.length);
  });

  it('opens on everything', () => {
    expect(ALL_FEATS).toBe('all');
    expect(filterBlocks(blocks, ALL_FEATS)).toHaveLength(blocks.length);
  });
});

/**
 * What a card knows about a ladder it is drawing.
 *
 * The sidebar row and the card header both read `claimed` and `steps` off the block rather than
 * counting the rungs on screen, which is what lets a row say `1/10` in a list of seventy.
 */
describe('what a ladder carries about itself', () => {
  it('counts its collected and waiting rungs off the whole chain', () => {
    const blocks = featBlocks(BOARD);
    const runs = blocks.find((block) => block.chain === 'runs');
    expect(runs?.steps).toBe(10);
    expect(runs?.claimed).toBe(1);
    expect(runs?.ready).toBe(1);
    // And the counts are of the ladder, not of the catalogue: they never exceed its own length.
    for (const block of blocks) {
      expect(block.claimed + block.ready, block.key).toBeLessThanOrEqual(block.steps);
    }
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
