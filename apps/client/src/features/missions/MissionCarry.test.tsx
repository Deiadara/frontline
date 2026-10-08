import {
  MISC_AREA_ID,
  RESOURCE_KG,
  findUnit,
  makeAttributes,
  missionTimings,
  payoutSlots,
  type MissionArea,
  type MissionOffer,
  missionCarry,
} from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MissionBoard } from './MissionBoard';

/**
 * The send window says how much of the card's pay the party can carry home (maintainer ruling,
 * 2026-09-30: keep the carry limit, but warn).
 *
 * A job that pays more than the crew can lift pays only what the crew can lift, and the trim is
 * silent until the report. The window is where the crew is picked, so the figure sits there, in
 * the loot slots the card prints its pay in, and moves as units are added.
 */

const RAZORS = findUnit('razors')!;
// 40 scrap at 1 slot and 20 supplies at 3: 100 loot slots, so one Razor's 25 is a quarter of it.
const rewards = { scrap: 40, supplies: 20 };

const offer: MissionOffer = {
  templateId: 'scrap-run',
  boardKey: '2026-09-30',
  name: 'Heavy Lifting',
  brief: 'More out there than one pair of hands can bring back.',
  kind: 'standard',
  grade: 'E',
  travelMinutes: 20,
  durationMinutes: 30,
  totalMinutes: missionTimings({ travelMinutes: 20, durationMinutes: 30 }).totalMinutes,
  rawTravelMinutes: 20,
  rawDurationMinutes: 30,
  speedPercent: 0,
  rewards,
  payoutSlots: Math.round(payoutSlots(rewards, RESOURCE_KG)),
  xp: 100,
  failedXp: 20,
  leanings: ['road'],
  ramp: null,
  golden: false,
  goldenPercent: 0,
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

function openWindow(
  bag = 0,
  army: Record<string, number> = { razors: 10 },
  carrierFlat = 0,
): HTMLElement {
  render(
    <MissionBoard
      areas={[area]}
      army={army}
      fleet={{}}
      loadouts={{}}
      bagPercent={bag}
      carrierFlat={carrierFlat}
      marks={{}}
      carriersFight={false}
      anyRide={false}
      roster={undefined}
      stores={undefined}
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
      now={new Date('2026-09-30T12:00:00.000Z')}
      atCapacity={false}
      automated={false}
      pendingTemplateId={null}
      refusal={null}
      onLaunch={() => undefined}
    />,
  );
  fireEvent.click(screen.getByTestId(`send-${offer.templateId}`));
  return screen.getByRole('dialog');
}

function send(dialog: HTMLElement, razors: number): HTMLElement {
  fireEvent.change(within(dialog).getByLabelText(`How many ${RAZORS.name}`), {
    target: { value: String(razors) },
  });
  return within(dialog).getByTestId('send-carries');
}

/** The figure's own span: the readout's second child, which carries the tone. */
const figure = (readout: HTMLElement): HTMLElement => readout.lastElementChild as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the send window and what the party carries home', () => {
  it('prices the fixture at 100 loot slots, so the shares below are exact', () => {
    expect(offer.payoutSlots).toBe(100);
    expect(RAZORS.stats.lootCapacity).toBe(25);
  });

  it('says how much of the pay comes home, and moves as units are picked', () => {
    const dialog = openWindow();
    expect(within(dialog).getByTestId('send-carries')).toHaveTextContent('Carries0 of 100');
    expect(send(dialog, 1)).toHaveTextContent('Carries25 of 100 loot slots');
    expect(send(dialog, 3)).toHaveTextContent('Carries75 of 100 loot slots');
  });

  it('warns while the party carries less than all of it, and stops at the whole pay', () => {
    const dialog = openWindow();
    expect(figure(send(dialog, 2)).className).toContain('text-warning');
    const whole = send(dialog, 4);
    expect(whole).toHaveTextContent('100 of 100 loot slots');
    expect(figure(whole).className).not.toContain('text-warning');
    // A bigger party carries no more than the job pays: the share is of the card's figure.
    expect(send(dialog, 10)).toHaveTextContent('100 of 100 loot slots');
  });

  it('replaces the old pair of readouts rather than adding a third', () => {
    const dialog = openWindow();
    expect(dialog.textContent).not.toContain('Can carry');
    expect(dialog.textContent).not.toContain('Job pays');
  });
});

// Bug pass, 2026-10-02: the row quoted the bare sheet while the header summed the crew's own carry.
describe('what one unit carries, on its row', () => {
  it('is the crew\u2019s own figure, the bag on it, as the header sums it', () => {
    const dialog = openWindow(40);
    const carried = missionCarry({ razors: 1 }, {}, 40);
    expect(carried).toBeGreaterThan(RAZORS.stats.lootCapacity);
    expect(dialog).toHaveTextContent(`carries ${carried} loot slots`);
  });

  // The Straw Sack (Arca, 2026-10-07): flat slots on every carrier, and on nobody else.
  it('adds the Straw Sack\u2019s bags to a carrier\u2019s row and not to a fighter\u2019s', () => {
    const dialog = openWindow(0, { razors: 10, scavengers: 10 }, 5);
    const porter = missionCarry({ scavengers: 1 }, {}, 0, undefined, 5);
    expect(porter).toBe(missionCarry({ scavengers: 1 }) + 5);
    expect(dialog).toHaveTextContent(`carries ${porter} loot slots`);
    expect(dialog).toHaveTextContent(`carries ${RAZORS.stats.lootCapacity} loot slots`);
  });
});

// §D7 sits on the muster now (maintainer, 2026-10-07): a unit on the roster goes where the crew goes,
// so the row carries no rank note and the picker takes everybody at home.
describe('a unit the old rank gate refused', () => {
  it('can be picked like any other, with nothing red on its row', () => {
    const dialog = openWindow(0, { razors: 10, juggernauts: 2 });
    expect(within(dialog).queryByTestId('beyond-rank-juggernauts')).toBeNull();
    expect(within(dialog).getByTestId('max-juggernauts')).toBeEnabled();
    expect(dialog.textContent).not.toMatch(/will not sign/i);
  });
});
