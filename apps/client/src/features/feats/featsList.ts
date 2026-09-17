import { FEAT_MEASURE_SPECS, FEATS, type FeatProgress, type FeatSpec } from '@frontline/shared';

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
 * A chain is a ladder and has to read as one: field a hundred units, then five hundred, then two
 * thousand is one idea at three sizes, and drawn as three unrelated rows it is the screen saying
 * the same sentence three times. A feat with no chain is a block of exactly one rung, so the page
 * has one kind of thing in it rather than two.
 */
export interface FeatBlock {
  /** The chain id, or null for a feat that stands alone. */
  chain: string | null;
  /** How many steps the chain has in the catalogue. Unaffected by the filters. */
  steps: number;
  /**
   * How many of those steps have been collected. Unaffected by the filters, which is the point:
   * the card's header says `3/10` while drawing one rung, because the other nine are the ladder
   * and the player is entitled to know the shape of it.
   */
  claimed: number;
  /** How many rungs are finished and waiting for the button. The count the sidebar lights up on. */
  ready: number;
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
    blocks.push({
      chain: spec.chain,
      steps: 1,
      claimed: 0,
      ready: 0,
      key: spec.chain ?? spec.id,
      rungs: [rung],
    });
  }

  for (const block of blocks) {
    block.claimed = block.rungs.filter((rung) => rung.progress.state === 'claimed').length;
    block.ready = block.rungs.filter((rung) => rung.progress.state === 'ready').length;
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

/**
 * Where a whole ladder stands, which is the only question the board asks now.
 *
 * The filters used to be two axes over *rungs*: which era, and how much of a chain to draw. The era
 * is gone (maintainer, 2026-09-17), and so is the fold, because the board is no longer a wall of
 * cards: it is a list of ladders on the left and one open ladder on the right, so a ladder is the
 * thing a player is choosing between and a ladder is what the filters count.
 *
 *   * **claimed**: every rung of it done and collected. Finished work, kept rather than hidden.
 *   * **unclaimed**: at least one rung finished and waiting for the button. The only setting that
 *     is asking a player to do something, which is why the sidebar lights these in brass.
 *   * **shut**: neither. Work in hand, or not started.
 */
export type LadderState = 'claimed' | 'unclaimed' | 'shut';

export function ladderState(block: FeatBlock): LadderState {
  if (block.ready > 0) return 'unclaimed';
  return block.claimed === block.steps ? 'claimed' : 'shut';
}

/** The board's one filter. `all` is where it opens. */
export type FeatFilter = 'all' | LadderState;

export const ALL_FEATS: FeatFilter = 'all';

export function blockMatches(block: FeatBlock, filter: FeatFilter): boolean {
  return filter === 'all' || ladderState(block) === filter;
}

/**
 * The ladders a filter admits, whole.
 *
 * Whole, where the old pass narrowed each block's rungs and kept the block if any survived. That
 * was right when the page drew every card at once and a filter had to reach inside them; it is
 * wrong now, because a ladder is opened one at a time and a player who picks one wants all of it.
 */
export function filterBlocks(blocks: readonly FeatBlock[], filter: FeatFilter): FeatBlock[] {
  return blocks.filter((block) => blockMatches(block, filter));
}

/** How many ladders a filter would leave. The figure on each filter chip. */
export function countMatching(blocks: readonly FeatBlock[], filter: FeatFilter): number {
  return blocks.reduce((total, block) => total + (blockMatches(block, filter) ? 1 : 0), 0);
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
  /*
   * An unscoped title is the measure id opened out, and two of those ids (`bodies_deployed` and
   * `supply_deployed`) still carry words the game stopped using for a count of units (maintainer,
   * 2026-09-15). Both are persisted tally keys, so the spellings stay; the title swaps the word
   * for the measure's own unit, which is "units" for the head count and "unit slots" for the one
   * that counts what they take up.
   */
  const phrase =
    spec.scope === undefined
      ? spec.measure.replace(/_/g, ' ').replace(/\b(bodies|supply)\b/, unit)
      : `${openOut(spec.scope)} ${unit}`;
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
