import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PartsBench } from './PartsBench';

/** The parts bin's breakdown press (maintainer, 2026-10-09): asked first, the yield named. */
describe('breaking a part down', () => {
  it('names the yield on the button and asks before it presses', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PartsBench held={{ scrap_servo: 2 }} />
      </QueryClientProvider>,
    );
    const button = screen.getByTestId('scrapyard-break-scrap_servo');
    expect(button.getAttribute('data-tip')).toBe('Break one down for 4 HQ metal and 20 scrap');
    expect(screen.getByTestId('scrapyard-breakdown-table')).toHaveTextContent(
      'masterpiece 110 HQ metal and 360 scrap',
    );
    fireEvent.click(button);
    expect(screen.getByText('Break down Scrap Servo?')).toBeInTheDocument();
  });
});
