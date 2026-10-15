import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { LampsSwitch } from './LampsSwitch';

/** Lampman's Row on its own sheet (maintainer, 2026-10-09): guarded first, the wait on hover. */

const NOW = new Date('2026-10-09T12:00:00Z');
const later = new Date(NOW.getTime() + 2 * 3600 * 1000).toISOString();

const withQueries = (children: ReactNode) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("Lampman's Row's lamps", () => {
  it('is greyed with the time left while the lamps cool, and live once they have', () => {
    const { rerender } = render(
      withQueries(
        <LampsSwitch
          lamps={{ lit: true, changesAt: later, tiers: 2, wholeCity: false }}
          now={NOW}
          baseId="b1"
          districtId="ironmouth"
          locationId="ironmouth-lampman"
        />,
      ),
    );
    const button = screen.getByTestId('lamps-throw-ironmouth-lampman');
    expect(screen.getByTestId('lamps-state-ironmouth-lampman')).toHaveTextContent('lit');
    expect(button).toBeDisabled();
    expect(button.getAttribute('data-refusal')).toMatch(/2h/);
    expect(button).toHaveTextContent('Put them out');
    expect(screen.getByTestId('lamps-ironmouth-lampman')).toHaveTextContent(
      'every location in the district',
    );

    rerender(
      withQueries(
        <LampsSwitch
          lamps={{ lit: false, changesAt: null, tiers: 4, wholeCity: true }}
          now={NOW}
          baseId="b1"
          districtId="ironmouth"
          locationId="ironmouth-lampman"
        />,
      ),
    );
    expect(screen.getByTestId('lamps-throw-ironmouth-lampman')).toBeEnabled();
    expect(screen.getByTestId('lamps-throw-ironmouth-lampman')).toHaveTextContent('Light them');
    expect(screen.getByTestId('lamps-ironmouth-lampman')).toHaveTextContent(
      'every location in the city',
    );
  });
});
