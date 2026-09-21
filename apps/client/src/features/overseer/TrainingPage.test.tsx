import {
  ATTRIBUTE_LABELS,
  TRAINING_HALF_GAIN_FROM,
  type AttributeName,
  type TrainingResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { TrainingPage } from './TrainingPage';
import type * as QueriesModule from '../../lib/queries';

/**
 * §F2: what an hour is worth, on the screen that sells it.
 *
 * `applyGain` (`packages/shared/src/crew/training.ts`) is the only place a session's value is
 * decided, and it decides it against the sheet in front of it: two points under
 * `TRAINING_HALF_GAIN_FROM` and one at or above it. `TrainingResponse.gainPerSession` is a flat
 * `TRAINING_GAIN` with no attribute in scope, so a screen that prints it prints the wrong number
 * for the back half of every skill.
 *
 * That is not a quoted estimate, it is a promise on a button: "+2 Analysis" on a control that
 * spends one of five hours a day and cannot be taken back. The hour goes, the sheet moves by one,
 * and nothing on the screen ever says why.
 *
 * The two figures are written out here rather than read back from `trainingGainFor`, so that a
 * change to the rule has to be made in this file as well as in the rule.
 */
const board = vi.hoisted(() => ({ current: null as TrainingResponse | null }));

vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof QueriesModule>()),
  useTraining: () => ({
    data: board.current,
    isError: false,
    dataUpdatedAt: Date.parse(F.trainingResponse.serverNow),
    refetch: () => undefined,
  }),
  useStartTraining: () => ({ mutate: () => undefined, isPending: false }),
  useCancelDrill: () => ({ mutate: () => undefined, isPending: false }),
}));

/** The one officer, with one skill either side of the halfway mark and neither drilled today. */
const SUBJECT = F.trainingResponse.subjects[1]!;
const UNDER: AttributeName = 'logic';
const OVER: AttributeName = 'analysis';

beforeEach(() => {
  board.current = {
    ...F.trainingResponse,
    subjects: [
      {
        ...SUBJECT,
        attributes: {
          ...SUBJECT.attributes,
          [UNDER]: TRAINING_HALF_GAIN_FROM - 20,
          [OVER]: TRAINING_HALF_GAIN_FROM + 12,
        },
        // Neither of the two under test, so both rows are open and both dialogs have a live button.
        lastAttribute: 'stamina',
      },
    ],
  };
});

