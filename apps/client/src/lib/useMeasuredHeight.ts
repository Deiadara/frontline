import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface MeasuredSize {
  width: number;
  height: number;
}

/**
 * An element's content box, as a live measurement.
 *
 * The chrome floats over the world, so everything under it has to know how big it is, and none of
 * those sizes are constants: the stockpile strip grows a row when the numbers get long enough to
 * wrap, the scenery switcher grows with the type size, and the room left for the district is
 * whatever those two did not take. Every screen used to clear the chrome with a hard-coded `pt-24`,
 * which is a number that is wrong at some viewport and silently hides a heading behind a bar when
 * it is.
 *
 * The *content* box, not the border box: a consumer asking how much room it has been left should
 * not have to subtract the padding it was given back out again.
 *
 * The first reading is taken in a **layout** effect, before the browser paints, and that is not a
 * detail. A `ResizeObserver`'s first callback is asynchronous, so a consumer that sizes itself from
 * this would otherwise lay out once at whatever it falls back to and correct itself a frame later,
 * which is a flash to a player and, worse, a real window in which the district was the wrong size
 * and its buildings were under the chrome. Anything measured off a live browser in that window is a
 * measurement of the wrong page.
 */
export function useMeasuredSize<T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T>,
  MeasuredSize,
] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<MeasuredSize>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (node !== null) setSize(contentBox(node));
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size];
}

/**
 * The content box, read straight off the DOM.
 *
 * `clientWidth`/`clientHeight` include the padding and exclude the border, so the padding comes back
 * off, and they are integers, which is why the observer's `contentRect` is preferred once it
 * starts reporting. This is the pre-paint reading, not the ongoing one.
 */
function contentBox(node: HTMLElement): MeasuredSize {
  const style = getComputedStyle(node);
  const horizontal = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const vertical = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  return {
    width: Math.max(0, node.clientWidth - horizontal),
    height: Math.max(0, node.clientHeight - vertical),
  };
}

/** {@link useMeasuredSize}, for the callers that only care how tall a bar is. */
export function useMeasuredHeight(): [RefObject<HTMLDivElement>, number] {
  const [ref, size] = useMeasuredSize();
  return [ref, size.height];
}
