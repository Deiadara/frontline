import { BLACK_MARKET_GOODS, BLACK_MARKET_GOOD_IDS } from '@frontline/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DRAWN_GOOD_IDS, GoodIcon } from './GoodIcon';

const markup = (goodId: string) => renderToStaticMarkup(<GoodIcon goodId={goodId} />);

const pageIds = Object.values(BLACK_MARKET_GOODS)
  .filter((good) => good.kind === 'blueprint_page')
  .map((good) => good.id);

describe('GoodIcon', () => {
  it('draws every good on the shelf that is not a page, and nothing the shelf has dropped', () => {
    expect([...DRAWN_GOOD_IDS].sort()).toEqual([...BLACK_MARKET_GOOD_IDS].sort());
  });

  it('never draws two goods the same, or a good the same as a page', () => {
    const drawings = [...BLACK_MARKET_GOOD_IDS, pageIds[0]!].map(markup);
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  it('gives every page, and an id nobody knows, the one page drawing', () => {
    expect(pageIds.length).toBeGreaterThan(0);
    const page = markup(pageIds[0]!);
    for (const id of pageIds) expect(markup(id)).toBe(page);
    expect(markup('no_such_good')).toBe(page);
    expect(markup('constructor')).toBe(page);
  });

  it('keeps the default size unless the caller sets one', () => {
    expect(markup('combat_stims')).toContain('class="h-5 w-5 shrink-0"');
    expect(renderToStaticMarkup(<GoodIcon goodId="combat_stims" className="h-7 w-7" />)).toContain(
      'class="h-5 w-5 shrink-0 h-7 w-7"',
    );
  });
});
