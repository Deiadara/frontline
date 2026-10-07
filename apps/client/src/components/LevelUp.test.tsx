import { playerLevelGrants } from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LevelUpBanner } from './LevelUp';

const LEVELLED = { level: 4, levelsGained: 1, grants: playerLevelGrants(4), unlocks: [] };

/*
 * The banner's X (maintainer, 2026-10-06) is for the narrow district, where the banner covers the
 * build strip. Everywhere else it is drawn as it always was, with no X at all.
 */
describe('the level-up banner', () => {
  it('draws no X unless the screen asks for one', () => {
    render(<LevelUpBanner levelUp={LEVELLED} />);
    expect(screen.queryByTestId('level-up-dismiss')).toBeNull();
  });

  it('closes on its X where the screen offers one', () => {
    const onDismiss = vi.fn();
    render(<LevelUpBanner levelUp={LEVELLED} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('level-up-dismiss'));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
