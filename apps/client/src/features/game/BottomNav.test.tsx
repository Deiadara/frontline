import { describe, expect, it } from 'vitest';
import { DESTINATIONS } from './BottomNav';

/**
 * §I1b: research is a place you walk to again.
 *
 * The door came off under §B8, when research was a desk you only opened from the Lab's own window.
 * It carries §D's blueprints now, which is a thing a player checks on the way past rather than a
 * decision they make while standing in the district, so it is back in the row. The Lab's button
 * still goes to the same route (`StructureDialog`).
 */
describe('§I1b: the scenery switcher', () => {
  it('carries a research door, level-gated like the rest', () => {
    const research = DESTINATIONS.find((destination) => destination.label === 'Research');
    expect(research).toBeDefined();
    expect(research?.to).toBe('/game/research');
    expect(research?.area).toBe('research');
    expect(research?.icon).toBe('research');
  });

  it('still carries the places research is not', () => {
    const to = DESTINATIONS.map((destination) => destination.to);
    expect(to).toContain('/game/base');
    expect(to).toContain('/game/units');
    expect(to).toContain('/game/workshop');
  });

  /** §D4's old home. The Satchel keeps a link to it; the walk of doors does not get a second one. */
  it('carries no blueprints door of its own', () => {
    const to = DESTINATIONS.map((destination) => destination.to);
    expect(to).not.toContain('/game/research/blueprints');
    expect(to).not.toContain('/game/inventory/blueprints');
  });

  /** §B9: the Scrapyard is the same shape of decision as the desk was, and keeps that answer. */
  it('carries no scrapyard door either: the plot is the way in', () => {
    expect(DESTINATIONS.map((destination) => destination.to)).not.toContain('/game/scrapyard');
  });
});
