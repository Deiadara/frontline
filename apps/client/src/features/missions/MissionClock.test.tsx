import {
  TRAVEL_BAND_MINUTES,
  MISC_AREA_ID,
  battleTierFor,
  leaningsFor,
  hastenedRoadMinutes,
  missionOffers,
  missionTimings,
  templateTimings,
  findVehicle,
  formatDuration,
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
    offers: missionOffers(id).map((template): MissionOffer => ({
      templateId: template.id,
      name: template.name,
      brief: template.brief,
      kind: template.kind,
      difficulty: template.difficulty,
      travelMinutes: templateTimings(template).travelMinutes,
      durationMinutes: template.durationMinutes,
      totalMinutes: templateTimings(template).totalMinutes,
      // The clock before anything is taken off it: what the send dialog runs the launch's own
      // arithmetic on. See `MissionOfferSchema.rawTravelMinutes`.
      rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
      rawDurationMinutes: template.durationMinutes,
      speedPercent: 0,
      rewards: template.spoils,
      payoutSlots: 40,
      xp: 240,
      failedXp: 48,
      pagePrize: null,
      // Off the template, not typed in: what a job leans on and what a battle fields are
      // `leaningsFor` and `battleTierFor`, and a fixture that made them up would let the picker
      // agree with itself while disagreeing with the maintainer.
      authoredChance: template.successChance,
      leanings: [...leaningsFor(template)],
      battleTier: battleTierFor(template),
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
  areas: [MISC],
  // A Colossus among them, because §C3's other half is on this screen: the one sheet no vehicle
  // takes drags the column, and the row has to say so before anybody presses Send.
  army: { razors: 6, the_colossus: 1 },
  serverNow: NOW,
  leaders: [],
  // This file is about the clock, not about who leads: a rule that refuses nothing keeps the
  // send button alive without a leader having to be picked first.
  unledRule: 'free',
  level: 12,
};

const crew: CrewResponse = { level: 6, housing: { used: 0, capacity: 8 }, officers: [] };

const me: MeResponse = {
  ...F.me,
  base: F.me.base ? { ...F.me.base, fleet: { ...FLEET } } : null,
};

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
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
  useSession.setState({ token: 'session-token', user: null });
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
    // This one board needs a bench: the shared fixture has none, because the rest of the file is
    // about the column rather than about who is at its head.
    fetchMock.mockImplementation((path: string) => {
      if (path.endsWith('/crew')) return reply(crew);
      if (path.endsWith('/me')) return reply(me);
      if (path.endsWith('/missions')) return reply({ ...board, leaders: withLeaders });
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
     * option is pressed. Its list is portalled to the body, which is why the options are found on
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
     * a body that cannot move 0, and the road comes back at its base length), so it is the one
     * state where the readout is allowed to hedge. See `RoundTrip`.
     */
    const clock = within(dialog).getByTestId('round-trip-clock');
    expect(clock).toHaveTextContent(formatDuration(OFFER.totalMinutes));
    expect(within(dialog).getByTestId('round-trip')).toHaveTextContent(
      'At most, with nobody picked',
    );

    // Six Razors in a Rotorcraft: more seats than bodies, so the whole column rides at its rate.
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
    expect(within(dialog).getByTestId('round-trip')).toHaveTextContent('There and back');
    expect(within(dialog).getByTestId('round-trip')).not.toHaveTextContent('At most');
    /*
     * ...and the line says which group set that pace, not a percentage.
     *
     * Six bodies in eighteen seats, so nobody walks and the machine itself is the slowest group in
     * the column: `columnSpeed` returns the Rotorcraft's own speed and the dialog names it.
     */
    expect(within(dialog).getByTestId('mission-column')).toHaveTextContent(
      `Held to ${ROTOR_SPEED} by the Rotorcraft`,
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
