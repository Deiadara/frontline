/**
 * The rule the standing bar broke, checked everywhere it could break again.
 *
 * The board's report was one screenshot: a long notoriety rank ("Back-Alley Rumored") widened its
 * plate, the plate pushed the crew name off the line, and the top of every screen came apart. The
 * fix was local. The *rule* is not, and it is worth writing down because it is not obvious:
 *
 *   **A readout is an instrument. Its size is a property of the instrument, not of the reading.**
 *
 * A number that gets longer, a rank that gets wordier and a name somebody typed are all readings.
 * Every one of them belongs in a box whose width was decided before the value arrived, and every
 * one of them needs a stated plan for a value that does not fit: wrap it, clamp it, or cut it with
 * an ellipsis. A box with no plan silently picks the worst one, which is to grow.
 *
 * ## What can and cannot be tested here
 *
 * jsdom has no layout engine: `getBoundingClientRect` is all zeroes, so nothing in this file can
 * answer "do these two boxes overlap". That question is answered in a real browser, by
 * `visual.spec.ts`, and that is the test that actually caught the board's screenshot.
 *
 * What this catches is the *cause*, one layer down and much earlier: a component that hands a
 * variable-length value to a box with no width and no wrapping plan is broken whether or not
 * today's fixture happens to be short enough to hide it. These run in milliseconds against real
 * rendered output, so they cover components no screenshot matrix will ever have a fixture for.
 *
 * Deliberately checked against the DOM rather than against the source. A source scan for `w-[`
 * cannot tell a fixed-width text plate from a decorative rule or a `max-w` ceiling, and flags
 * roughly twenty-five innocent lines in this client: a gate that cries wolf gets switched off.
 */
import {
  DISTRICT_NAME_MAX,
  FORTIFY_MAX_LEVEL,
  LOCATION_CATALOG,
  RESOURCE_KEYS,
  isPlainDay,
  weatherAt,
  labelText,
  notorietyTier,
  type EnvLabel,
  type Resources,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CrewLevelChip, InfamyChip } from './Meters';
import { CostLine, ResourceChip } from './Resources';
import { NumberField } from './ui/NumberField';
import { Panel } from './ui/Panel';
import { WeatherBanner } from './ui/WeatherBanner';
import { DescribedTag } from './ui/DescribedTag';
import { FortifyMeter } from './ui/FortifyMeter';
import { LabelChip, LabelRow } from './ui/LabelChip';
import { ProgressBar } from './ui/ProgressBar';

vi.mock('../assets/delivered', () => ({ deliveredUrl: () => null }));

/**
 * The providers a chip may reach for, so a case is one line rather than four.
 *
 * Several of these readouts are also controls: the level chip links to the crew, the infamy chip
 * opens the ladder. Rendering them bare throws before an assertion can run, and wrapping only the
 * ones that need it means the next case added here fails for a reason that has nothing to do with
 * layout.
 */
function render(ui: ReactElement): RenderResult {
  return rtlRender(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/* -------------------------------------------------------------------------- */
/* The invariants                                                              */
/* -------------------------------------------------------------------------- */

/** How a box may hold text that does not fit it. Any one of these is a plan; none is a bug. */
const WRAP_PLAN =
  /\b(truncate|text-balance|text-pretty|break-words|break-all|line-clamp-\d+|overflow-hidden|overflow-x-auto|whitespace-normal|whitespace-pre-wrap)\b/;

/** A width decided in advance. `min-w-`/`max-w-` are deliberately **not** this: they both give. */
const FIXED_WIDTH = /(?:^|\s)w-\[[^\]]+\]/;

/** Text that is entirely a number, with the separators a number is allowed to carry. */
const PURELY_NUMERIC = /^[\d\s.,%+\-−/×x]+$/;

/** `tabular-nums` here or on anything above it: inherited, so an ancestor counts. */
function hasTabularFigures(el: Element): boolean {
  for (let cursor: Element | null = el; cursor !== null; cursor = cursor.parentElement) {
    if (cursor.className.toString().includes('tabular-nums')) return true;
  }
  return false;
}

/** Elements whose own text is a leaf: the ones actually painting characters. */
function textLeaves(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('*')].filter(
    (el) =>
      el.children.length === 0 && (el.textContent ?? '').trim() !== '' && el.tagName !== 'STYLE',
  );
}

/**
 * Every digit in the game is the same width as every other digit.
 *
 * Proportional figures are why a counter ticking 1109 → 1110 jogs the label beside it: `1` is
 * narrower than `0` in almost every typeface with a proportional default. In a row of readouts
 * that reads as the whole row twitching. The board asked for this in as many words ("have all the
 * numbers always be the same size so it's not weird"), and it is one class.
 */
