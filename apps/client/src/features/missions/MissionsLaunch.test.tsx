import {
  assigneeBonusPercent,
  type AssigneesResponse,
  type LaunchMissionRequest,
  type LaunchMissionResponse,
  type MissionsResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissionsPage } from './MissionsPage';
import { useSession } from '../../store/session';

/**
 * The §G6 launch contract, driven through the real hooks against a stubbed network.
 *
 * Mocked at `fetch` rather than at `lib/queries` on purpose. The gate this covers is a *required
 * request field*: the server refuses every hard template unless the launch names an officer, and a
 * hook-level mock asserts only that some object reached `mutate` — it cannot see what went on the
 * wire, which is exactly how a client that never sent `officerId` passed every gate while four of
 * the eight templates were unlaunchable.
 */

const NOW = '2026-08-13T12:00:00.000Z';

const board: MissionsResponse = {
  missions: [],
  justResolved: [],
  resources: { caps: 0, food: 0, oil: 0, scrap: 0, highQualityMetal: 0 },
  activeLimit: 4,
  serverNow: NOW,
};

const officer = (officerId: string, name: string, assignees: number) => ({
  officerId,
  name,
  role: 'raid_boss' as const,
  assignees,
  bonusPercent: assigneeBonusPercent(assignees),
  nextBonusPercent: assigneeBonusPercent(assignees + 1),
});

/** §G — a roster with people on the books, so a hard run has somebody to lead it. */
const staffed: AssigneesResponse = {
  level: 6,
  pool: 8,
  placed: 4,
  unplaced: 4,
  capPerOfficer: 3,
  maxBonusPercent: assigneeBonusPercent(3),
  canReskill: false,
  officers: [officer('off-1', 'Reza Malik', 3), officer('off-2', 'Odile Marchetti', 1)],
};

/** The starting state: a base with no officers at all (§H — you hire them at the Bar). */
const unstaffed: AssigneesResponse = {
  ...staffed,
  level: 1,
  pool: 2,
  placed: 0,
  unplaced: 2,
  capPerOfficer: 1,
  officers: [],
};

/**
 * A launch the server accepted. Spelled out rather than stubbed loosely because the client
 * validates every 2xx body through `LaunchMissionResponseSchema` — a placeholder that does not
 * satisfy it fails the mutation, and every assertion below about a *successful* launch would then
 * be passing for the wrong reason.
 */
const accepted: LaunchMissionResponse = {
  mission: {
    id: 'm-new',
    baseId: 'base-1',
    templateId: 'scrap-run',
    startedAt: NOW,
    travelMinutes: 5,
    durationMinutes: 3,
    status: 'active',
    outcome: null,
    rewards: {},
    resolvedAt: null,
  },
  serverNow: NOW,
};

const fetchMock = vi.fn();

/** A launch refusal in the shared error envelope — what the §G6 gate actually returns. */
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

interface Stubbed {
  assignees: AssigneesResponse;
  /** How `POST /missions` answers. Defaults to accepting the launch. */
  launch?: { ok: boolean; status: number; body: unknown };
  /** Hold the roster back this long, so the board renders before the officers arrive. */
  rosterDelayMs?: number;
}

function stubApi({ assignees, launch, rosterDelayMs = 0 }: Stubbed): void {
  const reply = (body: unknown, { ok = true, status = 200, delay = 0 } = {}) =>
    new Promise<Response>((resolve) =>
      setTimeout(
        () =>
          resolve({ ok, status, statusText: '', json: () => Promise.resolve(body) } as Response),
        delay,
      ),
    );

  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path.endsWith('/assignees')) return reply(assignees, { delay: rosterDelayMs });
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

/** One card on the board, found by the template it offers. */
const card = (name: string): HTMLElement => {
  const article = screen.getByRole('heading', { name }).closest('article');
  if (!article) throw new Error(`no card for ${name}`);
  return article;
};

const deploy = (name: string) => within(card(name)).getByRole('button', { name: 'Deploy' });

/**
 * Wait for the roster itself, not for the control that renders it.
 *
 * An easy card's picker exists before the officers arrive — it always offers the "nobody" option —
 * so waiting on the `combobox` is satisfied by an *empty* roster. That made every easy-card
 * assertion below vacuous: selecting an officer silently did nothing because the option was not in
 * the DOM yet, and "unled by default" passed because there was nobody to lead it either way.
 */
