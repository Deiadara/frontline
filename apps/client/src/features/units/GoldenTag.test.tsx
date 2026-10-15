import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModifierTag } from './tags';

/** The Breakers' Breaching, drawn in gold (maintainer, 2026-10-09). */
describe('a signature modifier', () => {
  const breaching = {
    label: 'Breaching',
    description: 'Hits through the gate.',
    when: 'at a gate',
  };

  it('draws in gold when the sheet marks it, and plain otherwise', () => {
    const { rerender } = render(<ModifierTag modifier={{ ...breaching, golden: true }} />);
    const chip = screen.getByText('Breaching');
    expect(chip.getAttribute('data-golden')).toBe('yes');
    expect(chip.className).toContain('text-ember-100');

    rerender(<ModifierTag modifier={breaching} />);
    const plain = screen.getByText('Breaching');
    expect(plain.getAttribute('data-golden')).toBeNull();
    expect(plain.className).toContain('text-verdigris-100');
  });
});
