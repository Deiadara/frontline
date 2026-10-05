import {
  HOME_LOCKED_TEXT,
  TRAVEL_BAND_MINUTES,
  LEANING_PROFILES,
  MISSION_LEANING_LABELS,
  MISSION_LEANING_REASONS,
  type AttributeName,
  IMPORTANCE_LABELS,
  ATTRIBUTE_LABELS,
  MISC_AREA_ID,
  leaningsFor,
  missionOffers,
  playerLevelGrants,
  templateTimings,
  type LaunchMissionRequest,
  type FightLeaderRating,
  type MissionLeader,
  type LaunchMissionResponse,
  type MissionArea,
  type MissionOffer,
  type MissionsResponse,
  makeAttributes,
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
      // Out of the opening band. The band's own case has its own test below.
      ramp: null,
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
const RUSTYARD = areaOf('steelbelt', 'The Rustyard', 27);

const board: MissionsResponse = {
  missions: [],
  justResolved: [],
  resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, highQualityMetal: 0, planks: 0 },
  activeLimit: 2,
  xpBonusPercent: 0,
  areas: [MISC, RUSTYARD],
  army: { razors: 6, scavengers: 4 },
  serverNow: NOW,
  leaders: LEADERS,
  level: 12,
  // The board's city and the rooms this crew may read. Both carry a Zod default on the
  // wire; a hand-written fixture has to say them.
  cityId: 'ashfall',
  cities: ['ashfall'],
};

/**
 * A launch the server accepted. Spelled out rather than stubbed loosely because the client
 * validates every 2xx unit through `LaunchMissionResponseSchema`: a placeholder that does not
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
    grade: null,
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
const RAID_LOCKED = {
  ok: false,
  status: 409,
  body: {
    error: {
      // A real one: the raid lock can start between the board read and the click.
      code: 'MISSION_REFUSED',
      message: HOME_LOCKED_TEXT,
    },
  },
};

/**
 * The same refusal from a request that settled the board on its way to refusing (MOU-280): a crew
 * came home and crossed a level, and that write is not rolled back with the launch.
 */
const REFUSED_AFTER_LEVELLING = {
  ...RAID_LOCKED,
  body: {
    ...RAID_LOCKED.body,
    levelUp: { level: 4, levelsGained: 1, grants: playerLevelGrants(4) },
  },
};

interface Stubbed {
  /** How `POST /missions` answers. Defaults to accepting the launch. */
  launch?: { ok: boolean; status: number; body: unknown };
  /** How `GET /missions` answers. Defaults to the plain two-area board above. */
  missions?: MissionsResponse;
  /** How `POST /missions/leaders/quote` rates the bench for a fight. Defaults to nobody rated. */
  quote?: FightLeaderRating[];
}

function stubApi({ launch, missions = board, quote = [] }: Stubbed = {}): void {
  const reply = (body: unknown, { ok = true, status = 200 } = {}) =>
    Promise.resolve({
      headers: new Headers(),
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
    // A fight's send window asks the engine who should lead it; the board tests are not about
    // that answer, so the bench comes back unrated and the window keeps its first free leader.
    if (path.endsWith('/missions/leaders/quote')) return reply({ leaders: quote });
    throw new Error(`unstubbed request: ${path}`);
  });
}

