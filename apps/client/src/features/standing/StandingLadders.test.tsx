import {
  NOTORIETY_TIERS,
  PLAYER_LEVEL_MIN,
  PLAYER_LEVEL_UNLOCKS,
  describeNotorietyGrant,
  notorietySpentTo,
  notorietyUpgradeCost,
  playerXpToNextLevel,
} from '@frontline/shared';
import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two screens the standing chips open (maintainer request, 2026-09-17).
 *
 * What is worth pinning here is not that the pages render: it is that **every figure on them is the
 * game's own**. Both screens are a table of numbers a player will plan around, and a table of
 * numbers is exactly the artefact that goes quietly wrong: the curve is retuned, or a milestone is
 * filed, and a hand-typed copy of it sits there being wrong with nothing to say so. So the
 * assertions walk the whole ladder and compare each rung against `playerXpToNextLevel`,
 * `notorietyUpgradeCost`, `notorietySpentTo` and `describeNotorietyGrant` rather than against a
 * fixture written out here, which would only be the same table twice.
 */

const useMe = vi.hoisted(() => vi.fn());
vi.mock('../../lib/queries', () => ({
  useMe,
  // `DrawnMeter` lives in `components/Meters`, which is where the infamy chip's write hook is
  // imported from: the module is one module however many specifiers reach it.
  useUpgradeNotoriety: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));
vi.mock('../../assets/delivered', () => ({ deliveredUrl: () => null }));

const { LevelLadderPage, ladderCeiling } = await import('./LevelLadderPage');
const { NotorietyLadderPage } = await import('./NotorietyLadderPage');

/** A district part way up both ladders, so held, current and unreached rungs are all on screen. */
const LEVEL = 7;
const RANK = 4;
const INFAMY = 40_000;

function standing(level = LEVEL, notoriety = RANK, infamy = INFAMY) {
  return {
    data: {
      base: {
        level,
        progression: { xpIntoLevel: 700 },
        economy: { infamy, notoriety },
      },
    },
    isError: false,
    refetch: vi.fn(),
  };
}

/** Both pages carry a `Link` home, so both need a router. `/game` is where that link points. */
const mount = (ui: ReactElement) =>
  render(
    <MemoryRouter initialEntries={['/game/standing']}>
      <Routes>
        <Route path="/game/standing" element={ui} />
        <Route path="/game" element={<p>the district</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useMe.mockReturnValue(standing());
});

describe('the level ladder', () => {
  it('prints the shared threshold on every rung it draws, and draws every rung', () => {
    mount(<LevelLadderPage />);

    /*
     * Two ends, and one of them is deliberately not `ladderCeiling`.
     *
     * The length check reads the same helper the page reads, so on its own it is the source
     * agreeing with itself and would stay green if the ceiling collapsed to one rung. The anchor
     * is the catalogue: whatever the ceiling does, a ladder that does not reach the last thing the
     * game unlocks is a ladder with the end of the game missing off it.
     */
    const last = PLAYER_LEVEL_UNLOCKS.reduce((top, unlock) => Math.max(top, unlock.level), 0);
    expect(last, 'nothing in the catalogue has a level').toBeGreaterThan(PLAYER_LEVEL_MIN);
    expect(screen.getByTestId(`level-rung-${PLAYER_LEVEL_MIN}`)).toBeInTheDocument();
    expect(screen.getByTestId(`level-rung-${last}`)).toBeInTheDocument();

    const top = ladderCeiling(LEVEL, PLAYER_LEVEL_UNLOCKS);
    expect(top, 'the ladder has no rungs to check').toBeGreaterThan(PLAYER_LEVEL_MIN);
    expect(screen.getAllByTestId(/^level-rung-\d+$/)).toHaveLength(top - PLAYER_LEVEL_MIN + 1);

    for (let at = PLAYER_LEVEL_MIN; at <= top; at += 1) {
      const rung = screen.getByTestId(`level-rung-${at}`);
      expect(rung, `level ${at}`).toHaveTextContent(playerXpToNextLevel(at).toLocaleString());
    }
  });

  /**
   * A threshold with no reward beside it is a price with nothing on the other end of it, which is
   * the state levelling was in before this screen existed: §I3's catalogue was entirely invisible.
   */
  it('names what opens at the level it opens at, off the shared catalogue', () => {
    mount(<LevelLadderPage />);

    expect(PLAYER_LEVEL_UNLOCKS.length, 'nothing opens at any level').toBeGreaterThan(0);
    for (const unlock of PLAYER_LEVEL_UNLOCKS) {
      const rung = screen.getByTestId(`level-rung-${unlock.level}`);
      expect(within(rung).getByText(unlock.name), unlock.id).toBeInTheDocument();
      expect(within(rung).getByText(unlock.description), unlock.id).toBeInTheDocument();
    }
  });

  it('marks the rung the district is standing on', () => {
    mount(<LevelLadderPage />);

    expect(screen.getByTestId(`level-rung-${LEVEL}`)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId(`level-rung-${LEVEL + 1}`)).not.toHaveAttribute('aria-current');
  });

  /** A player past the top of the catalogue must still see a rung above them to aim at. */
  it('runs the ladder past a district that has outgrown the catalogue', () => {
    const beyond = ladderCeiling(PLAYER_LEVEL_MIN, PLAYER_LEVEL_UNLOCKS) + 6;
    useMe.mockReturnValue(standing(beyond));
    mount(<LevelLadderPage />);

    expect(screen.getByTestId(`level-rung-${beyond}`)).toBeInTheDocument();
    expect(screen.getByTestId(`level-rung-${beyond + 1}`)).toBeInTheDocument();
  });
});

describe('the notoriety ladder', () => {
  it('draws all fourteen rungs and prices each one off the shared curve', () => {
    mount(<NotorietyLadderPage />);

    // By test id rather than by role: each rung carries a list of its own grants, so counting
    // every `listitem` on the screen counts the grants too.
    expect(screen.getAllByTestId(/^notoriety-rung-\d+$/)).toHaveLength(NOTORIETY_TIERS.length);

    NOTORIETY_TIERS.forEach((tier, at) => {
      const rung = screen.getByTestId(`notoriety-rung-${at}`);
      expect(within(rung).getByText(tier)).toBeInTheDocument();
      if (at === 0) {
        // Nobody is where everybody starts, so it is the one rung with no price on it.
        expect(rung).toHaveTextContent('Where everybody starts');
        return;
      }
      const price = notorietyUpgradeCost(at - 1);
      expect(price, `${tier} is unreachable`).not.toBeNull();
      expect(rung, tier).toHaveTextContent((price ?? 0).toLocaleString());
      expect(within(rung).getByTestId(`notoriety-total-${at}`)).toHaveTextContent(
        notorietySpentTo(at).toLocaleString(),
      );
    });
  });

  /**
   * §D7 gave every rung above `Nobody` a grant, and until this screen the only one a player could
   * ever read was the next one up. A rank at the far end costs a fortune and has to be able to
   * justify itself from where the player is standing.
   */
  it('says what every rank pays, not only the next one', () => {
    mount(<NotorietyLadderPage />);

    NOTORIETY_TIERS.forEach((tier, at) => {
      const rung = screen.getByTestId(`notoriety-rung-${at}`);
      for (const line of describeNotorietyGrant(at)) {
        expect(within(rung).getByText(line), `${tier}: ${line}`).toBeInTheDocument();
      }
    });
  });

  it('marks the rank the crew holds', () => {
    mount(<NotorietyLadderPage />);

    expect(screen.getByTestId(`notoriety-rung-${RANK}`)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId(`notoriety-rung-${RANK + 1}`)).not.toHaveAttribute('aria-current');
  });

  /** The top of the ladder has nothing above it, so it must not quote a price for a rung. */
  it('says there is no rung above the top of the ladder', () => {
    useMe.mockReturnValue(standing(LEVEL, NOTORIETY_TIERS.length - 1, 9_000_000));
    mount(<NotorietyLadderPage />);

    expect(screen.getByTestId('notoriety-standing')).toHaveTextContent('no rank above this one');
  });
});

describe('the way out', () => {
  /**
   * Drawn, top right, and it goes home (maintainer, 2026-09-17).
   *
   * The filter primitives are the assertion rather than a class name, because they are what makes
   * the mark a drawing: a plain `x` glyph swapped in behind the same class would keep every other
   * assertion on this page green.
   */
  const expectDrawnClose = () => {
    const close = screen.getByTestId('standing-close');
    expect(close).toHaveAttribute('href', '/game');
    // The filter primitives on the **cross itself**, not on the ring behind it: the ring is a
    // drawing whatever the cross is, so asserting anywhere inside the link would stay green with
    // a plain glyph in the middle of it.
    const cross = within(close).getByTestId('standing-close-mark');
    expect(cross.querySelector('feTurbulence')).not.toBeNull();
    expect(cross.querySelector('feDisplacementMap')).not.toBeNull();
  };

  it('draws a hand-inked X on the level ladder that leads back to the district', () => {
    mount(<LevelLadderPage />);
    expectDrawnClose();
  });

  it('draws a hand-inked X on the notoriety ladder that leads back to the district', () => {
    mount(<NotorietyLadderPage />);
    expectDrawnClose();
  });
});
