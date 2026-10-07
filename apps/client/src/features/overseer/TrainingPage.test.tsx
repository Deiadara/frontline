import {
  ATTRIBUTE_LABELS,
  IMPORTANCE_LABELS,
  TRAINING_HALF_GAIN_FROM,
  importanceOf,
  type AttributeName,
  type TrainingResponse,
  attributeUse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { IMPORTANCE_TEXT } from '../../lib/importance';
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
  useStartTraining: () => ({
    mutate: () => undefined,
    reset: () => undefined,
    isPending: false,
    error: null,
  }),
  useCancelDrill: () => ({
    mutate: () => undefined,
    reset: () => undefined,
    isPending: false,
    error: null,
  }),
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
  // Fit and free: the fixture's second officer is laid up, and a sickbed shuts every drill.
  const IDLE = { ...F.trainingResponse.subjects[1]!, injuredUntil: null, held: null };

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
   * A queue of two until the Professor's Second Chair (maintainer, 2026-10-04). The line under the
   * quotation says how full it is, and a drill opened on a full queue reads the server's own
   * refusal, so the dialog cannot offer an hour the route would refuse.
   */
  it('refuses a drill while the queue is full', () => {
    board.current = { ...F.trainingResponse, queueSlots: 1, subjects: [IDLE, WORKING] };
    drawSheet();
    expect(screen.getByTestId('training-floor-line')).toHaveTextContent('1 of 1 in the queue');
    fireEvent.click(within(screen.getByTestId('training-subjects')).getByText(IDLE.name));
    fireEvent.click(screen.getByTestId(`drill-${UNDER}`));
    expect(screen.getByText('The queue is full.')).toBeInTheDocument();
  });

  it('keeps the drills open while the queue has room', () => {
    board.current = { ...F.trainingResponse, queueSlots: 2, subjects: [IDLE, WORKING] };
    drawSheet();
    expect(screen.getByTestId('training-floor-line')).toHaveTextContent('1 of 2 in the queue');
    fireEvent.click(within(screen.getByTestId('training-subjects')).getByText(IDLE.name));
    fireEvent.click(screen.getByTestId(`drill-${UNDER}`));
    expect(screen.queryByText('The queue is full.')).toBeNull();
  });

  /** A drill waiting its turn says when it starts, and its bar has not begun. */
  it('draws a queued drill as waiting, not running', () => {
    const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    board.current = {
      ...F.trainingResponse,
      subjects: [
        { ...WORKING, session: { ...WORKING.session!, startedAt: at(-10) } },
        {
          ...IDLE,
          session: { ...WORKING.session!, id: 'queued', subjectId: IDLE.id, startedAt: at(50) },
        },
      ],
    };
    drawSheet();
    const row = screen.getByTestId(`training-underway-${IDLE.id}`);
    expect(row).toHaveAttribute('data-queued', 'true');
    expect(row.querySelector<HTMLElement>('.paint-fill')?.style.width).toBe('0%');
    expect(row).toHaveTextContent(/in \d+m/);
    expect(screen.getByTestId(`training-underway-${WORKING.id}`)).not.toHaveAttribute(
      'data-queued',
    );
    expect(screen.getByTestId('training-underway')).toHaveTextContent('1 working, 1 queued');
    expect(within(screen.getByTestId('training-subjects')).getByText('Queued')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('training-subjects')).getByText(IDLE.name));
    expect(screen.getByTestId('training-in-flight')).toHaveTextContent(/Starts in/);
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

/**
 * What the drill dialog says a rating is worth to the crew (wiring audit, 2026-10-01).
 *
 * It printed `contributionOf(rating)`, the figure a rating is worth to the Overseer, for everybody.
 * An officer's rating reaches the crew's sheet at their chair's share of it (`seatedRating`), and
 * somebody on the bench is not in the room at all, so the Professor drilling Strength was told
 * +10% for an hour whose rating the crew counts at a quarter.
 *
 * The anchors are written out rather than read back from `seatedRating`: Strength is untagged for
 * the Professor, so it counts at a quarter, and 40 of it is 10 on the sheet, which is 3% after a
 * seat uplift of well under a sixth. The Overseer's 40 is the whole 10%.
 */
/**
 * What a drill feeds (maintainer, 2026-10-04): the grade of the seat the person is graded on, at
 * the skill's tag, and through it the chair's passive or the Overseer's lift; nothing from the
 * bench; and the guard against spies for Signals and Cryptography. No figure: a skill pays no
 * channel of its own any more.
 */
describe('what the drill dialog says a skill feeds', () => {
  const feedsFor = (subject: TrainingResponse['subjects'][number], name: AttributeName) => {
    board.current = {
      ...F.trainingResponse,
      subjects: [{ ...subject, session: null, lastAttribute: 'stamina' }],
    };
    openDrill(name);
    return screen.getByTestId('drill-feeds-grade').textContent ?? '';
  };

  it("names the Overseer's own grade and the lift it pays", () => {
    const tag = IMPORTANCE_LABELS[importanceOf('overseer', 'authority')].toLowerCase();
    expect(feedsFor(F.trainingResponse.subjects[0]!, 'authority')).toBe(
      `Your grade (${tag}), and the lift it puts on every seated officer`,
    );
  });

  it("names an officer's chair, the skill's tag in it, and what the chair gives", () => {
    expect(SUBJECT.officerRole).toBe('professor');
    const tag = IMPORTANCE_LABELS[importanceOf('professor', 'strength')].toLowerCase();
    expect(feedsFor(SUBJECT, 'strength')).toBe(
      `The Professor's grade (${tag}), and what the chair gives`,
    );
  });

  it('says somebody on the bench feeds nothing', () => {
    expect(feedsFor({ ...SUBJECT, officerRole: null, role: 'Bench' }, 'strength')).toBe(
      'Nothing until they sit in a chair',
    );
  });

  it.each(['signals', 'cryptography'] as const)('adds the guard against spies for %s', (name) => {
    expect(feedsFor(SUBJECT, name)).toMatch(/, and your guard against spies$/);
    expect(screen.queryByText('from this rating')).toBeNull();
  });
});

/**
 * The hover on every drill row (maintainer, 2026-10-04): the attribute's name, what it is good
 * for, and the chair's tier in its colour, and nothing else. A click still opens the dialog.
 */
describe('the hover on a drill row', () => {
  it.each(['chemistry', 'cryptography', 'signals'] as const)('says what %s is good for', (name) => {
    drawSheet();
    fireEvent.focus(screen.getByTestId(`drill-${name}`));
    expect(screen.getByTestId(`drill-use-${name}`)).toHaveTextContent(attributeUse(name));
    // Which seats it grades since 2026-10-04, and the spy guard for the two that give one.
    expect(attributeUse(name)).toMatch(/Grades the /);
  });

  it('names the tier in its colour and says nothing more', () => {
    drawSheet();
    // The fixture's officer sits in a chair; Cryptography is nothing to most of them.
    const name: AttributeName = 'cryptography';
    const importance = importanceOf(SUBJECT.officerRole!, name);
    fireEvent.focus(screen.getByTestId(`drill-${name}`));
    const card = screen.getByTestId(`drill-card-${name}`);
    const tier = screen.getByTestId(`drill-tier-${name}`);
    expect(tier).toHaveTextContent(new RegExp(`^${IMPORTANCE_LABELS[importance]}$`));
    expect(tier.className).toContain(IMPORTANCE_TEXT[importance]);
    // Name, use, tier: three lines, and no drill, gain or chair sentence under them.
    expect(card.children).toHaveLength(3);
    expect(card).toHaveTextContent(
      `${ATTRIBUTE_LABELS[name]}${attributeUse(name)}${IMPORTANCE_LABELS[importance]}`,
    );
  });

  // The Overseer is graded on a seat of their own since 2026-10-04, so their skills carry a tier.
  it("draws the Overseer's tier off their own seat", () => {
    board.current = { ...F.trainingResponse, subjects: [F.trainingResponse.subjects[0]!] };
    drawSheet();
    fireEvent.focus(screen.getByTestId('drill-authority'));
    const importance = importanceOf('overseer', 'authority');
    expect(importance).toBe('irreplaceable');
    expect(screen.getByTestId('drill-tier-authority')).toHaveTextContent(
      IMPORTANCE_LABELS[importance],
    );
  });

  it('draws no tier for somebody on the bench, who is in no chair', () => {
    board.current = {
      ...F.trainingResponse,
      subjects: [{ ...SUBJECT, officerRole: null, role: 'Bench' }],
    };
    drawSheet();
    fireEvent.focus(screen.getByTestId('drill-logic'));
    expect(screen.getByTestId('drill-card-logic').children).toHaveLength(2);
    expect(screen.queryByTestId('drill-tier-logic')).toBeNull();
  });
});

/*
 * Nobody away from the floor drills (maintainer, 2026-10-06): out leading a run, held for a fight
 * or laid up. The bench still may. The drill says so before the press, in the route's words.
 */
describe('somebody away from the floor', () => {
  const officer = { ...F.trainingResponse.subjects[1]!, session: null, lastAttribute: null };
  for (const [held, words] of [
    ['run', 'Out leading a run.'],
    ['fight', 'Held for a fight.'],
    ['injury', 'Laid up.'],
  ] as const) {
    it(`refuses a drill to somebody ${held === 'injury' ? 'laid up' : `held by a ${held}`}`, () => {
      board.current = { ...F.trainingResponse, queueSlots: 2, subjects: [{ ...officer, held }] };
      drawSheet();
      fireEvent.click(within(screen.getByTestId('training-subjects')).getByText(officer.name));
      fireEvent.click(screen.getByTestId(`drill-${UNDER}`));
      expect(screen.getByText(words)).toBeInTheDocument();
    });
  }
});
