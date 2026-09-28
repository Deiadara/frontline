import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { askToWaste, useWasteConfirm } from '../store/wasteConfirm';
import { ErrorNote } from './ui/ErrorNote';
import { WasteConfirmLayer } from './WasteConfirmLayer';

/**
 * The one dialog every waste warning is drawn in (maintainer ruling, 2026-09-28).
 *
 * Nothing is on screen until a request is refused with `WOULD_WASTE`; then the server's figure is
 * put to the player, and the answer goes back to the request that asked.
 */
describe('the waste warning', () => {
  afterEach(() => useWasteConfirm.setState({ question: null }));

  it('draws nothing until something asks', () => {
    render(<WasteConfirmLayer />);
    expect(screen.queryByTestId('waste-confirm')).toBeNull();
  });

  it('names the figure and hands the yes back', async () => {
    render(<WasteConfirmLayer />);
    let asked!: Promise<boolean>;
    act(() => {
      asked = askToWaste({ scrap: 120, oil: 40 });
    });
    expect(screen.getByTestId('waste-confirm').textContent).toContain(
      'This would put you over your storage: 40 Oil and 120 Scrap would go to waste. Go ahead?',
    );
    fireEvent.click(screen.getByTestId('waste-confirm-yes'));
    await expect(asked).resolves.toBe(true);
    expect(screen.queryByTestId('waste-confirm')).toBeNull();
  });

  it('hands a no back, and a second question declines the first', async () => {
    render(<WasteConfirmLayer />);
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = askToWaste({ scrap: 1 });
    });
    act(() => {
      second = askToWaste({ scrap: 2 });
    });
    await expect(first).resolves.toBe(false);
    fireEvent.click(screen.getByTestId('waste-confirm-no'));
    await expect(second).resolves.toBe(false);
  });

  /** A declined warning refuses with an empty message, and no screen should draw a note for it. */
  it('leaves no refusal on the sheet once the player has said no', () => {
    const { container } = render(<ErrorNote>{''}</ErrorNote>);
    expect(container.innerHTML).toBe('');
    render(<ErrorNote>That listing is gone</ErrorNote>);
    expect(screen.getByRole('alert').textContent).toContain('That listing is gone');
  });
});
