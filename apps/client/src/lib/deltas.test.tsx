import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeltaFloat } from '../components/ui/Delta';
import { playerXpToNextLevel } from '@frontline/shared';
import {
  DELTA_MS,
  shownDeltas,
  trickleAllowance,
  useDeltaMarks,
  xpBehind,
  type TrickleRates,
} from './deltas';

type Key = 'scrap' | 'caps';

/** One hour of wall clock between two settles, in the server's own stamps. */
const AT_ZERO = '2026-09-07T00:00:00.000Z';
const TWO_SECONDS_ON = '2026-09-07T00:00:02.000Z';
const A_MINUTE_ON = '2026-09-07T00:01:00.000Z';
const ALMOST_AN_HOUR_ON = '2026-09-07T00:59:00.000Z';
const AN_HOUR_ON = '2026-09-07T01:00:00.000Z';

const trickle = (
  settledAt: string | null,
  perHour: Partial<Record<Key, number>>,
): TrickleRates<Key> => ({
  settledAt,
  perHour,
});

describe('trickleAllowance', () => {
  /**
   * A stockpile is stored whole, so the read that crosses the accumulated fraction banks the whole
   * unit however slow the rate is. Sized by rate x window alone, two seconds of an 8-an-hour still
   * writes off 0.004 of a unit and the banked 1 reads as a payday.
   *
   * Control: `WHOLE_UNIT_ALLOWANCE = 0` and this comes back at 0.0044. (Inside `shownDeltas` the
   * larger `GAIN_FLOOR` covers the same case, which is why this is pinned on the allowance itself.)
   */
  it('never writes off less than one whole unit', () => {
    const allowance = trickleAllowance<Key>(
      { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 8 }) },
      { values: { scrap: 1001, caps: 0 }, trickle: trickle(TWO_SECONDS_ON, { scrap: 8 }) },
    );
    expect(allowance.scrap).toBe(1);
  });

  /** Above a whole unit it is the rate that decides: an hour of a 200-an-hour yard is 600. */
  it('sizes itself by the rate once the rate is worth more than a unit', () => {
    const allowance = trickleAllowance<Key>(
      { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 200 }) },
      { values: { scrap: 1001, caps: 0 }, trickle: trickle(AN_HOUR_ON, { scrap: 200 }) },
    );
    expect(allowance.scrap).toBe(600);
  });
});

