import {
  MISC_AREA_ID,
  findUnit,
  findVehicle,
  makeAttributes,
  missionTimings,
  type MissionArea,
  type MissionLeader,
  type MissionOffer,
  vehicleNoun,
} from '@frontline/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionBoard } from './MissionBoard';

/**
 * The crew switch the picker has to read, and did not (bug pass, 2026-09-19), and the rule
 * nothing switches off any more.
 *
 * - `carriers_fight` puts this crew's porters in a line. `standsInLine` is the predicate, the
 *   settle reads it (`missions/resolve.ts` hands `fightMissionBattle` the crew's whole fold), and
 *   the picker printed "cannot fight" beside a Scavenger that was about to fight and die. It could
 *   not ride on `CrewStandingResponse.effects`, which is a record of numbers, so it went on the
 *   roster payload.
 * - `no_ride` keeps the Colossus off every machine. Its waiver (`any_ride`) left the game on
 *   2026-10-15, so the column always waits for it.
 *
 * The switch tests are a pair: the same board, the same force, one switch flipped. A single-sided
 * assertion would pass against a screen that had simply stopped printing the label at all.
 */

const NOW = new Date('2026-09-13T12:00:00.000Z');

const offer: MissionOffer = {
  templateId: 'scrap-run',
  boardKey: '2026-09-13',
  name: 'Long Haul',
  brief: 'A long way out and a long way back.',
  kind: 'standard',
  grade: 'E',
  travelMinutes: 100,
  durationMinutes: 60,
  totalMinutes: missionTimings({ travelMinutes: 100, durationMinutes: 60 }).totalMinutes,
  rawTravelMinutes: 100,
  rawDurationMinutes: 60,
  speedPercent: 0,
  rewards: { scrap: 10 },
  payoutSlots: 8,
  xp: 100,
  failedXp: 20,
  leanings: ['road'],
  // Out of the opening band: this fixture is not about the ramp.
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

const officer: MissionLeader = {
  id: 'off-1',
  name: 'Reza Malik',
  kind: 'officer',
  arrivalPercent: 0,
  attributes: makeAttributes(40),
  held: null,
  heldUntil: null,
};

const COLOSSUS = findUnit('the_colossus');
const WAGON = findVehicle('armoured_car');

/** Razors to make a column, a Colossus that will not board, and porters that cannot fight. */
const ARMY = { razors: 4, scavengers: 6, the_colossus: 1 };

function renderBoard(switches: { carriersFight?: boolean } = {}) {
  return render(
    <MissionBoard
      areas={[area]}
      army={ARMY}
      // An Armoured Car seats thirty, which is room for the Colossus's twelve and the rest.
      fleet={{ armoured_car: 1 }}
      loadouts={{}}
      bagPercent={0}
      carrierFlat={0}
      marks={{}}
      carriersFight={switches.carriersFight ?? false}
      // The card a unit's name opens comes off the roster; these fixtures draw names bare.
      roster={undefined}
      leaders={[officer]}
      now={NOW}
      atCapacity={false}
      automated={false}
      pendingTemplateId={null}
      refusal={null}
      onLaunch={vi.fn()}
    />,
  );
}

function openDialog(): HTMLElement {
  fireEvent.click(screen.getByTestId(`send-${offer.templateId}`));
  return screen.getByRole('dialog');
}

/** The dialog with the Colossus picked and the truck loaded: a column that is really going. */
function openColumn(): HTMLElement {
  const dialog = openDialog();
  fireEvent.change(within(dialog).getByLabelText('How many Razors'), { target: { value: '2' } });
  fireEvent.change(within(dialog).getByLabelText(`How many ${COLOSSUS?.name}`), {
    target: { value: '1' },
  });
  fireEvent.change(within(dialog).getByLabelText(`How many ${vehicleNoun(WAGON?.name ?? '')}`), {
    target: { value: '1' },
  });
  return dialog;
}

/** `Rides at 55 · …` and `Held to 15 · …` both reduce to the number. */
function pace(dialog: HTMLElement): number {
  const text = (within(dialog).getByTestId('mission-column').textContent ?? '').replace(
    /\s+/g,
    ' ',
  );
  const found = /(?:Rides at|Held to) (\d+)/.exec(text);
  if (!found) throw new Error(`no pace in ${JSON.stringify(text)}`);
  return Number(found[1]);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('a crew whose porters fight', () => {
  it('says a Scavenger cannot fight when the crew has not bought the programme', () => {
    renderBoard({ carriersFight: false });
    expect(openDialog()).toHaveTextContent(/cannot fight/i);
  });

  it('stops saying it once they will be standing in the line', () => {
    renderBoard({ carriersFight: true });
    // `standsInLine` is what the settle asks, and for this crew it answers yes: the porters take
    // casualties on a battle job, so a row that calls them non-combatants is telling a lie that
    // costs units.
    expect(openDialog()).not.toHaveTextContent(/cannot fight/i);
  });
});

describe('a Colossus beside a truck with room for it', () => {
  it('walks, and holds the column at its own pace', () => {
    renderBoard();
    const dialog = openColumn();
    expect(within(dialog).getByTestId('walks-the_colossus')).toBeInTheDocument();
    expect(pace(dialog)).toBe(COLOSSUS?.stats.speed);
    // Not vacuous: the truck is faster, so a seat would have changed the quote.
    expect(WAGON?.speed ?? 0).toBeGreaterThan(COLOSSUS?.stats.speed ?? 0);
  });
});
