import type { LocationHolderKind } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ICON_GLYPHS } from './Icon';
import { INSIGNIA_INK, Insignia, hasInsignia } from './Insignia';

/**
 * The Combine's and the looters' marks (maintainer, 2026-09-30).
 *
 * The mark stands beside a name in a dozen places, so the rules worth pinning are the ones every
 * placement leans on: only those two parties have one, the mark is the drawn glyph from the icon
 * set, and its ink is the colour the city already gives that party.
 */
describe('the insignia', () => {
  it('draws a mark for the Combine and for the looters, and nothing for anybody else', () => {
    const { rerender, container } = render(<Insignia holder="government" className="h-4 w-4" />);
    expect(screen.getByTestId('insignia-government').querySelector('svg')).not.toBeNull();
    rerender(<Insignia holder="looters" className="h-4 w-4" />);
    expect(screen.getByTestId('insignia-looters').querySelector('svg')).not.toBeNull();
    rerender(<Insignia holder="crew" className="h-4 w-4" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Insignia holder="unoccupied" className="h-4 w-4" />);
    expect(container).toBeEmptyDOMElement();
    const kinds: LocationHolderKind[] = ['government', 'looters', 'crew', 'unoccupied'];
    expect(kinds.filter(hasInsignia)).toEqual(['government', 'looters']);
  });

  it('is decoration beside a name, and an image when it is given words', () => {
    const { rerender } = render(<Insignia holder="government" />);
    expect(screen.getByTestId('insignia-government')).toHaveAttribute('aria-hidden', 'true');
    rerender(<Insignia holder="government" label="The Combine" />);
    expect(screen.getByRole('img', { name: 'The Combine' })).toBeInTheDocument();
  });

  it("wears the party's own colour, unless told to keep the line's", () => {
    const { rerender } = render(<Insignia holder="looters" />);
    expect(screen.getByTestId('insignia-looters')).toHaveClass(INSIGNIA_INK.looters);
    rerender(<Insignia holder="looters" tone={false} />);
    expect(screen.getByTestId('insignia-looters')).not.toHaveClass(INSIGNIA_INK.looters);
  });

  it('is drawn from the icon set, so the landing promise and every mark are one drawing', () => {
    expect(ICON_GLYPHS.combine).toBeDefined();
    expect(ICON_GLYPHS.looters).toBeDefined();
    render(<Insignia holder="government" />);
    // The winged cross: a round head, the blade, the guard, two wings with a feather line through
    // each, and a rosette under each wing.
    const mark = screen.getByTestId('insignia-government');
    expect(mark.querySelectorAll('circle')).toHaveLength(3);
  });
});
