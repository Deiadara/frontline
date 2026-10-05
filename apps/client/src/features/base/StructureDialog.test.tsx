import {
  TUTORIAL_STEPS,
  BUILDING_MAX_LEVEL,
  STARTING_RESOURCES,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type MeResponse,
  type CrewStandingResponse,
  OVERSEER_PRESETS,
  describeOverseerPassive,
  buildBoostOilCost,
  storeCeilings,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePanel } from './BasePanel';
import { useSession } from '../../store/session';

/**
 * What the plot window is *made of* (maintainer, 2026-09-18).
 *
 * The maintainer asked for this window to join the screens that were given the feats board's hand:
 * the ladders, the archive's rail and the per-unit hovers. All of that is class names, which is
 * the kind of change that reads fine in a diff and is wrong on the screen, and the two rules that
 * actually matter are not things a screenshot can be relied on to catch a year from now.
 *
 * The first is the **material**: the panels are the board's paper, the same four classes, and not
 * a fifth thing that resembles it. The second is the **packing**: a grid aligns rows, and aligning
 * rows is what hid 145px of the Nexus window under a scroll at 1024x768 while a sixth of the same
 * window sat empty beside it. Multi-column has no rows, so the deck has to stay a multi-column
 * box with panels that cannot be broken across a column.
 *
 * The geometry itself is pinned in the browser, in `e2e/hideout.spec.ts`: jsdom has no layout, so
 * nothing here can measure a fold. What this file pins is the decision that produced it.
 */

const NOW = '2026-08-13T10:00:00.000Z';

const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: 'sector-7',
  level: 20,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  buildings: [
    { id: 'b-nexus', kind: 'nexus', level: 13, modifications: [] },
    { id: 'b-generator', kind: 'generator', level: 6, modifications: [] },
    // Stores big enough for the Nexus's next bill, or its button says the stores are too small.
    { id: 'b-apothecary', kind: 'apothecary', level: 20, modifications: [] },
  ],
  buildQueue: [],
  army: {},
  musterQueue: [],
  training: startingTraining('2026-08-16T00:00:00.000Z'),
  inventory: {},
  fittedUpgrades: [],
  unitLoadouts: {},
  fleet: {},
  commanders: [],
  createdAt: NOW,
};

const me: MeResponse = {
  admin: false,
  user: {
    id: 'user-1',
    username: 'operator',
    overseerId: 'ov-1',
    createdAt: NOW,
    displayName: null,
    icon: 'shield',
    timezone: 'Europe/Athens',
    soundVolume: 60,
    // Seen, so the opening tutorial does not draw over a test about something else.
    tutorialSeen: [...TUTORIAL_STEPS],
  },
  overseer: null,
  base,
};

const crewStanding = (): CrewStandingResponse => {
  const { presetId: _presetId, ...preset } = OVERSEER_PRESETS[0]!;
  return {
    overseer: { ...preset, id: 'ov-1' },
    chairs: [],
    overseerGrade: { mark: 'C', passive: describeOverseerPassive(40) },
    effects: {},
    marks: {},
    haulPercent: 0,
    missionCapsPercent: 0,
  };
};

const fetchMock = vi.fn();

function stubApi(): void {
  const reply = (body: unknown) =>
    Promise.resolve({
      headers: new Headers(),
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve(body),
    } as Response);

  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/overseer/me')) return reply(crewStanding());
    if (path.endsWith('/me')) return reply(me);
    if (path.includes('/base/')) return reply({ base });
    throw new Error(`unstubbed request: ${path}`);
  });
}

function renderDistrict() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/game/base']}>
        <Routes>
          <Route path="/game/base" element={<BasePanel />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const plot = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) });

