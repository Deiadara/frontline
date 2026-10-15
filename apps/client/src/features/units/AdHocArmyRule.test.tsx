import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { RuleTag } from './tags';

/** The card inside the hover opens mutations and links, so it needs a client and a router. */
function draw(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const rule = (label: string, level?: number) => ({
  id: 'ad_hoc_army',
  label,
  description: 'Starts the fight with a robot beside him.',
  ...(level === undefined ? {} : { level }),
});

/** AD HOC ARMY (maintainer, 2026-10-09): the robot's whole card over the rule's words. */
describe('the AD HOC ARMY hover', () => {
  it('shows the robot card titled for the rule, at the Crate Ring level, above the words', () => {
    draw(<RuleTag rule={rule('Ad Hoc Army', 4)} />);
    fireEvent.mouseEnter(screen.getByText('Ad Hoc Army'));
    const card = screen.getByTestId('ad-hoc-army-card');
    expect(within(card).getByText('AD HOC ARMY')).toBeTruthy();
    const robot = within(card).getByTestId('unit-ad_hoc_army');
    // Level 4: 200 + 300 vitality and 50 + 60 damage on the base sheet.
    expect(robot.textContent).toContain('500');
    expect(robot.textContent).toContain('110');
    expect(robot.textContent).toContain('The Geppetto');
    // The robot's rule as a line of its own: TAUNT, and what it does (2026-10-13).
    expect(card.textContent).toMatch(/Taunt:\s*Draws the enemy/);
    const words = within(card).getByText('Starts the fight with a robot beside him.');
    expect(robot.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(
      0,
    );
  });

  it('draws the base robot for a crew without the ring, and names the second rung', () => {
    const { unmount } = draw(<RuleTag rule={rule('Ad Hoc Army')} />);
    fireEvent.mouseEnter(screen.getByText('Ad Hoc Army'));
    expect(screen.getByTestId('unit-ad_hoc_army').textContent).toContain('200');
    unmount();
    draw(<RuleTag rule={rule('Ad Hoc Army II', 5)} />);
    expect(screen.getByText('Ad Hoc Army II')).toBeTruthy();
  });
});
