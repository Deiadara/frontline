import {
  MISC_AREA_ID,
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
      stance: template.stance,
      travelMinutes: templateTimings(template).travelMinutes,
      durationMinutes: template.durationMinutes,
      totalMinutes: templateTimings(template).totalMinutes,
      rewards: template.spoils,
      payoutSlots: 40,
      xp: 240,
      failedXp: 48,
      pagePrize: null,
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

describe('the send dialog clock', () => {
  it('moves with the column the machines produce, and says the rest only shortens it', async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <MissionsPage />
      </QueryClientProvider>,
    );
    await screen.findByTestId('board-area');

    fireEvent.click(await screen.findByTestId(`send-${OFFER.templateId}`));
    const dialog = screen.getByRole('dialog');

    // Before anything is loaded, the bare template clock is the right answer.
    expect(dialog).toHaveTextContent(
      `${formatDuration(OFFER.totalMinutes)} there and back at most`,
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

    await waitFor(() =>
      expect(dialog).toHaveTextContent(`${formatDuration(hastened)} there and back at most`),
    );
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
        <MissionsPage />
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
