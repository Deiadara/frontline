import { describe, expect, it } from 'vitest';
import { PERK_IDS, isPerkId } from './perks.js';

/**
 * A perk id is plain snake case (maintainer, 2026-10-01).
 *
 * Sniper's Eye shipped as `sniper’s_eye`, the only id with a curly apostrophe in it: it worked,
 * and it was a trap for anyone typing it into a fixture, a query or the Console. Renamed to
 * `snipers_eye`; a save holding the old id drops that one perk on read (`knownCommanders`).
 */
describe('perk ids', () => {
  it.each(PERK_IDS.map((id) => [id]))('%s is plain snake case', (id) => {
    expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it('no longer knows the curly id', () => {
    expect(isPerkId('snipers_eye')).toBe(true);
    expect(isPerkId('sniper’s_eye')).toBe(false);
  });
});
