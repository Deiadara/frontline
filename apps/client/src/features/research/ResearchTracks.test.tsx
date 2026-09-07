import {
  OFFICER_ROLES,
  OFFICER_ROLE_LABELS,
  RESEARCH_TRACK_STEPS,
  type ResearchResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { ResearchPage } from './ResearchPage';
import { useSession } from '../../store/session';

/**
 * §C on the screen: nineteen trades on a rail, ten rungs on the one you opened.
 *
 * The page reads the server's answer and adds nothing of its own to it, which is the property
 * worth testing: a rung's blocker, its two marks and its price all come off the wire, and a screen
 * that recomputed any of them would eventually disagree with the route that refuses the click.
 */

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function stub(research: ResearchResponse = F.research): void {
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/research')) return reply(research);
    if (path.endsWith('/me')) return reply(F.me);
    // The Blueprints door counts documents off the satchel, which rides the market payload.
    if (path.endsWith('/market')) return reply(F.market);
    throw new Error(`unstubbed request: ${path}`);
  });
}

function open(at = '/game/research') {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[at]}>
        <ResearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openTracks() {
  open();
  fireEvent.click(await screen.findByTestId('research-section-programmes'));
  return screen.getByTestId('research-tracks');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * §I1a: two doors, and the desk is not one of them.
 *
 * Written against the rail's own children rather than against a list of ids the page also exports,
 * because the failure this is for is a door that is still *rendered*: a section left in `SECTIONS`
 * behind a condition nobody notices is exactly how the desk would survive its own deletion.
 */
describe('the archive rail', () => {
  it('has exactly two doors: Programmes and Blueprints', async () => {
    stub();
    open();
    const rail = await screen.findByTestId('research-sections');
    const doors = within(rail).getAllByRole('button');
    expect(doors.map((door) => door.getAttribute('data-testid'))).toEqual([
      'research-section-programmes',
      'research-section-blueprints',
    ]);
  });

  it('opens on Programmes, and the Blueprints workspace is not rendered behind it', async () => {
    stub();
    open();
    expect(await screen.findByTestId('research-tracks')).toBeInTheDocument();
    expect(screen.queryByTestId('blueprints-section')).toBeNull();
  });

  /** §I1d: the section is the URL, so a deep link into the documents lands on the documents. */
  it('opens on Blueprints when the URL says blueprints', async () => {
    stub();
    open('/game/research/blueprints');
    expect(await screen.findByTestId('blueprints-section')).toBeInTheDocument();
    expect(screen.queryByTestId('research-tracks')).toBeNull();
    expect(screen.getByTestId('research-section-blueprints')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('walks from one door to the other', async () => {
    stub();
    open();
    fireEvent.click(await screen.findByTestId('research-section-blueprints'));
    expect(await screen.findByTestId('blueprints-section')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('research-section-programmes'));
    expect(await screen.findByTestId('research-tracks')).toBeInTheDocument();
  });
});

describe('the research tracks', () => {
  it('is a precondition that the fixture has a full nineteen tracks with rungs on each', () => {
    expect(F.research.tracks).toHaveLength(OFFICER_ROLES.length);
    expect(F.research.technologies).toHaveLength(OFFICER_ROLES.length * RESEARCH_TRACK_STEPS);
    // ...and that at least one chair is empty, which is the state with its own drawing.
    expect(F.research.tracks.some((track) => track.mark === null)).toBe(true);
  });

  it('puts one row on the rail for every officer role', async () => {
    stub();
    const rail = await openTracks();
    for (const role of OFFICER_ROLES) {
      expect(within(rail).getByTestId(`research-track-${role}`)).toBeInTheDocument();
    }
  });

  it('opens on the first track and shows exactly its ten rungs', async () => {
    stub();
    await openTracks();
    const first = OFFICER_ROLES[0];
    if (!first) throw new Error('need a role');
    const panel = within(screen.getByTestId(`tech-track-${first}`));
    for (const item of F.research.technologies.filter((tech) => tech.track === first)) {
      expect(panel.getByTestId(`tech-${item.id}`)).toBeInTheDocument();
    }
    // ...and nothing from a different track leaks into it.
    const other = F.research.technologies.find((tech) => tech.track !== first);
    if (!other) throw new Error('need a rung on another track');
    expect(panel.queryByTestId(`tech-${other.id}`)).toBeNull();
  });

  it('switches the whole panel when another trade is chosen', async () => {
    stub();
    const rail = await openTracks();
    fireEvent.click(within(rail).getByTestId('research-track-scout'));
    const panel = await screen.findByTestId('tech-track-scout');
    expect(
      within(panel).getByRole('heading', { name: OFFICER_ROLE_LABELS.scout }),
    ).toBeInTheDocument();
    const scoutRungs = F.research.technologies.filter((tech) => tech.track === 'scout');
    expect(scoutRungs).toHaveLength(RESEARCH_TRACK_STEPS);
    for (const item of scoutRungs) {
      expect(within(panel).getByTestId(`tech-${item.id}`)).toBeInTheDocument();
    }
  });

  it('prints the server blocker on a shut rung rather than a button', async () => {
    stub();
    const rail = await openTracks();
    const shut = F.research.technologies.find(
      (tech) => tech.blocker !== null && !tech.known && tech.track === 'scout',
    );
    if (!shut) throw new Error('the fixture has no shut scout rung');
    fireEvent.click(within(rail).getByTestId('research-track-scout'));
    const card = within(await screen.findByTestId(`tech-${shut.id}`));
    const button = card.getByRole('button');
    expect(button).toHaveTextContent(shut.blocker ?? '');
    expect(button).toBeDisabled();
  });

  it('shows both marks a rung asks for, and only the Head one where there is one', async () => {
    stub();
    const rail = await openTracks();
    fireEvent.click(within(rail).getByTestId('research-track-scout'));
    const rungs = F.research.technologies.filter((tech) => tech.track === 'scout');
    const shallow = rungs.find((tech) => tech.requiresHeadMark === null);
    const deep = rungs.find((tech) => tech.requiresHeadMark !== null);
    if (!shallow || !deep) throw new Error('need one rung of each kind');

    const shallowCard = within(await screen.findByTestId(`tech-${shallow.id}`));
    expect(shallowCard.getByText(shallow.requiresMark)).toBeInTheDocument();
    expect(shallowCard.queryByText(/^Head /)).toBeNull();

    const deepCard = within(screen.getByTestId(`tech-${deep.id}`));
    expect(deepCard.getByText(`Head ${deep.requiresHeadMark}`)).toBeInTheDocument();
  });

  it('names the Head of Research and what their sheet is worth to the clock', async () => {
    stub();
    await openTracks();
    const head = F.research.head;
    if (!head) throw new Error('the fixture has no Head of Research');
    expect(await screen.findByText(head.name)).toBeInTheDocument();
    expect(
      screen.getByText(`${head.timeCutPercent.toFixed(1)}% off every research clock.`),
    ).toBeInTheDocument();
  });

  it('says a track is shut when nobody holds it, rather than quoting a discount', async () => {
    const empty = F.research.tracks.find((track) => track.mark === null);
    if (!empty) throw new Error('the fixture has no empty chair');
    stub();
    const rail = await openTracks();
    fireEvent.click(within(rail).getByTestId(`research-track-${empty.role}`));
    const panel = within(await screen.findByTestId(`tech-track-${empty.role}`));
    expect(
      panel.getByText('Nothing on this track moves until somebody is in the chair.'),
    ).toBeInTheDocument();
  });

  it('shuts every track at once when the post is vacant', async () => {
    stub({ ...F.research, head: null });
    await openTracks();
    expect(
      await screen.findByText('Every track on every trade is shut without one.'),
    ).toBeInTheDocument();
  });

  it('starts a rung through the tech route, naming it', async () => {
    stub();
    const rail = await openTracks();
    fireEvent.click(within(rail).getByTestId('research-track-scout'));
    const open = F.research.technologies.find(
      (tech) => tech.track === 'scout' && tech.blocker === null && !tech.known,
    );
    if (!open) throw new Error('the fixture has no startable scout rung');

    const card = within(await screen.findByTestId(`tech-${open.id}`));
    fireEvent.click(card.getByRole('button', { name: 'Put them on it' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (entry: unknown[]) => typeof entry[0] === 'string' && entry[0].endsWith('/research/tech'),
      );
      expect(call, 'nothing was posted to the tech route').toBeDefined();
      const body = (call?.[1] as RequestInit | undefined)?.body;
      expect(typeof body).toBe('string');
      expect(body as string).toContain(open.id);
    });
  });
});

/**
 * The countdown on the programme in flight reads the server's clock.
 *
 * It ticked off `Date.now()`, and on a machine five minutes fast a four-minute programme showed
 * "Landing…" under a full bar for five minutes while `GET /research` kept answering that it was
 * still running. The response carries `serverNow` for exactly this, and every other countdown in
 * the game reads it.
 */
describe('the running programme, on a fast machine', () => {
  it('counts down what the server says is left, not what the browser thinks', async () => {
    const serverNow = new Date(F.research.serverNow);
    const research = F.activeResearch(serverNow);
    const minutes = research.active?.durationMinutes ?? 0;
    expect(minutes).toBeGreaterThan(1);
    // The browser is past the programme's end by its own clock; the server is a minute into it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(serverNow.getTime() + (minutes + 3) * 60_000);
    try {
      stub(research);
      open();
      const bar = await screen.findByTestId('research-progress');
      await waitFor(() => expect(bar).not.toHaveTextContent('Landing'));
    } finally {
      vi.useRealTimers();
    }
  });
});
