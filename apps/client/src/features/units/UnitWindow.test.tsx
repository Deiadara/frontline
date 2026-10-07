import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { queryKeys } from '../../lib/queries';
import { useSession } from '../../store/session';
import { UnitWindow } from './UnitWindow';

/**
 * The card every unit name opens (bug pass, 2026-10-06). It was handed none of the roster's facts:
 * a crew's carriers read as locked behind research it had finished, and the count was the home
 * slice alone.
 */
function open(unitId: string, carriersFight: boolean) {
  // Signed out, so the query reads the cache below and never reaches for the network.
  useSession.setState({ signedIn: false, user: null });
  const client = new QueryClient();
  client.setQueryData(queryKeys.units, { ...F.unitsResponse, carriersFight });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UnitWindow unitId={unitId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the unit window', () => {
  it('counts the crew’s units wherever they stand, as the roster does', () => {
    open('razors', false);
    const home = F.unitsResponse.units.find((unit) => unit.id === 'razors')!.owned;
    const elsewhere =
      (F.unitsResponse.gateArmy.razors ?? 0) +
      (F.unitsResponse.garrisoned.razors ?? 0) +
      (F.unitsResponse.abroad.razors ?? 0);
    expect(elsewhere).toBeGreaterThan(0);
    expect(screen.getByTestId('unit-count-razors')).toHaveTextContent(String(home + elsewhere));
  });

  it('shows a carrier’s fighting figures once the crew has Everybody Fights', () => {
    const locked = open('haulers', false);
    expect(screen.queryAllByLabelText(/Locked until Everybody Fights/).length).toBeGreaterThan(0);
    locked.unmount();
    open('haulers', true);
    expect(screen.queryAllByLabelText(/Locked until Everybody Fights/)).toHaveLength(0);
  });
});
