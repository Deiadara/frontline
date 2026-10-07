import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PressError } from './PressError';

afterEach(() => vi.useRealTimers());

/** One frame: the box listens for the next click only from the frame after it opens. */
const nextFrame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });

/*
 * What slips past the guard shows beside the button, takes no room where it is written, and
 * closes on its X or on the next click anywhere (maintainer, 2026-10-06).
 */
describe('a refusal after a press', () => {
  it('takes no room where it is written', () => {
    const { container } = render(
      <div>
        <PressError>The bench is full</PressError>
      </div>,
    );
    expect(container.firstElementChild?.childElementCount).toBe(0);
    expect(screen.getByRole('alert')).toHaveTextContent('The bench is full');
  });

  it('closes on its X, and says so to whoever wrote it', () => {
    const onDismiss = vi.fn();
    render(<PressError onDismiss={onDismiss}>The bench is full</PressError>);
    fireEvent.click(screen.getByTestId('press-error-close'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('closes on the next click anywhere', async () => {
    const onDismiss = vi.fn();
    render(
      <>
        <button type="button">Elsewhere</button>
        <PressError onDismiss={onDismiss}>The bench is full</PressError>
      </>,
    );
    await nextFrame();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
