import { BLACK_MARKET_GOODS, CONSUMABLE_ITEM_IDS } from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoostStash } from './BoostStash';

/**
 * Bug pass, 2026-10-02: the shelf's "held" summed the boosts and the traps, so one screen read the
 * tab's 3, the shelf's 5 and the traps' 2. The shelf counts its own boosts.
 */
describe('the count on the shelf', () => {
  it('is the boosts on it, not the traps below it', () => {
    const boost = Object.values(BLACK_MARKET_GOODS).find((good) => good.kind === 'battle_boost')!;
    const trap = CONSUMABLE_ITEM_IDS[0];
    render(<BoostStash stash={{ [boost.id]: 3 }} inventory={{ [trap]: 2 }} />);
    expect(screen.getByTestId('battle-stash-total')).toHaveTextContent('3 held');
  });
});

// Bug pass, 2026-10-02: a trap's card drew the boosts' glyph, which has no traps and fell back to a
// bare circle, while its slot drew the trap's own mark.
describe('a trap opened off the shelf', () => {
  it('is drawn with the mark its slot wears', () => {
    const trap = CONSUMABLE_ITEM_IDS[0];
    render(<BoostStash stash={{}} inventory={{ [trap]: 1 }} />);
    const slot = screen.getByTestId(`battle-stash-${trap}`);
    const onShelf = slot.querySelector('svg')?.innerHTML;
    fireEvent.click(slot);
    expect(onShelf).toBeTruthy();
    expect(screen.getByTestId('stash-card').querySelector('svg')?.innerHTML).toBe(onShelf);
  });
});
