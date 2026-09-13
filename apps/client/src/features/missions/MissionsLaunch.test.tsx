import {
  TRAVEL_BAND_MINUTES,
  LEANING_PROFILES,
  MISSION_LEANING_LABELS,
  MISSION_LEANING_REASONS,
  MISC_AREA_ID,
  battleTierFor,
  leaningsFor,
  missionOffers,
  playerLevelGrants,
  templateTimings,
  type LaunchMissionRequest,
  type MissionLeader,
  type LaunchMissionResponse,
  type MissionArea,
  type MissionOffer,
  type MissionsResponse,
  makeAttributes,
  BLUEPRINTS,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionsPage } from './MissionsPage';
import { useSession } from '../../store/session';

/**
 * The §E/§G6 launch contract, driven through the real hooks against a stubbed network.
 *
 * Mocked at `fetch` rather than at `lib/queries` on purpose. What this covers is a set of
 * *required request fields*: a launch has to name the board it came off, the units going and,
 * unless the crew has researched going without, whoever leads it. A hook-level mock asserts only
 * that some object reached `mutate`: it cannot see what went on the wire, which is exactly how a
 * client that never sent the leader at all once passed every gate while half the board was
 * unlaunchable.
 */

const NOW = '2026-08-13T12:00:00.000Z';

/** One board's worth of offers, priced as the server prices them. */
function areaOf(id: string, name: string, payPercent = 0): MissionArea {
  return {
    id,
    name,
    blurb: `Everything anybody is paying for in ${name}.`,
    difficulty: 1,
    payPercent,
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

/**
 * Who may lead a run, off the board itself rather than off a second read of the crew.
 *
 * Three sheets that differ, because two of the assertions below are about *which* of them the
 * screen picks: a roster where everybody scores the same cannot tell a working "most suitable"
 * button from one that returns the first name it sees. Odile is out on another run, which is the
 * state the picker has to draw and refuse.
 */
const LEADERS: MissionLeader[] = [
  {
    id: 'ov-1',
    name: 'Rook',
    kind: 'overseer',
    arrivalPercent: 0,
    attributes: makeAttributes(22),
    held: null,
    heldUntil: null,
  },
  {
    id: 'off-1',
    name: 'Reza Malik',
    kind: 'officer',
    arrivalPercent: 0,
    attributes: makeAttributes(15, { logistics: 82, organization: 70, navigation: 66 }),
    held: null,
    heldUntil: null,
  },
  {
    id: 'off-2',
    name: 'Odile Marchetti',
    kind: 'officer',
    arrivalPercent: 0,
    attributes: makeAttributes(15, { logistics: 95, organization: 95, navigation: 95 }),
    held: 'run',
    heldUntil: null,
  },
];

const MISC = areaOf(MISC_AREA_ID, 'Miscellaneous Missions');
const RUSTYARD = areaOf('rustyard', 'The Rustyard', 27);

const board: MissionsResponse = {
  missions: [],
  justResolved: [],
  resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
  activeLimit: 2,
  areas: [MISC, RUSTYARD],
  army: { razors: 6, scavengers: 4 },
  serverNow: NOW,
  leaders: LEADERS,
  // The crew has the first rung: a run may go out unled, at a price. The forbidden half of that
  // gate has a group of its own below.
  unledRule: 'penalised',
  level: 12,
};

/**
 * A launch the server accepted. Spelled out rather than stubbed loosely because the client
 * validates every 2xx body through `LaunchMissionResponseSchema`: a placeholder that does not
 * satisfy it fails the mutation, and every assertion below about a *successful* launch would then
 * be passing for the wrong reason.
 */
const accepted: LaunchMissionResponse = {
  mission: {
    id: 'm-new',
    baseId: 'base-1',
    templateId: 'scrap-run',
    areaId: MISC_AREA_ID,
    payPercent: 0,
    xp: 240,
    force: { razors: 1 },
    vehicles: {},
    pricedMinutes: 0,
    startedAt: NOW,
    travelMinutes: 5,
    durationMinutes: 3,
    officerId: 'off-1',
    overseerLed: false,
    lost: {},
    found: {},
    reported: true,
    status: 'active',
    outcome: null,
    rewards: {},
    spoils: {},
    resolvedAt: null,
    recalledAt: null,
    pagePrize: null,
    pageWon: null,
  },
  serverNow: NOW,
};

const fetchMock = vi.fn();

/** A launch refusal in the shared error envelope: what the §G6 gate actually returns. */
const NEEDS_OFFICER = {
  ok: false,
  status: 409,
  body: {
    error: {
      code: 'MISSION_NEEDS_OFFICER',
      message: 'That job is too hard to run without an officer leading it',
    },
  },
};

/**
 * The same refusal from a request that settled the board on its way to refusing (MOU-280): a crew
 * came home and crossed a level, and that write is not rolled back with the launch.
 */
const REFUSED_AFTER_LEVELLING = {
  ...NEEDS_OFFICER,
  body: {
    ...NEEDS_OFFICER.body,
    levelUp: { level: 4, levelsGained: 1, grants: playerLevelGrants(4) },
  },
};

interface Stubbed {
  /** How `POST /missions` answers. Defaults to accepting the launch. */
  launch?: { ok: boolean; status: number; body: unknown };
  /** How `GET /missions` answers. Defaults to the plain two-area board above. */
  missions?: MissionsResponse;
}

function stubApi({ launch, missions = board }: Stubbed = {}): void {
  const reply = (body: unknown, { ok = true, status = 200 } = {}) =>
    Promise.resolve({
      ok,
      status,
      statusText: '',
      json: () => Promise.resolve(body),
    } as Response);

  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/missions') && init?.method === 'POST') {
      return launch
        ? reply(launch.body, { ok: launch.ok, status: launch.status })
        : reply(accepted);
    }
    if (path.endsWith('/missions')) return reply(missions);
    throw new Error(`unstubbed request: ${path}`);
  });
}

