import {
  DEFAULT_CITY_ID,
  BLUEPRINTS,
  REIMAGINING_COMPLETE_XP,
  REIMAGINING_RESEARCH_ID,
  RESOURCE_KEYS,
  STORAGE_SHARES,
  findBlueprintPage,
  findResearchItem,
  supplyBoard,
  unseenPages,
  type Inventory,
  type MarketResponse,
  type Resources,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReimaginingSection } from './ReimaginingSection';
import { useSession } from '../../store/session';

/**
 * §G2 on the screen: a tray, three sockets and a button that will not press until they are full.
 *
 * What is worth asserting here is the *choice*, because that is the half that is new. The server
 * decides what comes back and shared decides whether the trade is allowed; this screen decides
 * which three pages are named, and every bug it can have on its own is a bug in that: a socket that
 * takes a page the crew does not have left, a tray that lets a stack be spent twice, a button that
 * lights on two.
 */

const NOW = '2026-09-10T12:00:00.000Z';
const LAB_OPEN = { hasHeadOfResearch: true, hasReimaginingResearch: true };

const resources = Object.fromEntries(
  RESOURCE_KEYS.map((key) => [key, key === 'caps' ? 10_000 : 1_000]),
) as Resources;

function marketWith(
  inventory: Inventory,
  reimagining: MarketResponse['reimagining'] = LAB_OPEN,
): MarketResponse {
  return {
    reimagining,
    serverNow: NOW,
    cityId: DEFAULT_CITY_ID,
    cities: [DEFAULT_CITY_ID],
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
/** Every request the screen posted to the trade route, in order. */
let posted: { pages: string[] }[] = [];

const GAINED = 'pg_demolishers_charge_moulds';

/**
 * The bench, stubbed the way the server behaves: the three named pages leave the inventory and the
 * one that came back arrives in it.
 *
 * A handler that answered with the board unchanged would let a tray that never re-reads its counts
 * pass, which is the whole of what this screen has to get right after a press.
 */
function stub(
  inventory: Inventory,
  reimagining: MarketResponse['reimagining'] = LAB_OPEN,
  refuse: string | null = null,
): void {
  let current = inventory;
  posted = [];
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/market')) return reply(marketWith(current, reimagining));
    if (path.endsWith('/blueprints/reimagine')) {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        pages: string[];
      };
      posted.push(body);
      if (refuse !== null) {
        return reply(
          { error: { code: 'REIMAGINING_REFUSED', message: refuse } },
          { ok: false, status: 409 },
        );
      }
      const after: Record<string, number> = { ...(current as Record<string, number>) };
      for (const pageId of body.pages) after[pageId] = (after[pageId] ?? 0) - 1;
      // A finished collection pays experience rather than a page, the way the route does.
      const finished = unseenPages(current).length === 0;
      if (!finished) after[GAINED] = (after[GAINED] ?? 0) + 1;
      current = Object.fromEntries(Object.entries(after).filter(([, count]) => count > 0));
      return reply({
        market: marketWith(current, reimagining),
        spent: body.pages,
        gained: finished ? null : GAINED,
        xp: finished ? REIMAGINING_COMPLETE_XP : 0,
      });
    }
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderBench() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/game/research/reimagining']}>
        <ReimaginingSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * The player has asked for stillness, so the bench answers without the travel.
 *
 * Set for every test but the one that measures the other branch: with motion on, the result waits
 * on the animation, and every assertion in this file would be waiting 620ms for a page it could
 * already see.
 */
function stubMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const RANGE_CARDS = 'pg_snipers_range_cards';
const BARREL_LINERS = 'pg_snipers_barrel_liners';

/** Three copies of one page and one of another: enough to pay, and a stack to draw down. */
const INVENTORY: Inventory = { [RANGE_CARDS]: 3, [BARREL_LINERS]: 1 };

const nameOf = (pageId: string) => findBlueprintPage(pageId)?.name ?? pageId;
const slot = (index: number) => screen.getByTestId(`reimagine-slot-${index}`);
const tray = (pageId: string) => screen.getByTestId(`tray-${pageId}`);
const button = () => screen.getByTestId('reimagine');

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  stubMotion(true);
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bench, shut (§G4)', () => {
  it('says which half is missing and puts nothing else on the sheet', async () => {
    stub(INVENTORY, { hasHeadOfResearch: false, hasReimaginingResearch: true });
    renderBench();

    const locked = await screen.findByTestId('reimagining-locked');
    expect(locked).toHaveTextContent('Nobody is sitting in the Head of Research chair');
    expect(within(locked).getByLabelText('Locked')).toBeVisible();
    // No machine, no tray, no lever: a shut bench is a lock, a sentence and the way out of it.
    expect(screen.queryByTestId('reimagine-machine')).toBeNull();
    expect(screen.queryByTestId('reimagine-tray')).toBeNull();
    expect(screen.queryByTestId('reimagine')).toBeNull();
  });

  it('names the research when that is what is missing', async () => {
    stub(INVENTORY, { hasHeadOfResearch: true, hasReimaginingResearch: false });
    renderBench();
    expect(await screen.findByTestId('reimagining-locked')).toHaveTextContent(
      'The Lab has not worked Reimagining out yet.',
    );
  });

  it('names both when the crew has neither', async () => {
    stub(INVENTORY, { hasHeadOfResearch: false, hasReimaginingResearch: false });
    renderBench();
    const locked = await screen.findByTestId('reimagining-locked');
    expect(locked).toHaveTextContent('has not worked Reimagining out yet');
    expect(locked).toHaveTextContent('nobody in the Head of Research chair');
  });
});

