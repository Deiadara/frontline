import {
  MISC_AREA_ID,
  makeAttributes,
  missionTimings,
  type MissionArea,
  type MissionOffer,
} from '@frontline/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MissionBoard, launchedCardKey } from './MissionBoard';

/**
 * The board on show is an area, not a position in the list (bug pass, 2026-10-06).
 *
 * The list of areas changes whenever a district is taken or lost, and a board held by position
 * then showed a different district under the player, and launched an open card into it.
 */

const offer: MissionOffer = {
  templateId: 'scrap-run',
  boardKey: '2026-10-06',
  name: 'Long Haul',
  brief: 'A long way out and a long way back.',
  kind: 'standard',
  grade: 'E',
  travelMinutes: 40,
  durationMinutes: 30,
  totalMinutes: missionTimings({ travelMinutes: 40, durationMinutes: 30 }).totalMinutes,
  rawTravelMinutes: 40,
  rawDurationMinutes: 30,
  speedPercent: 0,
  rewards: { scrap: 10 },
  payoutSlots: 8,
  xp: 100,
  failedXp: 20,
  leanings: ['road'],
  ramp: null,
  golden: false,
  goldenPercent: 0,
};

const areaOf = (id: string, name: string): MissionArea => ({
  id,
  name,
  blurb: `${name}, hiring.`,
  difficulty: 1,
  payPercent: 0,
  offers: [offer],
  activeMissionId: null,
});

const misc = areaOf(MISC_AREA_ID, 'Miscellaneous Missions');

describe('a golden job (the Bounty Wall, 2026-10-07)', () => {
  it('wears the gold outline and says the bounty, and a plain one does neither', () => {
    const golden = { ...offer, templateId: 'gold-run', golden: true, goldenPercent: 30 };
    render(<MissionBoard {...props([{ ...misc, offers: [offer, golden] }])} />);
    expect(screen.getByTestId('offer-gold-run')).toHaveAttribute('data-golden', 'yes');
    expect(screen.getByTestId('golden-gold-run')).toHaveTextContent('+30% bounty');
    expect(screen.getByTestId('offer-scrap-run')).not.toHaveAttribute('data-golden');
    expect(screen.queryByTestId('golden-scrap-run')).not.toBeInTheDocument();
  });
});
const docks = areaOf('neon-docks', 'Neon Docks');
const belt = areaOf('steelbelt', 'Steelbelt');

function props(
  areas: MissionArea[],
  overrides: Partial<ComponentProps<typeof MissionBoard>> = {},
): ComponentProps<typeof MissionBoard> {
  return {
    areas,
    army: { razors: 20 },
    fleet: {},
    loadouts: {},
    bagPercent: 0,
    carrierFlat: 0,
    marks: {},
    carriersFight: false,
    anyRide: false,
    roster: undefined,
    stores: undefined,
    leaders: [
      {
        id: 'off-1',
        name: 'Reza Malik',
        kind: 'officer',
        arrivalPercent: 0,
        attributes: makeAttributes(40),
        held: null,
        heldUntil: null,
      },
    ],
    now: new Date('2026-10-06T12:00:00.000Z'),
    atCapacity: false,
    automated: false,
    pendingTemplateId: null,
    refusal: null,
    onLaunch: () => undefined,
    ...overrides,
  };
}

describe('the board on show', () => {
  it('stays on its district when one before it joins the list', () => {
    const { rerender } = render(<MissionBoard {...props([misc, belt])} />);
    fireEvent.click(screen.getByTestId('board-right'));
    expect(screen.getByTestId('board-area')).toHaveTextContent('Steelbelt');

    // The crew takes ground in the Docks, which the server lists before the Steelbelt.
    rerender(<MissionBoard {...props([misc, docks, belt])} />);
    expect(screen.getByTestId('board-area')).toHaveTextContent('Steelbelt');
  });

  it('falls back to the first board when its district leaves the list', () => {
    const { rerender } = render(<MissionBoard {...props([misc, belt])} />);
    fireEvent.click(screen.getByTestId('board-right'));
    rerender(<MissionBoard {...props([misc])} />);
    expect(screen.getByTestId('board-area')).toHaveTextContent('Miscellaneous Missions');
  });

  it('prints a refusal only on the card on the board it was about', () => {
    const refusal = { templateId: launchedCardKey('steelbelt', offer), message: 'No crew free' };
    render(<MissionBoard {...props([misc, belt], { refusal })} />);
    // The same job on the first board is not the job that was refused.
    expect(screen.queryByText('No crew free')).toBeNull();
    fireEvent.click(screen.getByTestId('board-right'));
    expect(screen.getByText('No crew free')).toBeInTheDocument();
  });

  it('clears the last refusal when a send window opens', () => {
    const onOpenSend = vi.fn();
    render(<MissionBoard {...props([misc], { onOpenSend })} />);
    fireEvent.click(screen.getByTestId(`send-${offer.templateId}`));
    expect(onOpenSend).toHaveBeenCalledTimes(1);
  });
});
