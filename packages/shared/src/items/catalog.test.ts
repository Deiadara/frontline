import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG } from './catalog.js';

/**
 * An item's `usedFor` is a promise the shop makes, and six of them stopped being true.
 *
 * The pre-war `blueprint_*` documents gated the old research tree and the old unit unlocks, both of
 * which were replaced. Nothing read them afterwards, and they went on being sold for up to 4,600
 * caps under a sentence naming a track that no longer exists.
 *
 * This is a general guard rather than a list of six ids: any item whose copy says it unlocks
 * something has to have something that reads it. Written this way because the failure was not
 * "somebody edited these six items", it was "a reader was deleted three files away".
 */
describe('an item that promises an unlock has a reader (§D)', () => {
  it('never claims to unlock something while nothing gates on it', () => {
    const source = [
      readFileSync(new URL('../units/unlocks.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../blueprints/requirements.ts', import.meta.url), 'utf8'),
      // A page's promise is kept by the document that lists it, which is the catalogue.
      readFileSync(new URL('../blueprints/catalog.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../building/addons.ts', import.meta.url), 'utf8'),
    ].join('\n');

    for (const spec of Object.values(ITEM_CATALOG)) {
      if (!/\bunlocks?\b/i.test(spec.usedFor)) continue;
      expect(
        source.includes(`'${spec.id}'`),
        `${spec.id} says "${spec.usedFor}" and nothing gates on it`,
      ).toBe(true);
    }
  });
});
