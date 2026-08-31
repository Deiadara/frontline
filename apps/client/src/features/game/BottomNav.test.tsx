import { describe, expect, it } from 'vitest';
import { DESTINATIONS } from './BottomNav';

/**
 * §B8: research stopped being a place you walk to.
 *
 * The door came off the bottom bar and the Lab's own window carries a button to the same route
 * (`StructureDialog`), which is where a player is already standing when they decide to research
 * something. What must **not** happen is the route disappearing with the door: deep links,
 * notifications and the Lab's button all go to `/game/research`, and that is asserted over in
 * `App.tsx`'s route table rather than here.
 */
describe('§B8: the scenery switcher', () => {
  it('carries no research door', () => {
    expect(DESTINATIONS.map((destination) => destination.to)).not.toContain('/game/research');
    expect(DESTINATIONS.map((destination) => destination.label)).not.toContain('Research');
  });

  it('still carries the places research is not', () => {
    const to = DESTINATIONS.map((destination) => destination.to);
    expect(to).toContain('/game/base');
    expect(to).toContain('/game/units');
    expect(to).toContain('/game/workshop');
  });

  /** §B9: the Scrapyard is the same shape of decision, and gets the same answer. */
  it('carries no scrapyard door either: the plot is the way in', () => {
    expect(DESTINATIONS.map((destination) => destination.to)).not.toContain('/game/scrapyard');
  });
});
