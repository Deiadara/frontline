import { findFeat } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FeatLadder } from './FeatLadder';
import type { FeatBlock } from './featsList';

/**
 * The progress line under a rung, on the one input that can make it lie.
 *
 * Lifetime counters bank fractions: production settles in fractional carry, so `resources_earned`
 * is a real number and the ladders built on it ask for three million of it. Rounding the figure to
 * draw it meant a crew a fraction short read `3,000,000 / 3,000,000` on a rung with no CLAIM
 * button, which is the screen telling a player the game has lost their progress.
 */

/** The lifetime-caps rung: three million of a measure that banks in fractions. */
const CAPS = findFeat('caps_3')!;

const block = (value: number): FeatBlock => {
  const spec = CAPS;
  return {
    chain: spec.chain,
    steps: 1,
    key: spec.id,
    rungs: [
      {
        spec,
        progress: {
          id: spec.id,
          state: 'open',
          value,
          target: spec.target,
          progress: value / spec.target,
        },
        step: 1,
      },
    ],
  };
};

describe('the figure under a rung', () => {
  it('never reads finished on a rung that is not', () => {
    const spec = CAPS;
    // A hair under the target, which is where a fractional counter actually sits.
    render(<FeatLadder block={block(spec.target - 0.4)} claiming={new Set()} onClaim={() => {}} />);

    const line = screen.getByTestId(`feat-count-${spec.id}`);
    expect(line).not.toHaveTextContent(
      `${spec.target.toLocaleString()} / ${spec.target.toLocaleString()}`,
    );
    expect(line).toHaveTextContent(`${(spec.target - 1).toLocaleString()}`);
  });

  it('reads the whole figure once the rung is finished', () => {
    const spec = CAPS;
    render(<FeatLadder block={block(spec.target)} claiming={new Set()} onClaim={() => {}} />);
    expect(screen.getByTestId(`feat-count-${spec.id}`)).toHaveTextContent(
      `${spec.target.toLocaleString()} / ${spec.target.toLocaleString()}`,
    );
  });
});
