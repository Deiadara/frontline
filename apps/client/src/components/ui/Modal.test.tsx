import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isReturnedFocus, Modal } from './Modal';

/**
 * Three ways a window closed or behaved when it should not (bug pass, 2026-10-06).
 */
describe('a window', () => {
  const open = () => {
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Behind</button>
        <Modal onClose={onClose} data-testid="window">
          <input aria-label="Stake" />
        </Modal>
      </>,
    );
    return onClose;
  };
  const backdrop = () => screen.getByTestId('window').parentElement!;

  it('stays open when a drag that began inside it is released over the backdrop', () => {
    const onClose = open();
    fireEvent.mouseDown(screen.getByLabelText('Stake'));
    fireEvent.click(backdrop());
    expect(onClose).not.toHaveBeenCalled();
    // ...and a press that both starts and ends on the backdrop still closes it.
    fireEvent.mouseDown(backdrop());
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves an Escape something inside it has already spent', () => {
    const onClose = open();
    const input = screen.getByLabelText('Stake');
    // What an open Dropdown does with Escape: closes its own list and marks the key used.
    input.addEventListener('keydown', (e) => e.preventDefault());
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes focus off whatever was behind it when it opens', () => {
    screen.queryByRole('button', { name: 'Behind' })?.focus();
    open();
    expect(screen.getByTestId('window').contains(document.activeElement)).toBe(true);
  });
});

/*
 * A full focus trap (maintainer, 2026-10-06): Tab cycles inside the window, focus goes back to the
 * opener on close, and that handed-back focus is marked so a hover card on the opener stays shut.
 */
describe('focus and a window', () => {
  // jsdom lays nothing out, so every element reports no boxes; the trap skips those as hidden.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      {} as DOMRect,
    ] as unknown as DOMRectList);
  });
  afterEach(() => vi.restoreAllMocks());

  function Opener({ onReturn }: { onReturn?: (returned: boolean) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          onFocus={(event) => onReturn?.(isReturnedFocus(event.target))}
        >
          Open
        </button>
        <button type="button">Behind</button>
        {open && (
          <Modal onClose={() => setOpen(false)} data-testid="window">
            <button type="button">First</button>
            <button type="button">Last</button>
          </Modal>
        )}
      </>
    );
  }

  it('keeps Tab inside the window, both ways round', () => {
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('hands focus back to the opener on close, marked as handed back', () => {
    const returns: boolean[] = [];
    render(<Opener onReturn={(returned) => returns.push(returned)} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByTestId('window').contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
    // The player's own focus, then the window's hand-back.
    expect(returns).toEqual([false, true]);
    expect(isReturnedFocus(opener)).toBe(false);
  });
});