const rosterLoaded = () => screen.findAllByRole('option', { name: /Reza Malik/ });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('§G6 — the officer a launch has to name', () => {
  it('sends the leading officer for a hard template', async () => {
    stubApi({ assignees: staffed });
    renderBoard();

    await rosterLoaded();
    fireEvent.click(deploy('Convoy Ambush'));

    await waitFor(() =>
      expect(launchBody()).toEqual({
        templateId: 'convoy-ambush',
        officerId: 'off-1',
      }),
    );
  });

  it('honours the officer the player picked rather than the default', async () => {
    stubApi({ assignees: staffed });
    renderBoard();

    await rosterLoaded();
    fireEvent.change(within(card('Foundry Raid')).getByRole('combobox'), {
      target: { value: 'off-2' },
    });
    fireEvent.click(deploy('Foundry Raid'));

    await waitFor(() => expect(launchBody().officerId).toBe('off-2'));
  });

  /**
   * The easy branch of §G6, and the reason the picker is not simply always-on: an easy run is
   * *allowed* to go out on assignees alone, so defaulting it to an officer would silently spend a
   * leader the player never named.
   */
  it('leaves an easy template unled by default, so it runs as a delegation', async () => {
    stubApi({ assignees: staffed });
    renderBoard();

    await rosterLoaded();
    fireEvent.click(deploy('Scrap Run'));

    await waitFor(() => expect(launchBody()).toEqual({ templateId: 'scrap-run' }));
  });

  it('still lets the player put an officer on an easy run', async () => {
    stubApi({ assignees: staffed });
    renderBoard();

    await rosterLoaded();
    fireEvent.change(within(card('Scrap Run')).getByRole('combobox'), {
      target: { value: 'off-1' },
    });
    fireEvent.click(deploy('Scrap Run'));

    await waitFor(() => expect(launchBody().officerId).toBe('off-1'));
  });

  /**
   * With nobody on the books a hard run is genuinely impossible, so the card says so instead of
   * offering a button that posts a request the server is certain to refuse.
   */
  it('explains a hard run it cannot staff instead of offering a dead button', async () => {
    stubApi({ assignees: unstaffed });
    renderBoard();

    // Waited on the message, not on the disabled button: Deploy is disabled while the roster is
    // merely *loading* too, so that condition is satisfied before the empty roster is even known.
    await within(card('Convoy Ambush')).findByText(/Hire one at the Bar/);
    expect(deploy('Convoy Ambush')).toBeDisabled();
    // The easy work is still live — this is a §G6 gate, not a dead board.
    expect(deploy('Scrap Run')).toBeEnabled();
  });

  /**
   * The board renders off a static template list, so it is on screen a full round trip before the
   * roster is. Reading "not loaded" as "nobody hired" told a player with a full crew to go hire an
   * officer — on all four hard cards, on every visit — and then silently replaced it once the
   * officers landed.
   */
  it('does not claim the player has no officers while the roster is still loading', async () => {
    stubApi({ assignees: staffed, rosterDelayMs: 40 });
    renderBoard();

    await screen.findByRole('heading', { name: 'Convoy Ambush' });
    expect(screen.queryByText(/Hire one at the Bar/)).toBeNull();
    expect(within(card('Convoy Ambush')).getByText('Reading the roster…')).toBeInTheDocument();
    // And it cannot be deployed on a leader nobody has named yet.
    expect(deploy('Convoy Ambush')).toBeDisabled();

    // Once the roster answers, the card offers the officer it found.
    await rosterLoaded();
    expect(within(card('Convoy Ambush')).getByRole('combobox')).toHaveValue('off-1');
    expect(screen.queryByText('Reading the roster…')).toBeNull();
  });
});

describe('a refused launch', () => {
  it('tells the player why instead of returning the board to normal', async () => {
    stubApi({ assignees: staffed, launch: NEEDS_OFFICER });
    renderBoard();

    await rosterLoaded();
    fireEvent.click(deploy('Scrap Run'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That job is too hard to run without an officer leading it',
    );
  });

  it('says nothing while every launch is succeeding', async () => {
    stubApi({ assignees: staffed });
    renderBoard();

    await rosterLoaded();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
