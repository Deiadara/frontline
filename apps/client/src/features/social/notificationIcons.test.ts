import { NOTIFICATION_KINDS, NOTIFICATION_KIND_SPECS } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from '../../components/ui/Icon';

/**
 * Bug pass, 2026-10-02: the bells and the haul tiles cast their glyph names to `IconName`, which
 * tells the type checker nothing, and the Planks tile drew an empty box because `Icon` has no
 * `planks`. The bells' glyphs are pinned here so a new kind with a misspelt icon fails a test
 * rather than drawing nothing.
 */
describe('the glyph on every bell', () => {
  it('is one the icon set can draw', () => {
    const drawable = new Set<string>(ICON_NAMES);
    const missing = NOTIFICATION_KINDS.filter(
      (kind) => !drawable.has(NOTIFICATION_KIND_SPECS[kind].icon),
    );
    expect(missing).toEqual([]);
  });
});
