import {
  RESOURCE_KEYS,
  supplyBoard,
  STORAGE_SHARES,
  findBlueprint,
  type Inventory,
  type MarketResponse,
  type Resources,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintsPage } from './BlueprintsPage';
import { BLUEPRINT_UNLOCK_MESSAGES } from '@frontline/shared';
import { useSession } from '../../store/session';

/**
 * The Blueprints page, and the one thing it must never do.
 *
 * §D5: a document a crew holds no pages of is not on this screen. Every other assertion here is
 * about a state a player can reach by finding pages, but that one is about what they must *not*
 * be able to learn, so it is checked against the whole catalogue rather than against one row.
 */

const NOW = '2026-09-03T12:00:00.000Z';

const resources = Object.fromEntries(
  RESOURCE_KEYS.map((key) => [key, key === 'caps' ? 10_000 : 1_000]),
) as Resources;

function marketWith(
  inventory: Inventory,
  reimagining: MarketResponse['reimagining'] = {
    hasHeadOfResearch: false,
    hasReimaginingResearch: false,
  },
): MarketResponse {
  return {
    reimagining,
    serverNow: NOW,
    caps: resources.caps,
    resources,
    inventory,
    vendor: { open: false, sessions: [], closesAt: null, opensAt: NOW, stock: [] },
    offers: [],
    mine: [],
    supply: supplyBoard(12, resources, 10_000, 0, (key) =>
      Math.round(10_000 * (STORAGE_SHARES[key] ?? 0)),
    ),
    barterRate: 0.5,
  };
}

const reply = (body: unknown, { ok = true, status = 200 } = {}) =>
  Promise.resolve({
    ok,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

const fetchMock = vi.fn();

/** Every page of the Sniper Blueprint: three, and the smallest complete set on the page. */
const ALL_SNIPER_PAGES: Inventory = {
  pg_snipers_barrel_liners: 1,
  pg_snipers_range_cards: 1,
  pg_snipers_ghillie_patterns: 1,
};

/** Both halves of the §G4 gate met, which is what puts a button on the panel. */
const LAB_OPEN = { hasHeadOfResearch: true, hasReimaginingResearch: true };

function stub(
  inventory: Inventory,
  onUnlock?: (body: unknown) => Inventory,
  reimagining: MarketResponse['reimagining'] = {
    hasHeadOfResearch: false,
    hasReimaginingResearch: false,
  },
  /** When set, the trade route refuses with this machine name instead of trading. */
  refuseTrade: string | null = null,
  /** When set, the unlock route refuses with this machine name instead of unlocking. */
  refuseUnlock: string | null = null,
): void {
  let current = inventory;
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/market')) return reply(marketWith(current, reimagining));
    if (path.endsWith('/blueprints/reimagine') && refuseTrade !== null) {
      return reply(
        { error: { code: 'REIMAGINING_REFUSED', message: refuseTrade } },
        { ok: false, status: 409 },
      );
    }
    if (path.endsWith('/blueprints/reimagine')) {
      // What the route answers with: the board, plus the only place the new page is ever named.
      current = { ...current, pg_munitions_load_tables: 1 };
      return reply({
        market: marketWith(current, reimagining),
        spent: ['pg_snipers_range_cards', 'pg_snipers_range_cards', 'pg_snipers_range_cards'],
        gained: 'pg_munitions_load_tables',
      });
    }
    if (path.endsWith('/blueprints/unlock') && refuseUnlock !== null) {
      return reply(
        { error: { code: 'BLUEPRINT_REFUSED', message: refuseUnlock } },
        { ok: false, status: 409 },
      );
    }
    if (path.endsWith('/blueprints/unlock')) {
      const raw = typeof init?.body === 'string' ? init.body : '{}';
      const body: unknown = JSON.parse(raw);
      current = onUnlock ? onUnlock(body) : current;
      return reply({ market: marketWith(current) });
    }
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/game/inventory/blueprints']}>
        <BlueprintsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what a crew is allowed to see (§D5)', () => {
  it('shows no blueprint at all to a crew holding no pages', async () => {
    stub({});
    renderPage();
    // The note itself is a hover card, so what is on screen is its chip.
    expect(await screen.findByText('How a blueprint is put together')).toBeVisible();
    // Not one row, and not one name: the Colossus is not a thing this player knows exists.
    expect(screen.queryByText('Colossus Blueprint')).toBeNull();
    expect(document.querySelectorAll('[data-testid^="blueprint-"]')).toHaveLength(0);
  });

  it('reveals exactly the one document a single page belongs to, and nothing beside it', async () => {
    stub({ pg_colossus_hull_sections: 1 });
    renderPage();
    expect(await screen.findByText('Colossus Blueprint')).toBeVisible();
    expect(document.querySelectorAll('[data-testid^="blueprint-"]')).toHaveLength(1);
    expect(screen.queryByText('Sniper Blueprint')).toBeNull();
  });
});

describe('a document being collected (§D6 to §D9)', () => {
  it('draws a square per page, filled for what is held', async () => {
    stub({ pg_snipers_range_cards: 1 });
    renderPage();
    const squares = await screen.findByTestId('pages-bp_snipers');
    const cells = within(squares).getAllByRole('listitem');
    // Three, off the catalogue rather than a literal, and never zero: `?? 0` here would pass on a
    // blueprint that had gone missing entirely.
    expect(findBlueprint('bp_snipers')?.pages).toHaveLength(3);
    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.dataset.held)).toEqual(['no', 'yes', 'no']);
  });

  it('locks and darkens it, and offers no way to unlock a document short of a page', async () => {
    stub({ pg_snipers_range_cards: 1 });
    renderPage();
    const card = await screen.findByTestId('blueprint-bp_snipers');
    expect(card.dataset.status).toBe('partial');
    expect(card.className).toContain('opacity-75');
    expect(within(card).getByLabelText('Locked')).toBeVisible();
    expect(within(card).queryByRole('button', { name: 'Unlock' })).toBeNull();
    expect(within(card).getByText('1 of 3 pages')).toBeVisible();
  });

  it('offers Unlock only once every page is in', async () => {
    stub(ALL_SNIPER_PAGES);
    renderPage();
    const card = await screen.findByTestId('blueprint-bp_snipers');
    expect(card.dataset.status).toBe('complete');
    expect(card.className).not.toContain('opacity-75');
    expect(within(card).getByRole('button', { name: 'Unlock' })).toBeEnabled();
  });
});

