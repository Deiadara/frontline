import { CITY_DISTRICTS } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../store/session';
import { CityView } from './CityView';

/** Bug pass, 2026-10-06: raising one captured gate greyed the button on every other gate. */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  // Nothing answers: the raise stays in flight for the whole test.
  fetchMock.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('two captured gates on the map', () => {
  it('waits only on the gate being raised', async () => {
    const [gate] = F.city.capturedGates;
    const other = CITY_DISTRICTS.find((district) => district.id !== gate!.districtId)!;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.me, F.me);
    client.setQueryData([...queryKeys.city, ''], {
      ...F.city,
      capturedGates: [gate, { ...gate!, districtId: other.id, districtName: other.name }],
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CityView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId(`raise-gate-${gate!.districtId}`));
    await waitFor(() =>
      expect(screen.getByTestId(`raise-gate-${gate!.districtId}`)).toBeDisabled(),
    );
    expect(screen.getByTestId(`raise-gate-${other.id}`)).toBeEnabled();
  });

  it('waits only on the gate whose raise is being called off', async () => {
    const [gate] = F.city.capturedGates;
    const other = CITY_DISTRICTS.find((district) => district.id !== gate!.districtId)!;
    const now = Date.parse(F.city.serverNow);
    const raising = {
      ...gate!,
      upgradingSince: new Date(now).toISOString(),
      upgradingUntil: new Date(now + 3_600_000).toISOString(),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(queryKeys.me, F.me);
    client.setQueryData([...queryKeys.city, ''], {
      ...F.city,
      capturedGates: [raising, { ...raising, districtId: other.id, districtName: other.name }],
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CityView />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId(`cancel-gate-${gate!.districtId}`));
    await waitFor(() =>
      expect(screen.getByTestId(`cancel-gate-${gate!.districtId}`)).toBeDisabled(),
    );
    expect(screen.getByTestId(`cancel-gate-${other.id}`)).toBeEnabled();
  });
});
