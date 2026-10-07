import { type TrainingResponse, type TrainingSubject } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { deliveredUrl } from '../../assets/delivered';
import { TrainingPage } from './TrainingPage';
import type * as QueriesModule from '../../lib/queries';

/**
 * Faces, marks and the cancel line on the Training tab.
 *
 * The first is a regression: the tab picked a portrait frame by `officerRole === null`, which is
 * the Overseer and also everybody on the bench, so a benched officer was looked up among the
 * Overseer presets and drawn as a blank silhouette. The face is pinned by its URL, the one the
 * officer pool hands out for their portrait id, on every place the tab draws them.
 */
const board = vi.hoisted(() => ({ current: null as TrainingResponse | null }));

vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof QueriesModule>()),
  useTraining: () => ({
    data: board.current,
    isError: false,
    // Received at the server's own instant, so the page's clock carries no offset and reads
    // the wall clock the sessions below are timed against.
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

const OVERSEER = F.trainingResponse.subjects[0]!;
const SEATED = F.trainingResponse.subjects[1]!;

/** Somebody on the bench: no chair, no mark, and a face off the officer pool all the same. */
const BENCHED: TrainingSubject = {
  ...SEATED,
  id: 'officer-bench',
  name: 'Nadia Ferrand',
  role: 'Bench',
  officerRole: null,
  mark: null,
  injuredUntil: null,
  session: null,
};

/** Draws the tab, and hands back a way to draw it again off whatever `board` holds by then. */
function drawSheet(): () => void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TrainingPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const { rerender } = render(tree());
  return () => rerender(tree());
}

const officerFace = (subject: TrainingSubject): string => {
  const url = deliveredUrl({ type: 'officer', portraitId: subject.portraitId! });
  if (url === null) throw new Error(`the fixture's face ${subject.portraitId} is not delivered`);
  return url;
};

/** The painted face inside an element, or null when it fell back to a silhouette or a letter. */
const faceIn = (el: HTMLElement): string | null =>
  el.querySelector<HTMLImageElement>('img')?.getAttribute('src') ?? null;

/** Starts `minutes` ago, against the wall clock the mocked board reads. */
const startedAgo = (minutes: number) => ({
  ...OVERSEER.session!,
  startedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
});

beforeEach(() => {
  board.current = {
    ...F.trainingResponse,
    subjects: [{ ...OVERSEER, mark: null }, { ...SEATED, mark: 'C+' }, BENCHED],
  };
});

describe('a face for everybody on the Training tab', () => {
  it('draws a benched officer with their own face on the rail, not the Overseer silhouette', () => {
    drawSheet();
    const row = screen.getByTestId(`training-subject-${BENCHED.id}`);
    expect(within(row).getByTestId(`training-face-${BENCHED.id}`)).toHaveAttribute(
      'data-face',
      'officer',
    );
    expect(faceIn(row)).toBe(officerFace(BENCHED));
  });

  it('draws it in the banner once they are picked, and on the floor once they are drilling', () => {
    board.current = {
      ...board.current!,
      subjects: [
        { ...OVERSEER, session: null },
        { ...SEATED, mark: 'C+' },
        { ...BENCHED, session: { ...startedAgo(20), subjectId: BENCHED.id } },
      ],
    };
    drawSheet();
    fireEvent.click(screen.getByTestId(`training-subject-${BENCHED.id}`));
    const faces = screen.getAllByTestId(`training-face-${BENCHED.id}`);
    // The rail, the banner and the chip on the floor.
    expect(faces).toHaveLength(3);
    for (const face of faces) expect(faceIn(face)).toBe(officerFace(BENCHED));
  });

  it('keeps the Overseer in the Overseer frame', () => {
    drawSheet();
    const row = screen.getByTestId(`training-subject-${OVERSEER.id}`);
    expect(within(row).getByTestId(`training-face-${OVERSEER.id}`)).toHaveAttribute(
      'data-face',
      'overseer',
    );
  });
});

describe('the mark on a face', () => {
  it('stamps a seated officer on the rail and in the banner, at their chair mark', () => {
    drawSheet();
    const row = screen.getByTestId(`training-subject-${SEATED.id}`);
    expect(within(row).getByTestId('mark-stamp-C+')).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getAllByTestId('mark-stamp-C+')).toHaveLength(2);
  });

  it('stamps nobody without a mark: the bench, and an Overseer with no grade yet', () => {
    drawSheet();
    for (const id of [BENCHED.id, OVERSEER.id]) {
      const row = screen.getByTestId(`training-subject-${id}`);
      expect(row.querySelector('[data-testid^="mark-stamp-"]')).toBeNull();
    }
  });

  it('stamps the Overseer too, the moment the wire carries a grade for them', () => {
    board.current = {
      ...board.current!,
      subjects: [{ ...OVERSEER, mark: 'B-' }, SEATED],
    };
    drawSheet();
    const row = screen.getByTestId(`training-subject-${OVERSEER.id}`);
    expect(within(row).getByTestId('mark-stamp-B-')).toBeInTheDocument();
  });
});

/**
 * The cancel's line is kept in every state (maintainer, 2026-10-04), so the banner is one height
 * whether the X is there or not, and the X fades rather than popping.
 */
describe('the cancel line under the title bar', () => {
  afterEach(() => vi.useRealTimers());

  const line = () => screen.getByTestId('training-cancel-line');

  it('is there, empty, while the subject is free', () => {
    board.current = { ...board.current!, subjects: [{ ...OVERSEER, session: null }] };
    drawSheet();
    expect(line()).toBeEmptyDOMElement();
  });

  it('is there, empty, once the window to call the drill off has shut', () => {
    board.current = { ...board.current!, subjects: [{ ...OVERSEER, session: startedAgo(20) }] };
    drawSheet();
    expect(screen.getByTestId('training-in-flight')).toBeInTheDocument();
    expect(line()).toBeEmptyDOMElement();
  });

  it('holds the X inside the window, and fades it out rather than dropping it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    board.current = { ...board.current!, subjects: [{ ...OVERSEER, session: startedAgo(1) }] };
    const redraw = drawSheet();
    expect(within(line()).getByTestId('cancel-drill')).toBeEnabled();

    // Called off: the subject is free, and the X is still on screen, dead, while it fades.
    board.current = { ...board.current, subjects: [{ ...OVERSEER, session: null }] };
    redraw();
    const fading = within(line()).getByTestId('cancel-drill');
    expect(fading).toBeDisabled();
    expect((line().firstElementChild as HTMLElement).style.opacity).toBe('0');

    act(() => void vi.advanceTimersByTime(250));
    expect(line()).toBeEmptyDOMElement();
  });
});
