import {
  MISSION_STANCE_SPECS,
  MISC_AREA_ID,
  missionOffers,
  playerLevelGrants,
  templateTimings,
  type CrewResponse,
  type LaunchMissionRequest,
  type LaunchMissionResponse,
  type MissionArea,
  type MissionOffer,
  type MissionsResponse,
  makeAttributes,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionsPage } from './MissionsPage';
import { useSession } from '../../store/session';

/**
 * The §E/§G6 launch contract, driven through the real hooks against a stubbed network.
 *
 * Mocked at `fetch` rather than at `lib/queries` on purpose. What this covers is a set of
 * *required request fields*: a launch has to name the board it came off, the units going and,
 * for a hard job, the officer leading it. A hook-level mock asserts only that some object reached
 * `mutate`: it cannot see what went on the wire, which is exactly how a client that never sent
 * `officerId` once passed every gate while half the board was unlaunchable.
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
      stance: template.stance,
      travelMinutes: templateTimings(template).travelMinutes,
      durationMinutes: template.durationMinutes,
      totalMinutes: templateTimings(template).totalMinutes,
      rewards: template.spoils,
      payoutSlots: 40,
      xp: 240,
      failedXp: 48,
    })),
    activeMissionId: null,
  };
}

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
};

const officer = (officerId: string, name: string) => ({
  officerId,
  name,
  role: 'raid_boss' as const,
  attributes: makeAttributes(15),
  perks: [],
  weeklyWage: 40,
  injuredUntil: null,
});

/** §G: a roster with people on the books, so a hard run has somebody to lead it. */
const staffed: CrewResponse = {
  level: 6,
  housing: { used: 0, capacity: 8 },
  officers: [officer('off-1', 'Reza Malik'), officer('off-2', 'Odile Marchetti')],
};

/** The starting state: a base with no officers at all (§H: you hire them at the Bar). */
const unstaffed: CrewResponse = {
  ...staffed,
  level: 1,
  officers: [],
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
    startedAt: NOW,
    travelMinutes: 5,
    durationMinutes: 3,
    officerId: null,
    status: 'active',
    outcome: null,
    rewards: {},
    spoils: {},
    resolvedAt: null,
    recalledAt: null,
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
  crew: CrewResponse;
  /** How `POST /missions` answers. Defaults to accepting the launch. */
  launch?: { ok: boolean; status: number; body: unknown };
  /** Hold the roster back this long, so the board renders before the officers arrive. */
  rosterDelayMs?: number;
}

function stubApi({ crew, launch, rosterDelayMs = 0 }: Stubbed): void {
  const reply = (body: unknown, { ok = true, status = 200, delay = 0 } = {}) =>
    new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve({ ok, status, statusText: '', json: () => Promise.resolve(body) } as Response),
        delay,
      ),
    );

  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/crew')) return reply(crew, { delay: rosterDelayMs });
    if (path.endsWith('/missions') && init?.method === 'POST') {
      return launch
        ? reply(launch.body, { ok: launch.ok, status: launch.status })
        : reply(accepted);
    }
    if (path.endsWith('/missions')) return reply(board);
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
      <MissionsPage />
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
    stubApi({ crew: staffed });
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
        officerId: 'off-1',
      }),
    );
  });

  /**
   * The arrows are the whole point of the inner board: the area the crew is sent to has to be the
   * one the player arrowed to, or the pay premium on screen belongs to somewhere else.
   */
  it('sends to the area the player arrowed to, not the one it opened on', async () => {
    stubApi({ crew: staffed });
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
    stubApi({ crew: staffed });
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
    stubApi({ crew: staffed });
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
    stubApi({ crew: staffed });
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

  it('says a hard job cannot go out with nobody on the books', async () => {
    stubApi({ crew: unstaffed });
    renderBoard();

    const hard = MISC.offers.find((offer) => offer.difficulty === 'hard');
    if (!hard) throw new Error('fixture error: no hard job on the miscellaneous board');

    const dialog = await openSend(hard);
    take(dialog, 'Razors', 2);
    await within(dialog).findByText(/without an officer leading it/);
    expect(within(dialog).getByTestId('confirm-send')).toBeDisabled();
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
    stubApi({ crew: staffed, launch: NEEDS_OFFICER });
    renderBoard();
    await screen.findByTestId('board-area');
    await sendAnything();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That job is too hard to run without an officer leading it',
    );
  });

  it('says nothing while every launch is succeeding', async () => {
    stubApi({ crew: staffed });
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
    stubApi({ crew: staffed, launch: REFUSED_AFTER_LEVELLING });
    renderBoard();
    await screen.findByTestId('board-area');
    await sendAnything();

    expect(await screen.findByRole('region', { name: 'Level up' })).toHaveTextContent('LEVEL 4');
    // And the refusal itself is still explained: the banner does not replace the reason.
    expect(screen.getByRole('alert')).toHaveTextContent(/officer leading it/);
  });

  it('shows no level-up banner when the refusal banked nothing', async () => {
    stubApi({ crew: staffed, launch: NEEDS_OFFICER });
    renderBoard();
    await screen.findByTestId('board-area');
    await sendAnything();

    await screen.findByRole('alert');
    expect(screen.queryByRole('region', { name: 'Level up' })).toBeNull();
  });
});

describe('the board says which way a job points at the Combine (§A3, §D8)', () => {
  it('badges a job that points at the state, and says what the word means', async () => {
    stubApi({ crew: staffed });
    renderBoard();
    await screen.findByTestId('board-area');

    const pointed = MISC.offers.find((offer) => offer.stance !== 'unaligned');
    if (!pointed) throw new Error('fixture error: no aligned job on the miscellaneous board');
    const spec = MISSION_STANCE_SPECS[pointed.stance];

    const card = within(screen.getByTestId(`offer-${pointed.templateId}`));
    const badge = card.getByText(spec.label);
    expect(badge).toBeInTheDocument();

    // And the keyword explains itself in the game's own window rather than in a browser tooltip.
    fireEvent.focus(badge);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(spec.description);
  });

  it('leaves unaligned work unbadged rather than labelling every card', async () => {
    stubApi({ crew: staffed });
    renderBoard();
    await screen.findByTestId('board-area');

    const plain = MISC.offers.find((offer) => offer.stance === 'unaligned');
    if (!plain) throw new Error('fixture error: no unaligned job on the miscellaneous board');
    const card = within(screen.getByTestId(`offer-${plain.templateId}`));
    for (const spec of Object.values(MISSION_STANCE_SPECS)) {
      expect(card.queryByText(spec.label)).toBeNull();
    }
  });
});
