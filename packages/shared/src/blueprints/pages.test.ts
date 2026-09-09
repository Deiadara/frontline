import { describe, expect, it } from 'vitest';
import { ITEM_CATALOG, type ItemId } from '../items/catalog.js';
import { ITEM_RARITIES, RARITY_ORDER, type ItemRarity } from '../items/rarity.js';
import { BLUEPRINTS, pageRarity, type BlueprintPage, type BlueprintSpec } from './catalog.js';

/**
 * What a page is, beyond an id in a satchel.
 *
 * A page used to be a name and a count. It carries a written description and a rarity of its own
 * now, both of which are read by the shop, the satchel and the Blueprints screen, and all three of
 * those failures are silent: a missing description prints an empty hover, a rarity that disagrees
 * with the document paints the row the wrong colour. So the checks here are over the whole
 * catalogue rather than over a sample, because the failure mode is one entry out of a hundred and
 * sixty rather than a broken rule.
 */

/**
 * Widened off the const-asserted catalogue on purpose.
 *
 * `BLUEPRINTS` is `as const`, so a page authored without a rarity has no `rarity` property at all
 * in its literal type and `page.rarity` does not compile. The rule under test is the interface's,
 * not the literal's.
 */
const ALL_PAGES: readonly { blueprint: BlueprintSpec; page: BlueprintPage }[] = BLUEPRINTS.flatMap(
  (blueprint) => blueprint.pages.map((page) => ({ blueprint, page })),
);

function tally(rarities: readonly ItemRarity[]): Record<ItemRarity, number> {
  const counts = Object.fromEntries(ITEM_RARITIES.map((rarity) => [rarity, 0])) as Record<
    ItemRarity,
    number
  >;
  for (const rarity of rarities) counts[rarity] += 1;
  return counts;
}

describe('every page says what is on it', () => {
  it('gives all one hundred and sixty a description', () => {
    for (const { blueprint, page } of ALL_PAGES) {
      expect(
        page.description.length,
        `${page.id} of ${blueprint.id} has no description`,
      ).toBeGreaterThan(20);
      expect(page.description.trim(), `${page.id} is padded`).toBe(page.description);
    }
    expect(ALL_PAGES.length).toBe(160);
  });

  /**
   * The point of a description: two sheets of one document are two different objects.
   *
   * Checked across the whole catalogue rather than per document, because a line copied from the
   * Sniper Blueprint onto a Colossus page is the same bug and reads worse.
   */
  it('never writes the same line on two pages', () => {
    const seen = new Map<string, string>();
    for (const { page } of ALL_PAGES) {
      const first = seen.get(page.description);
      expect(first, `${page.id} repeats the description on ${first ?? ''}`).toBeUndefined();
      seen.set(page.description, page.id);
    }
  });

  it('never writes the same name on two pages', () => {
    const names = ALL_PAGES.map(({ blueprint, page }) => `${blueprint.id}:${page.name}`);
    expect(new Set(names).size).toBe(names.length);
  });

  /** The hover prints it as a sentence, so it has to be one. */
  it('writes each one as a finished sentence', () => {
    for (const { page } of ALL_PAGES) {
      expect(page.description, `${page.id} does not end in a full stop`).toMatch(/[.]$/);
      expect(page.description[0], `${page.id} does not start with a capital`).toBe(
        page.description[0]?.toUpperCase(),
      );
    }
  });
});

describe('rarity is authored, not derived (§D3)', () => {
  it('gives every document one', () => {
    for (const blueprint of BLUEPRINTS) {
      expect(ITEM_RARITIES, `${blueprint.id} has no rarity`).toContain(blueprint.rarity);
    }
  });

  it('hands a page its document rarity unless the page says otherwise', () => {
    for (const { blueprint, page } of ALL_PAGES) {
      expect(pageRarity(blueprint, page)).toBe(page.rarity ?? blueprint.rarity);
    }
  });

  /**
   * One step, and the load-time guard in the catalogue enforces it. Repeated here because the
   * guard throws on import, which makes it invisible in a report: this names the rule.
   */
  it('never puts a page more than one tier from its document', () => {
    for (const { blueprint, page } of ALL_PAGES) {
      const step = Math.abs(
        RARITY_ORDER[pageRarity(blueprint, page)] - RARITY_ORDER[blueprint.rarity],
      );
      expect(step, `${page.id} is ${step} tiers from ${blueprint.id}`).toBeLessThanOrEqual(1);
    }
  });

  it('fills all four tiers, for documents and for pages (§D11)', () => {
    const documents = tally(BLUEPRINTS.map((blueprint) => blueprint.rarity));
    const pages = tally(ALL_PAGES.map(({ blueprint, page }) => pageRarity(blueprint, page)));
    for (const rarity of ITEM_RARITIES) {
      expect(documents[rarity], `no ${rarity} document`).toBeGreaterThan(0);
      expect(pages[rarity], `no ${rarity} page`).toBeGreaterThan(0);
    }
  });

  /**
   * Exotic is the rarest, which is what the word has to mean for the colour to be worth anything.
   *
   * Counted over documents and pages together, because that is the pool a player draws from: what
   * makes brass mean something is how rarely one turns up, not how many entries the catalogue has.
   */
  it('makes exotic the scarcest tier of the lot', () => {
    const counts = tally([
      ...BLUEPRINTS.map((blueprint) => blueprint.rarity),
      ...ALL_PAGES.map(({ blueprint, page }) => pageRarity(blueprint, page)),
    ]);
    for (const rarity of ITEM_RARITIES) {
      if (rarity === 'exotic') continue;
      expect(counts.exotic, `exotic is not scarcer than ${rarity}`).toBeLessThan(counts[rarity]);
    }
  });
});

describe('the item catalogue carries the authored copy through (§F)', () => {
  it('prices and colours a page off its own entry rather than a single value', () => {
    for (const { blueprint, page } of ALL_PAGES) {
      // `ALL_PAGES` widened the id to a string; every one of them really is an item and
      // `blueprints.test.ts` is what checks that.
      const spec = ITEM_CATALOG[page.id as ItemId];
      // Written out rather than run through `pageRarity`, on purpose. Reading the rule from the
      // same function the catalogue reads it from would pass whatever that function returned.
      expect(spec.rarity).toBe(page.rarity ?? blueprint.rarity);
      expect(spec.description).toBe(page.description);
    }
    // The failure this guards is a catalogue that gives every page one rarity, which reads as a
    // working feature until somebody counts.
    const rarities = new Set(ALL_PAGES.map(({ page }) => ITEM_CATALOG[page.id as ItemId].rarity));
    expect(rarities.size).toBe(ITEM_RARITIES.length);
  });

  it('gives a document the rarity it was authored with', () => {
    for (const blueprint of BLUEPRINTS) {
      expect(ITEM_CATALOG[blueprint.id].rarity).toBe(blueprint.rarity);
    }
  });
});