async function openNexus(): Promise<HTMLElement> {
  stubApi();
  renderDistrict();
  await waitFor(() => expect(plot('The Nexus')).toBeInTheDocument());
  fireEvent.click(plot('The Nexus'));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the plot window is in the same house as the feats board', () => {
  /*
   * The exact string the board carries, taken off the three screens the maintainer named rather
   * than invented here: `features/feats/FeatLadder.tsx`, `features/feats/FeatsSidebar.tsx` and
   * `features/research/ResearchPage.tsx` all frame a panel with these four, and
   * `features/units/UnitDamage.tsx` uses the same four on the hover sheet. Four separate classes
   * doing four separate jobs: the drawn border, the sheet, the wash over it and the tooth.
   */
  /*
   * `card-paper-lit` rather than `card-paper` since 2026-09-22 (maintainer: the building windows
   * are too dark). Same stack, same hand, one lighter sheet: `.card-paper` is ink black, which
   * reads as a hole rather than as a panel when it is printed on a lit paper Modal instead of on
   * the game's own dark shell.
   */
  const PAPER = ['ink-frame', 'card-paper-lit', 'washed', 'grain'] as const;

  it('frames every panel in the board’s paper', async () => {
    const dialog = await openNexus();
    const panels = [...dialog.querySelectorAll('section')];
    // A window with no panels would pass every assertion in the loop below.
    expect(panels.length).toBeGreaterThanOrEqual(3);

    for (const panel of panels) {
      const heading = panel.querySelector('h3')?.textContent ?? '(unnamed)';
      for (const mark of PAPER) {
        expect(panel.className.split(/\s+/), `${heading} is not on paper`).toContain(mark);
      }
      /*
       * And is not *also* punched tin. `.rivets` sets a `background-image`, and `.card-paper`'s
       * own sheet is a `background` shorthand, so carrying both is how eleven panels in this app
       * once rendered fully transparent. No paper panel anywhere else in the game has it.
       */
      expect(panel.className.split(/\s+/), `${heading} is riveted paper`).not.toContain('rivets');
    }
  });

  /**
   * One template for every plot (maintainer, 2026-09-28): the order and what the level gives down
   * the left, the brackets on the right, and the two columns the same height so the rack's top
   * and bottom sit level with the panels beside it. The multi-column deck this replaced packed
   * panels wherever they fitted, which is why no two windows had the same shape.
   */
  it('lays the panels on the one template, two columns of one height', async () => {
    const dialog = await openNexus();
    const deck = within(dialog).getByTestId('structure-deck');
    const marks = deck.className.split(/\s+/);
    expect(marks).toContain('sm:grid-cols-2');
    expect(marks).toContain('sm:items-stretch');
    expect(marks.some((mark) => mark.includes('columns'))).toBe(false);

    // The left column: the order, then the gift. The right: the brackets, and nothing else.
    const left = within(dialog).getByTestId('structure-left');
    const leftTitles = [...left.querySelectorAll('h3')].map((h) => h.textContent);
    expect(leftTitles).toEqual(['Upgrade to level 14', 'What it gives']);
    const titles = [...deck.querySelectorAll('h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Upgrade to level 14', 'What it gives', 'Modifications: 0 of 3 slots']);
    // The gift and the rack grow to the row, so their bottoms meet the rule together.
    const grown = [...deck.querySelectorAll('section')].filter((panel) =>
      panel.className.split(/\s+/).includes('flex-1'),
    );
    expect(grown.map((panel) => panel.querySelector('h3')?.textContent)).toEqual([
      'What it gives',
      'Modifications: 0 of 3 slots',
    ]);
  });

  /**
   * What a building does beyond the template is a control in the footer, beside the order, with
   * Close on the left in red (maintainer, 2026-09-28). The Nexus's is the payroll book, in a
   * window of its own.
   */
  it('keeps the building’s own control in the footer, Close on the left in red', async () => {
    const dialog = await openNexus();
    const footer = dialog.querySelector('footer');
    if (!footer) throw new Error('no footer');
    const buttons = [...footer.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Close', 'Increase payroll', 'Queue upgrade']);
    expect(within(footer).getByRole('button', { name: 'Close' }).className).toContain('oxblood');
    expect(within(dialog).queryByRole('heading', { name: 'The payroll book' })).toBeNull();

    fireEvent.click(within(footer).getByTestId('nexus-open-payroll'));
    const book = await screen.findByTestId('payroll-dialog');
    expect(within(book).getByRole('heading', { name: 'The payroll book' })).toBeInTheDocument();
    expect(within(book).getByTestId('payroll-ledger')).toBeInTheDocument();
    expect(book.textContent).not.toMatch(/A step is permanent/);
    // One window for the Bar and the Nexus (maintainer, 2026-10-01), so it names neither.
    expect(book.textContent).not.toMatch(/the nexus/i);
  });

  /** Two sentences the maintainer took out (2026-09-28): the set rule is no longer stated. */
  it('says nothing about sets until there is one to read', async () => {
    const dialog = await openNexus();
    expect(dialog.textContent).not.toMatch(/No set\./);
    expect(dialog.textContent).not.toMatch(/Fill all/);
    expect(within(dialog).queryByTestId('set-readout')).toBeNull();
  });

  it('opens at the broad width, which is what the two columns are for', async () => {
    const dialog = await openNexus();
    // `Modal`'s `broad`: 60rem. At 52 the played Nexus window is 705px tall, 17 more than a
    // 1280x720 frame has. See the note on `broad` for the rest of the measurements.
    expect(dialog.className).toContain('max-w-[60rem]');
  });

  /*
   * Drawn, not struck, counted the way `e2e/drawn-chrome.spec.ts` counts it on the four screens
   * that were restyled before this one: `DrawnFace` puts an inline SVG inside the control, so a
   * button that lost it still renders and still passes every other assertion in this file.
   */
  it('draws its controls with a pen rather than stamping them out of brass', async () => {
    const dialog = await openNexus();
    for (const name of ['Queue upgrade', 'Close']) {
      const control = within(dialog).getByRole('button', { name });
      expect(
        control.querySelectorAll('svg path').length,
        `${name} is not drawn`,
      ).toBeGreaterThanOrEqual(4);
    }
  });
});

