import { storageCapacity } from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CrewLevelChip } from './Meters';
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
      storageCapacity([
        { id: 'a', kind: 'apothecary', level, modifications: [], damage: 0, fortification: 0 },
      ]);
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
  it('spells the crew level out as a bar with both figures on it', () => {
    render(<CrewLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    fireEvent.focus(screen.getByTestId('level-hover'));
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText('Level 7')).toBeInTheDocument();
    // The reading and its ceiling are separate elements in the window, so the whitespace between
    // them is a layout detail. What matters is that both numbers are there.
    expect(within(card).getByText('1,240')).toBeInTheDocument();
    expect(card.textContent).toContain('2,800');
  });

  /** The figure and the bar. No sentence about what a level is worth or what pays for one. */
  it('narrates nothing under the XP bar', () => {
    render(<CrewLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    fireEvent.focus(screen.getByTestId('level-hover'));
    const card = screen.getByRole('tooltip');
    expect(card.textContent).not.toMatch(/what pays it|recruit slot|every level/i);
  });

  it('closes again when the pointer leaves', () => {
    render(<CrewLevelChip level={3} xpIntoLevel={10} xpToNextLevel={600} />);
    const trigger = screen.getByTestId('level-chip');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
