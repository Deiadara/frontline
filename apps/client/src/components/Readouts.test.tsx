import { MAX_NOTORIETY, describeNotorietyGrant, storageCapacity } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  DistrictLevelChip,
  InfamyChip,
  LEVEL_LADDER_ROUTE,
  NOTORIETY_LADDER_ROUTE,
} from './Meters';
import { fillFraction, ResourceChip, STORAGE_WARN_AT } from './Resources';

/**
 * The HUD is a row of numbers with no words on it, and everything that makes those numbers *mean*
 * something is one hover away. That is a deliberate trade: the compact form is what keeps the bar
 * to one line over the artwork, but it only pays off if the hover actually carries the missing
 * half, so this is where the missing half is pinned.
 */

describe('the stockpile ceiling', () => {
  it('fills in proportion to how close the Apothecary is to full', () => {
    expect(fillFraction(0, 1000)).toBe(0);
    expect(fillFraction(500, 1000)).toBe(0.5);
    expect(fillFraction(1000, 1000)).toBe(1);
  });

  /**
   * Raids and mission pay are deliberately *not* clamped to storage, so a district can legitimately
   * sit over its own ceiling, and a bar that rendered 140% would run out of its own track.
   */
  it('never runs past the end of the bar, however far over the ceiling a raid puts you', () => {
    expect(fillFraction(4000, 1000)).toBe(1);
    expect(fillFraction(-50, 1000)).toBe(0);
  });

  /** No ceiling means nothing to draw: an unknown capacity must not read as "full". */
  it('reads empty rather than full when there is no ceiling to show', () => {
    expect(fillFraction(900, undefined)).toBe(0);
    expect(fillFraction(900, 0)).toBe(0);
  });

  it('draws the bar only where there is a ceiling', () => {
    const { rerender } = render(<ResourceChip kind="oil" value={320} capacity={2000} />);
    expect(screen.getByTestId('resource-fill-oil')).toBeInTheDocument();

    rerender(<ResourceChip kind="oil" value={320} />);
    expect(screen.queryByTestId('resource-fill-oil')).not.toBeInTheDocument();
  });

  /**
   * The ceiling is the Apothecary's, and it is supposed to *grow* with it: otherwise the bar is
   * reporting a constant and the structure's one mechanic does nothing.
   */
  it('rises with the Apothecary, which is the whole point of the structure', () => {
    const at = (level: number) =>
      storageCapacity([{ id: 'a', kind: 'apothecary', level, modifications: [] }]);
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(10)).toBeGreaterThan(at(5));
    // Compounding, not linear: the late levels have to be worth their price.
    expect(at(10) - at(9)).toBeGreaterThan(at(2) - at(1));
  });
});

