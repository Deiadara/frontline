import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Modal } from './Modal';
import { TooltipLayer } from './TooltipLayer';

/**
 * The ladder of things that float over the whole app.
 *
 * Four of them portal or position themselves against the viewport, each picking its own `z-index`
 * in its own file, and they drifted: the dialog moved to 100 and the name layer stayed on the 70 it
 * had chosen back when the tallest thing on the screen was the chrome. Nothing looked broken,
 * because no `data-tip` happened to be inside a dialog on the day, and the first one added would
 * have opened a name *underneath* the window it was naming.
 *
 * Read off the class rather than off a computed style on purpose: Tailwind is not compiled in
 * jsdom, so `getComputedStyle` reports `auto` for both and a test written that way passes whatever
 * the numbers are. That is the shape of gate that proves nothing.
 */
function floatingLayer(element: HTMLElement | null): number {
  const found = element?.className.match(/z-\[(\d+)\]/);
  expect(found, `no z-[n] on ${element?.className ?? 'nothing'}`).not.toBeNull();
  return Number(found?.[1]);
}

describe('what floats over what', () => {
  it('draws a name above the dialog it is naming', () => {
    render(
      <>
        <TooltipLayer />
        <Modal onClose={() => {}} data-testid="window">
          <button type="button" data-tip="What this does">
            Press
          </button>
        </Modal>
      </>,
    );

    fireEvent.pointerOver(screen.getByRole('button', { name: 'Press' }));
    const tip = screen.getByTestId('tooltip');
    expect(tip).toHaveTextContent('What this does');

    // The backdrop carries the dialog's layer; the panel inside it is positioned within.
    const backdrop = screen.getByTestId('window').parentElement;
    expect(floatingLayer(tip)).toBeGreaterThan(floatingLayer(backdrop));
  });
});