/**
 * Max level: the window says so, and nothing on it is dimmed for it (maintainer, 2026-09-22).
 *
 * The finished panel used to read as a closed shutter: an ink heading and no lift, while the
 * live panels beside it kept their brass. That went with the dark sheet. The maintainer's note
 * is that a building window should be one lit material at every level and say "Max level
 * reached" in words, so the *only* difference a ceiling makes now is what the panel is called.
 *
 * What is still worth pinning is the wording, because it is a real distinction the code has to
 * keep: "No order to give" is the heading for a plot waiting on the Nexus, and a structure at
 * the end of its content is not waiting for anything.
 */
describe('a structure at the top of its ladder', () => {
  const maxedBase: Base = {
    ...base,
    buildings: [
      { id: 'b-nexus', kind: 'nexus', level: BUILDING_MAX_LEVEL, modifications: [] },
      // Held down by the Nexus rather than finished: the control for every assertion below.
      { id: 'b-generator', kind: 'generator', level: 6, modifications: [] },
    ],
  };

  function stubMaxed(): void {
    const reply = (body: unknown) =>
      Promise.resolve({
        headers: new Headers(),
        ok: true,
        status: 200,
        statusText: '',
        json: () => Promise.resolve(body),
      } as Response);
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/overseer/me')) return reply(crewStanding());
      if (path.endsWith('/me')) return reply({ ...me, base: maxedBase });
      if (path.includes('/base/')) return reply({ base: maxedBase });
      throw new Error(`unstubbed request: ${path}`);
    });
  }

  async function open(name: string): Promise<HTMLElement> {
    stubMaxed();
    renderDistrict();
    await waitFor(() => expect(plot(name)).toBeInTheDocument());
    fireEvent.click(plot(name));
    return screen.findByRole('dialog');
  }

  /** The panel whose heading is `title`, found through the heading so the match cannot slide. */
  const panelTitled = (dialog: HTMLElement, title: string): HTMLElement => {
    const heading = within(dialog).getByRole('heading', { name: title });
    const panel = heading.closest('section');
    if (!panel) throw new Error(`the heading "${title}" is not inside a panel`);
    return panel;
  };

  it('says max level reached rather than no order to give', async () => {
    const dialog = await open('The Nexus');
    expect(within(dialog).getByRole('heading', { name: 'Max level reached' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: 'No order to give' })).toBeNull();
    expect(within(dialog).getByTestId('structure-ceiling')).toHaveTextContent(
      `LEVEL ${BUILDING_MAX_LEVEL}, WHICH IS AS HIGH AS IT GOES`,
    );
  });

  it('leaves every panel in the window lit, the finished one included', async () => {
    const dialog = await open('The Nexus');
    const panels = [...dialog.querySelectorAll('section')];
    expect(panels.length).toBeGreaterThan(1);
    for (const panel of panels) {
      const heading = panel.querySelector('h3')?.textContent ?? '(unnamed)';
      // No panel is dimmed and none carries the old marker: one material, one lift.
      expect(panel.className, `${heading} lost its lift`).toContain('shadow-panel');
      expect(panel.dataset['spent'], `${heading} is still marked spent`).toBeUndefined();
      expect(panel.className, `${heading} is on the dark sheet`).toContain('card-paper-lit');
    }
  });

  it('keeps the finished panel heading in brass, like every other', async () => {
    const dialog = await open('The Nexus');
    expect(within(dialog).getByRole('heading', { name: 'Max level reached' }).className).toContain(
      'text-brass-300',
    );
    expect(within(dialog).getByRole('heading', { name: 'What it gives' }).className).toContain(
      'text-brass-300',
    );
  });

  /**
   * The control, and the reason the treatment is keyed on the ceiling rather than on
   * `nextLevel === null`. A Generator that still has a rung to buy is obviously live.
   */
  it('leaves a plot with a rung left looking live', async () => {
    const dialog = await open('The Generator');
    expect(within(dialog).queryByRole('heading', { name: 'Max level reached' })).toBeNull();
    const waiting = panelTitled(dialog, 'Upgrade to level 7');
    expect(waiting.className).toContain('shadow-panel');
  });
});

