import {
  MISC_AREA_ID,
  findUnit,
  findVehicle,
  makeAttributes,
  missionTimings,
  vehicleNoun,
  type FightLeaderQuoteRequest,
  type MissionArea,
  type MissionOffer,
} from '@frontline/shared';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionBoard } from './MissionBoard';

/**
 * Two things the send window gets wrong about a fight (bug pass, 2026-09-29).
 *
 * - Under `carriers_fight` a porter stands in the line, and the roster row already says so; the
 *   window still refused a party of them with "Porters do not go in alone".
 * - The leader quote carried the yard as picked, zeros included. `FleetSchema` refuses a zero, so a
 *   crew that stepped a bike up and back down got a 400 and a bench that read "not rated yet".
 */

const NOW = new Date('2026-09-29T12:00:00.000Z');
const HAULERS = findUnit('haulers');
const RAZORS = findUnit('razors');
const BIKE = findVehicle('motorcycle');

const fight: MissionOffer = {
  templateId: 'scrap-run',
  boardKey: '2026-09-13',
  name: 'Yard Brawl',
  brief: 'Somebody wants the yard back.',
  kind: 'battle',
  grade: 'F',
  travelMinutes: 5,
  durationMinutes: 20,
  totalMinutes: missionTimings({ travelMinutes: 5, durationMinutes: 20 }).totalMinutes,
  rawTravelMinutes: 5,
  rawDurationMinutes: 20,
  speedPercent: 0,
  rewards: { scrap: 10 },
  payoutSlots: 8,
  xp: 100,
  failedXp: 20,
  leanings: ['fight'],
  ramp: null,
};

const area: MissionArea = {
  id: MISC_AREA_ID,
  name: 'Miscellaneous Missions',
  blurb: 'Whatever anybody is paying for.',
  difficulty: 1,
  payPercent: 0,
  offers: [fight],
  activeMissionId: null,
};

const quote = vi.fn((body: FightLeaderQuoteRequest) => {
  void body;
  return Promise.resolve({ leaders: [] });
});

function open(army: Record<string, number>, carriersFight: boolean): HTMLElement {
  render(
    <MissionBoard
      areas={[area]}
      army={army}
      fleet={{ motorcycle: 1 }}
      loadouts={{}}
      bagPercent={0}
      marks={{}}
      carriersFight={carriersFight}
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
      onQuoteFightLeaders={quote}
      now={NOW}
      atCapacity={false}
      automated={false}
      pendingTemplateId={null}
      refusal={null}
      onLaunch={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTestId(`send-${fight.templateId}`));
  return screen.getByRole('dialog');
}

const field = (dialog: HTMLElement, name: string | undefined) =>
  within(dialog).getByLabelText<HTMLInputElement>(`How many ${name}`);
const send = (dialog: HTMLElement) => within(dialog).getByTestId('confirm-send');

beforeEach(() => {
  document.body.innerHTML = '';
  quote.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a party of porters on a fight', () => {
  it('goes for a crew that puts its porters in the line', () => {
    const dialog = open({ haulers: 6 }, true);
    fireEvent.change(field(dialog, HAULERS?.name), { target: { value: '6' } });
    expect(within(dialog).queryByText(/Porters do not go in alone/)).toBeNull();
    expect(send(dialog)).toBeEnabled();
  });

  it('is refused for a crew that does not', () => {
    const dialog = open({ haulers: 6 }, false);
    fireEvent.change(field(dialog, HAULERS?.name), { target: { value: '6' } });
    expect(within(dialog).getByText(/Porters do not go in alone/)).toBeVisible();
    expect(send(dialog)).toBeDisabled();
  });
});

describe('the leader quote', () => {
  it('never asks about a machine the crew stepped back to nothing', async () => {
    vi.useFakeTimers();
    const dialog = open({ razors: 4 }, false);
    fireEvent.change(field(dialog, RAZORS?.name), { target: { value: '2' } });
    const bike = field(dialog, vehicleNoun(BIKE?.name ?? ''));
    fireEvent.change(bike, { target: { value: '1' } });
    fireEvent.change(bike, { target: { value: '0' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(quote).toHaveBeenCalled();
    const asked = quote.mock.calls.at(-1)?.[0];
    expect(asked?.force).toEqual({ razors: 2 });
    expect(asked?.vehicles).toEqual({});
  });
});