describe('unlocking (§D10)', () => {
  it('moves the document to the unlocked view and stops offering the button', async () => {
    // What the server does: spend one of each page, hand back the document.
    stub(ALL_SNIPER_PAGES, () => ({ bp_snipers: 1 }));
    renderPage();

    const card = await screen.findByTestId('blueprint-bp_snipers');
    fireEvent.click(within(card).getByRole('button', { name: 'Unlock' }));

    // Gone from the collecting view, which is what "moves to the unlocked page" means.
    await waitFor(() => expect(screen.queryByTestId('blueprint-bp_snipers')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /Unlocked/ }));

    const unlockedCard = await screen.findByTestId('blueprint-bp_snipers');
    expect(unlockedCard.dataset.status).toBe('unlocked');
    expect(within(unlockedCard).queryByRole('button', { name: 'Unlock' })).toBeNull();
    expect(within(unlockedCard).getByText('Unlocked')).toBeVisible();
    // The pages were spent, and the finished document still draws a full row.
    const cells = within(screen.getByTestId('pages-bp_snipers')).getAllByRole('listitem');
    expect(cells.every((cell) => cell.dataset.held === 'yes')).toBe(true);
  });

  it('sends the blueprint the player pressed, and nothing else', async () => {
    const seen: unknown[] = [];
    stub(ALL_SNIPER_PAGES, (body) => {
      seen.push(body);
      return { bp_snipers: 1 };
    });
    renderPage();
    const card = await screen.findByTestId('blueprint-bp_snipers');
    fireEvent.click(within(card).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(seen).toEqual([{ blueprintId: 'bp_snipers' }]));
  });
});

describe('categories and the Reimagining seam (§D11d, §G4)', () => {
  it('files each document under its own category', async () => {
    stub({
      pg_snipers_range_cards: 1,
      pg_munitions_load_tables: 1,
      pg_shaped_charges_cone_geometry: 1,
    });
    renderPage();
    expect(
      within(await screen.findByTestId('blueprints-unit')).getByText('Sniper Blueprint'),
    ).toBeVisible();
    expect(
      within(screen.getByTestId('blueprints-upgrade')).getByText('Munitions Blueprint'),
    ).toBeVisible();
    expect(
      within(screen.getByTestId('blueprints-consumable')).getByText('Shaped Charge Blueprint'),
    ).toBeVisible();
  });

  it('shows Reimagining locked, with both requirements stated, even with nothing held', async () => {
    stub({});
    renderPage();
    expect(await screen.findByText('Reimagining')).toBeVisible();
    expect(screen.getByText('A Head of Research on the crew')).toBeVisible();
    expect(screen.getByText('Reimagining, researched in the Lab')).toBeVisible();
    expect(screen.getByText(/Take 3 pages you do not need/)).toBeVisible();
  });

  it('counts duplicates as the spare pages the trade would eat', async () => {
    stub({ pg_snipers_range_cards: 3 });
    renderPage();
    expect(await screen.findByText('2 spare pages in the satchel')).toBeVisible();
  });
});

/**
 * §D10: an Unlock that is refused says so in words.
 *
 * The route answers with the machine name `unlockRefusal` returns, and the banner printed it
 * straight through, so a crew one page short of a document read the literal string
 * `missing_pages`. The wording map had been written and exported with no consumer at all.
 */
