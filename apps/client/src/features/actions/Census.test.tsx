import { COMBINE_UNITS, PLAYER_UNITS } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { Census } from './Census';

/**
 * The Combine's own sheets never appear on the census (2026-09-19).
 *
 * The page walks the catalogue rather than the roster, so a Syndic with a count against him
 * would have been drawn like any Razor. The count is the realistic case, not a contrivance: the
 * roster is a bag of ids, and the one place a Combine id could land in a player's bag is a bug in
 * the engine's settle, which is exactly the moment the census must not launder it into a row.
 */
const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function drawCensus(roster: unknown) {
  fetchMock.mockImplementation((path: string) => {
    const url = String(path);
    if (url.endsWith('/units')) return reply(roster);
    if (url.endsWith('/actions')) return reply(F.actionsResponse);
    if (url.endsWith('/missions')) return reply(F.missionsResponse());
    throw new Error(`unstubbed request: ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/game/actions/census']}>
        <Census />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.findByTestId('census');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the census and the Combine', () => {
  it('is a precondition that the catalogue has Combine sheets to hide', () => {
    expect(COMBINE_UNITS.length).toBeGreaterThan(0);
    expect(PLAYER_UNITS.some((unit) => COMBINE_UNITS.includes(unit))).toBe(false);
  });

  it('draws no row for a Combine unit, even with a count against it', async () => {
    const combine = Object.fromEntries(COMBINE_UNITS.map((unit) => [unit.id, 3]));
    const page = await drawCensus({
      ...F.unitsResponse,
      army: { ...F.unitsResponse.army, ...combine },
      garrisoned: { ...F.unitsResponse.garrisoned, ...combine },
    });
    // The player's own rows are still there, so the absence below is not an empty page.
    expect(page).toHaveTextContent('Razors');
    for (const unit of COMBINE_UNITS) {
      expect(screen.queryByText(unit.name)).toBeNull();
    }
  });
});

/**
 * The page is a list, and a list is made of list items (maintainer, 2026-09-20).
 *
 * The whole row became a trigger when the card was unified, and a `HoverCard` *is* a `<button>`:
 * wrapping the item put a `<button>` straight into the `<ul>` with an `<li>` inside it. Both are
 * invalid, and the cost is not theoretical, because the list semantics are what carry the count:
 * a `<ul>` whose children are buttons has no items in it at all, so the one page in the game whose
 * job is counting announced nothing to count.
 *
 * Structure rather than appearance, which is the only thing a unit test can say here: the geometry
 * is unchanged either way, which is exactly why nothing else would have caught it.
 */
describe('the shape of the census list', () => {
  it('puts the trigger inside the item rather than the item inside the trigger', async () => {
    const page = await drawCensus(F.unitsResponse);

    const lists = [...page.querySelectorAll('ul')].filter((list) => list.children.length > 0);
    expect(lists.length, 'no rows were drawn, so this proves nothing').toBeGreaterThan(0);
    for (const list of lists) {
      for (const child of list.children) {
        expect(child.tagName, `a ${child.tagName} is standing in a list`).toBe('LI');
      }
    }

    // And the mirror: a row does open, so the item is not a plain one with the trigger dropped.
    const rows = [...page.querySelectorAll('li')];
    expect(rows.some((row) => row.querySelector('button') !== null)).toBe(true);
    expect(
      [...page.querySelectorAll('button')].filter(
        (one) => one.querySelector('li, button') !== null,
      ),
      'a control is standing inside another one',
    ).toEqual([]);
  });
});
