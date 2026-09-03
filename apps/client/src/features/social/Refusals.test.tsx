import { NOTIFICATION_KINDS, isAlwaysOn, type ActionsResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { ActionsPage } from '../actions/ActionsPage';
import { NotificationFilters } from './NotificationFilters';
import { DistrictPlaque } from '../../components/DistrictPlaque';
import { useSession } from '../../store/session';

/**
 * Three writes that were refused in silence.
 *
 * Grouped because they are one defect wearing three coats: the mutation is read for `isPending` and
 * `mutate` and never for `error`, and this repo's QueryClient has no `MutationCache.onError`, so
 * there is nothing behind them. On each screen the only visible consequence of a refusal was
 * something *not* happening, which a player reads as a click that missed.
 */

const NOW = '2026-08-26T12:00:00.000Z';

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

const refusal = (code: string, message: string) =>
  Promise.resolve({
    ok: false,
    status: 409,
    statusText: '',
    json: () => Promise.resolve({ error: { code, message } }),
  } as Response);

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={['/game']}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

/** One column on the road, still inside its recall window as the server saw it. */
const onTheRoad: ActionsResponse = {
  serverNow: NOW,
  movements: [
    {
      id: 'move-1',
      battleId: 'press',
      targetName: 'Kessler Press',
      fromName: 'Sector Seven',
      toName: 'Steelbelt',
      side: 'attacker',
      army: { razors: 2 },
      perimeter: {},
      size: 2,
      departedAt: NOW,
      arrivesAt: '2026-08-26T13:00:00.000Z',
      recallable: true,
    },
  ],
};

describe('a recall the server will not take', () => {
  /*
   * `movement.recallable` is decided when the response is built and `/actions` polls at 5s, while
   * the row's own `canRecall` is recomputed every second: for up to five seconds after the window
   * shuts the row reads "0s left to decide" beside a live button, and pressing it is refused.
   */
  it('says so instead of only making the button disappear', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/actions/recall')
        ? refusal('WINDOW_CLOSED', 'Too late: they are past the point of turning back')
        : reply(onTheRoad),
    );

    wrap(<ActionsPage />);
    fireEvent.click(await screen.findByTestId('recall-move-1'));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('past the point of turning back'),
    );
  });
});

describe('a notification setting that would not save', () => {
  it('says so, because the box has no other way to disagree', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/notifications/settings')
        ? refusal('INTERNAL', 'That did not save. Try again.')
        : reply(F.notificationsScreen),
    );

    // The first kind that is switchable and currently on, so the click is a real change.
    const settings = F.notificationsScreen.settings;
    const kind = NOTIFICATION_KINDS.find(
      (candidate) => !isAlwaysOn(candidate) && !settings.muted.includes(candidate),
    );
    if (!kind) throw new Error('every switchable kind is already muted in the fixture');
    // The component reads `/notifications` itself; it takes no props.
    wrap(<NotificationFilters />);

    const box = await screen.findByTestId<HTMLInputElement>(`notify-${kind}`);
    // The precondition: it is on, so the click is a real change rather than a no-op.
    expect(box.checked).toBe(true);
    fireEvent.click(box);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That did not save. Try again.'),
    );
    // ...and it is still ticked, which is the state the message exists to explain.
    expect(screen.getByTestId<HTMLInputElement>(`notify-${kind}`).checked).toBe(true);
  });
});

describe('a district name the city would not take', () => {
  it('does not still be showing the refusal the next time the form is opened', async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith('/base/district-name')
        ? refusal('NAME_TAKEN', 'That name is taken')
        : reply(F.me),
    );

    const base = F.me.base;
    if (!base) throw new Error('the fixture has no district');
    wrap(<DistrictPlaque base={base} />);

    fireEvent.click(screen.getByTestId('district-plaque'));
    fireEvent.change(screen.getByLabelText('District name'), { target: { value: 'Vermilion' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByTestId('district-name-error')).toHaveTextContent('That name is taken'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId('district-plaque'));

    // The form is open again, over the name the crew is actually using...
    expect(screen.getByLabelText<HTMLInputElement>('District name').value).toBe(base.name);
    // ...and not under a refusal of a name they have not typed yet.
    expect(screen.queryByTestId('district-name-error')).toBeNull();
  });
});