/**
 * The shut bench is a door, not a notice (maintainer, 2026-09-10).
 *
 * A sentence saying nobody is in the chair leaves a player to work out for themselves that chairs
 * are filled at the Bar; a sentence saying the Lab has not worked Reimagining out leaves them to
 * find which of nineteen trades the rung is on. Which door is drawn is the *chair* rather than the
 * research, because an empty Head of Research chair shuts every rung on every trade (§C1c): a crew
 * missing both cannot start the research either, so hiring is always the next thing.
 *
 * The destination is asserted rather than the words, because the words are the cheap half. A link
 * reading "Research it on the Fabricator's track" that points at a bare `/game/research` lands a
 * player on the Master of Whispers, and every assertion on its label would still pass.
 */
describe('the door out of a shut bench', () => {
  it('sends a crew with no Head of Research to the Bar', async () => {
    stub(INVENTORY, { hasHeadOfResearch: false, hasReimaginingResearch: true });
    renderBench();
    const door = await screen.findByTestId('reimagining-door');
    expect(door).toHaveTextContent('Hire a Head of Research at the Bar');
    expect(door).toHaveAttribute('href', '/game/bar');
  });

  it('sends a crew that has the chair but not the rung to the track the rung is on', async () => {
    stub(INVENTORY, { hasHeadOfResearch: true, hasReimaginingResearch: false });
    renderBench();
    const door = await screen.findByTestId('reimagining-door');
    /*
     * The Fabricator, not the Head of Research.
     *
     * Reimagining is the sixth rung of the Fabricator's track (`tracks.ts`), which is not where
     * anybody guesses it is: the maintainer's note for this door said the Head of Research's, and the
     * Head of Research post is what *gates* the research rather than what carries it. Both halves
     * are read off the catalogue here so a door pointing at a rail with no such rung on it fails
     * rather than quietly wasting a player's click.
     */
    const track = findResearchItem(REIMAGINING_RESEARCH_ID)?.track;
    expect(track).toBe('fabricator');
    expect(door).toHaveTextContent("Research it on the Fabricator's track");
    expect(door).toHaveAttribute('href', `/game/research?track=${track ?? ''}`);
  });

  it('asks for the chair first when the crew has neither', async () => {
    stub(INVENTORY, { hasHeadOfResearch: false, hasReimaginingResearch: false });
    renderBench();
    expect(await screen.findByTestId('reimagining-door')).toHaveAttribute('href', '/game/bar');
  });

  it('draws no door once the bench runs', async () => {
    stub(INVENTORY);
    renderBench();
    expect(await screen.findByTestId('reimagine-machine')).toBeInTheDocument();
    expect(screen.queryByTestId('reimagining-door')).toBeNull();
  });
});

