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
 * So the box is the parent's, and the aimed crop is the part that keeps the reversal honest. It
 * is `object-position: 50% -10%` since 2026-09-22 rather than `object-top` (maintainer: the top
 * of the head is sometimes cropped): the top edge of the picture starts level with the box and
 * then slides a tenth of the overflow lower, so the air above the skull grows. The
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
    expect(container.querySelector('img')).toHaveStyle({ objectPosition: '50% -10%' });
  });

  /**
   * The fixed-ratio boxes are aimed at the top too (maintainer request, 2026-09-15).
   *
   * This used to assert the opposite, on the grounds that a fixed ratio is "a box shaped like the
   * picture". It is not: `portrait` is 3:4 and the deliveries are 2:3, so a centred cover crop
   * still throws away the top and bottom. Measured against a real 928x1392 delivery whose skull
   * starts about 40px down, a centred crop loses **77px** at `portrait` and **232px** at `square`,
   * so the smallest avatar in the game was the one cutting the most off the head.
   *
   * Both shapes are asserted, because they fail for the same reason and one of them is the 40px
   * portrait in the standing bar, which is the one a player looks at on every screen.
   */
  it('aims the fixed-ratio crops at the top as well, where the heads are', () => {
    deliveredUrl.mockReturnValue('/assets/portrait-overseer-1.webp');
    for (const aspect of ['portrait', 'square'] as const) {
      const { container } = render(
        <OverseerPortrait portraitId="overseer-1" archetype="enforcer" aspect={aspect} />,
      );
      expect(container.querySelector('img'), `${aspect} crops from the middle`).toHaveStyle({
        objectPosition: '50% -10%',
      });
    }
  });

  it('leaves the avatar crops alone, which are deliberate', () => {
    const square = render(
      <OverseerPortrait portraitId="overseer-1" archetype="enforcer" aspect="square" />,
    );
    expect(square.container.firstElementChild).toHaveClass('aspect-square');
  });
});
