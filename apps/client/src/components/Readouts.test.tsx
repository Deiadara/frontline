import { METER_MAX, REPUTATION_LABEL_SPECS, storageCapacity } from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeterChip, ReputationChip } from './Meters';
import { fillFraction, ResourceChip, STORAGE_WARN_AT } from './Resources';

/**
 * The HUD is a row of numbers with no words on it, and everything that makes those numbers *mean*
 * something is one hover away. That is a deliberate trade — the compact form is what keeps the bar
 * to one line over the artwork — but it only pays off if the hover actually carries the missing
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
   * sit over its own ceiling — and a bar that rendered 140% would run out of its own track.
   */
  it('never runs past the end of the bar, however far over the ceiling a raid puts you', () => {
    expect(fillFraction(4000, 1000)).toBe(1);
    expect(fillFraction(-50, 1000)).toBe(0);
  });

  /** No ceiling means nothing to draw — an unknown capacity must not read as "full". */
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
   * The ceiling is the Apothecary's, and it is supposed to *grow* with it — otherwise the bar is
   * reporting a constant and the structure's one mechanic does nothing.
   */
  it('rises with the Apothecary, which is the whole point of the structure', () => {
    const at = (level: number) =>
      storageCapacity([
        { id: 'a', kind: 'apothecary', level, modifications: [], damage: 0, garrisons: 0 },
      ]);
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(10)).toBeGreaterThan(at(5));
    // Compounding, not linear — the late levels have to be worth their price.
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

  /** Keyboard, not just pointer — a card only a mouse can open is a card half of players never see. */
  it('opens on focus as well as on hover', () => {
    render(<ResourceChip kind="caps" value={10} capacity={100} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByTestId('resource-hover-caps'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  /**
   * A full stockpile is a silent, continuous loss — production stops dead while raid loot still
   * lands — so the one state worth shouting about is the one just before it.
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

describe('what the meters say when you look at them', () => {
  it('explains morale as a thing the district sustains rather than a bar you top up', () => {
    render(<MeterChip kind="morale" value={62} />);
    fireEvent.focus(screen.getByTestId('meter-hover-morale'));
    const card = screen.getByRole('tooltip');
    expect(within(card).getByText('Morale')).toBeInTheDocument();
    // The reading and its ceiling are separate elements in the window, so the whitespace between
    // them is a layout detail. What matters is that both numbers are there.
    expect(within(card).getByText('62')).toBeInTheDocument();
    expect(card.textContent).toContain(String(METER_MAX));
    expect(card.textContent).toMatch(/crew feels/i);
  });

  it('says what infamy is for', () => {
    render(<MeterChip kind="infamy" value={40} />);
    fireEvent.focus(screen.getByTestId('meter-hover-infamy'));
    expect(screen.getByRole('tooltip').textContent).toMatch(/knows your name/i);
  });
});

describe('what a reputation means', () => {
  /**
   * Every label, not one: the sentences already existed in the shared spec and were being shown
   * nowhere, and a chip that explains three of eleven standings is a chip a player learns to
   * distrust.
   */
  it('carries the designed explanation for every standing the game can give you', () => {
    for (const [label, spec] of Object.entries(REPUTATION_LABEL_SPECS)) {
      const { unmount } = render(
        <ReputationChip label={label as keyof typeof REPUTATION_LABEL_SPECS} />,
      );
      fireEvent.focus(screen.getByTestId('reputation-chip'));
      const card = screen.getByRole('tooltip');
      expect(within(card).getByText(label), label).toBeInTheDocument();
      expect(within(card).getByText(spec.description), label).toBeInTheDocument();
      unmount();
    }
  });

  it('closes again when the pointer leaves', () => {
    render(<ReputationChip label="Feared" />);
    const trigger = screen.getByTestId('reputation-chip');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

/**
 * The card floats. It does not move the bar it came from.
 *
 * Rendered in place, the card was a child of the stockpile strip, and a bar built on `flex-wrap`
 * grew to contain it: hovering a resource pushed the entire top of the screen down. Nothing about a
 * tooltip should be able to reflow the thing it is explaining, so it is portalled out of the
 * document flow entirely and positioned in viewport coordinates.
 */
describe('where the hover card lives', () => {
  it('renders outside the chip it belongs to, so it cannot resize it', () => {
    const { container } = render(<ResourceChip kind="oil" value={100} capacity={1000} />);
    fireEvent.focus(screen.getByTestId('resource-hover-oil'));

    const card = screen.getByRole('tooltip');
    expect(card).toBeInTheDocument();
    // Not merely "not a child of the chip": not anywhere inside the tree the chip was rendered in.
    expect(container.contains(card)).toBe(false);
    expect(document.body.contains(card)).toBe(true);
  });

  it('floats over the page rather than taking space in it', () => {
    render(<ResourceChip kind="oil" value={100} capacity={1000} />);
    fireEvent.focus(screen.getByTestId('resource-hover-oil'));
    // `fixed` is what makes it independent of every scroll container and every flex parent above
    // it. `absolute` would still be laid out inside whichever ancestor established the context.
    //
    // Asserted on the resolved *property*, not on the presence of a `fixed` class. The class
    // version of this test passed for months while the card was actually laid out `relative`:
    // `.glass-strong` declares `position: relative` in `index.css`'s `@layer utilities`, which
    // Tailwind appends after its own generated utilities, so at equal specificity the later rule
    // won and the class was decorative. A test that pins the mechanism instead of the effect
    // cannot see that; this one can.
    expect(screen.getByRole('tooltip').style.position).toBe('fixed');
  });

  it('goes away again when the trigger is left', () => {
    render(<ResourceChip kind="oil" value={100} capacity={1000} />);
    const trigger = screen.getByTestId('resource-hover-oil');
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