describe('filling the sockets (§G2)', () => {
  it('opens with three empty sockets, an empty outfeed and a dead button', async () => {
    stub(INVENTORY);
    renderBench();

    await screen.findByTestId('reimagine-machine');
    for (const index of [0, 1, 2]) expect(slot(index)).toHaveAttribute('data-filled', 'no');
    expect(screen.getByTestId('reimagine-result')).toHaveAttribute('data-filled', 'no');
    expect(button()).toBeDisabled();
  });

  it('puts a page in the first empty socket and takes it off the tray count', async () => {
    stub(INVENTORY);
    renderBench();

    expect(await screen.findByTestId(`tray-${RANGE_CARDS}`)).toHaveAttribute('data-left', '3');
    fireEvent.click(tray(RANGE_CARDS));

    expect(slot(0)).toHaveAttribute('data-filled', 'yes');
    expect(slot(0)).toHaveTextContent(nameOf(RANGE_CARDS));
    expect(slot(1)).toHaveAttribute('data-filled', 'no');
    expect(tray(RANGE_CARDS)).toHaveAttribute('data-left', '2');
  });

  /** §G2: a page may go in as many times as it is held, and not once more. */
  it('lets a stack fill all three sockets and then goes dark', async () => {
    stub(INVENTORY);
    renderBench();

    await screen.findByTestId('reimagine-machine');
    for (const _ of [0, 1, 2]) fireEvent.click(tray(RANGE_CARDS));

    expect(tray(RANGE_CARDS)).toHaveAttribute('data-left', '0');
    expect(tray(RANGE_CARDS)).toBeDisabled();
    // ...and the one copy of the other page cannot be put anywhere either, because the machine is
    // full. Three sockets is the cap, not three of any one page.
    expect(tray(BARREL_LINERS)).toBeDisabled();
  });

  it('gives a page back when its socket is pressed', async () => {
    stub(INVENTORY);
    renderBench();

    await screen.findByTestId('reimagine-machine');
    fireEvent.click(tray(RANGE_CARDS));
    fireEvent.click(tray(BARREL_LINERS));
    expect(tray(BARREL_LINERS)).toHaveAttribute('data-left', '0');

    fireEvent.click(slot(1));
    expect(slot(1)).toHaveAttribute('data-filled', 'no');
    expect(tray(BARREL_LINERS)).toHaveAttribute('data-left', '1');
    expect(tray(BARREL_LINERS)).toBeEnabled();
    // The first socket keeps what was put in it: emptying one is not emptying the machine.
    expect(slot(0)).toHaveAttribute('data-filled', 'yes');
    // An empty socket cannot be pressed, or a stray click on the machine would do nothing visible
    // and read as the screen being dead.
    expect(slot(2)).toBeDisabled();
  });

  it('lights the button on the third page and not on the second', async () => {
    stub(INVENTORY);
    renderBench();

    await screen.findByTestId('reimagine-machine');
    fireEvent.click(tray(RANGE_CARDS));
    expect(button()).toBeDisabled();
    fireEvent.click(tray(RANGE_CARDS));
    expect(button()).toBeDisabled();
    expect(screen.getByTestId('reimagine-machine')).toHaveAttribute('data-lit', 'no');

    fireEvent.click(tray(BARREL_LINERS));
    expect(button()).toBeEnabled();
    // The machinery says the same thing the button says, which is what stops a player pressing a
    // dead control and wondering whether the screen heard them.
    expect(screen.getByTestId('reimagine-machine')).toHaveAttribute('data-lit', 'yes');
  });
});