describe('a refused Unlock (§D10)', () => {
  it('shows the sentence rather than the machine name', async () => {
    // A complete set, so the button is there to press, with the server refusing anyway.
    stub(ALL_SNIPER_PAGES, undefined, undefined, null, 'missing_pages');
    renderPage();

    const card = await screen.findByTestId('blueprint-bp_snipers');
    fireEvent.click(within(card).getByRole('button', { name: 'Unlock' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(BLUEPRINT_UNLOCK_MESSAGES.missing_pages);
    expect(alert.textContent).not.toContain('missing_pages');
  });
});

/**
 * A spare copy of a page whose document is already assembled.
 *
 * `unseenPages` used to treat every page of an unlocked document as one the crew had never seen,
 * because unlocking spends one of each and leaves the count at zero. Reimagining therefore handed
 * back pages of documents finished last week, and the fix was to exclude them. That fix has a
 * consequence on this screen: a *second* copy of such a page is now genuinely spendable, and the
 * card was hiding it, because the spare badge was suppressed for unlocked documents entirely.
 */
describe('a spare page of a document already assembled (§D10, §G2)', () => {
  it('marks the copy on the card rather than hiding it under a finished document', async () => {
    // Unlocked, plus one loose copy of one of its pages.
    stub({ bp_snipers: 1, pg_snipers_range_cards: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Unlocked/ }));
    const squares = within(await screen.findByTestId('pages-bp_snipers'));
    expect(squares.getByText('1')).toBeVisible();
  });

  it('leaves a spent page with no copies left carrying no number at all', async () => {
    stub({ bp_snipers: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('tab', { name: /Unlocked/ }));
    const squares = await screen.findByTestId('pages-bp_snipers');
    // Any digit, not just a `1`. Rendering `{held}` unconditionally puts a literal `0` in every
    // square, which a check for one particular number walks straight past.
    for (const square of squares.querySelectorAll('li')) {
      const shown = [...square.children]
        .filter((child) => !child.classList.contains('sr-only'))
        .map((child) => child.textContent ?? '')
        .join('');
      expect(shown, `a spent page is showing "${shown}"`).not.toMatch(/\d/);
    }
  });
});

/**
 * §G2: the trade itself, once the Lab will do it.
 *
 * The panel had a lock on it and nothing behind the lock for as long as the research did not
 * exist, so these cover the half that was a placeholder: a button that posts, and a report that
 * names the page. That report matters more than it looks. The page a crew gains is chosen on the
 * server and appears in the satchel as one more row among dozens, so this sentence is the only
 * moment a player is told what they got.
 */
describe('trading three pages for one (§G2)', () => {
  it('drops the requirement list and offers the trade once the Lab is open', async () => {
    stub({ pg_snipers_range_cards: 4 }, undefined, LAB_OPEN);
    renderPage();

    expect(await screen.findByTestId('reimagine')).toBeEnabled();
    // The lock copy earns its space only while it is shut.
    expect(screen.queryByText('A Head of Research on the crew')).toBeNull();
  });

  it('names what went in and what came out', async () => {
    stub({ pg_snipers_range_cards: 4 }, undefined, LAB_OPEN);
    renderPage();

    fireEvent.click(await screen.findByTestId('reimagine'));
    const report = await screen.findByTestId('reimagine-result');
    expect(report).toHaveTextContent('Range Cards x3 went in');
    expect(report).toHaveTextContent('Load Tables came out');
  });

  it('holds the trade shut and says why when the spares are short', async () => {
    stub({ pg_snipers_range_cards: 3 }, undefined, LAB_OPEN);
    renderPage();

    expect(await screen.findByTestId('reimagine')).toBeDisabled();
    expect(screen.getByTestId('reimagine-refusal')).toHaveTextContent(
      'wants 3 pages you do not need',
    );
  });

  it('says why when the server refuses a trade the page thought was fine', async () => {
    // The page's own check passes: four copies is three spares, and the Lab is open. The refusal
    // arrives from the server, which is what happens when the Head of Research is unseated in
    // another tab between the board being drawn and the button being pressed.
    stub({ pg_snipers_range_cards: 4 }, undefined, LAB_OPEN, 'not_available');
    renderPage();

    fireEvent.click(await screen.findByTestId('reimagine'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The Lab is not doing this yet.');
    // And never the raw machine name.
    expect(alert.textContent).not.toContain('not_available');
  });

  it('keeps the lock on while only one half of the gate is met', async () => {
    stub({ pg_snipers_range_cards: 4 }, undefined, {
      hasHeadOfResearch: true,
      hasReimaginingResearch: false,
    });
    renderPage();

    expect(await screen.findByText('Reimagining')).toBeVisible();
    expect(screen.queryByTestId('reimagine')).toBeNull();
    expect(screen.getByText('A Head of Research on the crew')).toBeVisible();
  });
});
