import {
  makeAttributes,
  EARLY_RAMP_BANDS,
  TRAVEL_BAND_MINUTES,
  MISC_AREA_ID,
  leaningsFor,
  hastenedRoadMinutes,
  missionOffers,
  missionTimings,
  rampedTimings,
  templateTimings,
  findVehicle,
  formatDuration,
  payrollLedger,
  startingPayroll,
  type CrewResponse,
  type MeResponse,
  type MissionArea,
  type MissionOffer,
  type MissionsResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { MissionsPage } from './MissionsPage';
import { useSession } from '../../store/session';

/**
 * The send dialog's clock moves with the machines it prints two sections below.
 *
 * `offer.totalMinutes` is the bare template: `missions/board.ts` builds the board with
 * `templateTimings`. The launch runs `hastenedRoadMinutes(TRAVEL_BAND_MINUTES[band],
 * missionSpeedPercent + carried)` on the road, so a crew loading a Rotorcraft read
 * "-55% off the road" beside a total that did not know about it: neither number described the run.
 *
 * The dialog still cannot be exact: `missionSpeedPercent` and any delegation terms come off the
 * clock too and neither is on this payload. Both only ever shorten it, which is why the line says
 * "at most" and why the assertion below is an equality against the road half alone.
 */

const NOW = '2026-08-13T12:00:00.000Z';

/** One Rotorcraft: the biggest lever in the dialog, at whatever the catalogue prices it. */
const FLEET = { rotorcraft: 1 } as const;
/*
 * Read out of the catalogue rather than typed in.
 *
 * It was a literal, in three places, and the vehicle rebalance moved it. This file is about whether
 * the dialog's clock and its vehicle line agree with each other and with `hastenedRoadMinutes`; the
 * speed table is `building/vehicles.test.ts`'s to pin, and duplicating it here turned a tuning pass
 * into a failing clock test.
 */
const ROTOR_SPEED = findVehicle('rotorcraft')!.speed;

function areaOf(id: string, name: string): MissionArea {
  return {
    id,
    name,
    blurb: `Everything anybody is paying for in ${name}.`,
    difficulty: 1,
    payPercent: 0,
    offers: missionOffers(id, '', 12).map(({ template, grade }): MissionOffer => ({
      templateId: template.id,
      boardKey: 'board-key',
      name: template.name,
      brief: template.brief,
      kind: template.kind,
      grade,
      travelMinutes: templateTimings(template, grade).travelMinutes,
      durationMinutes: templateTimings(template, grade).durationMinutes,
      totalMinutes: templateTimings(template, grade).totalMinutes,
      // The clock before anything is taken off it: what the send dialog runs the launch's own
      // arithmetic on. See `MissionOfferSchema.rawTravelMinutes`.
      rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
      rawDurationMinutes: templateTimings(template, grade).durationMinutes,
      speedPercent: 0,
      rewards: template.spoils,
      payoutSlots: 40,
      xp: 240,
      failedXp: 48,
      // Off the template, not typed in: what a job leans on is `leaningsFor`, and a fixture
      // that made it up would let the picker agree with itself while disagreeing with the
      // maintainer. The grade is the one the board deals a level-twelve crew.
      leanings: [...leaningsFor(template)],
      // Out of the opening band: this fixture is not about the ramp.
      ramp: null,
    })),
    activeMissionId: null,
  };
}

const MISC = areaOf(MISC_AREA_ID, 'Miscellaneous Missions');

const board: MissionsResponse = {
  missions: [],
  justResolved: [],
  resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
  activeLimit: 2,
  xpBonusPercent: 0,
  areas: [MISC],
  // A Colossus among them, because §C3's other half is on this screen: the one sheet no vehicle
  // takes drags the column, and the row has to say so before anybody presses Send.
  army: { razors: 6, the_colossus: 1 },
  serverNow: NOW,
  // This file is about the clock, not about who leads. Every run has a leader, and the Overseer
  // takes nothing off the road (`arrivalPercent` is an officer's), so the clock is the bare one.
  leaders: [
    {
      id: 'ov-1',
      name: 'Rook',
      kind: 'overseer',
      arrivalPercent: 0,
      attributes: makeAttributes(22),
      held: null,
      heldUntil: null,
    },
  ],
  level: 12,
  // The board's city and the rooms this crew may read. Both carry a Zod default on the
  // wire; a hand-written fixture has to say them.
  cityId: 'ashfall',
  cities: ['ashfall'],
};

const crew: CrewResponse = {
  level: 6,
  housing: { used: 0, capacity: 8 },
  payroll: payrollLedger(startingPayroll(), 0),
  officers: [],
};

const me: MeResponse = {
  ...F.me,
  base: F.me.base ? { ...F.me.base, fleet: { ...FLEET } } : null,
};

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    headers: new Headers(),
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/crew')) return reply(crew);
    if (path.endsWith('/me')) return reply(me);
    if (path.endsWith('/missions')) return reply(board);
    throw new Error(`unstubbed request: ${path}`);
  });
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => vi.unstubAllGlobals());

