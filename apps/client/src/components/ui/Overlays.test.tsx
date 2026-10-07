import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HoverCard } from './HoverCard';
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

/**
 * A tip whose element leaves the page (bug pass, 2026-10-06). The element sends no `pointerout` on
 * its way out, so the tip used to stay over whatever took its place.
 */
describe('a name for something that is gone', () => {
  function Expiring() {
    const [shown, setShown] = useState(true);
    return (
      <>
        <TooltipLayer />
        {shown && (
          <span data-tip="Call it off: 50% back" data-testid="mark">
            x
          </span>
        )}
        <button type="button" onClick={() => setShown(false)}>
          Expire
        </button>
        <p data-testid="underneath">plain text</p>
      </>
    );
  }

  it('goes with the first pointer move after its element has gone', () => {
    render(<Expiring />);
    fireEvent.pointerOver(screen.getByTestId('mark'));
    expect(screen.getByTestId('tooltip')).toHaveTextContent('Call it off');
    // Removed without any pointer event reaching it, as a timer would remove it.
    act(() => screen.getByRole('button', { name: 'Expire' }).click());
    expect(screen.queryByTestId('mark')).toBeNull();
    fireEvent.pointerOver(screen.getByTestId('underneath'));
    expect(screen.queryByTestId('tooltip')).toBeNull();
  });
});

/**
 * Pressing the control inside an interactive card while its trigger held focus (bug pass,
 * 2026-10-06). The trigger's blur started the leave timer and the card went before the press.
 */
describe('an interactive card whose trigger has focus', () => {
  it('stays while focus moves into it, and still goes when focus moves elsewhere', () => {
    vi.useFakeTimers();
    try {
      render(
        <>
          <HoverCard
            label="Infamy"
            interactive
            onActivate={() => {}}
            card={<button type="button">Upgrade Tier</button>}
          >
            Infamy
          </HoverCard>
          <button type="button">elsewhere</button>
        </>,
      );
      const trigger = screen.getByRole('button', { name: 'Infamy' });
      fireEvent.focus(trigger);
      const inside = screen.getByRole('button', { name: 'Upgrade Tier' });
      fireEvent.blur(trigger, { relatedTarget: inside });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('button', { name: 'Upgrade Tier' })).not.toBeNull();

      fireEvent.focus(trigger);
      fireEvent.blur(trigger, { relatedTarget: screen.getByRole('button', { name: 'elsewhere' }) });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole('button', { name: 'Upgrade Tier' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A card and the window it opened, which used to be drawn at the same time (maintainer, 2026-09-20).
 *
 * A `HoverCard` trigger that also opens a dialog keeps the pointer on it, and from a keyboard keeps
 * the focus on it, so nothing ever fired the leave that closes the card. The card outranks the
 * dialog by `z-[200]` against `z-[100]`, which the test above is about, so what a player got was the
 * same sheet twice with the stranded copy on top: measured in the browser at 1280x720, 720x230 of
 * a 960x392 unit window covered by the hover it had been opened from.
 *
 * The rule is which window is on top rather than "a dialog is open anywhere", which is why the
 * third case is here: a card whose trigger is *inside* the dialog is the card the dialog exists to
 * make reachable, and turning that one off would trade one defect for a worse one.
 */
describe('a hover card under a dialog', () => {
  /** A trigger that explains itself and opens a window, with a second trigger inside the window. */
  function Chip() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <HoverCard label="Razors" card={<p>Nine of them</p>} onActivate={() => setOpen(true)}>
          <span>Razors</span>
        </HoverCard>
        {open && (
          <Modal onClose={() => setOpen(false)} data-testid="window">
            <HoverCard label="Shield line" card={<p>They are shot at first</p>}>
              <span>Shield line</span>
            </HoverCard>
          </Modal>
        )}
      </>
    );
  }

  const cards = (): string[] =>
    screen.queryAllByRole('tooltip').map((card) => card.textContent ?? '');

  it('puts the card away while the window stands over it, and gives it back after', () => {
    render(<Chip />);
    const trigger = screen.getByRole('button', { name: 'Razors' });

    // It opens at all, which is what stops the rest of this passing on a card nothing draws.
    fireEvent.focus(trigger);
    expect(cards()).toEqual(['Nine of them']);

    fireEvent.click(trigger);
    expect(screen.getByTestId('window')).toBeInTheDocument();
    expect(cards(), 'the card it was opened from is still over the window').toEqual([]);

    // The chips inside the window still answer: that is the whole reason the window exists.
    fireEvent.focus(screen.getByRole('button', { name: 'Shield line' }));
    expect(cards()).toEqual(['They are shot at first']);

    // Nothing ever left the trigger, so closing the window hands the card back rather than
    // leaving a chip that has quietly stopped explaining itself.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('window')).toBeNull();
    expect(cards()).toEqual(['Nine of them']);
  });
});