function drawSheet(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TrainingPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function openDrill(attribute: AttributeName) {
  drawSheet();
  fireEvent.click(screen.getByTestId(`drill-${attribute}`));
}

describe('what the Training tab promises an hour will buy', () => {
  it('promises one point on a skill past the halfway mark', () => {
    openDrill(OVER);
    expect(
      screen.getByRole('button', { name: new RegExp(`\\+1 ${ATTRIBUTE_LABELS[OVER]}$`) }),
    ).toBeInTheDocument();
  });

  it('still promises two on a skill under it', () => {
    openDrill(UNDER);
    expect(
      screen.getByRole('button', { name: new RegExp(`\\+2 ${ATTRIBUTE_LABELS[UNDER]}$`) }),
    ).toBeInTheDocument();
  });

  /*
   * The figure is drawn at two sites, and the row's is the one a player reads first: thirty-three
   * of them, one hover apiece, before anything is opened. A fix applied to the dialog alone leaves
   * this one saying something the dialog behind it contradicts.
   */
  it('says the same on the row the drill is opened from', () => {
    drawSheet();
    fireEvent.focus(screen.getByTestId(`drill-${OVER}`));
    expect(screen.getByText(/An hour buys 1 point\./)).toBeInTheDocument();

    fireEvent.focus(screen.getByTestId(`drill-${UNDER}`));
    expect(screen.getByText(/An hour buys 2 points\./)).toBeInTheDocument();
  });
});

/**
 * The strip at the foot of the sheet: who is on an hour right now (maintainer, 2026-09-21).
 *
 * The e2e measures the geometry, which is where this can break silently: whether the strip fits
 * inside the frame, whether it wraps, whether a bar has any pigment in it. What it cannot easily
 * say is *which* people belong in it, and that is a rule rather than a layout: everybody on an
 * hour, nobody who is idle, whatever the roster's order.
 */
describe('the floor at the foot of the training sheet', () => {
  /** The fixture's overseer, who has a running drill, and its officer, who does not. */
  const WORKING = F.trainingResponse.subjects[0]!;
  const IDLE = F.trainingResponse.subjects[1]!;

  it('draws a row for everyone on an hour and none for anyone idle', () => {
    board.current = { ...F.trainingResponse, subjects: [IDLE, WORKING] };
    drawSheet();

    const floor = screen.getByTestId('training-underway');
    expect(floor).toHaveTextContent(WORKING.name);
    expect(floor).not.toHaveTextContent(IDLE.name);
    expect(screen.getByTestId(`training-underway-${WORKING.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`training-underway-${IDLE.id}`)).toBeNull();
  });

  /**
   * The bar is drawn to the hour, not to a constant.
   *
   * A width read off the wrong clock, or off nothing at all, is invisible to every other check
   * here: a bar at 0% and a bar at 100% both render. Two subjects at deliberately different points
   * in their hours have to come out at different widths.
   */
  it('draws each bar to how far into the hour that person is', () => {
    /*
     * Off the wall clock, not off the fixture's `serverNow`.
     *
     * `useServerClock` reads `Date.parse(serverNow) - dataUpdatedAt` as its offset, and the mock
     * above hands it the same instant for both, so the offset is zero and the page is counting
     * from *now*. A start time measured back from the fixture's own clock is therefore hours in
     * the past, and both bars come out at a hundred percent, which is a test that cannot fail.
     */
    const started = (minutesAgo: number) =>
      new Date(Date.now() - minutesAgo * 60_000).toISOString();
    board.current = {
      ...F.trainingResponse,
      subjects: [
        { ...WORKING, session: { ...WORKING.session!, startedAt: started(45) } },
        {
          ...IDLE,
          session: { ...WORKING.session!, subjectId: IDLE.id, startedAt: started(5) },
        },
      ],
    };
    drawSheet();

    const widthOf = (id: string): number => {
      const fill = screen
        .getByTestId(`training-underway-${id}`)
        .querySelector<HTMLElement>('.paint-fill');
      if (!fill) throw new Error(`no bar drawn for ${id}`);
      return Number.parseFloat(fill.style.width);
    };
    const deep = widthOf(WORKING.id);
    const fresh = widthOf(IDLE.id);
    expect(fresh, 'a bar five minutes in is empty').toBeGreaterThan(0);
    expect(deep, 'a bar forty-five minutes in is full').toBeLessThan(100);
    expect(deep, 'the older hour is not drawn further along').toBeGreaterThan(fresh + 10);
  });

  /**
   * One bench until the Professor's Second Chair (maintainer, 2026-09-21). The line under the
   * quotation says how many are in use, and every drill on an idle sheet reads the server's own
   * refusal while the floor is full, so the dialog behind it cannot offer an hour the route would
   * refuse.
   */
  it('dims every drill while the floor is full, and opens them with a second bench', () => {
    board.current = { ...F.trainingResponse, benches: 1, subjects: [IDLE, WORKING] };
    drawSheet();
    expect(screen.getByTestId('training-floor-line')).toHaveTextContent('1 of 1 bench in use');
    // The sheet opens on the Overseer, who is the one on the hour: the idle officer's sheet is
    // where the floor is the only thing in the way.
    fireEvent.click(within(screen.getByTestId('training-subjects')).getByText(IDLE.name));
    fireEvent.focus(screen.getByTestId(`drill-${UNDER}`));
    expect(screen.getByText('The floor is taken')).toBeInTheDocument();
  });

  it('keeps the drills open while a bench is free', () => {
    board.current = { ...F.trainingResponse, benches: 2, subjects: [IDLE, WORKING] };
    drawSheet();
    expect(screen.getByTestId('training-floor-line')).toHaveTextContent('1 of 2 benches in use');
    fireEvent.click(within(screen.getByTestId('training-subjects')).getByText(IDLE.name));
    fireEvent.focus(screen.getByTestId(`drill-${UNDER}`));
    expect(screen.queryByText('The floor is taken')).toBeNull();
    expect(screen.getByText(/An hour buys/)).toBeInTheDocument();
  });

  it('says so plainly when nobody is on the floor', () => {
    board.current = { ...F.trainingResponse, subjects: [IDLE] };
    drawSheet();
    expect(screen.getByTestId('training-underway')).toHaveTextContent('The floor is empty.');
    expect(screen.queryByTestId(`training-underway-${IDLE.id}`)).toBeNull();
  });

  /** The four columns live inside the same frame the strip does, which is the whole request. */
  it('puts the four groups and the strip in one frame', () => {
    drawSheet();
    const frame = screen.getByTestId('training-floor');
    expect(frame).toContainElement(screen.getByTestId('training-sheet'));
    expect(frame).toContainElement(screen.getByTestId('training-underway'));
    for (const group of ['physical', 'mental', 'social', 'technical']) {
      expect(frame).toContainElement(screen.getByTestId(`group-${group}`));
    }
  });
});
