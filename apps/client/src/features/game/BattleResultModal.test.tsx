import { STARTING_RESOURCES, playerLevelGrants, type BattleResult } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BattleResultModal } from './BattleResultModal';

const result: BattleResult = {
  winner: 'attacker',
  log: ['Breach charge set'],
  rewards: { scrap: 40 },
};

function show(levelUp?: { level: number; levelsGained: number }) {
  render(
    <BattleResultModal
      result={result}
      resources={STARTING_RESOURCES}
      targetName="Rustyard"
      levelUp={
        levelUp ? { ...levelUp, grants: playerLevelGrants(levelUp.level), unlocks: [] } : undefined
      }
      onClose={() => {}}
    />,
  );
}

/**
 * MOU-227: the raid response is the only place this level-up is reported, so the report modal is
 * where the player finds out. What is asserted is the *grants*: the level number alone does not
 * tell them the raid just bought a bigger assignee pool.
 */
describe('BattleResultModal announces the level-up the raid paid for (§I2)', () => {
  it('names the new level and what it granted', () => {
    show({ level: 4, levelsGained: 1 });

    const banner = screen.getByRole('region', { name: 'Level up' });
    expect(banner).toHaveTextContent('LEVEL 4');
    const grants = playerLevelGrants(4);
    expect(banner).toHaveTextContent(`Recruit slots${grants.recruitSlots}`);
  });

  it('says how many levels when one raid crossed several', () => {
    show({ level: 5, levelsGained: 2 });

    expect(screen.getByRole('region', { name: 'Level up' })).toHaveTextContent('+2 levels');
  });

  it('does not count a single level, which would read as noise', () => {
    show({ level: 2, levelsGained: 1 });

    expect(screen.getByRole('region', { name: 'Level up' })).not.toHaveTextContent('levels');
  });

  it('shows nothing at all when the raid did not cross a level', () => {
    show();

    // Presence is the whole signal: an empty or zeroed banner would be a false announcement.
    expect(screen.queryByRole('region', { name: 'Level up' })).toBeNull();
    // The rest of the report is untouched by its absence.
    expect(screen.getByText('VICTORY')).toBeInTheDocument();
  });
});
