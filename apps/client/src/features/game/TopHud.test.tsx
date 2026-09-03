import {
  notorietyTier,
  OVERSEER_PRESETS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  startingEconomy,
  type Base,
  type EconomyState,
  type Resources,
  type Overseer,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopHud } from './TopHud';
import { useSession } from '../../store/session';

const [preset] = OVERSEER_PRESETS;
if (!preset) throw new Error('expected at least one overseer preset');

const overseer: Overseer = {
  id: 'ov-1',
  name: preset.name,
  archetype: preset.archetype,
  portraitId: preset.portraitId,
  bio: preset.bio,
  attributes: preset.attributes,
  perks: preset.perks,
};

const economy: EconomyState = startingEconomy('2026-08-13T09:30:00.000Z');

/** The crew the bar names. Only the id and the name are read here; the rest is schema ballast. */
const base = {
  id: 'base-1',
  name: 'The Ninth Street Reclamation Company',
  // The sign in the middle of the bar reads the district's real name off the map, so the fixture
  // has to name one that is actually on it.
  districtId: 'neon-docks',
  level: 7,
  // The bar reads the level chip straight off these two, so the fixture has to carry them.
  progression: { xpIntoLevel: 640 },
  economy,
} as unknown as Base;

/** A real Apothecary, because the stockpile ceiling is read off what is standing. */
const buildings = [
  {
    id: 'b-apothecary',
    kind: 'apothecary' as const,
    level: 4,
    modifications: [],
    damage: 0,
  },
];

// Inside a router *and* a query client: the identity on the right is a link, and the infamy chip
// carries the §D7 Upgrade Tier control, which is a mutation. Neither degrades outside its provider.
const renderHud = (
  override: Partial<EconomyState> = {},
  resources: Resources = STARTING_RESOURCES,
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TopHud
          overseer={overseer}
          base={{ ...base, economy: { ...economy, ...override } }}
          resources={resources}
          economy={{ ...economy, ...override }}
          buildings={buildings}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/**
 * §A1: the allegiance's name, and the one control that changes it.
 *
 * It used to be a plaque on the district's own title bar, which is the wrong screen for it twice
 * over: the name belongs to the player rather than to one place, and the bar cost the painting
 * forty pixels of height everywhere it was drawn. Stubbed at `fetch` rather than at the hook, so
 * what is asserted is the body that goes on the wire and the fact that the response's own crew is
 * what the bar re-renders from.
 */
describe('renaming the crew from the standing bar', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    useSession.setState({ token: 'test-token', user: null });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: '',
        json: () => Promise.resolve({ base: { ...base, name: 'Vermilion' } }),
      } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('names the crew, and offers to rename it', async () => {
    renderHud();

    // The crew's own name and nothing else: the district's name was on here for a while and made
    // the smaller of the two read as a subtitle of the larger. The plaque is not an `<h1>` either:
    // the bar carries no page heading, and the one on each screen behind it is the page's own.
    const plaque = screen.getByTestId('district-plaque');
    expect(plaque).toHaveTextContent(base.name);

    // The whole plaque is the control, so it is named for the thing it *is* plus the thing it
    // does, which is what a player reads on hover and what a screen reader announces.
    fireEvent.click(screen.getByRole('button', { name: /rename your district/i }));
    fireEvent.change(screen.getByLabelText('District name'), { target: { value: 'Vermilion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/base/district-name'),
        expect.objectContaining({ body: JSON.stringify({ name: 'Vermilion' }) }),
      ),
    );
  });
});

