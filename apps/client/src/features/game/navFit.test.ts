import { describe, expect, it } from 'vitest';
import { DOOR, compactDoors, naturalRowWidth } from './navFit';

const rowOf = (doors: number, sizes: NonNullable<ReturnType<typeof compactDoors>>) =>
  doors * sizes.width + (doors - 1) * sizes.gap + 2 * sizes.pad;

describe('the bottom bar on one row', () => {
  it('leaves a row that fits exactly as it is drawn', () => {
    // Thirteen doors need 1040px: every standard frame but 1024 wide has the room.
    expect(naturalRowWidth(13)).toBe(1040);
    for (const width of [1040, 1280, 1440, 1920]) expect(compactDoors(13, width)).toBeNull();
    expect(compactDoors(12, 1024)).toBeNull();
  });

  it('tightens a row that would wrap until it fits, smaller icons and less space between', () => {
    // Thirteen doors, then the fight mark, the Console, and both at once.
    for (const doors of [13, 14, 15, 16]) {
      const sizes = compactDoors(doors, 1024);
      expect(sizes, `${doors} doors`).not.toBeNull();
      expect(rowOf(doors, sizes!), `${doors} doors`).toBeLessThanOrEqual(1024);
      expect(sizes!.icon).toBeLessThan(DOOR.icon);
      expect(sizes!.tile).toBeLessThan(DOOR.tile);
      expect(sizes!.label).toBeLessThan(DOOR.label);
      expect(sizes!.gap).toBeLessThan(DOOR.gap);
    }
  });
});