/**
 * The control that matters, and the one the first pass of these tests missed.
 *
 * A structure **held down by the Nexus** has no order to give either: `nextLevel` is null, the
 * panel falls into the same branch, and the only thing separating it from a finished structure is
 * the `maxed` flag. Written out as its own district because it cannot exist in the one above: a
 * maxed Nexus caps nothing.
 *
 * Found by mutation. Turning the `CAPPED BY THE NEXUS` arm to `maxed: true` left all 1048 tests
 * green, because every "waiting" case in the suite above still had a rung to buy and so never
 * reached the branch at all. The distinction the whole change rests on was untested.
 */
describe('a structure held down by the Nexus', () => {
  const heldBase: Base = {
    ...base,
    buildings: [
      { id: 'b-nexus', kind: 'nexus', level: 5, modifications: [] },
      // Exactly at the rung a Nexus of 5 signs for (7), and nowhere near the end of its own
      // content (20). Both halves matter: one rung lower and the panel has an order to give, and
      // at 20 it would be finished rather than held.
      { id: 'b-generator', kind: 'generator', level: 7, modifications: [] },
    ],
  };

  it('has no order to give, and is not spent', async () => {
    const reply = (body: unknown) =>
      Promise.resolve({
        headers: new Headers(),
        ok: true,
        status: 200,
        statusText: '',
        json: () => Promise.resolve(body),
      } as Response);
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/overseer/me')) return reply(crewStanding());
      if (path.endsWith('/me')) return reply({ ...me, base: heldBase });
      if (path.includes('/base/')) return reply({ base: heldBase });
      throw new Error(`unstubbed request: ${path}`);
    });
    renderDistrict();
    await waitFor(() => expect(plot('The Generator')).toBeInTheDocument());
    fireEvent.click(plot('The Generator'));
    const dialog = await screen.findByRole('dialog');

    // The premise: this really is the no-next-level branch, not a plot with a rung left.
    expect(within(dialog).getByTestId('structure-ceiling')).toHaveTextContent(
      'CAPPED BY THE NEXUS',
    );
    // ...and it is the *waiting* half of that branch, which is what must stay live.
    expect(within(dialog).queryByRole('heading', { name: 'Max level reached' })).toBeNull();
    const panel = within(dialog)
      .getByRole('heading', { name: 'No order to give' })
      .closest('section');
    expect(panel?.dataset['spent']).toBeUndefined();
    expect(panel?.className).toContain('shadow-panel');
  });
});

