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
 * The two crew switches the picker has to read, and did not (bug pass, 2026-09-19).
 *
 * Both of them lift a hard rule off a *unit sheet*, and neither is a fact about the sheet:
 *
 * - `carriers_fight` puts this crew's porters in a line. `standsInLine` is the predicate, the
 *   settle reads it (`missions/resolve.ts` hands `fightMissionBattle` the crew's whole fold), and
 *   the picker printed "cannot fight" beside a Scavenger that was about to fight and die.
 * - `any_ride` gets a `no_ride` sheet into a truck. `ridingGroups(force, anyRide)` is what the
 *   launch spends seats with, and the picker printed "walks" beside a Colossus that rides, then
 *   quoted the column at fifteen when it was travelling at the truck's pace.
 *
 * Neither could ever have ridden on `CrewStandingResponse.effects`, which is a record of numbers,
 * and that is the whole reason they were missing: there was nowhere on the wire to put them until
 * `carriersFight` went on the roster payload for the ally picker. `anyRide` is beside it now.
 *
 * Every test here is a pair: the same board, the same force, one switch flipped. A single-sided
 * assertion would pass against a screen that had simply stopped printing the label at all.
 */

const NOW = new Date('2026-09-13T12:00:00.000Z');

const offer: MissionOffer = {
  templateId: 'scrap-run',
  name: 'Long Haul',
  brief: 'A long way out and a long way back.',
  kind: 'standard',
  difficulty: 'easy',
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
  arrivalPercent: 0,
  attributes: makeAttributes(40),
  held: null,
  heldUntil: null,
};

const COLOSSUS = findUnit('the_colossus');
const WAGON = findVehicle('armoured_car');

/** Razors to make a column, a Colossus that will not board, and porters that cannot fight. */
const ARMY = { razors: 4, scavengers: 6, the_colossus: 1 };

function renderBoard(switches: { carriersFight?: boolean; anyRide?: boolean } = {}) {
  return render(
    <MissionBoard
      areas={[area]}
      army={ARMY}
      // An Armoured Car seats thirty, which is room for the Colossus's twelve and the rest.
      fleet={{ armoured_car: 1 }}
      loadouts={{}}
      bagPercent={0}
      marks={{}}
      carriersFight={switches.carriersFight ?? false}
      anyRide={switches.anyRide ?? false}
      // The card a unit's name opens comes off the roster; these fixtures draw names bare.
      roster={undefined}
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

describe('a crew whose machines seat anything', () => {
  it('holds the column at the Colossus without the waiver', () => {
    renderBoard({ anyRide: false });
    const dialog = openColumn();
    expect(within(dialog).getByTestId('walks-the_colossus')).toBeInTheDocument();
    expect(pace(dialog)).toBe(COLOSSUS?.stats.speed);
  });

  it('puts it in the truck, and quotes the truck, with the waiver', () => {
    renderBoard({ anyRide: true });
    const dialog = openColumn();
    expect(within(dialog).queryByTestId('walks-the_colossus')).toBeNull();
    expect(pace(dialog)).toBe(WAGON?.speed);
    // The bug this is really about: the quote was the slower of the two, which is the one
    // direction `column.ts` says a road quote may not be wrong in.
    expect(WAGON?.speed ?? 0).toBeGreaterThan(COLOSSUS?.stats.speed ?? 0);
  });
});
