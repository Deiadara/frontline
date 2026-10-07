import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UnclaimedPlotWindow } from './UnclaimedPlot';

/**
 * An unclaimed plot is a window over the city map (maintainer, 2026-09-30), and it closes the way
 * the location window does: a click anywhere outside it, or Escape. A click on the sheet itself
 * must not close it, or reading the blurb would dismiss it.
 */
function open(onClose = vi.fn()) {
  render(
    <UnclaimedPlotWindow
      name="Player District II"
      blurb="Roofs stacked on roofs above the wall."
      travelMinutes={18}
      onClose={onClose}
    />,
  );
  return onClose;
}

describe('the unclaimed plot window', () => {
  it('says where it is, what it is like, how far it is, and that it is shut', () => {
    open();
    const sheet = screen.getByTestId('unclaimed-plot');
    expect(screen.getByRole('dialog', { name: 'Player District II' })).toBe(sheet);
    expect(sheet).toHaveTextContent('Roofs stacked on roofs above the wall.');
    expect(sheet).toHaveTextContent('18 min');
    expect(screen.getByTestId('unclaimed-stamp')).toHaveAccessibleName('Unclaimed');
    expect(screen.getByTestId('plot-plan')).toBeInTheDocument();
    expect(screen.getByTestId('unclaimed-plot-closed')).toHaveTextContent(
      'It stays closed to every crew until one moves in.',
    );
  });

  // Maintainer, 2026-09-30: no difficulty and no garrison on a player's plot, claimed or not.
  it('prints no difficulty and no garrison', () => {
    open();
    const sheet = screen.getByTestId('unclaimed-plot');
    expect(sheet).not.toHaveTextContent(/difficulty/i);
    expect(sheet).not.toHaveTextContent(/garrison/i);
    expect(sheet).not.toHaveTextContent(/whoever holds the ground/i);
  });

  it('closes on a click outside it, and not on a click inside it', () => {
    const onClose = open();
    fireEvent.click(screen.getByTestId('plot-plan'));
    fireEvent.click(screen.getByTestId('unclaimed-plot'));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = screen.getByTestId('unclaimed-plot').parentElement;
    if (!backdrop) throw new Error('the window has no backdrop');
    // A whole press on the backdrop, as a real click is: `Modal` closes only on one that began
    // there, so a drag out of the panel does not.
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape and on its cross', () => {
    const onClose = open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
