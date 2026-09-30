/**
 * `x` up to `knee`, then diminishing returns towards `ceiling`, which it never reaches.
 *
 * The maintainer's rule for unit effects (2026-09-29): no hard caps. "Sending 12 medics rather than
 * 10 should always be better, but they should not be OP." A `min` stops paying the moment it binds,
 * so every unit past that point is dead weight. This pays in full up to the knee, then keeps paying
 * a little for every one past it: the tail leaves the knee at the same slope (so nothing jumps) and
 * closes on the ceiling exponentially. Strictly increasing for every `x`, which is the property
 * the rule asks for.
 */
export function softCap(x: number, knee: number, ceiling: number): number {
  if (x <= knee) return x;
  const room = ceiling - knee;
  return knee + room * (1 - Math.exp(-(x - knee) / room));
}
