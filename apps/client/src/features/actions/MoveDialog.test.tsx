import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { MoveDialog } from './MoveDialog';

/**
 * The Garrison control on a held location opens this dialog pointed at that location
 * (maintainer, 2026-09-28: "Nothing sends units immediately, you need to move them"). The instant
 * garrison door it replaced is gone, so the one thing the control has to get right is where the
 * column is going: here, from home.
 */
const fetchMock = vi.fn();

function draw(towards?: Parameters<typeof MoveDialog>[0]['towards']) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MoveDialog
        roster={F.unitsResponse}
        {...(towards ? { towards } : {})}
        onClose={() => undefined}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    throw new Error(`unstubbed request: ${String(path)}`);
  });
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the Move dialog opened from a location', () => {
  it('walks units from home onto the place it was opened on', () => {
    draw({ kind: 'location', locationId: 'steelbelt-press' });
    expect(screen.getByTestId('move-to')).toHaveTextContent('No. 4 Press House');
    expect(screen.getByTestId('move-from')).toHaveTextContent('Your District');
  });

  it('keeps its old default without one: from home to the gate', () => {
    draw();
    expect(screen.getByTestId('move-to')).toHaveTextContent('Your Gate');
  });
});

// Bug pass, 2026-10-02: a refused quote left "Working it out" on screen for ever, Send still live.
describe('a move the server will not quote', () => {
  it('says why on the time line and holds the send', async () => {
    fetchMock.mockImplementation((path: string) => {
      if (String(path).endsWith('/actions/move/quote')) {
        return Promise.resolve({
          headers: new Headers(),
          ok: false,
          status: 409,
          statusText: '',
          json: () =>
            Promise.resolve({
              error: { code: 'MOVE_REFUSED', message: 'There is no road to that' },
            }),
        } as Response);
      }
      throw new Error(`unstubbed request: ${String(path)}`);
    });
    draw();
    const unit = Object.keys(F.unitsResponse.army).find(
      (id) => (F.unitsResponse.army[id] ?? 0) > 0,
    )!;
    const field =
      screen.getByTestId(`move-count-${unit}`).querySelector('input') ??
      screen.getByTestId(`move-count-${unit}`);
    fireEvent.change(field, { target: { value: '1' } });

    await waitFor(() =>
      expect(screen.getByTestId('move-time')).toHaveTextContent('There is no road to that'),
    );
    expect(screen.getByTestId('move-confirm')).toBeDisabled();
  });
});
