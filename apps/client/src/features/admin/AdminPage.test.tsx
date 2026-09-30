import { ADMIN_MAX_PLAYER_LEVEL, MAX_NOTORIETY, OFFICER_ROLES } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { useSession } from '../../store/session';
import { AdminPage } from './AdminPage';

/**
 * The Console against the routes it drives (bug pass, 2026-09-29).
 */

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

/** What the page sent to `/admin/knobs` and `/admin/grant`, in order. */
const knobs: unknown[] = [];
const grants: unknown[] = [];

function renderConsole() {
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    const url = String(path);
    if (url.endsWith('/me')) return reply(F.adminGame);
    if (url.endsWith('/admin/knobs')) {
      knobs.push(JSON.parse(init?.body as string));
      return reply({ admin: F.adminSnapshot });
    }
    if (url.endsWith('/admin/grant')) {
      grants.push(JSON.parse(init?.body as string));
      return reply({ admin: F.adminSnapshot });
    }
    if (url.endsWith('/admin')) return reply(F.adminSnapshot);
    throw new Error(`unstubbed request: ${url}`);
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  knobs.splice(0);
  grants.splice(0);
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the Console', () => {
  /*
   * The field took any number and the route refused anything past the deepest authored level, so
   * typing 99 answered with a schema message instead of the last stage the bench can set.
   */
  it('sends the deepest level the bench takes when asked for more', async () => {
    renderConsole();
    const field = await screen.findByTestId('admin-player-level');
    fireEvent.change(field, { target: { value: String(ADMIN_MAX_PLAYER_LEVEL + 9) } });
    fireEvent.click(screen.getByRole('button', { name: 'Set level' }));
    await waitFor(() => expect(knobs).toEqual([{ playerLevel: ADMIN_MAX_PLAYER_LEVEL }]));
  });

  /* The last operating-system menu on the page; every other picker is the painted `Dropdown`. */
  it('draws no browser select', async () => {
    const { container } = renderConsole();
    await screen.findByTestId('admin-grant-track');
    expect(container.querySelector('select')).toBeNull();
  });

  /*
   * The knobs that were reachable only through a preset or curl (maintainer ruling, 2026-09-29):
   * a rank, a seated bench, rested standing orders, and the grants for research depth, traps,
   * boosts, bodies and footholds.
   */
  it('sets a rank, clamped to the ladder', async () => {
    renderConsole();
    fireEvent.change(await screen.findByTestId('admin-notoriety'), {
      target: { value: String(MAX_NOTORIETY + 4) },
    });
    fireEvent.click(screen.getByTestId('admin-notoriety-go'));
    await waitFor(() => expect(knobs).toEqual([{ notoriety: MAX_NOTORIETY }]));
  });

  it('seats officers at a rating, and rests the standing orders', async () => {
    renderConsole();
    fireEvent.change(await screen.findByTestId('admin-officers'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('admin-officer-rating'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('admin-officers-go'));
    await waitFor(() => expect(knobs).toEqual([{ officers: { count: 3, rating: 40 } }]));
    fireEvent.click(screen.getByTestId('admin-automations-rested'));
    await waitFor(() => expect(knobs).toContainEqual({ automationsRested: true }));
    // Never more chairs than there are roles.
    fireEvent.change(screen.getByTestId('admin-officers'), { target: { value: '99' } });
    expect(screen.getByTestId<HTMLInputElement>('admin-officers').value).toBe(
      String(OFFICER_ROLES.length),
    );
  });

  it('grants research depth, traps, boosts, bodies and footholds', async () => {
    renderConsole();
    // One at a time: the panel's buttons wait while a grant is on the wire.
    const press = async (testId: string) => {
      const sent = grants.length;
      await waitFor(() => expect(screen.getByTestId(testId)).toBeEnabled());
      fireEvent.click(screen.getByTestId(testId));
      await waitFor(() => expect(grants).toHaveLength(sent + 1));
    };
    fireEvent.change(await screen.findByTestId('admin-grant-depth'), { target: { value: '7' } });
    await press('admin-grant-depth-go');
    fireEvent.change(screen.getByTestId('admin-grant-stock'), { target: { value: '3' } });
    await press('admin-grant-traps');
    await press('admin-grant-boosts');
    fireEvent.change(screen.getByTestId('admin-grant-bodies'), { target: { value: '12' } });
    await press('admin-grant-units');
    await press('admin-grant-footholds');
    expect(grants.slice(0, 3)).toEqual([{ researchDepth: 7 }, { consumables: 3 }, { boosts: 3 }]);
    const units = (grants[3] as { units?: Record<string, number> }).units ?? {};
    expect(Object.values(units)).toEqual([12]);
    expect(grants[4]).toEqual({ footholds: 'every-city' });
  });
});
