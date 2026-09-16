import {
  MISC_AREA_ID,
  formatDuration,
  hastenedMinutes,
  hastenedRoadMinutes,
  makeAttributes,
  missionTimings,
  type MissionArea,
  type MissionLeader,
  type MissionOffer,
} from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionBoard } from './MissionBoard';

/**
 * The two clocks in the send dialog, which have to be the same clock.
 *
 * The dialog prints the round trip at the foot of the leader column and the one-way road beside
 * "what carries them". Both describe the run this column is about to walk, so `road * 2 + on site`
 * has to come back to the round trip, and both have to be what `launchMission` will actually
 * charge: `hastenedRoadMinutes(TRAVEL_BAND_MINUTES[band], columnSpeed, ground + officer)`.
 *
 * The road line was neither. It ran the column's pace over `offer.travelMinutes`, a figure the
 * board had **already** reduced by the ground's cut and rounded, so it rounded twice where the
 * launch rounds once; and it passed no reduction at all, so the officer's Short Way and the
 * crew's own ground were both missing from it. Two numbers in one dialog, describing one run,
 * disagreeing by minutes.
 */

const NOW = new Date('2026-09-13T12:00:00.000Z');

/** The ground's cut, in the card's clock and in the launch's. */
const GROUND_PERCENT = 10;
/** §D5: the officer's Short Way, which only the launch and the dialog's own clock can see. */
const ARRIVAL_PERCENT = 10;
const RAW_TRAVEL = 100;
const RAW_DURATION = 60;

/**
 * The card's clock, priced exactly as `pricedTimings` prices it: the ground's cut at pace zero,
 * because who is going is chosen after the card is read. This is the already-reduced, already-
 * rounded figure the road line used to be handed.
 */
const CARD_TRAVEL = hastenedRoadMinutes(RAW_TRAVEL, 0, GROUND_PERCENT);
const CARD_DURATION = hastenedMinutes(RAW_DURATION, GROUND_PERCENT);

const offer: MissionOffer = {
  templateId: 'scrap-run',
  name: 'Long Haul',
  brief: 'A long way out and a long way back.',
  kind: 'standard',
  difficulty: 'easy',
  travelMinutes: CARD_TRAVEL,
  durationMinutes: CARD_DURATION,
  totalMinutes: missionTimings({
    travelMinutes: CARD_TRAVEL,
    durationMinutes: CARD_DURATION,
  }).totalMinutes,
  rawTravelMinutes: RAW_TRAVEL,
  rawDurationMinutes: RAW_DURATION,
  speedPercent: GROUND_PERCENT,
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

const officer: MissionLeader = {
  id: 'off-1',
  name: 'Reza Malik',
  kind: 'officer',
  arrivalPercent: ARRIVAL_PERCENT,
  attributes: makeAttributes(40),
  held: null,
  heldUntil: null,
};

function renderBoard() {
  return render(
    <MissionBoard
      areas={[area]}
      army={{ razors: 4 }}
      // Something in the yard, so the dialog draws "what carries them" and its road line.
      fleet={{ scrap_car: 1 }}
      loadouts={{}}
      bagPercent={0}
      marks={{}}
      leaders={[officer]}
      unledRule="free"
      level={10}
      now={NOW}
      atCapacity={false}
      pendingTemplateId={null}
      refusal={null}
      onLaunch={vi.fn()}
    />,
  );
}

/** The send window, with a crew, a machine and the officer picked: a column that is really going. */
function openLoadedDialog(): HTMLElement {
  fireEvent.click(screen.getByTestId(`send-${offer.templateId}`));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('How many Razors'), { target: { value: '2' } });
  fireEvent.change(within(dialog).getByLabelText('How many Scar'), { target: { value: '1' } });
  fireEvent.click(within(dialog).getByTestId('send-leader'));
  fireEvent.click(screen.getByRole('option', { name: /Reza Malik/ }));
  return dialog;
}

/** `Rides at 55 · 1h 05m on the road` becomes `{ speed: 55, road: '1h 05m' }`. */
function columnLine(dialog: HTMLElement): { speed: number; road: string } {
  const text = within(dialog).getByTestId('mission-column').textContent ?? '';
  const flat = text.replace(/\s+/g, ' ');
  const pace = /(?:Rides at|Held to) (\d+)/.exec(flat);
  const road = /· (.+?) on the road/.exec(flat);
  if (!pace || !road) throw new Error(`no road line in ${JSON.stringify(flat)}`);
  return { speed: Number(pace[1]), road: road[1] as string };
}

beforeEach(() => {
  // The picker portals its options; jsdom needs no more than a real container for that.
  document.body.innerHTML = '';
});

describe('the road the send dialog quotes', () => {
  it('is what the launch will charge, raw figures through one division and one rounding', () => {
    renderBoard();
    const dialog = openLoadedDialog();
    const { speed, road } = columnLine(dialog);

    // The launch's own arithmetic, over the raw band and the two cuts added before they are spent.
    const charged = hastenedRoadMinutes(RAW_TRAVEL, speed, GROUND_PERCENT + ARRIVAL_PERCENT);
    expect(road).toBe(formatDuration(charged));
  });

  it('agrees with the round trip printed in the same dialog', () => {
    renderBoard();
    const dialog = openLoadedDialog();
    const { road } = columnLine(dialog);
    const roundTrip = within(dialog).getByTestId('round-trip-clock').textContent;

    // Two legs of that road plus the job at the far end. The job's clock is the crew's own cut and
    // the officer's, exactly as `launchMission` spends them.
    const onSite = hastenedMinutes(RAW_DURATION, GROUND_PERCENT + ARRIVAL_PERCENT);
    const legs = [...formatDurationsUpTo(60)].find((entry) => entry.label === road)?.minutes;
    expect(legs).toBeDefined();
    expect(roundTrip).toBe(formatDuration(2 * (legs as number) + onSite));
  });
});

/** Every whole-minute clock up to `hours`, so a rendered duration can be read back as a number. */
function* formatDurationsUpTo(hours: number): Generator<{ minutes: number; label: string }> {
  for (let minutes = 1; minutes <= hours * 60; minutes++) {
    yield { minutes, label: formatDuration(minutes) };
  }
}