/** The unit the page actually put on the wire for the one launch it made. */
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
  useSession.setState({ signedIn: true, user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what a launch puts on the wire (§E, §G6)', () => {
  // The card exactly as it was read, its board's key and its grade, which is all the server will
  // launch (maintainer, 2026-09-29).
  it('names the card it read, the crew and the leader', async () => {
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
        boardKey: offer.boardKey,
        grade: offer.grade,
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

    await waitFor(() => expect(launchBody().areaId).toBe('steelbelt'));
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
   * Every run has a leader (maintainer, 2026-09-28), so the window starts with the most suitable
   * free one picked and never offers to send nobody. Both halves, because a window that picked
   * somebody and still offered "nobody" would let a player choose a run the server refuses.
   */
  /**
   * A fight's bench is rated by fighting it (maintainer, 2026-09-28): the window asks the server
   * who wins with this force, follows the best *free* one, and says what each is worth in
   * practice fights rather than in a letter off a sheet the engine never reads.
   */
  it('rates a fight\u2019s leaders by practice fights and follows the best free one', async () => {
    stubApi({
      quote: [
        // Odile is out on a run: rated best, and still not the pick.
        { id: 'off-2', wins: 6, fights: 6, kept: 0.9, score: 1.45 },
        { id: 'off-1', wins: 5, fights: 6, kept: 0.7, score: 1.18 },
        { id: 'ov-1', wins: 2, fights: 6, kept: 0.4, score: 0.53 },
      ],
    });
    renderBoard();
    await screen.findByTestId('board-area');
    const battle = MISC.offers.find((offer) => offer.kind === 'battle');
    if (!battle) throw new Error('fixture error: no battle job on the miscellaneous board');

    const dialog = await openSend(battle);
    take(dialog, 'Razors', 2);
    await waitFor(() =>
      expect(within(dialog).getByTestId('leader-fit')).toHaveTextContent(
        /wins 5 of 6 practice fights/,
      ),
    );
    expect(within(dialog).getByTestId('leader-fit')).toHaveTextContent(/Officer/);
    // The quote was asked for this force, on this job, at its grade.
    const asked = fetchMock.mock.calls.find(([path]) =>
      String(path).endsWith('/missions/leaders/quote'),
    );
    expect(asked).toBeDefined();
    const body = JSON.parse((asked![1] as RequestInit).body as string) as {
      templateId: string;
      grade: string;
      force: Record<string, number>;
    };
    expect(body.templateId).toBe(battle.templateId);
    expect(body.grade).toBe(battle.grade);
    expect(body.force).toEqual({ razors: 2 });

    // Choosing by hand sticks: the quote does not take the pick back.
    fireEvent.click(within(dialog).getByTestId('send-leader'));
    const rook = (await screen.findAllByRole('option')).find((option) =>
      /Rook/.test(option.textContent ?? ''),
    );
    if (!rook) throw new Error('the Overseer is not on the list');
    fireEvent.click(rook);
    await waitFor(() =>
      expect(within(dialog).getByTestId('leader-fit')).toHaveTextContent(
        /wins 2 of 6 practice fights/,
      ),
    );
    expect(within(dialog).getByTestId('leader-fit')).toHaveTextContent(/Overseer/);
  });

  it('starts with the most suitable free leader and never offers nobody', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    const dialog = await openSend(firstOffer(MISC));
    take(dialog, 'Razors', 2);
    expect(within(dialog).getByTestId('leader-fit')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('leader-note')).toBeNull();
    expect(within(dialog).getByTestId('confirm-send')).toBeEnabled();

    fireEvent.click(within(dialog).getByTestId('send-leader'));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent ?? '').join(' ')).not.toMatch(/nobody/i);
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
    stubApi({ launch: RAID_LOCKED });
    renderBoard();
    await screen.findByTestId('board-area');
    await sendAnything();

    expect(await screen.findByRole('alert')).toHaveTextContent(HOME_LOCKED_TEXT);
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
    expect(screen.getByRole('alert')).toHaveTextContent(HOME_LOCKED_TEXT);
  });

  it('shows no level-up banner when the refusal banked nothing', async () => {
    stubApi({ launch: RAID_LOCKED });
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
 * reads and how much each matters, so a player can go and look at the sheet of whoever they were
 * about to send.
 */
describe('the board says what a job leans on, and why', () => {
  it('explains a leaning chip in the game’s own window', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    const job = MISC.offers.find((offer) => offer.kind === 'standard' && offer.leanings.length > 0);
    if (!job) throw new Error('fixture error: no job with leanings on the miscellaneous board');
    const leaning = job.leanings[0]!;

    const card = within(screen.getByTestId(`offer-${job.templateId}`));
    const chip = card.getByText(MISSION_LEANING_LABELS[leaning]);
    fireEvent.focus(chip);

    const tip = await screen.findByRole('tooltip');
    // The title, and the attributes with how much each matters, and nothing else (maintainer,
    // 2026-09-23): no eyebrow, and the leaning's sentence is gone from the hover.
    expect(tip).toHaveTextContent(MISSION_LEANING_LABELS[leaning]);
    expect(tip).not.toHaveTextContent(/What it leans on/i);
    expect(tip).not.toHaveTextContent(MISSION_LEANING_REASONS[leaning]);
    for (const [attribute, importance] of Object.entries(LEANING_PROFILES[leaning])) {
      expect(tip).toHaveTextContent(ATTRIBUTE_LABELS[attribute as AttributeName]);
      expect(tip).toHaveTextContent(IMPORTANCE_LABELS[importance]);
    }
  });

  it('carries no stance badge any more', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');
    expect(screen.queryByText(/Anti-Combine|Combine Contract/)).toBeNull();
  });
});

/**
 * §F1b: whether a job pays a blueprint page is never on the card (maintainer, 2026-09-28).
 *
 * A player learns it from the notification when a crew comes home with one, and from the Recently
 * returned list, and not before. The offer no longer carries the field; this pins the card too,
 * because a label left behind with a hard-coded category would still read as a promise.
 */
describe('a job and the blueprint page it might pay (§F1b)', () => {
  it('says nothing about a page on any card', async () => {
    stubApi();
    const { container } = renderBoard();
    await screen.findByTestId('board-area');

    expect(container.querySelector('[data-testid^="page-prize-"]')).toBeNull();
    for (const card of container.querySelectorAll('[data-testid^="offer-"]')) {
      expect(card.textContent).not.toMatch(/blueprint|\bpages?\b/i);
    }
  });
});

/**
 * The difficulty stamp in the corner of each brief (maintainer, 2026-09-28).
 *
 * The grade the card was dealt, and nothing else: the same for every crew who reads it, which is
 * the point of it (maintainer, 2026-09-28: "objective, regardless of who sees it").
 */
describe('the difficulty stamp', () => {
  it('stamps every card with the grade it was dealt', async () => {
    stubApi();
    renderBoard();
    await screen.findByTestId('board-area');

    expect(MISC.offers.length, 'fixture error: the miscellaneous board is empty').toBeGreaterThan(
      0,
    );
    for (const offer of MISC.offers) {
      const card = screen.getByTestId(`offer-${offer.templateId}`);
      const stamp = within(card).getByTestId('difficulty-stamp');
      const mark = offer.grade;
      expect(stamp).toHaveAttribute('data-mark', mark);
      expect(stamp).toHaveAccessibleName(`Difficulty ${mark}`);
    }
  });

  it('keeps its test id out of the `offer-` namespace the card count reads', async () => {
    stubApi();
    const { container } = renderBoard();
    await screen.findByTestId('board-area');

    const cards = container.querySelectorAll('[data-testid^="offer-"]');
    expect(cards, 'something inside a card is being counted as a card').toHaveLength(
      MISC.offers.length,
    );
  });
});
