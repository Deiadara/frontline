import { storageCapacity } from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FactionLevelChip } from './Meters';
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
   */
  it('warns when the ceiling is close, and does not before', () => {
    const { unmount } = render(<ResourceChip kind="scrap" value={100} capacity={1000} />);
    fireEvent.focus(screen.getByTestId('resource-hover-scrap'));
    expect(screen.getByRole('tooltip').textContent).not.toMatch(/nearly full/i);
    unmount();

    render(<ResourceChip kind="scrap" value={STORAGE_WARN_AT * 1000 + 1} capacity={1000} />);
    fireEvent.focus(screen.getByTestId('resource-hover-scrap'));
    expect(screen.getByRole('tooltip').textContent).toMatch(/nearly full/i);
  });
});

describe('what the standing chips say when you look at them', () => {
  it('spells the faction level out as a bar with both figures on it', () => {
    render(<FactionLevelChip level={7} xpIntoLevel={1240} xpToNextLevel={2800} />);
    fireEvent.focus(screen.getByTestId('level-hover'));
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText('Level 7')).toBeInTheDocument();
    // The reading and its ceiling are separate elements in the window, so the whitespace between
    // them is a layout detail. What matters is that both numbers are there.
    expect(within(card).getByText('1,240')).toBeInTheDocument();
    expect(card.textContent).toContain('2,800');
    // And what is left, which is the one figure a player actually plans against.
    expect(card.textContent).toContain('1,560');
  });

  it('closes again when the pointer leaves', () => {
    render(<FactionLevelChip level={3} xpIntoLevel={10} xpToNextLevel={600} />);
    const trigger = screen.getByTestId('level-chip');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