const OFFER = MISC.offers[0];
if (!OFFER) throw new Error('the miscellaneous board offers nothing');

/** A bench with nobody held, so every name on it can actually be picked. */
const withLeaders = F.missionLeaders(null);

/**
 * The longest job the board is offering.
 *
 * A percentage cut has to land on a clock big enough to show it. The first version of the leader
 * test used the board's first card, an eighteen minute run, where ten per cent rounds away to the
 * same minute and the two leaders read identically whatever the component did.
 */
const LONG = [...MISC.offers].sort((a, b) => b.totalMinutes - a.totalMinutes)[0];
if (!LONG) throw new Error('the miscellaneous board offers nothing');

describe('the send dialog clock', () => {
  /**
   * §D5: the officer's own cut off the road, which the dialog could not see at all.
   *
   * `launchMission` adds `leadArrivalPercent` to the ground's cut and spends the sum once, but the
   * figure was on no payload the screen reads, so a run led by somebody with Short Way was sent
   * out up to ten per cent quicker than the line above the button said it would be. That is the
   * one line the maintainer asked to be exact.
   *
   * Asserted as a comparison rather than against a recomputed number on purpose. Working the
   * expected clock out here with the same three functions the component uses would pass whether
   * or not the component spent the percentage at all; two different leaders producing two
   * different clocks is a claim only the fixed version can satisfy.
   */
  it('shortens the run for a leader who takes time off the road', async () => {
    // The furthest band on this card: Short Way is spent on the road alone (maintainer,
    // 2026-10-01), and a tenth off a five-minute leg rounds back onto the same minute.
    const longRoad: MissionsResponse = {
      ...board,
      areas: board.areas.map((area) => ({
        ...area,
        offers: area.offers.map((offer) =>
          offer.templateId === LONG.templateId
            ? { ...offer, rawTravelMinutes: TRAVEL_BAND_MINUTES.furthest }
            : offer,
        ),
      })),
    };
    // This one board needs a bench: the shared fixture has none, because the rest of the file is
    // about the column rather than about who is at its head.
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/crew')) return reply(crew);
      if (path.endsWith('/me')) return reply(me);
      if (path.endsWith('/missions')) return reply({ ...longRoad, leaders: withLeaders });
      throw new Error(`unstubbed request: ${path}`);
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <MissionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('board-area');
    fireEvent.click(await screen.findByTestId(`send-${LONG.templateId}`));
    const dialog = screen.getByRole('dialog');

    // Somebody has to be going, or the readout is the empty-column ceiling rather than a run.
    fireEvent.change(within(dialog).getByLabelText('How many Razors'), { target: { value: '6' } });

    const clock = within(dialog).getByTestId('round-trip-clock');
    const leaders = withLeaders;
    const overseer = leaders.find((one) => one.kind === 'overseer');
    const officer = leaders.find((one) => one.kind === 'officer');
    if (!overseer || !officer) throw new Error('fixture error: the bench is missing a leader');
    // The precondition: the fixture gives officers a real cut and the Overseer none, which is the
    // launch's own rule. At zero the two clocks would agree whatever the component did.
    expect(officer.arrivalPercent).toBeGreaterThan(0);
    expect(overseer.arrivalPercent).toBe(0);

    /*
     * The picker is the painted `Dropdown`, not a native select, so it is clicked open and the
     * option is pressed. Its list is portalled to the unit, which is why the options are found on
     * `screen` rather than inside the dialog. `fireEvent.change` on it does nothing at all, which
     * is how the first version of this test managed to read the same clock twice.
     */
    const choose = async (name: string) => {
      fireEvent.click(within(dialog).getByTestId('send-leader'));
      await screen.findByRole('listbox');
      fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }));
    };

    await choose(overseer.name);
    await waitFor(() => expect(clock.textContent).not.toBe(''));
    const byOverseer = clock.textContent;

    await choose(officer.name);
    await waitFor(() => expect(clock.textContent).not.toBe(byOverseer));
  });

  it('moves with the column the machines produce, and says the rest only shortens it', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <MissionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('board-area');

    fireEvent.click(await screen.findByTestId(`send-${OFFER.templateId}`));
    const dialog = screen.getByRole('dialog');

    /*
     * Before anything is loaded, the bare template clock is the right answer, and it says so.
     *
     * An empty column is the one state where the figure really is a ceiling (`columnSpeed` gives
     * a unit that cannot move 0, and the road comes back at its base length), so it is the one
     * state where the readout is allowed to hedge. See `RoundTrip`.
     */
    const clock = within(dialog).getByTestId('round-trip-clock');
    expect(clock).toHaveTextContent(formatDuration(OFFER.totalMinutes));
    expect(within(dialog).getByTestId('round-trip')).toHaveTextContent(
      'At most, with nobody picked',
    );

    // Six Razors in a Rotorcraft: more seats than units, so the whole column rides at its rate.
    fireEvent.change(within(dialog).getByLabelText('How many Razors'), { target: { value: '6' } });
    fireEvent.change(within(dialog).getByLabelText('How many Rotorcraft'), {
      target: { value: '1' },
    });

    const hastened = missionTimings({
      travelMinutes: hastenedRoadMinutes(OFFER.travelMinutes, ROTOR_SPEED),
      durationMinutes: OFFER.durationMinutes,
    }).totalMinutes;
    // The precondition the assertion rests on: the two clocks are actually different.
    expect(hastened).toBeLessThan(OFFER.totalMinutes);

    // And once a column exists the figure is exact, so the hedge goes away with it.
    await waitFor(() => expect(clock).toHaveTextContent(formatDuration(hastened)));
    expect(within(dialog).getByTestId('round-trip')).toHaveTextContent('Total roundtrip time');
    expect(within(dialog).getByTestId('round-trip')).not.toHaveTextContent('At most');
    /*
     * ...and the line says which group set that pace, not a percentage.
     *
     * Six units in eighteen seats, so nobody walks and the machine itself is the slowest group in
     * the column: `columnSpeed` returns the Rotorcraft's own speed and the dialog names it.
     */
    expect(within(dialog).getByTestId('mission-column')).toHaveTextContent(
      `Held to ${ROTOR_SPEED} by The Rotorcraft`,
    );
  });
});

