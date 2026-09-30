import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Which ends of a horizontal scroller have more past them. Both false when nothing overflows. */
export interface ScrollEdges {
  start: boolean;
  end: boolean;
}

const NONE: ScrollEdges = { start: false, end: false };

/**
 * Whether a horizontal scroller is hiding anything, and on which side.
 *
 * Read after every render, on the scroller's own scroll (the returned handler, passed as its
 * `onScroll`) and when the window is resized. After every render because what overflows a strip of
 * orders changes when an order is added or finishes, which resizes neither the strip nor the page;
 * a prop rather than a listener because the scroller can be unmounted and drawn again under the
 * same ref. One pixel of slack, because a scroller sized to a fraction reports a scroll width a
 * pixel over its client width with nothing hidden at all.
 */
export function useScrollEdges<T extends HTMLElement>(): [RefObject<T>, ScrollEdges, () => void] {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState<ScrollEdges>(NONE);

  const read = useCallback(() => {
    const node = ref.current;
    const start = node !== null && node.scrollLeft > 1;
    const end = node !== null && node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    setEdges((was) => (was.start === start && was.end === end ? was : { start, end }));
  }, []);

  useLayoutEffect(read);

  useEffect(() => {
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [read]);

  return [ref, edges, read];
}
