import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PortraitFrame } from './PortraitFrame';

/**
 * The frame round the big portraits.
 *
 * Three screens draw one of these and a fourth draws it small, so the things worth pinning are the
 * things that would go wrong when somebody adds the fifth: a bracket drawn from a path that is not
 * quite the same as the other three, a decorative drawing that ends up in the accessible name of
 * the picture it frames, and the brackets appearing on a 40px avatar where they read as four
 * blobs.
 */

const brackets = (container: HTMLElement) => [
  ...container.querySelectorAll<SVGSVGElement>('[data-testid="portrait-frame"] > svg'),
];

describe('PortraitFrame', () => {
  it('rules its edge with the same pen the buttons are drawn with', () => {
    render(
      <PortraitFrame>
        <img alt="the overseer" src="/portrait.webp" />
      </PortraitFrame>,
    );
    // `.brushed` is the frayed stroke on WITHDRAW and MAX. A plain border here is the defect the
    // board reported: a machine-cut line round a painted picture.
    expect(screen.getByTestId('portrait-frame')).toHaveClass('brushed');
  });

  it('draws four corners at page size and none on a HUD avatar', () => {
    const page = render(<PortraitFrame size="lg">{null}</PortraitFrame>);
    expect(brackets(page.container)).toHaveLength(4);
    page.unmount();

    const hud = render(<PortraitFrame size="sm">{null}</PortraitFrame>);
    expect(brackets(hud.container)).toHaveLength(0);
  });

  it('turns one drawing into four corners rather than drawing four', () => {
    const { container } = render(<PortraitFrame>{null}</PortraitFrame>);
    const paths = brackets(container).map((svg) =>
      [...svg.querySelectorAll('path')].map((path) => path.getAttribute('d')).join('|'),
    );
    expect(new Set(paths).size, 'the four corners are not the same drawing').toBe(1);

    // One placement each, and all four of them different: three brackets stacked in one corner is
    // a defect that every other assertion here passes.
    const places = brackets(container).map((svg) => svg.getAttribute('class'));
    expect(new Set(places).size).toBe(4);
  });

  it('marks its own drawing as decoration and adds nothing to the picture it frames', () => {
    const { container } = render(
      <PortraitFrame>
        <img alt="the overseer" src="/portrait.webp" />
      </PortraitFrame>,
    );
    /* Both halves, because the first one alone proves nothing: a bare `<svg>` carries no role, so
       a count of the images in the accessibility tree stays at one whether the brackets are hidden
       or not. `MemberSigil` is an `<svg role="img">` two directories away, which is how a drawing
       in this codebase ends up announcing itself. */
    expect(brackets(container).map((svg) => svg.getAttribute('aria-hidden'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'the overseer' })).toBeInTheDocument();
  });

  it('leaves the box to its caller, because the box is what kills the dead space', () => {
    render(<PortraitFrame className="min-h-0 flex-1">{null}</PortraitFrame>);
    const frame = screen.getByTestId('portrait-frame');
    expect(frame).toHaveClass('flex-1');
    expect(frame).toHaveClass('min-h-0');
  });
});
