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
    claimed: 0,
    ready: 0,
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

/**
 * The header's fraction, on a card drawing one rung of a ten-rung ladder.
 *
 * This is the shape the board is in at rest now: `current` folds the collected rungs away and the
 * shut ones above the next door, so most cards draw one or two rows out of ten. Counted over the
 * rows on screen, as it was, the header on this card would read `0/1`.
 */
describe('the header of a folded ladder', () => {
  it('counts the whole ladder, not the rungs that survived the filter', () => {
    const spec = CAPS;
    render(
      <FeatLadder
        block={{ ...block(spec.target / 2), steps: 10, claimed: 3 }}
        claiming={new Set()}
        onClaim={() => {}}
      />,
    );
    expect(screen.getByTestId(`feat-block-done-${spec.id}`)).toHaveTextContent('3/10');
  });
});