/** The body the page actually put on the wire for the one launch it made. */
function launchBody(): LaunchMissionRequest {
  const post = fetchMock.mock.calls.find(
    ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
  );
  if (!post) throw new Error('no launch was sent');
  return JSON.parse((post[1] as RequestInit).body as string) as LaunchMissionRequest;
}

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The first offer on whichever board is showing, and its name. */
const firstOffer = (area: MissionArea): MissionOffer => {
  const offer = area.offers[0];
  if (!offer) throw new Error(`${area.name} offers nothing`);
  return offer;
};

/** Open the send window for one offer. */
async function openSend(offer: MissionOffer): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId(`send-${offer.templateId}`));
  return screen.getByRole('dialog');
}

/** Put `count` of a unit in the crew. The stepper's own field is labelled by unit name. */
function take(dialog: HTMLElement, unitName: string, count: number): void {
  const field = within(dialog).getByLabelText(`How many ${unitName}`);
  fireEvent.change(field, { target: { value: String(count) } });
}

/** Choose the officer leading it. The list is portalled, so it is found on `screen`. */
async function lead(dialog: HTMLElement, name: RegExp): Promise<void> {
  fireEvent.click(within(dialog).getByTestId('send-leader'));
  fireEvent.click(await screen.findByRole('option', { name }));
}

