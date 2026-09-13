import {
  FEAT_MEASURE_SPECS,
  FEATS,
  type FeatEra,
  type FeatProgress,
  type FeatSpec,
  type FeatState,
} from '@frontline/shared';

/**
 * Turning the wire into the thing the screen draws (maintainer request, 2026-09-13).
 *
 * Pure, and in its own module, because the two decisions this makes are the two the feats screen
 * is most likely to get wrong and the only ones worth testing without a DOM: **what to do when
 * the catalogue and the progress disagree**, and **where one ladder stops and the next begins**.
 */

/** One rung: the catalogue entry, where the crew stands on it, and its place in its chain. */
export interface FeatRung {
  spec: FeatSpec;
  progress: FeatProgress;
  /** Which step of the chain this is, 1-based, counted before any filter. 1 when it stands alone. */
  step: number;
}

/**
 * A run of rungs drawn as one card.
 *
 * A chain is a ladder and has to read as one: field a hundred bodies, then five hundred, then two
 * thousand is one idea at three sizes, and drawn as three unrelated rows it is the screen saying
 * the same sentence three times. A feat with no chain is a block of exactly one rung, so the page
 * has one kind of thing in it rather than two.
 */
export interface FeatBlock {
  /** The chain id, or null for a feat that stands alone. */
  chain: string | null;
  /** How many steps the chain has in the catalogue. Unaffected by the filters. */
  steps: number;
  /** Stable across filter changes, so React keeps a card's DOM when the list narrows. */
  key: string;
  rungs: FeatRung[];
}

/**
 * The catalogue joined to the crew's standing, grouped into ladders.
 *
 * ## When the two do not agree
 *
 * The response carries progress only and the catalogue lives in the client, so a deploy can land
 * on one side before the other. Walking `FEATS` rather than the response settles both directions
 * at once: a progress row for a feat this build has never heard of is **dropped**, because there
 * is no name, no blurb and no reward to draw beside it, and a feat with no progress row is drawn
 * **untouched**, because that is what a crew that has not been evaluated against it has done.
 *
 * An untouched step of a chain reads as locked rather than open. The server is the only thing that
 * knows whether the step before it is finished, and guessing "open" would put a CLAIM button in
 * reach of a rung that the claim route is going to refuse.
 *
 * ## Why one pass groups the chains
 *
 * The catalogue guarantees a chain's steps are contiguous and in order (`catalog.test.ts` holds
 * it), so a chain starts wherever the id changes and ends wherever it changes again. No sort, no
 * map of chain to rungs, and the page keeps the order the catalogue was authored in.
 */
export function featBlocks(progress: readonly FeatProgress[]): FeatBlock[] {
  const standing = new Map(progress.map((row) => [row.id, row]));
  const blocks: FeatBlock[] = [];

  for (const spec of FEATS) {
    const rung: FeatRung = {
      spec,
      progress: standing.get(spec.id) ?? untouched(spec),
      step: 1,
    };
    const open = blocks[blocks.length - 1];
    if (spec.chain !== null && open !== undefined && open.chain === spec.chain) {
      rung.step = open.rungs.length + 1;
      open.rungs.push(rung);
      open.steps = open.rungs.length;
      continue;
    }
    blocks.push({ chain: spec.chain, steps: 1, key: spec.chain ?? spec.id, rungs: [rung] });
  }

  return blocks;
}

function untouched(spec: FeatSpec): FeatProgress {
  return {
    id: spec.id,
    state: spec.after === null ? 'open' : 'locked',
    value: 0,
    target: spec.target,
    progress: 0,
  };
}

/** The era filter, plus the everything setting the screen opens on. */
export type EraFilter = FeatEra | 'all';

/**
 * The board's second filter: "a show completed or not completed too".
 *
 * **Completed means achieved, not collected.** A feat that is finished and waiting for the button
 * is completed by any reading a player has: they did the thing. Counting it as not-completed would
 * file the one rung with a CLAIM button on it under the list of work still to do, which is the
 * opposite of useful.
 */
export type DoneFilter = 'all' | 'done' | 'todo';

export interface FeatFilter {
  era: EraFilter;
  done: DoneFilter;
}

export const ALL_FEATS: FeatFilter = { era: 'all', done: 'all' };

/** Whether a state counts as finished. Both filters and the ledger read this one answer. */
export function featIsDone(state: FeatState): boolean {
  return state === 'ready' || state === 'claimed';
}

export function rungMatches(rung: FeatRung, filter: FeatFilter): boolean {
  if (filter.era !== 'all' && rung.spec.era !== filter.era) return false;
  if (filter.done === 'all') return true;
  return featIsDone(rung.progress.state) === (filter.done === 'done');
}

/**
 * The ladders, narrowed to what the filters admit.
 *
 * The rungs are filtered and the block is kept if any survive, rather than the block being kept or
 * dropped whole. Every chain in the catalogue spans at least two eras (all fifty-two of them: a
 * ladder's whole shape is that it starts early and finishes late), so filtering by block would
 * make the era filter do nothing at all.
 *
 * `step` and `steps` are the *unfiltered* numbers, which is what keeps the card honest: the mid
 * rungs of a four-step chain still say III and IV of four rather than renumbering themselves to I
 * and II and pretending the early half does not exist.
 */
export function filterBlocks(blocks: readonly FeatBlock[], filter: FeatFilter): FeatBlock[] {
  const kept: FeatBlock[] = [];
  for (const block of blocks) {
    const rungs = block.rungs.filter((rung) => rungMatches(rung, filter));
    if (rungs.length > 0) kept.push({ ...block, rungs });
  }
  return kept;
}

/** How many rungs a filter would leave. The figure on each filter chip. */
export function countMatching(blocks: readonly FeatBlock[], filter: FeatFilter): number {
  let total = 0;
  for (const block of blocks) {
    for (const rung of block.rungs) if (rungMatches(rung, filter)) total += 1;
  }
  return total;
}

/**
 * What to call a ladder, given any one of its rungs.
 *
 * A chain has no label in the catalogue, and it needs one: the page draws two cards side by side
 * and four in a column, and a card with nothing in its head is a box. The first version used the
 * measure's `unit`, which put the word **Missions** on nine cards in a row, because thirteen
 * different chains all count missions.
 *
 * So it is built from the measure, which is what actually tells two ladders apart, in two shapes:
 *
 *   * **scoped**: the scope and the unit, which is how a player would say it. `missions_in_area`
 *     in `neon-docks` is "Neon Docks missions"; `resources_earned` in `highQualityMetal` is
 *     "High Quality Metal earned"; `building_level` at `nexus` is "Nexus levels".
 *   * **unscoped**: the measure itself with its underscores opened out. "Missions done", "Battles
 *     won", "Officers hired", "Notoriety".
 *
 * Every step of a chain shares a measure and a scope (`catalog.test.ts` holds the measure; a chain
 * asking the same question of two different districts would not be a chain), so any rung answers
 * for the whole ladder.
 */
export function ladderTitle(spec: FeatSpec): string {
  const unit = FEAT_MEASURE_SPECS[spec.measure].unit;
  const phrase =
    spec.scope === undefined ? spec.measure.replace(/_/g, ' ') : `${openOut(spec.scope)} ${unit}`;
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * A scope, as a person would write it.
 *
 * Scopes are written in three hands across the catalogue: hyphenated ids (`neon-docks`), bare
 * words (`nexus`) and camel case borrowed from the resource keys (`highQualityMetal`). One pass
 * opens all three out, so the titles do not advertise which table the author took the id from.
 */
function openOut(scope: string): string {
  return scope
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(' ')
    .map((word) => (word === '' ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join(' ');
}
