import { playerLevelGrants, type LevelUp } from '@frontline/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  // The toast dismisses itself on a timer now, so every case below has to be able to say "and no
  // time passed". Without fake timers the five second clock is simply never reached in a test and
  // the auto-dismiss would be the one behaviour with no coverage at all.
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  /**
   * It leaves on its own after five seconds.
   *
   * The old banner had no timer: it sat over the page until the player found a `Noted` link set at
   * 11px in a corner, which is the complaint that produced the rework. This is the half of the fix
   * a click cannot demonstrate.
   */
  it('takes itself away after five seconds with nobody touching it', () => {
    render(<ShellLevelUp levelUp={crossed} />);
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    // Still there at four: the dwell is five, and a card that left early would be unreadable.
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();
  });

  /** Hovering holds the clock, so the one player who wants to read an unlock can. */
  it('holds the clock while the pointer is on it', () => {
    render(<ShellLevelUp levelUp={crossed} />);
    fireEvent.mouseEnter(screen.getByTestId('level-up-toast'));

    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByTestId('level-up-toast'));
    act(() => {
      vi.advanceTimersByTime(5_100);
    });
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();
  });

  it('stays up after the poll that carried it has moved on, until it is dismissed', () => {
    const { rerender } = render(<ShellLevelUp levelUp={crossed} />);
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();

    // The next poll: no level-up on it. The banner has to stay.
    rerender(<ShellLevelUp levelUp={undefined} />);
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('level-up-dismiss'));
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
    fireEvent.click(screen.getByTestId('level-up-dismiss'));
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();

    rerender(<ShellLevelUp levelUp={undefined} />);
    // A fresh object carrying the same award: a different identity, the same level.
    rerender(<ShellLevelUp levelUp={{ ...crossed }} />);
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();
  });

  it('still announces the next level after one has been dismissed', () => {
    const { rerender } = render(<ShellLevelUp levelUp={crossed} />);
    fireEvent.click(screen.getByTestId('level-up-dismiss'));

    rerender(<ShellLevelUp levelUp={undefined} />);
    rerender(<ShellLevelUp levelUp={{ ...crossed, level: 6, grants: playerLevelGrants(6) }} />);
    expect(screen.getByTestId('shell-level-up')).toBeInTheDocument();
  });

  it('draws nothing when nothing was crossed', () => {
    render(<ShellLevelUp levelUp={undefined} />);
    expect(screen.queryByTestId('shell-level-up')).not.toBeInTheDocument();
  });
});