describe('pressing it (§G2, §G3)', () => {
  const fill = () => {
    fireEvent.click(tray(RANGE_CARDS));
    fireEvent.click(tray(RANGE_CARDS));
    fireEvent.click(tray(BARREL_LINERS));
  };

  it('names the three that were in the sockets, and nothing else', async () => {
    stub(INVENTORY);
    renderBench();
    await screen.findByTestId('reimagine-machine');
    fill();

    fireEvent.click(button());
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ pages: [RANGE_CARDS, RANGE_CARDS, BARREL_LINERS] });
  });

  it('lands the new page in the outfeed and empties the sockets', async () => {
    stub(INVENTORY);
    renderBench();
    await screen.findByTestId('reimagine-machine');
    fill();
    fireEvent.click(button());

    const result = await screen.findByTestId('reimagine-result');
    await waitFor(() => expect(result).toHaveAttribute('data-filled', 'yes'));
    expect(result).toHaveAttribute('data-page', GAINED);
    expect(result).toHaveTextContent(nameOf(GAINED));
    for (const index of [0, 1, 2]) expect(slot(index)).toHaveAttribute('data-filled', 'no');
    expect(screen.getByTestId('reimagine-report')).toHaveTextContent(nameOf(GAINED));
  });

  it('leaves the tray holding what the trade left behind', async () => {
    stub(INVENTORY);
    renderBench();
    await screen.findByTestId('reimagine-machine');
    fill();
    fireEvent.click(button());

    /*
     * Waited on the outfeed rather than on the tray.
     *
     * A tray count is one number standing for two states: while the sheets are still in the
     * sockets it is what is left to put in, and it reads 1 for the Range Cards either way. Waiting
     * on it passed on the frame *before* the response landed, so the assertions underneath were
     * measuring the inventory the crew had walked in with.
     */
    await waitFor(() =>
      expect(screen.getByTestId('reimagine-result')).toHaveAttribute('data-filled', 'yes'),
    );
    // Two Range Cards and the one Barrel Liner went in; the new page arrived. Read off the tray
    // rather than off the response, because the tray is what a player looks at next.
    expect(screen.getByTestId(`tray-${RANGE_CARDS}`)).toHaveAttribute('data-left', '1');
    expect(screen.queryByTestId(`tray-${BARREL_LINERS}`)).toBeNull();
    expect(screen.getByTestId(`tray-${GAINED}`)).toHaveAttribute('data-left', '1');
  });

  /** With the travel on, the answer still lands: the animation delays it, it does not lose it. */
  it('waits for the animation before showing the page, and still shows it', async () => {
    stubMotion(false);
    stub(INVENTORY);
    renderBench();
    await screen.findByTestId('reimagine-machine');
    fill();
    fireEvent.click(button());

    // The sheets are on their way out of the sockets, and the outfeed is still empty.
    expect(screen.getByTestId('reimagine-machine')).toHaveAttribute('data-phase', 'running');
    expect(screen.getByTestId('reimagine-result')).toHaveAttribute('data-filled', 'no');
    await waitFor(
      () => expect(screen.getByTestId('reimagine-result')).toHaveAttribute('data-filled', 'yes'),
      { timeout: 3000 },
    );
  });

  it('says why in words when the server refuses, and gives the pages back', async () => {
    stub(INVENTORY, LAB_OPEN, 'not_available');
    renderBench();
    await screen.findByTestId('reimagine-machine');
    fill();
    fireEvent.click(button());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The Lab is not doing this yet.');
    // Never the raw machine name, and never an inventory that quietly lost three pages.
    expect(alert.textContent).not.toContain('not_available');
    expect(screen.getByTestId(`tray-${RANGE_CARDS}`)).toHaveAttribute('data-left', '1');
    expect(slot(0)).toHaveAttribute('data-filled', 'yes');
  });
});

describe('a crew with nothing to feed it', () => {
  it('says so rather than drawing an empty tray', async () => {
    stub({ scrap_servo: 6 });
    renderBench();

    await screen.findByTestId('reimagine-machine');
    expect(screen.getByText(/The bench eats pages and you are carrying none/)).toBeVisible();
    expect(screen.queryByTestId('reimagine-tray')).toBeNull();
    expect(button()).toBeDisabled();
  });

  /**
   * The end of the collection: every page held, so there is no page the bench could hand back.
   *
   * It pays experience instead (maintainer, 2026-09-23). The lever is live, the sentence that
   * used to sit under the machine is gone, and the outfeed shows the figure rather than a sheet.
   */
  it('pays experience once every page is held, and says so in the outfeed', async () => {
    const everything: Record<string, number> = {};
    for (const spec of BLUEPRINTS) {
      for (const page of spec.pages) everything[page.id] = 2;
    }
    stub(everything);
    renderBench();

    await screen.findByTestId('reimagine-machine');
    expect(screen.queryByTestId('reimagine-refusal')).toBeNull();
    expect(screen.queryByText(/Nothing left to want/)).toBeNull();
    const [first, second, third] = BLUEPRINTS[0]?.pages.map((page) => page.id) ?? [];
    fireEvent.click(screen.getByTestId(`tray-${first!}`));
    fireEvent.click(screen.getByTestId(`tray-${second!}`));
    fireEvent.click(screen.getByTestId(`tray-${third!}`));
    expect(button()).toBeEnabled();
    fireEvent.click(button());

    const result = await screen.findByTestId('reimagine-result');
    await waitFor(() => expect(result).toHaveAttribute('data-filled', 'xp'));
    expect(result).toHaveTextContent('5,000');
    expect(screen.getByTestId('reimagine-report')).toHaveTextContent(/5,000 experience/);
    expect(posted).toHaveLength(1);
  });
});