const send = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByTestId('confirm-send'));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what a launch puts on the wire (§E, §G6)', () => {
  it('names the board, the crew and the leader', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    const offer = firstOffer(MISC);
    const dialog = await openSend(offer);
    take(dialog, 'Razors', 2);
    await lead(dialog, /Reza Malik/);
    send(dialog);

    await waitFor(() =>
      expect(launchBody()).toEqual({
        templateId: offer.templateId,
        areaId: MISC_AREA_ID,
        force: { razors: 2 },
        vehicles: {},
        leaderId: 'off-1',
      }),
    );
  });

  /**
   * The arrows are the whole point of the inner board: the area the crew is sent to has to be the
   * one the player arrowed to, or the pay premium on screen belongs to somewhere else.
   */
  it('sends to the area the player arrowed to, not the one it opened on', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    expect(screen.getByTestId('board-area')).toHaveTextContent('Miscellaneous Missions');
    fireEvent.click(screen.getByTestId('board-right'));
    expect(screen.getByTestId('board-area')).toHaveTextContent('The Rustyard');

    const offer = firstOffer(RUSTYARD);
    const dialog = await openSend(offer);
    take(dialog, 'Razors', 1);
    send(dialog);

    await waitFor(() => expect(launchBody().areaId).toBe('rustyard'));
  });

  /**
   * The board stops at both ends rather than rolling round, the same as the Bar's roster.
   *
   * Both halves are asserted, because a stepper is two controls and a fix applied to one of them
   * leaves the other wrapping: the disabled arrow has to be *dead*, and the live one still has to
   * move. The text is checked after each press as well as the arrow's state, so a stepper that
   * greyed out correctly and still changed the area would fail here.
   */
  it('stops at both ends of the boards rather than wrapping round', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    expect(screen.getByTestId('board-left')).toBeDisabled();
    fireEvent.click(screen.getByTestId('board-left'));
    expect(screen.getByTestId('board-area')).toHaveTextContent('Miscellaneous Missions');

    fireEvent.click(screen.getByTestId('board-right'));
    expect(screen.getByTestId('board-area')).toHaveTextContent('The Rustyard');
    expect(screen.getByTestId('board-right')).toBeDisabled();
    fireEvent.click(screen.getByTestId('board-right'));
    expect(screen.getByTestId('board-area')).toHaveTextContent('The Rustyard');

    expect(screen.getByTestId('board-left')).toBeEnabled();
    fireEvent.click(screen.getByTestId('board-left'));
    expect(screen.getByTestId('board-area')).toHaveTextContent('Miscellaneous Missions');
  });

  it('will not send a crew that is nobody at all', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    const dialog = await openSend(firstOffer(MISC));
    expect(within(dialog).getByTestId('confirm-send')).toBeDisabled();
  });

  /**
   * §A5: the support tier carries and does not fight. A battle job with nothing but porters in it
   * is refused in the window rather than on the wire, so the player is told before they commit.
   */
  it('refuses a battle job crewed entirely by porters', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    const battle = MISC.offers.find((offer) => offer.kind === 'battle');
    if (!battle) throw new Error('fixture error: no battle job on the miscellaneous board');

    const dialog = await openSend(battle);
    take(dialog, 'Scavengers', 3);
    expect(within(dialog).getByTestId('confirm-send')).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/able to fight/i);

    // One fighter among them and it goes.
    take(dialog, 'Razors', 1);
    expect(within(dialog).getByTestId('confirm-send')).toBeEnabled();
  });

  /**
   * The unled gate, on the button rather than on the wire.
   *
   * Both halves, because a fix applied to one of them alone is the failure this shape of test
   * exists to catch: a dead button that stays dead once somebody is put in charge is a screen
   * nobody can launch from, and it would pass an assertion that only checked the refusal.
   */
  it('will not send a run nobody is leading until the crew has researched it', async () => {
    stubApi({ missions: { ...board, unledRule: 'forbidden' } });
    renderBoard();
    await screen.findByTestId('board-area');

    const dialog = await openSend(firstOffer(MISC));
    take(dialog, 'Razors', 2);
    await within(dialog).findByText('Nobody leads this. Research unled runs, or send somebody.');
    expect(within(dialog).getByTestId('confirm-send')).toBeDisabled();

    await lead(dialog, /Reza Malik/);
    expect(within(dialog).getByTestId('confirm-send')).toBeEnabled();
  });
});

