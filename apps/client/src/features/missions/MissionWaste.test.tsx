import {
  MISC_AREA_ID,
  STARTING_RESOURCES,
  findUnit,
  makeAttributes,
  missionTimings,
  storeCeilings,
  type Building,
  type MissionArea,
  type MissionOffer,
} from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MissionBoard, type MissionStores } from './MissionBoard';

/**
 * The send window says how much of the haul the stores could take today (maintainer ruling,
 * 2026-09-28).
 *
 * A run's pay lands up to the store's ceiling and the rest is thrown away at the gate, and nobody
 * can be asked then. So the window the crew is committed from is where the warning goes: against
 * the stock held now, as a warning rather than a refusal, because the stock moves before the crew
 * is back.
 */

const RAZORS = findUnit('razors');
const DISTRICT: Building[] = [
  { id: 'b-apothecary', kind: 'apothecary', level: 2, modifications: [] },
];
const CEILINGS = storeCeilings(DISTRICT);

const offer: MissionOffer = {
  templateId: 'scrap-run',
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
};

const area: MissionArea = {
  id: MISC_AREA_ID,
  name: 'Miscellaneous Missions',
  blurb: 'Whatever anybody is paying for.',
  difficulty: 1,
  payPercent: 0,
  offers: [offer],
  activeMissionId: null,
};

function open(stores: MissionStores | undefined): HTMLElement {
  render(
    <MissionBoard
      areas={[area]}
      army={{ razors: 20 }}
      fleet={{}}
      loadouts={{}}
      bagPercent={0}
      marks={{}}
      carriersFight={false}
      anyRide={false}
      roster={undefined}
      stores={stores}
      leaders={[
        {
          id: 'off-1',
          name: 'Reza Malik',
          kind: 'officer',
          arrivalPercent: 0,
          attributes: makeAttributes(40),
          held: null,
          heldUntil: null,
        },
      ]}
      now={new Date('2026-09-28T12:00:00.000Z')}
      atCapacity={false}
      automated={false}
      pendingTemplateId={null}
      refusal={null}
      onLaunch={() => undefined}
    />,
  );
  fireEvent.click(screen.getByTestId(`send-${offer.templateId}`));
  const dialog = screen.getByRole('dialog');
  // Enough hands to carry the whole job, so what is short is the store and not the bag.
  fireEvent.change(within(dialog).getByLabelText(`How many ${RAZORS?.name}`), {
    target: { value: '20' },
  });
  return dialog;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the send window and the stores', () => {
  it('says the stores take all of it when they have room', () => {
    const dialog = open({ resources: { ...STARTING_RESOURCES, scrap: 0 }, ceilings: CEILINGS });
    expect(dialog.textContent).toContain('all of it');
    expect(within(dialog).queryByTestId('send-waste')).toBeNull();
  });

  it('warns how much would go to waste on a nearly full store, and still lets the crew go', () => {
    const dialog = open({
      resources: { ...STARTING_RESOURCES, scrap: CEILINGS.scrap - 4 },
      ceilings: CEILINGS,
    });
    expect(dialog.textContent).toContain('part of it');
    expect(within(dialog).getByTestId('send-waste').textContent).toContain(
      '6 Scrap of this haul would go to waste',
    );
    expect(within(dialog).getByTestId('confirm-send')).toBeEnabled();
  });

  it('says nothing about room before the crew has been read', () => {
    const dialog = open(undefined);
    expect(dialog.textContent).not.toContain('Stores take');
  });
});
