import { findOverseerPreset, findPerk } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverseerCard } from './OverseerCard';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

function card(presetId: string) {
  const preset = findOverseerPreset(presetId);
  if (!preset) throw new Error(`fixture: no ${presetId} preset`);
  return render(<OverseerCard preset={preset} selected={false} onSelect={() => {}} />);
}

/**
 * Character select is the one screen a player cannot come back to, and the signature perk is the
 * half of the choice that is not a portrait.
 *
 * The card printed the perk's name and its flavour line and stopped there, so the largest single
 * number in the run ("+5 to officer social skills") was visible on the profile page you only reach
 * *after* choosing. Everywhere else in the game a perk carries `describePerkBonus` with it.
 */
describe('OverseerCard', () => {
  it('prints what the signature perk is actually worth', () => {
    card('drillmaster');
    // Written out rather than read back off `describePerkBonus`, so a describer that quietly
    // stopped producing a number fails here instead of agreeing with itself.
    expect(screen.getByText('+5 to officer social skills')).toBeVisible();
  });

  it('prints the mechanical line for whichever character it is handed', () => {
    card('paymaster');
    expect(screen.getByText('-18% wages')).toBeVisible();
  });

  it('still carries the name, the flavour and the browser test handle', () => {
    const perk = findPerk('sig_drillmaster');
    if (!perk) throw new Error('fixture: no drillmaster signature in the book');
    card('drillmaster');
    expect(screen.getByText(perk.name)).toBeVisible();
    expect(screen.getByTestId('overseer-card-drillmaster')).toBeVisible();
    expect(screen.getByText(perk.name)).toHaveAttribute(
      'data-tip',
      expect.stringContaining(perk.description),
    );
  });
});