describe('TopHud', () => {
  it('shows every one of the six resources with its amount (GDD §D1-§D6)', () => {
    renderHud();

    // Asserted against the domain rather than a literal, so §D5b's planks could not be added to
    // the stockpile and quietly left off the bar. The count is pinned as well, because a loop over
    // an empty list passes.
    expect(RESOURCE_KEYS).toHaveLength(6);
    for (const key of RESOURCE_KEYS) {
      // The chip's name, not a word printed beside it: the bar has to fit six resources, two
      // meters and an identity on one line over the artwork, so the label is what the icon *means*
      // rather than something taking width next to it.
      const chip = screen.getByTestId(`resource-chip-${key}`);
      expect(chip).toBeInTheDocument();
      expect(within(chip).getByText(String(STARTING_RESOURCES[key]))).toBeInTheDocument();
      // The ceiling is drawn as a fill, which is the half of "how much do I have" a bare number
      // cannot answer: whether the next hour of production has anywhere to go.
      //
      // Caps are the exception, and they are the reason this is a branch rather than a loop body:
      // they have no ceiling anywhere in the game, so a bar under them would be a track that can
      // never fill. Both halves asserted, because a chip that lost its bar by accident and a
      // currency that grew one both have to fail here.
      const fill = within(chip).queryByTestId(`resource-fill-${key}`);
      if (key === 'caps') expect(fill, 'caps have no ceiling to draw').toBeNull();
      else expect(fill, `${key} should show how full its shelf is`).toBeInTheDocument();
    }
  });

  /**
   * The digits, not a rounded stand-in.
   *
   * `125K` was the reading for a long time, and it cannot answer the question the stockpile is
   * looked at for: 125,000 and 125,499 drew identically, so a player working out whether the next
   * upgrade was affordable had to hover every chip to find out. Pinned at magnitudes where the two
   * spellings differ: every starting value is under 10,000 and reads the same either way, so a
   * fixture of starting resources cannot fail this however the chip is written.
   */
  it('spells out the full amount on every chip, not a rounded one', () => {
    const stockpile: Resources = {
      caps: 125_000,
      supplies: 48_500,
      oil: 32_100,
      scrap: 96_750,
      planks: 96_010,
      highQualityMetal: 12_345,
    };
    renderHud({}, stockpile);

    for (const key of RESOURCE_KEYS) {
      const chip = screen.getByTestId(`resource-chip-${key}`);
      expect(
        within(chip).getByText(stockpile[key].toLocaleString()),
        `${key} should read in full`,
      ).toBeInTheDocument();
    }
    // ...and nothing on the bar is still speaking in thousands. The loop above passes on a chip
    // that renders both spellings; this fails on it.
    expect(screen.getByTestId('resource-chip-caps')).not.toHaveTextContent(/\d+(\.\d+)?[KM]\b/);
  });

  /**
   * The three shelves, as the player sees them.
   *
   * The Apothecary holds three times as much scrap as high-quality metal, so two chips holding the
   * same amount must not read as equally full. Asserted off the rendered widths rather than off
   * `STORAGE_SHARES`, which would just be the table agreeing with itself.
   */
  it('draws a shorter shelf for the scarce materials than for the bulk ones', () => {
    renderHud(
      {},
      { ...STARTING_RESOURCES, scrap: 100, highQualityMetal: 100, oil: 100, planks: 100 },
    );

    const width = (key: string): number =>
      Number.parseFloat(screen.getByTestId(`resource-fill-${key}`).style.width.replace('%', ''));

    expect(width('highQualityMetal')).toBeGreaterThan(width('scrap'));
    expect(width('oil')).toBeGreaterThan(width('planks'));
  });

  it('shows the crew level and the infamy wallet (§I, §D7)', () => {
    renderHud();

    expect(screen.getByTestId('level-chip')).toBeInTheDocument();
    expect(screen.getByTestId('infamy-chip')).toBeInTheDocument();
  });

  /**
   * §D7: the rank is beside the points, and it is the half that does not fall.
   *
   * The pair is the whole rework: a player who saw only the number drop after buying something
   * would read it as having lost standing, which is exactly what used to happen.
   */
  it('names the rank the crew holds next to the points it has', () => {
    renderHud({ infamy: 1200, notoriety: 8 });

    expect(screen.getByTestId('notoriety-tier')).toHaveTextContent('Feared');
    expect(screen.getByTestId('infamy-chip')).toHaveTextContent('1,200');
  });

  /**
   * The two doors that stayed up here, between the resources rather than on the bottom row.
   *
   * Settings is no longer one of them: it is pinned to the right of the scenery switcher now,
   * which is the board's placement and closer to the hand. What is left is the fight you have
   * called and who is on the road, both wanted from wherever a player is standing.
   */
  it('puts the Battles and Actions doors in the standing bar, and not Settings', () => {
    renderHud();

    expect(screen.getByTestId('hud-battles')).toHaveAttribute('href', '/game/battles');
    expect(screen.getByTestId('hud-actions')).toHaveAttribute('href', '/game/actions');
    expect(screen.queryByTestId('hud-settings')).toBeNull();
  });

  /**
   * §I: the level is on every screen for the same reason infamy is. It gates what the crew may
   * hold, so a player has to be able to see how close the next one is without going to look.
   */
  it('reads the level and its progress off the base, not off a second copy', () => {
    renderHud();
    const chip = screen.getByTestId('level-chip');
    expect(chip).toHaveTextContent(String(base.level));
  });
});

