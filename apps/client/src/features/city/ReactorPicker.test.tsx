import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ReactorPicker } from './ReactorPicker';

/** The Reactor Shed on its own sheet (maintainer, 2026-10-14): guarded first, the lock on hover. */

const NOW = new Date('2026-10-14T12:00:00Z');
const later = new Date(NOW.getTime() + 5 * 3600 * 1000).toISOString();
const OPTIONS = [
  { id: 'razors', name: 'Razors' },
  { id: 'wardens', name: 'Wardens' },
];

const withQueries = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe('the Reactor Shed’s choice', () => {
  it('says who is Radioactive, and asks for a pick before it will choose', () => {
    render(
      withQueries(
        <ReactorPicker
          reactor={{ unitId: 'razors', changesAt: null, options: OPTIONS }}
          mine
          now={NOW}
          baseId="b1"
          districtId="blockhouse"
          locationId="blockhouse-reactor"
        />,
      ),
    );
    expect(screen.getByTestId('reactor-state-blockhouse-reactor')).toHaveTextContent(
      'Radioactive: Razors',
    );
    const button = screen.getByTestId('reactor-choose-blockhouse-reactor');
    expect(button).toBeDisabled();
    expect(button.getAttribute('data-refusal')).toBe('Choose a unit first');
  });

  it('is greyed with the time left while the choice is locked', () => {
    render(
      withQueries(
        <ReactorPicker
          reactor={{ unitId: 'razors', changesAt: later, options: OPTIONS }}
          mine
          now={NOW}
          baseId="b1"
          districtId="blockhouse"
          locationId="blockhouse-reactor"
        />,
      ),
    );
    fireEvent.click(screen.getByTestId('reactor-unit-blockhouse-reactor'));
    fireEvent.click(screen.getByText('Wardens'));
    const button = screen.getByTestId('reactor-choose-blockhouse-reactor');
    expect(button).toBeDisabled();
    expect(button.getAttribute('data-refusal')).toMatch(/Locked, 5h/);
  });

  it('shows a visitor the choice and no control', () => {
    render(
      withQueries(
        <ReactorPicker
          reactor={{ unitId: null, changesAt: null, options: [] }}
          mine={false}
          now={NOW}
          baseId="b1"
          districtId="blockhouse"
          locationId="blockhouse-reactor"
        />,
      ),
    );
    expect(screen.getByTestId('reactor-state-blockhouse-reactor')).toHaveTextContent(
      'Nobody is Radioactive yet',
    );
    expect(screen.queryByTestId('reactor-choose-blockhouse-reactor')).toBeNull();
  });
});