describe('what a resource chip says when you look at it', () => {
  const openOil = () => {
    render(<ResourceChip kind="oil" value={3200} capacity={20_000} />);
    fireEvent.mouseEnter(screen.getByTestId('resource-hover-oil'));
    return screen.getByRole('tooltip');
  };

  it('names the resource and shows the stock against its ceiling', () => {
    const card = openOil();
    expect(within(card).getByText('Oil')).toBeInTheDocument();
    expect(within(card).getByText(/3,200/)).toBeInTheDocument();
    expect(within(card).getByText(/20,000/)).toBeInTheDocument();
  });

  /** Keyboard, not just pointer: a card only a mouse can open is a card half of players never see. */
  it('opens on focus as well as on hover', () => {
    render(<ResourceChip kind="caps" value={10} capacity={100} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByTestId('resource-hover-caps'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  /**
   * A full stockpile is a silent, continuous loss: production stops dead while raid loot still
   * lands, so the one state worth shouting about is the one just before it.
   *
   * Said by the bar turning red rather than by a sentence, which is how every other game in this
   * genre says it and the reason the prose came out of these cards. The assertion is on the fill's
   * colour class for exactly that reason: it is the whole signal now.
   */
  it('turns the fill red as the ceiling comes up, and not before', () => {
    const fill = () =>
      screen.getByRole('tooltip').querySelector('span[style*="width"]')?.className ?? '';

    const { unmount } = render(<ResourceChip kind="scrap" value={100} capacity={1000} />);
    fireEvent.focus(screen.getByTestId('resource-hover-scrap'));
    expect(fill()).not.toContain('bg-oxblood-300');
    unmount();

    render(<ResourceChip kind="scrap" value={STORAGE_WARN_AT * 1000 + 1} capacity={1000} />);
    fireEvent.focus(screen.getByTestId('resource-hover-scrap'));
    expect(fill()).toContain('bg-oxblood-300');
  });

  /**
   * And nothing else. The card is the figure, the ceiling and the bar: what a player opens one for
   * is the number, and the three paragraphs that used to follow it explained a mechanic over the
   * top of the thing they were reading.
   */
  it('carries no explanation of what the material is for', () => {
    render(<ResourceChip kind="oil" value={400} capacity={1000} />);
    fireEvent.focus(screen.getByTestId('resource-hover-oil'));
    const card = screen.getByRole('tooltip');
    expect(card.textContent).not.toMatch(/spent on|comes from|apothecary/i);
  });
});

describe('what the standing chips say when you look at them', () => {
  /**
   * Both chips are controls now, so both need a router. Mounting one bare throws inside
   * `useNavigate` before an assertion can run, which reports as a broken chip rather than as a
   * missing provider.
   */
  const mount = (ui: ReactElement) =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/game']}>
          <Routes>
            <Route path="/game" element={ui} />
            <Route path={`/game/${LEVEL_LADDER_ROUTE}`} element={<p>the level ladder</p>} />
            <Route path={`/game/${NOTORIETY_LADDER_ROUTE}`} element={<p>the notoriety ladder</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it('spells the district level out as a bar with both figures on it', () => {
    mount(<DistrictLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    fireEvent.focus(screen.getByTestId('level-hover'));
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText('Level 7')).toBeInTheDocument();
    // The reading and its ceiling are separate elements in the window, so the whitespace between
    // them is a layout detail. What matters is that both numbers are there.
    expect(within(card).getByText('1,240')).toBeInTheDocument();
    expect(card.textContent).toContain('2,800');
  });

  /**
   * The XP is the district's, not the crew's (maintainer, 2026-09-17).
   *
   * Pinned on the accessible name rather than on anything drawn, because at most widths the chip
   * is a glyph and a number with no word on it at all: the label is the only place a player who
   * cannot see it is ever told what the reading is of.
   */
  it('calls the level a district level, and never a crew one', () => {
    mount(<DistrictLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    const trigger = screen.getByTestId('level-hover');
    expect(trigger).toHaveAccessibleName('District level 7');

    fireEvent.focus(trigger);
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText('Your district')).toBeInTheDocument();
    expect(card.textContent).not.toMatch(/crew/i);
  });

  /**
   * The figure and the bar. No sentence about what a level is worth or what pays for one: the
   * prose came out of every readout in the standing bar, and the footnote that is left is a door
   * sign rather than an explanation of the mechanic.
   */
  it('narrates nothing under the XP bar', () => {
    mount(<DistrictLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    fireEvent.focus(screen.getByTestId('level-hover'));
    const card = screen.getByRole('tooltip');
    expect(card.textContent).not.toMatch(/what pays it|recruit slot|every level/i);
  });

  /**
   * The graphic is drawn rather than a rounded rectangle (maintainer, 2026-09-17).
   *
   * Asserted on the track being an SVG whose width moves with the reading, which is the part that
   * would silently come back if somebody swapped the drawing for a `<span>` with a background
   * colour on it. A class-name assertion would pass on a flat bar that happened to keep the name.
   */
  it('draws the XP meter with a pen, and fills it in proportion', () => {
    mount(<DistrictLevelChip level={7} xpIntoLevel={700} xpToNextLevel={2800} />);
    fireEvent.focus(screen.getByTestId('level-hover'));
    const meter = within(screen.getByRole('tooltip')).getByTestId('level-card-meter');

    expect(meter.querySelector('feTurbulence')).not.toBeNull();
    expect(meter.querySelector('feDisplacementMap')).not.toBeNull();
    // A quarter of the way in, on a 116-unit track drawn inside a 120-unit box.
    expect(meter.querySelector('rect')?.getAttribute('width')).toBe('29');
  });

  /** A chip that leads somewhere has to actually lead there when it is pressed. */
  it('opens the level ladder when the chip is clicked', () => {
    mount(<DistrictLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    expect(screen.queryByText('the level ladder')).toBeNull();

    fireEvent.click(screen.getByTestId('level-hover'));
    expect(screen.getByText('the level ladder')).toBeInTheDocument();
  });

  it('opens the notoriety ladder when the infamy chip is clicked', () => {
    mount(<InfamyChip infamy={40_000} notoriety={4} />);
    expect(screen.queryByText('the notoriety ladder')).toBeNull();

    fireEvent.click(screen.getByTestId('infamy-hover'));
    expect(screen.getByText('the notoriety ladder')).toBeInTheDocument();
  });

  /**
   * The chip beside it says `40K` because it is 58px wide. The card is where the exact figure
   * lives, and it printed `40000`: the one number in that window without separators, beside a
   * price that had them.
   */
  it('groups the exact infamy figure the compact chip is hiding', () => {
    mount(<InfamyChip infamy={40_000} notoriety={4} />);
    fireEvent.focus(screen.getByTestId('infamy-hover'));
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText('40,000')).toBeInTheDocument();
    expect(card.textContent).not.toContain('40000');
  });

  /**
   * A rank has to say what it buys, on the one screen where a rank is bought.
   *
   * §D7 gave every rung of the ladder a grant (`economy/renown.ts`), and the ladder used to gate
   * nothing above `Marked`: a player at rank 8 was being asked for a fortune in infamy in exchange
   * for a different word on a chip. The grants are folded into the crew's standing by the server
   * and are otherwise entirely invisible, so this card is where they are stated.
   */
  it('says what the next rank pays, and not just what it costs', () => {
    const at = 7;
    mount(<InfamyChip infamy={1_000_000} notoriety={at} />);
    fireEvent.focus(screen.getByTestId('infamy-hover'));
    const grant = within(screen.getByRole('tooltip')).getByTestId('notoriety-grant');
    const promised = describeNotorietyGrant(at + 1);
    expect(promised.length, 'the rung under test pays nothing').toBeGreaterThan(0);
    for (const line of promised) expect(within(grant).getByText(line)).toBeInTheDocument();
  });

  /** The top of the ladder has no rung above it, so it promises nothing rather than an empty box. */
  it('promises nothing at the top of the ladder', () => {
    mount(<InfamyChip infamy={1_000_000} notoriety={MAX_NOTORIETY} />);
    fireEvent.focus(screen.getByTestId('infamy-hover'));
    expect(screen.queryByTestId('notoriety-grant')).toBeNull();
  });

  /** Both cards are the drawn material now, not the lit console frame the resources still use. */
  it('draws both standing cards on paper', () => {
    mount(<DistrictLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    fireEvent.focus(screen.getByTestId('level-hover'));
    expect(screen.getByTestId('level-card').className).toContain('card-paper');

    mount(<InfamyChip infamy={40_000} notoriety={4} />);
    fireEvent.focus(screen.getByTestId('infamy-hover'));
    expect(screen.getByTestId('infamy-card').className).toContain('card-paper');
  });

  it('closes again when the pointer leaves', () => {
    mount(<DistrictLevelChip level={3} xpIntoLevel={10} xpToNextLevel={600} />);
    const trigger = screen.getByTestId('level-chip');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