describe('shownDeltas', () => {
  it('shows a spend', () => {
    expect(
      shownDeltas<Key>(
        { values: { scrap: 5000, caps: 900 } },
        { values: { scrap: 5000, caps: 900 - 1200 } },
      ),
    ).toEqual({ caps: -1200 });
  });

  it('shows a gain', () => {
    expect(
      shownDeltas<Key>({ values: { scrap: 100, caps: 0 } }, { values: { scrap: 500, caps: 0 } }),
    ).toEqual({ scrap: 400 });
  });

  /**
   * The passive trickle is the whole reason this filter exists. A Scrapyard making 200 scrap an
   * hour banks about three of them a minute, and a figure thrown for that every minute is what
   * teaches a player to stop looking at the figures that matter.
   */
  it('writes off a rise no larger than what the structures could have made', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 200 }) };
    const after = {
      values: { scrap: 1003, caps: 0 },
      trickle: trickle(A_MINUTE_ON, { scrap: 200 }),
    };
    expect(shownDeltas<Key>(before, after)).toEqual({});
  });

  it('still shows a rise the trickle cannot explain', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 200 }) };
    const after = {
      values: { scrap: 1400, caps: 0 },
      trickle: trickle(A_MINUTE_ON, { scrap: 200 }),
    };
    expect(shownDeltas<Key>(before, after)).toEqual({ scrap: 400 });
  });

  /**
   * The margin has to cover what the client cannot see: crew production perks and the ground the
   * crew holds, neither of which is on `/me`. An hour of a 200-an-hour yard is written off up to
   * (200 + 100) x 2 = 600.
   */
  it('sizes the write-off by the window between the two server settles, not by the browser clock', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 200 }) };
    const quiet = {
      values: { scrap: 1550, caps: 0 },
      trickle: trickle(AN_HOUR_ON, { scrap: 200 }),
    };
    const loud = { values: { scrap: 1700, caps: 0 }, trickle: trickle(AN_HOUR_ON, { scrap: 200 }) };
    expect(shownDeltas<Key>(before, quiet)).toEqual({});
    expect(shownDeltas<Key>(before, loud)).toEqual({ scrap: 700 });
  });

  /**
   * The board's bug, to the digit.
   *
   * Launching a mission drops `/me`; that read settles the two seconds since the last one and
   * banks a whole unit of a low-rate resource, because a stockpile is stored whole. Two seconds of
   * an 8-an-hour still is 0.004 units by the rate, so the rate alone writes off nothing and the
   * player gets a pop-up saying they were paid one oil for launching a mission.
   *
   * Control: drop `GAIN_FLOOR` back to 0 (or take `WHOLE_UNIT_ALLOWANCE` out of the allowance) and
   * this case goes back to reporting `{ oil: 1 }`.
   */
  it('writes off a whole unit banked by a settle seconds after the last reading', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 8 }) };
    const after = {
      values: { scrap: 1001, caps: 0 },
      trickle: trickle(TWO_SECONDS_ON, { scrap: 8 }),
    };
    expect(shownDeltas<Key>(before, after)).toEqual({});
  });

  /**
   * And two of them, on a rate high enough to bank both.
   *
   * The whole-unit allowance covers one; `GAIN_FLOOR` is what covers the second, which is the case
   * two low-rate resources crossing on the same read produces.
   *
   * Control: `GAIN_FLOOR = 0` and this reports `{ scrap: 2 }` while the +1 case above stays green,
   * which is why the two are pinned separately.
   */
  it('writes off two whole units banked by the same settle', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 8 }) };
    const after = {
      values: { scrap: 1002, caps: 0 },
      trickle: trickle(TWO_SECONDS_ON, { scrap: 8 }),
    };
    expect(shownDeltas<Key>(before, after)).toEqual({});
  });

  /** The same two seconds, and a figure no settle could have produced: a mission came home. */
  it('shows a payout in the same two seconds', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 8 }) };
    const after = {
      values: { scrap: 1040, caps: 0 },
      trickle: trickle(TWO_SECONDS_ON, { scrap: 8 }),
    };
    expect(shownDeltas<Key>(before, after)).toEqual({ scrap: 40 });
  });

  /** And a single unit going the other way is a spend, which is never filtered. */
  it('shows a one-unit spend in the same two seconds', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 8 }) };
    const after = {
      values: { scrap: 999, caps: 0 },
      trickle: trickle(TWO_SECONDS_ON, { scrap: 8 }),
    };
    expect(shownDeltas<Key>(before, after)).toEqual({ scrap: -1 });
  });

  /**
   * The floor is for stockpiles that produce. A counter with no passive source behind it (the
   * infamy wallet, the unit roster, the satchel) announces every move: one found servo is +1 item
   * and there is nothing else it could have been.
   */
  it('shows a single unit on a reading with no production behind it', () => {
    expect(
      shownDeltas<Key>({ values: { scrap: 3, caps: 0 } }, { values: { scrap: 4, caps: 0 } }),
    ).toEqual({ scrap: 1 });
  });

  /** Nothing in the game quietly drains a stockpile, so a fall is never weather. */
  it('never writes off a fall', () => {
    const before = { values: { scrap: 1000, caps: 0 }, trickle: trickle(AT_ZERO, { scrap: 200 }) };
    const after = { values: { scrap: 999, caps: 0 }, trickle: trickle(AN_HOUR_ON, { scrap: 200 }) };
    expect(shownDeltas<Key>(before, after)).toEqual({ scrap: -1 });
  });
});

function Probe({ values, rates }: { values: Record<Key, number>; rates?: TrickleRates<Key> }) {
  const marks = useDeltaMarks<Key>(values, rates);
  return <DeltaFloat marks={marks['scrap'] ?? []} data-testid="scrap-deltas" />;
}

describe('useDeltaMarks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const figures = () => screen.queryAllByTestId(/^delta-(spend|gain)$/).map((el) => el.textContent);

  /** A page opening is not a payday. */
  it('announces nothing on the first reading', () => {
    render(<Probe values={{ scrap: 1000, caps: 500 }} />);
    expect(figures()).toEqual([]);
  });

  it('throws a red figure with a minus for a spend', () => {
    const { rerender } = render(<Probe values={{ scrap: 1000, caps: 500 }} />);
    rerender(<Probe values={{ scrap: 1000 - 1200 + 1200 - 400, caps: 500 }} />);
    const figure = screen.getByTestId('delta-spend');
    expect(figure).toHaveTextContent('-400');
    expect(figure.className).toContain('text-oxblood-300');
  });

  it('throws a green figure with a plus for a gain, grouped with separators', () => {
    const { rerender } = render(<Probe values={{ scrap: 1000, caps: 500 }} />);
    rerender(<Probe values={{ scrap: 12_400, caps: 500 }} />);
    const figure = screen.getByTestId('delta-gain');
    expect(figure).toHaveTextContent('+11,400');
    expect(figure.className).toContain('text-verdigris-300');
  });

  /** Two moves inside one figure's life stack in their own rows rather than overwriting. */
  it('stacks several in a row', () => {
    const { rerender } = render(<Probe values={{ scrap: 1000, caps: 500 }} />);
    rerender(<Probe values={{ scrap: 900, caps: 500 }} />);
    rerender(<Probe values={{ scrap: 700, caps: 500 }} />);
    expect(figures()).toEqual(['-100', '-200']);
    const lanes = screen.queryAllByTestId('delta-spend').map((el) => el.style.top);
    expect(new Set(lanes).size).toBe(2);
  });

  it('takes each figure away again on its own', () => {
    const { rerender } = render(<Probe values={{ scrap: 1000, caps: 500 }} />);
    rerender(<Probe values={{ scrap: 900, caps: 500 }} />);
    expect(figures()).toEqual(['-100']);
    act(() => void vi.advanceTimersByTime(DELTA_MS + 10));
    expect(figures()).toEqual([]);
  });

  /**
   * A poll that changed nothing must not restart the production window. Left unguarded, a
   * stockpile that sat still for an hour would have its next rise judged against five seconds of
   * output and every one of them would be announced.
   */
  it('measures the window from the last reading that moved, not from the last poll', () => {
    // An hour of polls that changed nothing, then 400 scrap: which is an hour of a 200-an-hour
    // yard and therefore weather. Judged against the *last poll* instead, it is 400 scrap in a
    // minute, and every quiet hour would end in a figure nobody was paid.
    const still = { scrap: 1000, caps: 500 };
    const { rerender } = render(<Probe values={still} rates={trickle(AT_ZERO, { scrap: 200 })} />);
    rerender(<Probe values={still} rates={trickle(ALMOST_AN_HOUR_ON, { scrap: 200 })} />);
    rerender(
      <Probe values={{ scrap: 1400, caps: 500 }} rates={trickle(AN_HOUR_ON, { scrap: 200 })} />,
    );
    expect(figures()).toEqual([]);
  });
});