/**
 * The standing bar at its widest legal values.
 *
 * jsdom has no layout engine, so these cannot answer "do two boxes overlap": that question lives
 * in `visual.spec.ts`, in a browser, and is the one that actually caught the board's screenshot.
 * What these pin is the rule underneath it, which a browser test cannot state as clearly: **a
 * readout is an instrument and must not size itself to its reading.**
 *
 * Every figure in the bar is `tabular-nums` inside a fixed-width column, and every plate but the
 * identity is a fixed width. Those two facts are what make the pixel test pass, so losing either
 * one should fail here first and cheaply.
 */
/** The chain from `el` up to (and including) `root`, so a class can be looked for on either. */
function ancestorsWithin(root: HTMLElement, el: Element): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let cursor = el.parentElement;
  while (cursor && root.contains(cursor)) {
    chain.push(cursor);
    cursor = cursor.parentElement;
  }
  return chain;
}

describe('the standing bar does not size itself to its contents', () => {
  const HUGE: Resources = {
    caps: 9_999_999,
    supplies: 9_999_999,
    oil: 9_999_999,
    scrap: 9_999_999,
    highQualityMetal: 9_999_999,
    planks: 9_999_999,
  };

  /** The longest rank in the ladder, found rather than typed, so a retune cannot outdate it. */
  const worstTier = (() => {
    let worst = { notoriety: 0, tier: '' };
    for (let n = 0; n < 60; n += 1) {
      const tier = notorietyTier(n);
      if (tier.length > worst.tier.length) worst = { notoriety: n, tier };
    }
    return worst;
  })();

  /**
   * Six digits in full, and a magnitude above that.
   *
   * This asserted the opposite until the board settled it: every figure spelled out, on the
   * grounds that a chip which switches form at a threshold is a chip whose width depends on its
   * reading. That reasoning was wrong in its second half. `compactFigure` is bounded, so both
   * branches fit the same seven-character column, and spelling out seven digits cost the column a
   * whole rem it did not have: the stockpile was running over the identity plaque.
   *
   * So the rule is unchanged and the implementation of it is not: the box does not move, and what
   * gives is precision rather than width.
   */
  it('prints six digits in full and larger figures as a magnitude', () => {
    const { unmount } = renderHud({}, HUGE);
    for (const key of RESOURCE_KEYS) {
      expect(
        within(screen.getByTestId(`resource-chip-${key}`)).getByText('10M'),
      ).toBeInTheDocument();
    }
    unmount();

    const SIX = Object.fromEntries(
      RESOURCE_KEYS.map((key) => [key, 999_999]),
    ) as unknown as Resources;
    renderHud({}, SIX);
    for (const key of RESOURCE_KEYS) {
      expect(
        within(screen.getByTestId(`resource-chip-${key}`)).getByText('999,999'),
        `${key} should still be spelled out at six digits`,
      ).toBeInTheDocument();
    }
  });

  it('sets every figure in a fixed column with tabular figures', () => {
    renderHud({ infamy: 9_999_999 }, HUGE);
    const figures = [
      ...RESOURCE_KEYS.map((key) => screen.getByTestId(`resource-chip-${key}`)),
      screen.getByTestId('level-chip'),
      screen.getByTestId('infamy-chip'),
    ];
    for (const chip of figures) {
      const numeric = [...chip.querySelectorAll('span')].filter((el) =>
        el.className.includes('tabular-nums'),
      );
      expect(numeric.length, `${chip.dataset.testid} has no tabular figure`).toBeGreaterThan(0);
      // Each figure sits in a column of reserved width, so the digits cannot push the plate wider
      // as they grow. The width may sit on the figure or on the wrapper holding it and its label.
      for (const figure of numeric) {
        const reserved = [figure, ...ancestorsWithin(chip, figure)].some((el) =>
          /\bw-\[/.test(el.className),
        );
        expect(reserved, `${chip.dataset.testid} lets "${figure.textContent}" size the plate`).toBe(
          true,
        );
      }
    }
  });

  it('keeps the rank in a fixed plate, however long the rank is', () => {
    renderHud({ notoriety: worstTier.notoriety });
    const rank = screen.getByTestId('notoriety-tier');

    expect(rank).toHaveTextContent(worstTier.tier);
    expect(worstTier.tier.length, 'the ladder should hold a genuinely long rank').toBeGreaterThan(
      12,
    );
    // Fixed width and allowed to wrap: two short lines in a plate that never moves, rather than
    // one long line in a plate that does.
    expect(rank.className).toMatch(/\bw-\[/);
    expect(rank.className).not.toMatch(/\bwhitespace-nowrap\b/);
  });

  /** The one plate that is allowed to grow, because its content is something the player typed. */
  it('lets only the identity plaque size itself', () => {
    renderHud();
    expect(screen.getByTestId('district-plaque').className).not.toMatch(/\bw-\[/);
  });
});
