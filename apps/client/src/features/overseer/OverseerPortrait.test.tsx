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
 * The `fill` box takes the whole frame, and aims the crop that costs.
 *
 * It used to be `aspect-[2/3]`, the delivery's own shape, so `object-cover` had nothing to crop
 * and nothing was ever cut. The board reversed that on 2026-09-13: a box shaped like the picture
 * is a box that does not fill the panel, and on a 720-tall viewport the overseer's file showed a
 * 227px painting sitting in the middle of a 330px rail.
 *
 * So the box is the parent's, and `object-top` is the part that keeps the reversal honest. The
 * deliveries are 928x1392 with the head in the top half; a `fill` box on a short viewport is
 * nearly square, and a *centred* cover crop of a nearly-square box off a 2:3 picture takes its
 * first bite out of the top of the head. Both halves are pinned: the box fills, and the crop is
 * anchored where the faces are.
 */
describe('the fill box', () => {
  it('takes the whole frame and crops off the bottom rather than the head', () => {
    const { width, height } = ASSET_CLASS_SPECS.portrait;
    expect(width / height, 'the class is still delivered taller than 3:4').toBeCloseTo(2 / 3, 5);
    deliveredUrl.mockReturnValue('/assets/portrait-overseer-1.webp');

    const { container } = render(
      <OverseerPortrait portraitId="overseer-1" archetype="enforcer" aspect="fill" />,
    );
    const box = container.firstElementChild;
    expect(box).toHaveClass('h-full');
    expect(box).toHaveClass('w-full');
    expect(box?.className, 'a fixed ratio would put the dead space back').not.toMatch(/aspect-/);
    expect(container.querySelector('img')).toHaveClass('object-top');
  });

  it('leaves the fixed-ratio crops centred, which is right for a box shaped like the picture', () => {
    deliveredUrl.mockReturnValue('/assets/portrait-overseer-1.webp');
    const { container } = render(
      <OverseerPortrait portraitId="overseer-1" archetype="enforcer" aspect="portrait" />,
    );
    expect(container.querySelector('img')).not.toHaveClass('object-top');
  });

  it('leaves the avatar crops alone, which are deliberate', () => {
    const square = render(
      <OverseerPortrait portraitId="overseer-1" archetype="enforcer" aspect="square" />,
    );
    expect(square.container.firstElementChild).toHaveClass('aspect-square');
  });
});
