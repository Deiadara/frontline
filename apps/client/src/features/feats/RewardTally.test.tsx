import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RewardTally } from './RewardTally';

describe('the reward tokens', () => {
  // P8-A (2026-10-02): a page drawn on the claim is promised by count, not by name.
  it('draws random pages as one counted token', () => {
    render(<RewardTally reward={{ pages: 2, resources: { caps: 300 } }} data-testid="tally" />);
    const tally = screen.getByTestId('tally');
    expect(tally.textContent).toContain('Random blueprint pages');
    expect(tally.textContent).toContain('x2');
  });

  it('names a single random page as one', () => {
    render(<RewardTally reward={{ pages: 1 }} data-testid="tally" />);
    expect(screen.getByTestId('tally').textContent).toContain('A random blueprint page');
  });
});
