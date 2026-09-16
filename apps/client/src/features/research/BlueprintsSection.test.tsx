import {
  ITEM_RARITY_LABELS,
  RESOURCE_KEYS,
  supplyBoard,
  STORAGE_SHARES,
  findBlueprint,
  pageRarity,
  type Inventory,
  type MarketResponse,
  type Resources,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlueprintsSection } from './BlueprintsSection';
import { BLUEPRINT_UNLOCK_MESSAGES } from '@frontline/shared';
import { useSession } from '../../store/session';

/**
 * The Blueprints tab, and the one thing it must never do.
 *
 * §D5: a document a crew holds no pages of is not on this screen. Every other assertion here is
 * about a state a player can reach by finding pages, but that one is about what they must *not*
 * be able to learn, so it is checked against the whole catalogue rather than against one row.
 */

const NOW = '2026-09-03T12:00:00.000Z';

const resources = Object.fromEntries(
  RESOURCE_KEYS.map((key) => [key, key === 'caps' ? 10_000 : 1_000]),
) as Resources;

function marketWith(inventory: Inventory): MarketResponse {
  return {
    reimagining: { hasHeadOfResearch: false, hasReimaginingResearch: false },
    serverNow: NOW,
    caps: resources.caps,
    resources,
    inventory,
    vendor: {
      open: false,
      sessions: [],
      session: null,
      closesAt: null,
      opensAt: NOW,
      stock: [],
      results: [],
    },
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

function stub(
  inventory: Inventory,
  onUnlock?: (body: unknown) => Inventory,
  /** When set, the unlock route refuses with this machine name instead of unlocking. */
  refuseUnlock: string | null = null,
): void {
  let current = inventory;
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/market')) return reply(marketWith(current));
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
      <MemoryRouter initialEntries={['/game/research/blueprints']}>
        <BlueprintsSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The switch, by the name a player reads on it. */
const showUnlocked = () => screen.getByRole('switch', { name: /Show unlocked/ });

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
    // The sentence is printed on the page rather than folded into a hover chip: collapsed, that
    // chip was the entire content of this screen for a crew with nothing in the inventory.
    expect(await screen.findByTestId('blueprints-empty')).toHaveTextContent(
      /A blueprint is a set of named pages, and you have none of them/,
    );
    // Not one row, and not one name: the Colossus is not a thing this player knows exists.
    expect(screen.queryByText('Colossus Blueprint')).toBeNull();
    expect(document.querySelectorAll('[data-testid^="blueprint-bp"]')).toHaveLength(0);
    // ...and no furniture either: the switch and the drawers would be a screen with controls on it
    // and nothing to control.
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('reveals exactly the one document a single page belongs to, and nothing beside it', async () => {
    stub({ pg_colossus_hull_sections: 1 });
    renderPage();
    expect(await screen.findByText('Colossus Blueprint')).toBeVisible();
    expect(document.querySelectorAll('[data-testid^="blueprint-bp"]')).toHaveLength(1);
    expect(screen.queryByText('Sniper Blueprint')).toBeNull();
  });
});

/**
 * §D8, the maintainer's 2026-09-09 call: every page is its own thing and says so.
 *
 * A page tile carries three things a square never could: the page's name, its rarity, and on hover
 * the line saying what is actually drawn on the sheet. All three are authored in the shared
 * catalogue, so the assertions read them from there rather than repeating the copy: a test holding
 * its own copy of "Range Cards" passes on a screen printing a page that no longer exists.
 */
describe('what a page tile says about the page (§D8)', () => {
  it('names every page of the document and inks each one at its own rarity', async () => {
    stub({ pg_snipers_range_cards: 1 });
    renderPage();
    const tiles = within(await screen.findByTestId('pages-bp_snipers')).getAllByRole('listitem');
    const snipers = findBlueprint('bp_snipers');
    expect(snipers).toBeDefined();
    if (!snipers) return;

    for (const [index, page] of snipers.pages.entries()) {
      expect(tiles[index]?.textContent ?? '', `tile ${index} does not name ${page.id}`).toContain(
        page.name,
      );
    }
    /*
     * The rarity is on the tile's own attribute and on its hover rather than printed under the
     * name: an 88px tile has room for a page name at 10px and nothing else, and the strip has to
     * put the Colossus' eight sheets on one line.
     */
    expect(tiles.map((tile) => tile.dataset.rarity)).toEqual(
      snipers.pages.map((page) => pageRarity(snipers, page)),
    );
    // Barrel Liners is authored a tier above the document. A screen reading one rarity for the
    // whole document would draw all three tiles the same and still name them correctly.
    expect(new Set(tiles.map((tile) => tile.dataset.rarity)).size).toBeGreaterThan(1);
  });

  it('puts the page description and its rarity word on the hover', async () => {
    stub({ pg_snipers_range_cards: 1 });
    renderPage();
    const tiles = within(await screen.findByTestId('pages-bp_snipers')).getAllByRole('listitem');
    const snipers = findBlueprint('bp_snipers');
    const page = snipers?.pages[1];
    expect(page).toBeDefined();
    if (!snipers || !page) return;

    const tip = tiles[1]?.dataset.tip ?? '';
    expect(tip).toContain(page.name);
    expect(tip).toContain(page.description);
    expect(tip).toContain(ITEM_RARITY_LABELS[pageRarity(snipers, page)]);
  });

  it('prints the document rarity beside its name', async () => {
    stub({ pg_colossus_hull_sections: 1 });
    renderPage();
    const colossus = findBlueprint('bp_the_colossus');
    expect(colossus?.rarity).toBe('exotic');
    expect(await screen.findByTestId('rarity-bp_the_colossus')).toHaveTextContent(
      ITEM_RARITY_LABELS.exotic,
    );
  });
});

describe('a document being collected (§D6 to §D9)', () => {
  it('draws a sheet per page, lit for what is held', async () => {
    stub({ pg_snipers_range_cards: 1 });
    renderPage();
    const strip = await screen.findByTestId('pages-bp_snipers');
    const tiles = within(strip).getAllByRole('listitem');
    // Three, off the catalogue rather than a literal, and never zero: `?? 0` here would pass on a
    // blueprint that had gone missing entirely.
    expect(findBlueprint('bp_snipers')?.pages).toHaveLength(3);
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => tile.dataset.held)).toEqual(['no', 'yes', 'no']);
  });

  it('locks it, and holds Unlock shut on a document short of a page', async () => {
    stub({ pg_snipers_range_cards: 1 });
    renderPage();
    const row = await screen.findByTestId('blueprint-bp_snipers');
    expect(row.dataset.status).toBe('partial');
    // A short document is a plate with a plain edge; the finished one below wears the brass.
    expect(row.className).not.toContain('shadow-brass');
    expect(within(row).getByLabelText('Locked')).toBeVisible();
    expect(within(row).getByText('1 of 3 pages')).toBeVisible();
    /*
     * There, and dead. The control used to appear only once the set was complete, so an incomplete
     * document had nothing on its right at all and the row was a sentence with the verb missing.
     * §D6 wants the player to see what the pages are *for*.
     */
    expect(within(row).getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('lights Unlock the moment the last page is in', async () => {
    stub(ALL_SNIPER_PAGES);
    renderPage();
    const row = await screen.findByTestId('blueprint-bp_snipers');
    expect(row.dataset.status).toBe('complete');
    expect(row.className).toContain('shadow-brass');
    expect(within(row).getByRole('button', { name: 'Unlock' })).toBeEnabled();
  });
});

describe('unlocking (§D10)', () => {
  it('takes the document off the collecting list and stamps it in the unlocked one', async () => {
    // What the server does: spend one of each page, hand back the document.
    stub(ALL_SNIPER_PAGES, () => ({ bp_snipers: 1 }));
    renderPage();

    const row = await screen.findByTestId('blueprint-bp_snipers');
    fireEvent.click(within(row).getByRole('button', { name: 'Unlock' }));

    // Gone from the list, which is what "moves to the unlocked page" means.
    await waitFor(() => expect(screen.queryByTestId('blueprint-bp_snipers')).toBeNull());
    fireEvent.click(showUnlocked());

    const unlockedRow = await screen.findByTestId('blueprint-bp_snipers');
    expect(unlockedRow.dataset.status).toBe('unlocked');
    expect(within(unlockedRow).queryByRole('button', { name: 'Unlock' })).toBeNull();
    expect(within(unlockedRow).getByText('Unlocked')).toBeVisible();
    // The pages were spent, and the finished document still draws a full strip.
    const tiles = within(screen.getByTestId('pages-bp_snipers')).getAllByRole('listitem');
    expect(tiles.every((tile) => tile.dataset.held === 'yes')).toBe(true);
  });

  it('sends the blueprint the player pressed, and nothing else', async () => {
    const seen: unknown[] = [];
    stub(ALL_SNIPER_PAGES, (body) => {
      seen.push(body);
      return { bp_snipers: 1 };
    });
    renderPage();
    const row = await screen.findByTestId('blueprint-bp_snipers');
    fireEvent.click(within(row).getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(seen).toEqual([{ blueprintId: 'bp_snipers' }]));
  });
});

/**
 * The switch and the three drawers (maintainer, 2026-09-10).
 *
 * Both are state the screen holds and nothing else does, which makes them the two places this
 * screen can lie about what a crew owns: a switch that showed unlocked documents by default would
 * bury what a player is short of, and a drawer that filtered on the wrong field would hide a
 * document that is really there.
 */
describe('the switch and the drawers', () => {
  const MIXED: Inventory = {
    pg_snipers_range_cards: 1,
    bp_motorcycle: 1,
    pg_mod_filed_sights_sight_picture: 1,
    pg_shaped_charges_cone_geometry: 1,
  };

  it('leaves unlocked documents out until the switch is on', async () => {
    stub(MIXED);
    renderPage();

    expect(await screen.findByTestId('blueprint-bp_snipers')).toBeVisible();
    expect(showUnlocked()).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('blueprint-bp_motorcycle')).toBeNull();

    fireEvent.click(showUnlocked());
    expect(showUnlocked()).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByTestId('blueprint-bp_motorcycle')).toBeVisible();
    // Both, not just the unlocked ones: the switch adds to the list rather than swapping it.
    expect(screen.getByTestId('blueprint-bp_snipers')).toBeVisible();
    expect(screen.getByTestId('blueprint-bp_motorcycle').dataset.status).toBe('unlocked');
  });

  it('counts what each drawer holds, and follows the switch when it counts', async () => {
    stub(MIXED);
    renderPage();

    const drawer = (category: string) => screen.getByTestId(`blueprint-category-${category}`);
    await screen.findByTestId('blueprints-unit');
    expect(drawer('unit')).toHaveTextContent('1');
    expect(drawer('upgrade')).toHaveTextContent('1');
    expect(drawer('consumable')).toHaveTextContent('1');

    fireEvent.click(showUnlocked());
    // The motorbike is a unit document, so only that drawer's count moves.
    expect(drawer('unit')).toHaveTextContent('2');
    expect(drawer('upgrade')).toHaveTextContent('1');
  });

  it('shows one drawer at a time, and files each document under its own', async () => {
    stub(MIXED);
    renderPage();

    expect(
      within(await screen.findByTestId('blueprints-unit')).getByText('Sniper Blueprint'),
    ).toBeVisible();
    expect(screen.queryByTestId('blueprints-upgrade')).toBeNull();

    fireEvent.click(screen.getByTestId('blueprint-category-upgrade'));
    expect(
      within(screen.getByTestId('blueprints-upgrade')).getByText('Filed Sights Blueprint'),
    ).toBeVisible();
    expect(screen.queryByTestId('blueprints-unit')).toBeNull();
    expect(screen.queryByText('Sniper Blueprint')).toBeNull();

    fireEvent.click(screen.getByTestId('blueprint-category-consumable'));
    expect(
      within(screen.getByTestId('blueprints-consumable')).getByText('Shaped Charge Blueprint'),
    ).toBeVisible();
  });

  /** A crew whose only pages are recipes opens on the recipes rather than on an empty drawer. */
  it('opens on the first drawer that has anything in it', async () => {
    stub({ pg_shaped_charges_cone_geometry: 1 });
    renderPage();
    expect(await screen.findByTestId('blueprints-consumable')).toBeVisible();
    expect(screen.getByTestId('blueprint-category-consumable')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
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
    // A complete set, so the button is live to press, with the server refusing anyway.
    stub(ALL_SNIPER_PAGES, undefined, 'missing_pages');
    renderPage();

    const row = await screen.findByTestId('blueprint-bp_snipers');
    fireEvent.click(within(row).getByRole('button', { name: 'Unlock' }));

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
 * row was hiding it, because the spare badge was suppressed for unlocked documents entirely.
 */
describe('a spare page of a document already assembled (§D10, §G2)', () => {
  it('marks the copy on the row rather than hiding it under a finished document', async () => {
    // Unlocked, plus one loose copy of one of its pages.
    stub({ bp_snipers: 1, pg_snipers_range_cards: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('switch', { name: /Show unlocked/ }));
    const strip = within(await screen.findByTestId('pages-bp_snipers'));
    // "x1" rather than a bare 1: the count sits on a tile carrying a name now, and a lone digit
    // beside "Range Cards" reads as part of the name.
    expect(strip.getByText('x1')).toBeVisible();
  });

  it('leaves a spent page with no copies left carrying no number at all', async () => {
    stub({ bp_snipers: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole('switch', { name: /Show unlocked/ }));
    const strip = await screen.findByTestId('pages-bp_snipers');
    // Any digit, not just a `1`. Rendering `{held}` unconditionally puts a literal `0` on every
    // tile, which a check for one particular number walks straight past.
    for (const tile of strip.querySelectorAll('li')) {
      const shown = [...tile.children]
        .filter((child) => !child.classList.contains('sr-only'))
        .map((child) => child.textContent ?? '')
        .join('');
      expect(shown, `a spent page is showing "${shown}"`).not.toMatch(/\d/);
    }
  });
});
