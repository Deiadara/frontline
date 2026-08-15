import { BUILDING_KINDS } from '@frontline/shared';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StructureSprite } from './sprites';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

beforeEach(() => deliveredUrl.mockClear().mockReturnValue(null));

describe('StructureSprite', () => {
  it('draws a distinct silhouette for every kind while the art is undelivered', () => {
    const drawn = BUILDING_KINDS.map((kind) => {
      const { container } = render(<StructureSprite kind={kind} built />);
      const svg = container.querySelector('svg');
      expect(svg, kind).not.toBeNull();
      return svg?.innerHTML ?? '';
    });
    expect(new Set(drawn).size, 'no two structures may share a silhouette').toBe(drawn.length);
  });

  it('paints the delivered master instead, addressing it by structure rather than by path', () => {
    deliveredUrl.mockReturnValue('/assets/building-nexus.webp');
    const { container } = render(<StructureSprite kind="nexus" built />);

    expect(deliveredUrl).toHaveBeenCalledWith({ type: 'building', building: 'nexus' });
    expect(container.querySelector('img')).toHaveAttribute('src', '/assets/building-nexus.webp');
    expect(container.querySelector('svg'), 'the silhouette is replaced, not stacked').toBeNull();
  });

  /**
   * The regression this guards: an empty plot is a *state*, not a structure. Painting the delivered
   * master on it because the file happens to exist would show a finished Nexus standing on ground
   * the player has not built on, and the plot's own label would be the only thing saying otherwise.
   */
  it('keeps a vacant plot procedural even once that structure’s art has landed', () => {
    deliveredUrl.mockReturnValue('/assets/building-nexus.webp');
    const { container } = render(<StructureSprite kind="nexus" built={false} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
