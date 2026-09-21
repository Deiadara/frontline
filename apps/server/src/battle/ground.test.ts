import { findDistrict, findLocation } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { targetName } from './ground.js';

/**
 * What a fight is called, on every screen that lists one.
 *
 * The sentence is composed here rather than on the client because four surfaces print the string
 * this returns: the fights list, a fight's own header, the faction feed and a movement row. The
 * place inside it is set in caps (maintainer, 2026-09-20) and the words around it are not, which
 * is the same rule `DeclareDialog` follows on the one heading it writes itself.
 */
describe('what a fight is called', () => {
  const CONTESTED = 'rustyard';
  const district = findDistrict(CONTESTED);
  const place = district?.name ?? '';

  it('is a precondition that the district has a mixed-case name to shout', () => {
    // Without this the two cases below would pass against a name that was already upper case.
    expect(place).not.toBe('');
    expect(place, 'nothing to test: the name is already in caps').not.toBe(place.toUpperCase());
  });

  it('sets the place in caps on a gate, and leaves the words around it alone', () => {
    const said = targetName({ kind: 'gate', districtId: CONTESTED });
    expect(said).toBe(`the gate at ${place.toUpperCase()}`);
    expect(said.startsWith('the gate at '), 'the sentence is shouted too').toBe(true);
  });

  it('does the same for a raid', () => {
    const said = targetName({ kind: 'district', districtId: CONTESTED });
    expect(said).toBe(`a raid on ${place.toUpperCase()}`);
    expect(said.startsWith('a raid on '), 'the sentence is shouted too').toBe(true);
  });

  /**
   * A location target is the whole of the name, with no sentence around it. There is nothing to
   * set it apart from, and this string is also read as a plain noun in a movement row, so it
   * stays as the map writes it.
   */
  it('leaves a location as the map writes it', () => {
    const plot = district?.locations[0];
    expect(plot, 'the fixture district has no locations').toBeDefined();
    expect(targetName({ kind: 'location', districtId: CONTESTED, locationId: plot!.id })).toBe(
      findLocation(plot!.id)?.name,
    );
  });

  it('says somewhere rather than throwing on ground it cannot find', () => {
    expect(targetName({ kind: 'gate', districtId: 'nowhere-at-all' })).toBe(
      'the gate at SOMEWHERE',
    );
    expect(targetName({ kind: 'location', districtId: 'x', locationId: 'nope' })).toBe('somewhere');
  });
});
