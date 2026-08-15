import { UNIT_TIERS } from '@frontline/shared';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnitPortrait } from './UnitPortrait';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

beforeEach(() => deliveredUrl.mockClear().mockReturnValue(null));

describe('UnitPortrait', () => {
  it('draws the silhouette while the portrait is undelivered', () => {
    const { container } = render(<UnitPortrait unitId="razors" tier="rabble" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('paints the delivered portrait instead, addressing it by unit rather than by path', () => {
    deliveredUrl.mockReturnValue('/assets/unit-scrapers.webp');
    const { container } = render(<UnitPortrait unitId="scrapers" tier="rabble" />);

    expect(deliveredUrl).toHaveBeenCalledWith({ type: 'unit', unitId: 'scrapers' });
    expect(container.querySelector('img')).toHaveAttribute('src', '/assets/unit-scrapers.webp');
    expect(container.querySelector('svg'), 'the silhouette is replaced, not stacked').toBeNull();
  });

  /**
   * The interim look is keyed to tier, so a roster of undelivered units still separates a Razor
   * from a Colossus. A tier that fell through to the same tint would make that claim silently
   * false, and there is nothing else on the card drawn in the tier's colour to notice it by.
   */
  it('tints every tier differently, so an undelivered roster still reads as a ladder', () => {
    const tints = UNIT_TIERS.map((tier) => {
      const { container } = render(<UnitPortrait unitId="razors" tier={tier} />);
      return container.firstElementChild?.className ?? '';
    });
    expect(new Set(tints).size).toBe(UNIT_TIERS.length);
  });
});