/*
 * A Garage at its tenth and last rung that admin mode raised past what its Nexus and neighbours
 * would sign for. It is finished, and the window has to say so before it lists what it is waiting
 * on, in the order the server refuses in. Its last two brackets open at 10 (maintainer,
 * 2026-09-29), so all three are open and there is no next slot to promise.
 */
describe('a ten-rung structure at its ceiling', () => {
  const garageAt = (level: number): Base => ({
    ...base,
    buildings: [
      { id: 'b-nexus', kind: 'nexus', level: 12, modifications: [] },
      { id: 'b-garage', kind: 'garage', level, modifications: [] },
    ],
  });

  async function openGarage(garageBase: Base): Promise<HTMLElement> {
    const reply = (body: unknown) =>
      Promise.resolve({
        headers: new Headers(),
        ok: true,
        status: 200,
        statusText: '',
        json: () => Promise.resolve(body),
      } as Response);
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/overseer/me')) return reply(crewStanding());
      if (path.endsWith('/me')) return reply({ ...me, base: garageBase });
      if (path.includes('/base/')) return reply({ base: garageBase });
      throw new Error(`unstubbed request: ${path}`);
    });
    renderDistrict();
    await waitFor(() => expect(plot('The Garage')).toBeInTheDocument());
    fireEvent.click(plot('The Garage'));
    return screen.findByRole('dialog');
  }

  it('says both of its last two slots open at level 10', async () => {
    const dialog = await openGarage(garageAt(7));
    expect(dialog).toHaveTextContent('The next two slots open at level 10.');
    for (const index of [1, 2]) {
      expect(within(dialog).getByTestId(`slot-garage-${index}`)).toHaveTextContent(
        'LockedLevel 10',
      );
    }
  });

  it('reads as finished, and promises no slot past level 10', async () => {
    const dialog = await openGarage(garageAt(10));

    expect(within(dialog).getByTestId('structure-ceiling')).toHaveTextContent(
      'LEVEL 10, WHICH IS AS HIGH AS IT GOES',
    );
    expect(dialog).not.toHaveTextContent(/next slots? opens?/i);
    expect(dialog).toHaveTextContent('Modifications: 0 of 3 slots');
    for (const index of [0, 1, 2]) {
      expect(within(dialog).getByTestId(`slot-door-garage-${index}`)).toBeInTheDocument();
    }
    expect(dialog).not.toHaveTextContent(/level 20/i);
  });
});

/*
 * Bug pass, 2026-10-02: the burn's price follows the Generator and the store follows the
 * Apothecary, so a Generator ahead of its Apothecary asks more oil than the store can ever hold,
 * and the button said "Short of oil" to a crew that could wait for ever.
 */
describe('a burn priced past the stores', () => {
  it('says the stores are too small, not that the crew is short', async () => {
    const outgrown: Base = {
      ...base,
      buildings: [
        { id: 'b-nexus', kind: 'nexus', level: 12, modifications: [] },
        { id: 'b-generator', kind: 'generator', level: 12, modifications: [] },
        { id: 'b-apothecary', kind: 'apothecary', level: 1, modifications: [] },
      ],
    };
    const ceilings = storeCeilings(outgrown.buildings);
    const oil = buildBoostOilCost(outgrown.buildings);
    expect(oil, 'fixture: the burn must outgrow the store').toBeGreaterThan(ceilings.oil);
    const full: Base = { ...outgrown, resources: { ...outgrown.resources, oil: ceilings.oil } };
    const reply = (body: unknown) =>
      Promise.resolve({
        headers: new Headers(),
        ok: true,
        status: 200,
        statusText: '',
        json: () => Promise.resolve(body),
      } as Response);
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/overseer/me')) return reply(crewStanding());
      if (path.endsWith('/me')) return reply({ ...me, base: full });
      if (path.includes('/base/')) return reply({ base: full });
      throw new Error(`unstubbed request: ${path}`);
    });
    renderDistrict();
    await waitFor(() => expect(plot('The Generator')).toBeInTheDocument());
    fireEvent.click(plot('The Generator'));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByTestId('build-boost-buy')).toHaveTextContent('Stores too small');
    expect(within(dialog).getByTestId('build-boost').getAttribute('data-tip')).toContain(
      `hold at most ${ceilings.oil.toLocaleString()} oil`,
    );
  });
});
