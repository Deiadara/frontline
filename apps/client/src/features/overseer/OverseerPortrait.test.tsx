import { ASSET_CLASS_SPECS } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverseerPortrait } from './OverseerPortrait';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

beforeEach(() => deliveredUrl.mockClear().mockReturnValue(null));

const renderPortrait = () =>
  render(<OverseerPortrait portraitId="overseer-1" archetype="enforcer" />);

describe('OverseerPortrait', () => {
  it('paints the silhouette while the portrait is undelivered', () => {
    const { container } = renderPortrait();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('enforcer')).toBeVisible();
  });

  it('shows the delivered portrait instead, addressing it by overseer rather than by path', () => {
    deliveredUrl.mockReturnValue('/assets/portrait-overseer-1.webp');
    const { container } = renderPortrait();
    expect(deliveredUrl).toHaveBeenCalledWith({ type: 'portrait', portraitId: 'overseer-1' });
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/assets/portrait-overseer-1.webp',
    );
    expect(container.querySelector('svg'), 'the silhouette is replaced, not stacked').toBeNull();
  });
});

/**
 * The `fill` box is the shape of the delivery, so `object-cover` has nothing to crop.
 *
 * `OverseerProfilePage` is the one screen that is *about* the portrait, and its comment promises
 * "nothing gets cut, at any size". The box was `aspect-[3/4]` and the delivered files are 928x1392,
 * which is 2:3, so the image was scaled by 0.75 / 0.667 = 1.125 and 11% of its height was thrown
 * away, half off the top of the head.
 *
 * Pinned against `ASSET_CLASS_SPECS.portrait`'s own pixel dimensions rather than against the string
 * `'2:3'`: that spec is the record of what the board is asked to deliver, and its `aspect` *label*
 * says `'3:4'` beside a 1024x1536 that is 2:3, which is exactly how the box came to be wrong.
 */
describe('the fill box against the delivered shape', () => {
  it('is the ratio the portrait class is delivered at', () => {
    const { width, height } = ASSET_CLASS_SPECS.portrait;
    expect(width / height).toBeCloseTo(2 / 3, 5);

    const { container } = render(
      <OverseerPortrait portraitId="overseer-1" archetype="enforcer" aspect="fill" />,
    );
    const box = container.firstElementChild;
    expect(box).toHaveClass(`aspect-[${width / 512}/${height / 512}]`);
  });

  it('leaves the avatar crops alone, which are deliberate', () => {
    const square = render(
      <OverseerPortrait portraitId="overseer-1" archetype="enforcer" aspect="square" />,
    );
    expect(square.container.firstElementChild).toHaveClass('aspect-square');
  });
});