function expectFiguresAreTabular(result: RenderResult, what: string): void {
  const loose = textLeaves(result.container)
    .filter((el) => PURELY_NUMERIC.test((el.textContent ?? '').trim()))
    .filter((el) => !hasTabularFigures(el))
    .map((el) => `"${el.textContent?.trim()}"`);
  expect([...new Set(loose)], `${what}: figures set in proportional digits`).toEqual([]);
}

/**
 * A box given a fixed width has said what to do when the text is longer than the box.
 *
 * Without a plan the browser picks one, and the one it picks is to overflow: the text is drawn
 * straight out of the box, over whatever is beside it. That is exactly the screenshot the board
 * sent. Wrapping counts as a plan, and is usually the right one: two short lines in a plate that
 * never moves beats one long line in a plate that does.
 */
function expectFixedBoxesCanHoldTheirText(result: RenderResult, what: string): void {
  const unplanned = [...result.container.querySelectorAll<HTMLElement>('*')]
    .filter((el) => (el.textContent ?? '').trim() !== '')
    .filter((el) => FIXED_WIDTH.test(el.className.toString()))
    .filter((el) => {
      const cls = el.className.toString();
      // `whitespace-nowrap` withdraws the default plan (wrapping) and must replace it.
      const wrapsByDefault = !/\bwhitespace-nowrap\b/.test(cls);
      return !wrapsByDefault && !WRAP_PLAN.test(cls);
    })
    .map((el) => `"${el.textContent?.trim().slice(0, 40)}"`);
  expect(unplanned, `${what}: fixed-width boxes that can neither wrap nor clip`).toEqual([]);
}

/* -------------------------------------------------------------------------- */
/* The cases                                                                   */
/* -------------------------------------------------------------------------- */

/** Seven figures in every resource: the largest number the stockpile can put on screen. */
const HUGE: Resources = Object.fromEntries(
  RESOURCE_KEYS.map((key) => [key, 9_999_999]),
) as unknown as Resources;

/** The wordiest label in the catalogue, found rather than typed so a retune cannot outdate it. */
const WORST_LABEL: EnvLabel = (() => {
  const all = Object.values(LOCATION_CATALOG).flatMap((spec) => spec.labels);
  return all.reduce((worst, label) =>
    labelText(label).length > labelText(worst).length ? label : worst,
  );
})();

/** The longest rank on the ladder, same reasoning. */
const WORST_TIER = (() => {
  let worst = '';
  for (let n = 0; n < 60; n += 1) {
    const tier = notorietyTier(n);
    if (tier.length > worst.length) worst = tier;
  }
  return worst;
})();

/** The notoriety that spells the longest rank. Found, so a retune of the ladder cannot outdate it. */
const WORST_NOTORIETY = (() => {
  let worst = { notoriety: 0, length: 0 };
  for (let n = 0; n < 60; n += 1) {
    const length = notorietyTier(n).length;
    if (length > worst.length) worst = { notoriety: n, length };
  }
  return worst.notoriety;
})();

/**
 * A day the sky is doing something, so the banner renders at all.
 *
 * `WeatherBanner` returns `null` on a plain day, and a fixed date would eventually land on one and
 * quietly turn this case into a test of nothing. Searched instead, and the search failing is
 * itself worth knowing about.
 */
const WORST_WEATHER_DAY = (() => {
  for (let day = 0; day < 400; day += 1) {
    const at = new Date(Date.UTC(2026, 0, 1 + day, 12));
    if (!isPlainDay(weatherAt(at))) return at;
  }
  throw new Error('no day in a year of the calendar has weather on it');
})();

/**
 * Each case renders one component at the largest content the game can hand it.
 *
 * "Largest" is derived from the domain wherever there is a domain to derive it from, so a new rank
 * or a wordier ground label is covered the day it is authored rather than the day somebody
 * remembers to widen a literal here.
 */
