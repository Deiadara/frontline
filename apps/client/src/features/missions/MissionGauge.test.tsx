import { BATTLE_ODDS, BATTLE_ODDS_LABELS, CHANCE_TONES, chanceTone } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MissionGauge, gaugeDial } from './MissionGauge';

/**
 * The instrument itself, away from the board that feeds it.
 *
 * Everything the dial does is arithmetic on one number, and all of it is wrong in ways a
 * screenshot cannot show: a needle a band out reads as a needle, and a figure struck in the wrong
 * colour reads as a figure. So the angles and the tones are pinned here, and the two ends of the
 * sweep are pinned by hand rather than through the function that produces them.
 */

/** What the rendered dial is saying, as the DOM carries it. */
function dialOf(element: HTMLElement): { tone: string | null; angle: number; figure: string } {
  return {
    tone: element.getAttribute('data-tone'),
    angle: Number(element.getAttribute('data-angle')),
    figure: screen.getByTestId('gauge-figure').textContent ?? '',
  };
}

const renderChance = (chance: number) => {
  const { unmount } = render(
    <MissionGauge reading={{ kind: 'chance', chance }} label="Chance it comes off" />,
  );
  const read = dialOf(screen.getByTestId('mission-gauge'));
  unmount();
  return read;
};

describe('where the needle sits', () => {
  /**
   * Written out rather than derived. The needle is an up-pointing blade rotated about the pivot,
   * so 0 has to be a quarter turn anticlockwise and 1 a quarter turn the other way; a dial that
   * had those the wrong way round, or that swept 180 degrees from the wrong start, would agree
   * with any expectation computed from the same expression the component uses.
   */
  it('points at the left of the arc for nothing and the right for a certainty', () => {
    expect(renderChance(0).angle).toBe(-90);
    expect(renderChance(1).angle).toBe(90);
    expect(renderChance(0.5).angle).toBe(0);
  });

  it('clamps a figure from outside the arc rather than swinging past the bezel', () => {
    expect(renderChance(-0.4).angle).toBe(-90);
    expect(renderChance(1.7).angle).toBe(90);
    expect(renderChance(1.7).figure).toBe('100%');
  });

  it('leaves the top band lit at a certainty instead of falling off the end of the tones', () => {
    // `chanceTone` floors into five bands, so 1.0 is the one input that indexes past the last one.
    expect(renderChance(1).tone).toBe('blue');
    expect(CHANCE_TONES.at(-1)).toBe('blue');
  });
});

describe('the tone under the figure', () => {
  /**
   * The band boundaries, at the four places the arithmetic can be a point out. Twenty points is
   * the *bottom* of orange, not the top of red, and so on up: a dial that used `Math.ceil`, or
   * that banded on `<=`, is a band low at every one of these and correct everywhere else.
   */
  it('bands each twenty points into the tone above it', () => {
    expect(renderChance(0.2).tone).toBe('orange');
    expect(renderChance(0.4).tone).toBe('yellow');
    expect(renderChance(0.6).tone).toBe('green');
    expect(renderChance(0.8).tone).toBe('blue');
    // And the point below each of them is still the band below.
    expect(renderChance(0.19).tone).toBe('red');
    expect(renderChance(0.39).tone).toBe('orange');
    expect(renderChance(0.59).tone).toBe('yellow');
    expect(renderChance(0.79).tone).toBe('green');
  });

  /**
   * The figure and the colour are one statement about one number.
   *
   * A chance a hair under a boundary prints the boundary and used to keep the band below it, so
   * two jobs both reading `60%` were struck in two different colours and the player comparing
   * them had no way to know why. Both sides are asserted: the tone has to *move* with the printed
   * figure at 0.599, and it has to stay put at 0.594, which still prints 59.
   *
   * The needle is asserted alongside them because the rounding lands in two places, the angle and
   * the band, and either one left reading the raw chance leaves the dial saying two things at
   * once. A whole point is 1.8 degrees, which is why nothing else here would notice.
   */
  it('colours the figure by the figure it printed, not by the digits it dropped', () => {
    const rounded = renderChance(0.599);
    expect(rounded.figure).toBe('60%');
    expect(rounded.tone).toBe('green');
    expect(rounded.angle).toBe(renderChance(0.6).angle);

    const under = renderChance(0.594);
    expect(under.figure).toBe('59%');
    expect(under.tone).toBe('yellow');
  });

  it('agrees with the shared banding for every whole point on the dial', () => {
    for (let points = 0; points <= 100; points += 1) {
      const read = renderChance(points / 100);
      expect(read.figure, `the figure at ${points}`).toBe(`${points}%`);
      expect(read.tone, `the tone at ${points}`).toBe(chanceTone(points / 100));
    }
  });
});

