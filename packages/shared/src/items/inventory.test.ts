/**
 * The inventory diff that the page bell is built on.
 *
 * `pagesGained` is the whole of "did a document move a square closer?", and every one of the six
 * paths that hand a page over leans on it. What it has to get right is narrow and easy to get
 * wrong in a way nothing else would notice: only pages, only upward, and a second copy of a page
 * already held is still a page arriving.
 */
import { describe, expect, it } from 'vitest';
import { BLUEPRINTS } from '../blueprints/catalog.js';
import { ITEM_CATALOG, type ItemId } from './catalog.js';
import { pagesGained } from './inventory.js';

const FIRST = BLUEPRINTS[0];
const PAGE = FIRST.pages[0].id;
const OTHER_PAGE = (BLUEPRINTS.find((spec) => spec.id !== FIRST.id) ?? FIRST).pages[0].id;
const COMPONENT: ItemId = 'scrap_servo';

describe('pagesGained', () => {
  it('the fixture is what it says it is', () => {
    expect(ITEM_CATALOG[PAGE].kind).toBe('page');
    expect(ITEM_CATALOG[OTHER_PAGE].kind).toBe('page');
    expect(PAGE).not.toBe(OTHER_PAGE);
    expect(ITEM_CATALOG[COMPONENT].kind).not.toBe('page');
  });

  it('names a page that arrived', () => {
    expect(pagesGained({}, { [PAGE]: 1 })).toEqual({ [PAGE]: 1 });
  });

  it('says nothing about a page that was already there', () => {
    expect(pagesGained({ [PAGE]: 2 }, { [PAGE]: 2, [COMPONENT]: 1 })).toEqual({});
  });

  it('says nothing about a component, however many of them turned up', () => {
    expect(pagesGained({}, { [COMPONENT]: 9 })).toEqual({});
  });

  it('counts a second copy of a page already held', () => {
    expect(pagesGained({ [PAGE]: 1 }, { [PAGE]: 3 })).toEqual({ [PAGE]: 2 });
  });

  it('counts two different pages arriving at once', () => {
    expect(pagesGained({}, { [PAGE]: 1, [OTHER_PAGE]: 1, [COMPONENT]: 4 })).toEqual({
      [PAGE]: 1,
      [OTHER_PAGE]: 1,
    });
  });

  it('says nothing about a page that was spent', () => {
    // Reimagining takes three and gives one back. The three that went in are not news, and a diff
    // that reported them would ring a bell for every page a player traded away.
    expect(pagesGained({ [PAGE]: 3 }, { [PAGE]: 1, [OTHER_PAGE]: 1 })).toEqual({
      [OTHER_PAGE]: 1,
    });
  });
});