const CASES: readonly { name: string; render: () => RenderResult }[] = [
  {
    name: 'a resource chip at seven figures',
    render: () => render(<ResourceChip kind="scrap" value={9_999_999} capacity={9_999_999} />),
  },
  {
    name: 'a resource chip at zero',
    render: () => render(<ResourceChip kind="caps" value={0} capacity="uncapped" />),
  },
  {
    name: 'a cost line naming every resource at once',
    render: () => render(<CostLine cost={HUGE} stock={HUGE} />),
  },
  {
    name: 'a cost line nothing can pay for',
    render: () =>
      render(
        <CostLine
          cost={HUGE}
          stock={Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0])) as unknown as Resources}
        />,
      ),
  },
  {
    name: 'the wordiest ground label in the catalogue',
    render: () => render(<LabelChip label={WORST_LABEL} />),
  },
  {
    name: 'a full row of ground labels',
    render: () =>
      render(<LabelRow labels={Object.values(LOCATION_CATALOG).flatMap((s) => s.labels)} />),
  },
  {
    name: 'a progress bar with the longest rank as its remaining text',
    render: () =>
      render(<ProgressBar progress={0.5} label="How much longer" remaining={WORST_TIER} />),
  },
  {
    name: 'a progress bar at nothing done',
    render: () => render(<ProgressBar progress={0} label="Nothing yet" remaining="0%" />),
  },
  {
    name: 'a fortify meter at its ceiling',
    render: () => render(<FortifyMeter level={FORTIFY_MAX_LEVEL} percent={100} />),
  },
  {
    name: 'the infamy chip at its longest rank and its largest figure',
    render: () => render(<InfamyChip infamy={9_999_999} notoriety={WORST_NOTORIETY} />),
  },
  {
    name: 'the infamy chip at nothing earned',
    render: () => render(<InfamyChip infamy={0} notoriety={0} />),
  },
  {
    name: 'the crew level chip three digits in',
    render: () =>
      render(<CrewLevelChip level={120} xpIntoLevel={9_999_999} xpToNextLevel={9_999_999} />),
  },
  {
    name: 'a panel whose title is the longest district name the game allows',
    render: () => render(<Panel title={'W'.repeat(DISTRICT_NAME_MAX)}>body</Panel>),
  },
  {
    name: 'a number field at seven figures',
    render: () =>
      render(
        <NumberField
          label="How many"
          value={9_999_999}
          max={9_999_999}
          onChange={() => undefined}
        />,
      ),
  },
  {
    name: 'the weather banner on the worst day the calendar has',
    render: () => render(<WeatherBanner at={WORST_WEATHER_DAY} />),
  },
  {
    name: 'a described tag carrying a long explanation',
    render: () =>
      render(
        <DescribedTag
          label={WORST_TIER}
          description={`${WORST_TIER}: ${'a sentence that keeps going '.repeat(6)}`}
        />,
      ),
  },
];

describe('a readout is sized by the instrument, never by the reading', () => {
  /**
   * Every case above actually draws something.
   *
   * Both checks assert that a list is empty, so a case that renders an empty tree passes both
   * without looking at anything. That is not hypothetical here: `WeatherBanner` returns `null` on
   * a plain day, and the first version of its case picked a fixed date. This is the control that
   * makes the other seventy assertions mean what they say.
   */
  for (const testCase of CASES) {
    it(`draws something to check: ${testCase.name}`, () => {
      const { container } = testCase.render();
      expect(
        (container.textContent ?? '').trim().length,
        `${testCase.name} rendered no text at all`,
      ).toBeGreaterThan(0);
    });
  }

  for (const testCase of CASES) {
    it(`sets every figure in tabular digits: ${testCase.name}`, () => {
      expectFiguresAreTabular(testCase.render(), testCase.name);
    });

    it(`gives every fixed box a way to hold its text: ${testCase.name}`, () => {
      expectFixedBoxesCanHoldTheirText(testCase.render(), testCase.name);
    });
  }

  /**
   * The checkers themselves, against a component built to fail each one.
   *
   * Without this the whole file is unfalsifiable: every assertion above is "this list is empty",
   * and a checker that silently matches nothing, because a selector is wrong or a regex never
   * fires, produces exactly that. These two prove the empty lists are earned.
   */
  describe('the checks can fail', () => {
    it('catches a number set in proportional digits', () => {
      const bad = render(<span className="font-display">1,109</span>);
      expect(() => expectFiguresAreTabular(bad, 'probe')).toThrow(/proportional digits/);
    });

    it('catches a fixed box that can neither wrap nor clip', () => {
      const bad = render(<span className="w-[3rem] whitespace-nowrap">Back-Alley Rumored</span>);
      expect(() => expectFixedBoxesCanHoldTheirText(bad, 'probe')).toThrow(/neither wrap nor clip/);
    });

    it('passes the same box once it is given a plan', () => {
      const good = render(
        <span className="w-[3rem] truncate whitespace-nowrap">Back-Alley Rumored</span>,
      );
      expect(() => expectFixedBoxesCanHoldTheirText(good, 'probe')).not.toThrow();
    });
  });
});
