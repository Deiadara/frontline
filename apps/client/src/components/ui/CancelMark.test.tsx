import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CancelBox, CancelCell } from './CancelMark';

const press = { label: 'Call it off', pending: false, onCancel: vi.fn() };

/**
 * The cancel holds its room (maintainer, 2026-10-08): a queue box is the same size with the X in
 * it and without, so what a shut window leaves is an empty cell, never a missing one.
 */
describe('the cancel cell', () => {
  it('draws the X and its countdown while the window is open', () => {
    render(<CancelCell {...press} windowMs={90_000} data-testid="x" />);
    expect(screen.getByTestId('x')).toHaveAccessibleName('Call it off');
    expect(screen.getByTestId('x-window')).toHaveTextContent('1m 30s');
  });

  it('keeps the cell and offers nothing once the window has shut', () => {
    render(<CancelCell {...press} windowMs={0} data-testid="x" />);
    expect(screen.getByTestId('cell-x')).toBeInTheDocument();
    expect(screen.queryByTestId('x')).toBeNull();
  });

  it('keeps the same size class open or shut', () => {
    const { rerender } = render(<CancelCell {...press} windowMs={90_000} data-testid="x" />);
    const open = screen.getByTestId('cell-x').className;
    rerender(<CancelCell {...press} windowMs={0} data-testid="x" />);
    expect(screen.getByTestId('cell-x').className).toBe(open);
  });
});

describe('the cancel box', () => {
  it('says the thing can no longer be called off once the window has shut', () => {
    render(<CancelBox {...press} windowMs={0} data-testid="x" />);
    expect(screen.queryByTestId('x')).toBeNull();
    expect(screen.getByTestId('closed-x')).toHaveTextContent('Cannot be cancelled');
  });

  it('offers the X with the time left to decide while it is open', () => {
    render(<CancelBox {...press} windowMs={125_000} data-testid="x" />);
    expect(screen.getByTestId('x')).toBeEnabled();
    expect(screen.getByTestId('box-x')).toHaveTextContent('left to decide');
  });
});
