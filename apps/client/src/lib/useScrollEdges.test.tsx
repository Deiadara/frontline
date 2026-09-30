import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useScrollEdges } from './useScrollEdges';

/** jsdom lays nothing out, so the scroller's geometry is written onto it by hand. */
function shape(
  node: HTMLElement,
  box: { scrollLeft: number; clientWidth: number; scrollWidth: number },
) {
  for (const [key, value] of Object.entries(box)) {
    Object.defineProperty(node, key, { configurable: true, value });
  }
}

function Strip() {
  const [ref, edges, onScroll] = useScrollEdges<HTMLDivElement>();
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      data-testid="strip"
      data-edges={`${edges.start}:${edges.end}`}
    />
  );
}

describe('a horizontal scroller', () => {
  it('says nothing is hidden when its content fits', () => {
    render(<Strip />);
    const strip = screen.getByTestId('strip');
    shape(strip, { scrollLeft: 0, clientWidth: 600, scrollWidth: 600.5 });
    fireEvent.scroll(strip);
    expect(strip.dataset.edges).toBe('false:false');
  });

  it('names the side with more past it, and both sides in the middle', () => {
    render(<Strip />);
    const strip = screen.getByTestId('strip');
    shape(strip, { scrollLeft: 0, clientWidth: 600, scrollWidth: 1_300 });
    fireEvent.scroll(strip);
    expect(strip.dataset.edges).toBe('false:true');
    shape(strip, { scrollLeft: 300, clientWidth: 600, scrollWidth: 1_300 });
    fireEvent.scroll(strip);
    expect(strip.dataset.edges).toBe('true:true');
    shape(strip, { scrollLeft: 700, clientWidth: 600, scrollWidth: 1_300 });
    fireEvent.scroll(strip);
    expect(strip.dataset.edges).toBe('true:false');
  });
});
