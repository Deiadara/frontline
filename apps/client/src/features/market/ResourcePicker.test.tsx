import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResourcePicker } from './ResourcePicker';

/** Bug pass, 2026-10-06: the stockpile settles in fractions, and the tiles printed them raw. */
describe('the resource tiles', () => {
  it('print what is held whole, on the tile and in its tip', () => {
    render(
      <ResourcePicker
        value="scrap"
        onChange={() => undefined}
        held={{ scrap: 1234.5678 }}
        label="Give"
        data-testid="give"
      />,
    );
    const tile = screen.getByTestId('give-scrap');
    expect(tile).toHaveTextContent('1,235');
    expect(tile).not.toHaveTextContent('1,234.568');
    expect(tile.getAttribute('data-tip')).toContain('1,235 held');
  });
});