/**
 * §I2: the level chip's receipt.
 *
 * The chip is drawn from a level plus progress *into* it, so the award that matters most is the
 * one that makes the second figure smaller. `xpBehind` folds the pair back into a total that only
 * rises, and the ordinary diff does the rest.
 */
describe('xpBehind', () => {
  it('is the progress itself at level 1', () => {
    expect(xpBehind(1, 40)).toBe(40);
  });

  it('adds every threshold the crew has already cleared', () => {
    // 100 to clear level 1 and 300 to clear level 2, and 500 into the third.
    expect(playerXpToNextLevel(1)).toBe(100);
    expect(playerXpToNextLevel(2)).toBe(300);
    expect(xpBehind(3, 500)).toBe(900);
  });

  /**
   * The figure the chip has to throw when an award crosses a threshold: what was left of the
   * level, plus what the next one opened with. 600 to clear level 3, 500 already in it, 20 in the
   * new one, so the award was 120.
   *
   * Control: diff `xpIntoLevel` directly (20 - 500) and this reads -480, which is the red minus
   * the chip used to be one wiring away from throwing at a level-up.
   */
  it('turns a level crossing into the award that paid for it', () => {
    expect(playerXpToNextLevel(3)).toBe(600);
    expect(xpBehind(4, 20) - xpBehind(3, 500)).toBe(120);
  });

  /** And a double crossing pays the whole thing: 100 left of level 3, all of level 4, then 10. */
  it('adds the levels an award skipped straight past', () => {
    expect(xpBehind(5, 10) - xpBehind(3, 500)).toBe(100 + playerXpToNextLevel(4) + 10);
  });

  /** A malformed row never throws on a read path: the level is clamped, the progress floored. */
  it('clamps a level below the floor', () => {
    expect(xpBehind(0, -5)).toBe(0);
  });
});

function XpProbe({ level, xpIntoLevel }: { level: number; xpIntoLevel: number }) {
  const marks = useDeltaMarks({ xp: xpBehind(level, xpIntoLevel) });
  return <DeltaFloat marks={marks['xp'] ?? []} unit="XP" data-testid="xp-deltas" />;
}

describe('the level chip receipt', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('throws a green figure in XP when a mission pays out', () => {
    const { rerender } = render(<XpProbe level={3} xpIntoLevel={500} />);
    rerender(<XpProbe level={3} xpIntoLevel={560} />);
    const figure = screen.getByTestId('delta-gain');
    expect(figure).toHaveTextContent('+60XP');
    expect(figure.className).toContain('text-verdigris-300');
  });

  /** The level-up case, which is the one a naive diff gets backwards. */
  it('throws the whole award when the payout crosses a level', () => {
    const { rerender } = render(<XpProbe level={3} xpIntoLevel={500} />);
    rerender(<XpProbe level={4} xpIntoLevel={20} />);
    const figure = screen.getByTestId('delta-gain');
    expect(figure).toHaveAttribute('data-amount', '120');
    expect(screen.queryByTestId('delta-spend')).toBeNull();
  });

  /** XP does not trickle, so there is no floor: a single point is still a receipt. */
  it('announces a single point', () => {
    const { rerender } = render(<XpProbe level={3} xpIntoLevel={500} />);
    rerender(<XpProbe level={3} xpIntoLevel={501} />);
    expect(screen.getByTestId('delta-gain')).toHaveAttribute('data-amount', '1');
  });
});
