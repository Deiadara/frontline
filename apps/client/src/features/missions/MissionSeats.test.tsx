import {
  MISC_AREA_ID,
  fleetCapacity,
  findUnit,
  findVehicle,
  makeAttributes,
  missionTimings,
  type MissionArea,
  type MissionOffer,
  vehicleNoun,
} from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionBoard } from './MissionBoard';

/**
 * §C3: the seats are the ceiling on the mission board too (maintainer, 2026-09-19).
 *
 * Two rules, pulling opposite ways, and both were asked for in the same breath:
 *
 * - "Make it so that if you choose vehicles you can only choose up to that many units and it
 *   doesn't even let you click the button otherwise with a warning that they don't fit."
 * - "If you have already added units and you add vehicles it doesn't let you send it until you're
 *   in the amount you need, **but it doesn't change the units**, you have to do that yourself
 *   until the button is clickable."
 *
 * So the stepper stops at what fits going up, and an overload arrived at from the other direction
 * is a refusal with a sentence rather than a silent trim. A window that quietly put people back
 * would satisfy the first half and break the second.
 *
 * The third thing here is the zero: `setRiding` leaves a key behind when a machine is stepped
 * back to nothing, `FleetSchema` is a record of **positive** integers, and the launch came back
 * `Too small: expected number to be >0 at vehicles.motorcycle` at a crew that had changed its
 * mind about a bike.
 */

const NOW = new Date('2026-09-19T12:00:00.000Z');
const WAGON = findVehicle('armoured_car');
const BIKE = findVehicle('motorcycle');
const RAZORS = findUnit('razors');

const offer: MissionOffer = {
  templateId: 'scrap-run',
  name: 'Long Haul',
  brief: 'A long way out and a long way back.',
  kind: 'standard',
  difficulty: 'easy',
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
  pagePrize: null,
  authoredChance: 0.8,
  leanings: ['road'],
  battleTier: null,
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

const launch = vi.fn();

function open(): HTMLElement {
  launch.mockReset();
  render(
    <MissionBoard
      areas={[area]}
      army={{ razors: 20 }}
      // A bike seats two and a wagon thirty, so the two ends of the rule are both reachable.
      fleet={{ motorcycle: 1, armoured_car: 1 }}
      loadouts={{}}
      bagPercent={0}
      marks={{}}
      carriersFight={false}
      anyRide={false}
      roster={undefined}
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
      unledRule="free"
      level={10}
      now={NOW}
      atCapacity={false}
      pendingTemplateId={null}
      refusal={null}
      onLaunch={launch}
    />,
  );
  fireEvent.click(screen.getByTestId(`send-${offer.templateId}`));
  return screen.getByRole('dialog');
}

const razorField = (dialog: HTMLElement) =>
  within(dialog).getByLabelText<HTMLInputElement>(`How many ${RAZORS?.name}`);
const bikeField = (dialog: HTMLElement) =>
  within(dialog).getByLabelText<HTMLInputElement>(`How many ${vehicleNoun(BIKE?.name ?? '')}`);
const send = (dialog: HTMLElement) => within(dialog).getByTestId('confirm-send');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('picking the machine first', () => {
  it('leaves the roster uncapped while nothing is loaded', () => {
    const dialog = open();
    expect(razorField(dialog).max).toBe('20');
  });

  it('stops the stepper at the seats once a machine is loaded', () => {
    const dialog = open();
    fireEvent.change(bikeField(dialog), { target: { value: '1' } });
    // A Scrappy seats two unit slots and a Razor is one apiece.
    expect(fleetCapacity({ motorcycle: 1 })).toBe(2);
    expect(razorField(dialog).max).toBe('2');
    fireEvent.click(within(dialog).getByTestId(`max-${RAZORS?.id}`));
    expect(razorField(dialog).value).toBe('2');
    expect(send(dialog)).toBeEnabled();
  });
});

describe('picking the people first', () => {
  it('refuses the send and says why, without putting anybody back', () => {
    const dialog = open();
    fireEvent.change(razorField(dialog), { target: { value: '9' } });
    expect(send(dialog)).toBeEnabled();

    // ...and now the bike, which seats two of the nine.
    fireEvent.change(bikeField(dialog), { target: { value: '1' } });
    expect(within(dialog).getByTestId('mission-overloaded')).toBeVisible();
    expect(send(dialog)).toBeDisabled();
    // The rule the maintainer was explicit about: the nine are still nine.
    expect(razorField(dialog).value, 'the window trimmed the force by itself').toBe('9');
  });

  it('clears the moment the crew makes it fit, either way round', () => {
    const dialog = open();
    fireEvent.change(razorField(dialog), { target: { value: '9' } });
    fireEvent.change(bikeField(dialog), { target: { value: '1' } });
    expect(send(dialog)).toBeDisabled();

    // Bringing a bigger machine is one answer...
    fireEvent.change(within(dialog).getByLabelText(`How many ${vehicleNoun(WAGON?.name ?? '')}`), {
      target: { value: '1' },
    });
    expect(within(dialog).queryByTestId('mission-overloaded')).toBeNull();
    expect(send(dialog)).toBeEnabled();
  });

  it('...and taking people off is the other', () => {
    const dialog = open();
    fireEvent.change(razorField(dialog), { target: { value: '9' } });
    fireEvent.change(bikeField(dialog), { target: { value: '1' } });
    expect(send(dialog)).toBeDisabled();

    fireEvent.change(razorField(dialog), { target: { value: '2' } });
    expect(within(dialog).queryByTestId('mission-overloaded')).toBeNull();
    expect(send(dialog)).toBeEnabled();
  });
});

describe('what reaches the launch', () => {
  it('never carries a machine the crew stepped back to nothing', () => {
    const dialog = open();
    fireEvent.change(razorField(dialog), { target: { value: '2' } });
    // Picked, then unpicked. The key stays in React state with a zero in it; the payload must
    // not, because `FleetSchema` is a partial record of positive integers.
    fireEvent.change(bikeField(dialog), { target: { value: '1' } });
    fireEvent.change(bikeField(dialog), { target: { value: '0' } });
    fireEvent.click(send(dialog));

    expect(launch).toHaveBeenCalledTimes(1);
    const fleet = launch.mock.calls[0]?.[4] as Record<string, number> | undefined;
    expect(fleet).toEqual({});
    expect(Object.values(fleet ?? {}).every((count) => count > 0)).toBe(true);
  });
});
