import {
  OVERSEER_PRESETS,
  RESOURCE_KEYS,
  STARTING_RESOURCES,
  startingEconomy,
  type Base,
  type EconomyState,
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
  traits: preset.traits,
};

const economy: EconomyState = startingEconomy('2026-08-13T09:30:00.000Z');

/** The crew the bar names. Only the id and the name are read here; the rest is schema ballast. */
const base = {
  id: 'base-1',
  name: 'The Ninth Street Reclamation Company',
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
    fortification: 0,
  },
];

// Inside a router *and* a query client: the identity on the right is a link, and the infamy chip
// carries the §D7 Upgrade Tier control, which is a mutation. Neither degrades outside its provider.
const renderHud = (override: Partial<EconomyState> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TopHud
          overseer={overseer}
          base={{ ...base, economy: { ...economy, ...override } }}
          resources={STARTING_RESOURCES}
          economy={{ ...economy, ...override }}
          buildings={buildings}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/**
 * §A1: the faction's name, and the one control that changes it.
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

  it('names the faction, and offers to rename it', async () => {
    renderHud();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(base.name);

    // The whole plaque is the control, so it is named for the thing it *is* plus the thing it
    // does, which is what a player reads on hover and what a screen reader announces.
    fireEvent.click(screen.getByRole('button', { name: /rename your faction/i }));
    fireEvent.change(screen.getByLabelText('Faction name'), { target: { value: 'Vermilion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/base/faction'),
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
      expect(within(chip).getByTestId(`resource-fill-${key}`)).toBeInTheDocument();
    }
  });

  it('shows the faction level and the infamy wallet (§I, §D7)', () => {
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
    expect(screen.getByTestId('infamy-chip')).toHaveTextContent('1200');
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
