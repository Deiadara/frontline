/**
 * Every tally measure has a writer, and every writer names a real measure.
 *
 * `FEAT_TALLY_MEASURES` in `packages/shared/src/feats/measures.ts` says in as many words that
 * "`feats.tallies.test.ts` pins both directions". **That file has never existed**, and the constant
 * it describes has no consumer anywhere in the tree, so the gate the comment promises was not
 * guarding anything: a measure could be authored with no writer and a feat built on it would simply
 * sit at zero for ever, on the one screen that tells a player what there is to do. That is the exact
 * failure CLAUDE.md's "Feats move with the game" section is written about, and it was one comment
 * away from looking covered.
 *
 * Nine tally measures were added in a single change on 2026-09-18. They are wired, and the only
 * reason anybody knows that is that somebody tested each one by hand. This is the test that says so
 * for the tenth.
 *
 * ## Why it reads the source
 *
 * A tally reaches the database as `by('<measure>', n)` inside `feats/tally.ts`, which builds the
 * snapshot key from the measure name. There is no registry to compare against, and a runtime check
 * would only cover the paths a test happens to drive. Reading the one file every write goes through
 * is the honest version: it answers "is there a line of code that could ever write this" rather
 * than "did today's tests happen to reach it".
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEAT_MEASURES, FEAT_MEASURE_SPECS, FEAT_TALLY_MEASURES } from '@frontline/shared';
import { describe, expect, it } from 'vitest';

/**
 * Where a counter can be written from.
 *
 * Two places, and the second is the reason this is a list rather than one path: most bumps are
 * built in the server's `tally.ts`, but the four "what did that fight look like" measures are
 * decided in shared, by `feats/battle.ts`, so that the blurb promising "a line twice your own" and
 * the code that decides it cannot drift apart.
 *
 * `measures.ts` and `catalog.ts` are deliberately **not** here. The first declares the vocabulary
 * and the second names every measure once per feat, so including either would make this test pass
 * for every measure in the game whether or not anything ever wrote one.
 */
const WRITERS = [
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'tally.ts'),
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/shared/src/feats/battle.ts',
  ),
];

/** Source with its comments removed, so a measure named in prose does not count as written. */
const bare = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

/**
 * Every measure named as a string literal by a writer.
 *
 * Read as literals rather than as `one('x')` call shapes on purpose: two earlier drafts of this
 * matched the call and both were wrong, first missing everything written through `one(` and then
 * missing the eight written through a ternary *inside* the call, like
 * `one(outcome === 'forced' ? 'districts_raided' : 'raids_repelled')`. Matching the name is robust
 * to however the next one is written, and stripping comments first is what keeps it honest.
 */
const written = new Set(
  WRITERS.flatMap((file) => [...bare(file).matchAll(/'([a-z_]+)'/g)].map((hit) => hit[1]!)).filter(
    (name): name is (typeof FEAT_MEASURES)[number] =>
      (FEAT_MEASURES as readonly string[]).includes(name),
  ),
);

describe('the tally vocabulary and the counters that write it', () => {
  it('is not vacuous: the source really does name measures this way', () => {
    // If the bump builders are ever refactored away, both directions below pass trivially and
    // prove nothing. This is the control that fails loudly instead.
    expect(written.size, 'no measures are named by any writer').toBeGreaterThan(20);
    for (const measure of written) {
      expect(FEAT_MEASURES, `${measure} is written but is not a measure`).toContain(measure);
    }
  });

  it('gives every tally measure somewhere that writes it', () => {
    const orphans = FEAT_TALLY_MEASURES.filter((measure) => !written.has(measure));
    expect(
      orphans,
      `these measures have no writer, so a feat built on one sits at zero for ever: ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('writes nothing under a name no measure reads', () => {
    // `written` is already narrowed to real measures by the filter above it, so this indexes
    // directly: casting to `never` to silence the index made the lookup's type `never` too.
    const strays = [...written].filter((measure) => FEAT_MEASURE_SPECS[measure].source !== 'tally');
    expect(
      strays,
      `these counters are written but nothing will ever ask for them: ${strays.join(', ')}`,
    ).toEqual([]);
  });
});