/**
 * §C3: the sheet that will not board, marked on the row that offers it.
 *
 * The Colossus is the only unit in the game a machine cannot carry, and a crew that ticks it into a
 * column has bought a truck that is now waiting for it. The note is on the count line where the
 * decision is made rather than in the report afterwards, and it only appears once something is
 * actually loaded: with an empty yard every unit walks and a note on every row says nothing.
 */
describe('the send dialog and a unit that walks', () => {
  it('marks it only once a machine is picked', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <MissionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('board-area');
    fireEvent.click(await screen.findByTestId(`send-${OFFER.templateId}`));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).queryByTestId('walks-the_colossus')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('How many Rotorcraft'), {
      target: { value: '1' },
    });
    await waitFor(() =>
      expect(within(dialog).getByTestId('walks-the_colossus')).toHaveTextContent('walks'),
    );
    expect(within(dialog).queryByTestId('walks-razors')).toBeNull();
  });
});

/**
 * The opening band, on the one screen that never learned about it.
 *
 * A crew's first three runs are compressed to between one and three minutes door to door
 * (`missions.ramp.ts`), and the board card prints that: the server prices the card through
 * `pricedTimings`, band included. The send dialog does not use those figures. It re-runs the
 * launch's arithmetic from `rawTravelMinutes` and `rawDurationMinutes` so the column's pace and
 * the leader's Short Way can come off it, and raw is the bare template.
 *
 * So the band was missing from the one line a player commits from. Measured against a live server
 * on 2026-09-25: the card read "Round trip 2m" and the dialog under it read "At most, with nobody
 * picked · 1h 50m" for the same job, on a new crew's very first mission.
 */
