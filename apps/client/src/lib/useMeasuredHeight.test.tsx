import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeasuredHeight } from './useMeasuredHeight';

/** A bar that is only drawn once there is something to draw, the way the game shell's are. */
function Shell({ ready }: { ready: boolean }) {
  const [ref, height] = useMeasuredHeight();
  return (
    <>
      <output data-testid="height">{height}</output>
      {ready && (
        <div ref={ref} style={{ padding: 0 }}>
          bar
        </div>
      )}
    </>
  );
}

/*
 * jsdom lays nothing out, so every box is given a height here: the pre-paint reading is what is
 * under test, and it reads `clientHeight`.
 */
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(40);
});
afterEach(() => vi.restoreAllMocks());

describe('useMeasuredHeight', () => {
  /*
   * The game shell first renders a "Loading district" branch with neither bar in it. A hook that
   * measured once on mount read nothing there and never looked again, leaving `--hud-h` at 0px.
   */
  it('measures an element that appears after the first render', () => {
    const { rerender } = render(<Shell ready={false} />);
    expect(screen.getByTestId('height')).toHaveTextContent('0');
    rerender(<Shell ready />);
    expect(screen.getByTestId('height')).toHaveTextContent('40');
  });
});
