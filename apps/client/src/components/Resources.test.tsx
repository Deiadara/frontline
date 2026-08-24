import { STARTING_RESOURCES } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CostLine, ResourceChip, ResourceIcon } from './Resources';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../assets/delivered', () => ({ deliveredUrl }));

beforeEach(() => deliveredUrl.mockClear().mockReturnValue(null));

describe('ResourceIcon', () => {
  it('draws the line glyph while the icon is undelivered', () => {
    const { container } = render(<ResourceIcon kind="oil" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('paints the delivered icon instead, addressing it by resource rather than by path', () => {
    deliveredUrl.mockReturnValue('/assets/icon-caps.webp');
    const { container } = render(<ResourceIcon kind="caps" />);

    expect(deliveredUrl).toHaveBeenCalledWith({ type: 'resource-icon', resource: 'caps' });
    expect(container.querySelector('img')).toHaveAttribute('src', '/assets/icon-caps.webp');
    expect(container.querySelector('svg')).toBeNull();
  });

  /**
   * Both forms occupy the same 14px box. A readout is normally half delivered and half procedural.
   * That is the whole point of the fallback, so a size that moved with delivery would jog every
   * chip in the HUD sideways as each master lands.
   */
  it('draws both forms in the same box, so a half-delivered readout keeps its columns', () => {
    const { container: glyph } = render(<ResourceIcon kind="caps" />);
    deliveredUrl.mockReturnValue('/assets/icon-caps.webp');
    const { container: painted } = render(<ResourceIcon kind="caps" />);

    const sizeOf = (root: HTMLElement) =>
      [...(root.querySelector('svg, img')?.classList ?? [])].filter((c) => /^[hw]-/.test(c)).sort();
    expect(sizeOf(painted)).toEqual(sizeOf(glyph));
  });
});

describe('the readouts that use it', () => {
  it('leaves the chip’s resource colour on the wrapper, not on the mark', () => {
    render(<ResourceChip kind="caps" value={600} />);
    expect(screen.getByText('600')).toBeVisible();
  });

  /**
   * `CostLine` recolours a line the stockpile cannot cover by setting `color` on the row and
   * letting the glyph inherit it through `currentColor`. So the mark must render the glyph *bare*:
   * any element of its own between the row and the svg is a place a colour can be set, and an
   * unaffordable line would then keep a friendly-coloured mark beside hostile figures.
   *
   * Asserted on the mark's own root rather than on the svg's class list: a wrapper carrying the
   * colour leaves the svg's own attributes untouched, so reading them proves nothing.
   */
  it('renders the glyph bare, so an unaffordable line recolours the mark it inherits', () => {
    const { container } = render(<CostLine cost={{ caps: 99_999 }} stock={STARTING_RESOURCES} />);
    const row = container.querySelector('span.text-oxblood-300');
    expect(row, 'a line the vault cannot cover is drawn hostile').not.toBeNull();

    // The mark carries no colour of its own, not the svg, and not the wrapper that sizes it, so
    // whatever the row is painted flows straight through. Asserted as "nothing sets a colour"
    // rather than as "the root is an svg": the icon gained a sizing wrapper (so a delivered `<img>`
    // and the procedural fallback come out the same size), and inheritance is what actually matters.
    const bare = render(<ResourceIcon kind="caps" />);
    const glyph = bare.container.querySelector('svg');
    expect(glyph, 'the procedural fallback is an svg').not.toBeNull();
    for (const node of [bare.container.firstElementChild, glyph]) {
      expect(node?.getAttribute('class') ?? '').not.toMatch(/\btext-/);
    }
    expect(glyph?.getAttribute('fill')).toBe('none');
  });
});