describe('the send dialog and the opening band', () => {
  const BAND = EARLY_RAMP_BANDS[0]!;

  /** The same board, with every card in the first band, as the server sends it to a new crew. */
  const ramped: MissionsResponse = {
    ...board,
    areas: board.areas.map((area) => ({
      ...area,
      offers: area.offers.map((offer) => {
        const timings = rampedTimings(
          missionTimings({
            travelMinutes: offer.rawTravelMinutes,
            durationMinutes: offer.rawDurationMinutes,
          }),
          BAND,
        );
        return { ...offer, ...timings, ramp: BAND };
      }),
    })),
  };

  beforeEach(() => {
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/crew')) return reply(crew);
      if (path.endsWith('/me')) return reply(me);
      if (path.endsWith('/missions')) return reply(ramped);
      throw new Error(`unstubbed request: ${path}`);
    });
  });

  it('quotes the band the card quotes, not the template underneath it', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <MissionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('board-area');

    const card = ramped.areas[0]!.offers[0]!;
    // The precondition, and the whole reason this case exists: the band has to be doing something
    // to this job, or the dialog agreeing with the card says nothing about whether it applied one.
    expect(card.totalMinutes).toBeLessThan(card.rawDurationMinutes + 2 * card.rawTravelMinutes);
    expect(card.totalMinutes).toBeLessThanOrEqual(BAND.maxMinutes);

    fireEvent.click(await screen.findByTestId(`send-${card.templateId}`));
    const dialog = screen.getByRole('dialog');
    const clock = within(dialog).getByTestId('round-trip-clock');
    /*
     * The whole string, not `toHaveTextContent`.
     *
     * That matcher is a substring test, and every duration here ends in the same unit: the band's
     * "3m" is inside the template's "23m", so the assertion passed against the unfixed component.
     * Caught by mutating the fix away and watching this case stay green.
     */
    expect(clock.textContent).toBe(formatDuration(card.totalMinutes));
  });

  it('keeps the band on after a column is picked, which is when the figure goes exact', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MemoryRouter>
          <MissionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByTestId('board-area');

    const card = ramped.areas[0]!.offers[0]!;
    fireEvent.click(await screen.findByTestId(`send-${card.templateId}`));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('How many Razors'), { target: { value: '6' } });

    // A column only ever shortens the walk, and the band clamps what is left into its own window,
    // so the quote stays inside the band rather than jumping back to the template's own clock.
    await waitFor(() => {
      const shown = within(dialog).getByTestId('round-trip-clock').textContent ?? '';
      expect(shown).toBe(formatDuration(card.totalMinutes));
    });
  });
});
