import { useEffect, useState } from 'react';

/**
 * A value that fades in and out rather than snapping.
 *
 * `held` is the value while it is there and the last one it had for `ms` after it goes, so there
 * is something on screen to fade; `lit` is whether to draw it at full opacity. Coming in, `lit`
 * waits two frames so the browser paints it at zero first and has an opacity to run from. A value
 * that is there on the first render is lit at once: a page opening is not something appearing.
 */
export function useFadingValue<T>(value: T | null, ms: number): { held: T | null; lit: boolean } {
  const [held, setHeld] = useState<T | null>(value);
  const [lit, setLit] = useState(value !== null);
  const present = value !== null;
  // Follows the value while it is there, in render rather than in an effect, so a held value is
  // never a frame behind the live one.
  if (present && held !== value) setHeld(value);

  useEffect(() => {
    if (present) {
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setLit(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    setLit(false);
    const timer = setTimeout(() => setHeld(null), ms);
    return () => clearTimeout(timer);
  }, [present, ms]);

  return { held: present ? value : held, lit: present && lit };
}
