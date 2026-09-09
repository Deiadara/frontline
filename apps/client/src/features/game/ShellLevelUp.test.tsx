import { playerLevelGrants, type LevelUp } from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShellLevelUp } from './ShellLevelUp';

/**
 * The shell's poll carries a level-up exactly once.
 *
 * `/me` settles the base and announces the level a build crossed on that one response; the next
 * poll, five seconds later, carries nothing. A banner that read the live value would flash for one
 * poll and vanish, so the latch has to hold what it saw until the player dismisses it.
 */
const crossed: LevelUp = {
  level: 5,
  levelsGained: 1,
  grants: playerLevelGrants(5),
  unlocks: [],
};

describe('the level-up the shell found', () => {
  it('stays up after the poll that carried it has moved on, until it is dismissed', () => {
    const { rerender } = render(<ShellLevelUp levelUp={crossed} />);
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();

    // The next poll: no level-up on it. The banner has to stay.
    rerender(<ShellLevelUp levelUp={undefined} />);
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Noted' }));
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();
  });

  /**
   * A level-up is announced once, whoever delivers it.
   *
   * The world clock banks a level and the next `/me` drains it, so this arrives with nothing the
   * player did behind it and with no second chance to be seen: the latch is the whole signal. But
   * the award is absent between deliveries, so structural sharing cannot hold the object identity,
   * and anything that hands the same award over twice (a retried poll, a second tab that drained
   * after this one had drawn it) used to pop the banner back over a player who had dismissed it.
   */
  it('does not re-announce a level the player has already dismissed', () => {
    const { rerender } = render(<ShellLevelUp levelUp={crossed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Noted' }));
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();

    rerender(<ShellLevelUp levelUp={undefined} />);
    // A fresh object carrying the same award: a different identity, the same level.
    rerender(<ShellLevelUp levelUp={{ ...crossed }} />);
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();
  });

  it('still announces the next level after one has been dismissed', () => {
    const { rerender } = render(<ShellLevelUp levelUp={crossed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Noted' }));

    rerender(<ShellLevelUp levelUp={undefined} />);
    rerender(<ShellLevelUp levelUp={{ ...crossed, level: 6, grants: playerLevelGrants(6) }} />);
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();
  });

  it('draws nothing when nothing was crossed', () => {
    render(<ShellLevelUp levelUp={undefined} />);
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();
  });
});
