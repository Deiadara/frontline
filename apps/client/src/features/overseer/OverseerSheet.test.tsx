import { findOverseerPreset, findPerk } from '@frontline/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OverseerSheet } from './OverseerSheet';

const deliveredUrl = vi.hoisted(() => vi.fn<() => string | null>(() => null));
vi.mock('../../assets/delivered', () => ({ deliveredUrl }));

function sheet(presetId: string) {
  const preset = findOverseerPreset(presetId);
  if (!preset) throw new Error(`fixture: no ${presetId} preset`);
  return render(<OverseerSheet preset={preset} />);
}

/**
 * Character select is the one screen a player cannot come back to, and the signature perk is the
 * half of the choice that is not a portrait.
 *
 * These three moved off `OverseerCard`, which went with the thumbnail grid on 2026-09-22: the
 * landing is four paintings now and this sheet is what a press opens. The claim is unchanged and
 * it is the reason the sheet exists. The card printed the perk's name and its flavour line and
 * stopped there, so the largest single number in the run ("+5 to officer social skills") was
 * visible only on the profile page you reach *after* choosing.
 */
describe('OverseerSheet', () => {
  it('prints what the signature perk is actually worth', () => {
    sheet('drillmaster');
    // Written out rather than read back off `describePerkBonus`, so a describer that quietly
    // stopped producing a number fails here instead of agreeing with itself.
    expect(screen.getByText('+5 to officer social skills')).toBeVisible();
  });

  it('prints the mechanical line for whichever character it is handed', () => {
    sheet('paymaster');
    expect(screen.getByText('-18% wages')).toBeVisible();
  });

  it('carries the name, the whole description and the browser test handle', () => {
    const perk = findPerk('sig_drillmaster');
    if (!perk) throw new Error('fixture: no drillmaster signature in the book');
    sheet('drillmaster');
    expect(screen.getByText(perk.name)).toBeVisible();
    expect(screen.getByTestId('overseer-sheet-drillmaster')).toBeVisible();
    /*
     * On the page rather than on a hover.
     *
     * The card had to hide it behind `data-tip`, because four of these had to fit one viewport.
     * One sheet has the room, and a player deciding on a signature should not have to find out
     * that hovering it says more.
     */
    expect(screen.getByText(perk.description)).toBeVisible();
  });
});