describe('a battle', () => {
  it('parks the needle in the middle of its own band and never prints a number', () => {
    for (const [index, odds] of BATTLE_ODDS.entries()) {
      const { at, figure } = gaugeDial({ kind: 'battle', odds });
      expect(at, `${odds} is not centred in its band`).toBeCloseTo(
        (index + 0.5) / BATTLE_ODDS.length,
        10,
      );
      expect(figure).toBe(BATTLE_ODDS_LABELS[odds]);
      expect(figure).not.toMatch(/%/);
    }
  });

  it('draws four bands, from the red end to the blue one', () => {
    expect(gaugeDial({ kind: 'battle', odds: 'low' })).toMatchObject({
      bands: ['red', 'orange', 'green', 'blue'],
      tone: 'red',
    });
    expect(gaugeDial({ kind: 'battle', odds: 'very_high' }).tone).toBe('blue');
  });
});

describe('what the dial says to somebody who cannot see it', () => {
  it('carries the measurement and the reading in one label', () => {
    render(<MissionGauge reading={{ kind: 'chance', chance: 0.62 }} label="Chance it comes off" />);
    expect(screen.getByRole('img', { name: 'Chance it comes off: 62%' })).toBeInTheDocument();
    // The drawing itself is decoration: the label above is the whole announcement.
    expect(screen.getByTestId('mission-gauge').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('names the band on a fight rather than reading out an invented percentage', () => {
    render(<MissionGauge reading={{ kind: 'battle', odds: 'good' }} label="How the fight looks" />);
    expect(
      screen.getByRole('img', { name: 'How the fight looks: Good chance' }),
    ).toBeInTheDocument();
  });
});

/**
 * The re-skin put a glow under the band the needle is standing in (maintainer request, 2026-09-13).
 *
 * That band is now the loudest thing on the instrument, so it has to be the same band the figure
 * is struck in. Lighting one band and colouring the number to match a different one is a dial that
 * says two things at once, which is the defect the rounding above already had to be fixed for.
 */
describe('the band that lights', () => {
  const litBand = (element: HTMLElement): string[] =>
    [...element.querySelectorAll<SVGPathElement>('path.gauge-band')]
      .filter((path) => path.getAttribute('opacity') === '1')
      .map((path) => path.getAttribute('class') ?? '');

  it('is the band the figure is struck in, and only that one', () => {
    render(<MissionGauge reading={{ kind: 'chance', chance: 0.62 }} label="Chance it comes off" />);
    const gauge = screen.getByTestId('mission-gauge');
    expect(gauge).toHaveAttribute('data-tone', 'green');
    expect(litBand(gauge)).toEqual(['gauge-band gauge-band-green']);

    // And the halo under it: one wide, faint copy of that same arc, in that same tone. Without
    // this the glow could be deleted outright and every other assertion here would stay green.
    const halo = [...gauge.querySelectorAll<SVGPathElement>('path.gauge-band')]
      .filter((path) => path.style.strokeWidth === '22')
      .map((path) => path.getAttribute('class'));
    expect(halo).toEqual(['gauge-band gauge-band-green']);
  });

  it('follows the needle across every band on both dials', () => {
    for (const points of [5, 25, 45, 65, 85, 100]) {
      const { unmount } = render(
        <MissionGauge reading={{ kind: 'chance', chance: points / 100 }} label="Chance" />,
      );
      const gauge = screen.getByTestId('mission-gauge');
      const tone = gauge.getAttribute('data-tone');
      expect(litBand(gauge), `at ${points} points`).toEqual([`gauge-band gauge-band-${tone}`]);
      unmount();
    }
    for (const odds of BATTLE_ODDS) {
      const { unmount } = render(<MissionGauge reading={{ kind: 'battle', odds }} label="Fight" />);
      const gauge = screen.getByTestId('mission-gauge');
      const tone = gauge.getAttribute('data-tone');
      expect(litBand(gauge), odds).toEqual([`gauge-band gauge-band-${tone}`]);
      unmount();
    }
  });
});