describe('a refused launch', () => {
  const sendAnything = async () => {
    const dialog = await openSend(firstOffer(MISC));
    take(dialog, 'Razors', 1);
    await lead(dialog, /Reza Malik/);
    send(dialog);
  };

  it('tells the player why instead of returning the board to normal', async () => {
    stubApi({ launch: NEEDS_OFFICER });
    renderBoard();
    await screen.findByTestId('board-area');
    await sendAnything();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That job is too hard to run without an officer leading it',
    );
  });

  it('says nothing while every launch is succeeding', async () => {
    stubApi();
    renderBoard();

    await screen.findByTestId('board-area');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /**
   * MOU-280: a launch settles the board before it decides, and the settle is not rolled back when
   * it then refuses. The board's own poll re-resolves nothing, so this refusal is the only response
   * that will ever carry that level-up: dropping it here loses the moment outright.
   */
  it('still announces a level-up the refused launch had already banked', async () => {
    stubApi({ launch: REFUSED_AFTER_LEVELLING });
    renderBoard();
    await screen.findByTestId('board-area');
    await sendAnything();

    expect(await screen.findByRole('region', { name: 'Level up' })).toHaveTextContent('LEVEL 4');
    // And the refusal itself is still explained: the banner does not replace the reason.
    expect(screen.getByRole('alert')).toHaveTextContent(/officer leading it/);
  });

  it('shows no level-up banner when the refusal banked nothing', async () => {
    stubApi({ launch: NEEDS_OFFICER });
    renderBoard();
    await screen.findByTestId('board-area');
    await sendAnything();

    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Level up' })).toBeNull();
  });
});

/*
 * What a job leans on, and why (maintainer request, 2026-09-12).
 *
 * The card used to carry a `Anti-Combine` / `Combine Contract` badge, which nothing in the game
 * read back and which told a player nothing about how to run the job. It is gone. What is left is
 * the leaning chips, and they now explain themselves: hovering one says which attributes the job
 * reads and what each of them is for, so a player can go and look at the sheet of whoever they
 * were about to send.
 */
describe('the board says what a job leans on, and why', () => {
  it('explains a leaning chip in the game’s own window', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    const job = MISC.offers.find((offer) => offer.battleTier === null && offer.leanings.length > 0);
    if (!job) throw new Error('fixture error: no job with leanings on the miscellaneous board');
    const leaning = job.leanings[0]!;

    const card = within(screen.getByTestId(`offer-${job.templateId}`));
    const chip = card.getByText(MISSION_LEANING_LABELS[leaning]);
    fireEvent.focus(chip);

    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(MISSION_LEANING_REASONS[leaning]);
    // And it names at least one attribute, because "it is a difficult job" is not guidance.
    const named = Object.keys(LEANING_PROFILES[leaning]).filter((attribute) =>
      MISSION_LEANING_REASONS[leaning].toLowerCase().includes(attribute.toLowerCase()),
    );
    expect(named.length).toBeGreaterThan(0);
  });

  it('carries no stance badge any more', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');
    expect(screen.queryByText(/Anti-Combine|Combine Contract/)).toBeNull();
  });
});

/**
 * §F1b: a job that has a blueprint page on it says so, and says only the category.
 *
 * Two separate things go wrong here and only one of them is about the badge. The badge itself is
 * the deliberate half of the design: which sheet you get is decided when the crew is home, so the
 * card names a *kind* and the player finds out the rest on the way back.
 *
 * The other half is the accident this group exists to keep from coming back. The badge first
 * shipped with the test id `offer-page-<template>`, which sits under the `offer-` prefix that both
 * the visual sweep and the layout sweep use to count the cards on a board. Three offers plus one
 * badge counted as four cards, and the count assertion is on the far side of the repo from the
 * component that broke it. So the last test here pins the namespace, not the appearance.
 */
describe('a job carrying a blueprint page (§F1b)', () => {
  const withPrize = (): MissionsResponse => {
    const [first, ...rest] = MISC.offers;
    if (!first) throw new Error('fixture error: the miscellaneous board is empty');
    return {
      ...board,
      areas: board.areas.map((area) =>
        area.id === MISC_AREA_ID
          ? { ...area, offers: [{ ...first, pagePrize: 'consumable' as const }, ...rest] }
          : area,
      ),
    };
  };

  it('names the category on the card and never the page', async () => {
    const [first] = MISC.offers;
    if (!first) throw new Error('fixture error: the miscellaneous board is empty');
    stubApi({ missions: withPrize() });
    renderBoard();
    await screen.findByTestId('board-area');

    const badge = await screen.findByTestId(`page-prize-${first.templateId}`);
    expect(badge).toHaveTextContent(/page/i);
    // The page ids live in the blueprint catalogue. None of their names may reach the card.
    for (const spec of Object.values(BLUEPRINTS)) {
      for (const page of spec.pages) {
        expect(badge.textContent).not.toContain(page.name);
      }
    }
  });

  it('leaves a job with no page on it unbadged', async () => {
    const rest = MISC.offers.slice(1);
    expect(
      rest.length,
      'fixture error: nothing to compare the badged card against',
    ).toBeGreaterThan(0);
    stubApi({ missions: withPrize() });
    renderBoard();
    await screen.findByTestId('board-area');

    for (const offer of rest) {
      expect(screen.queryByTestId(`page-prize-${offer.templateId}`)).toBeNull();
    }
  });

  it('keeps its test id out of the `offer-` namespace the card count reads', async () => {
    stubApi({ missions: withPrize() });
    const { container } = renderBoard();
    await screen.findByTestId('board-area');

    const cards = container.querySelectorAll('[data-testid^="offer-"]');
    expect(cards, 'the page badge is being counted as a mission card').toHaveLength(
      MISC.offers.length,
    );
  });
});
