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
 * §C on the screen: three tabs, nineteen trades on a rail, ten rungs on the one you opened.
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
    // Only the Blueprints and Reimagining workspaces read the inventory now. The strip above them
    // does not, and one of the tests below is that it does not.
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
  // `/game/research` is Programmes, so the strip is already on it: the click is only here to prove
  // a tab that is already chosen does not navigate away from itself.
  fireEvent.click(await screen.findByTestId('research-tab-programmes'));
  return screen.getByTestId('research-tracks');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * §I1a: three tabs, and the desk is not one of them.
 *
 * Written against the strip's own children rather than against a list of ids the page also
 * exports, because the failure this is for is a tab that is still *rendered*: a section left in
 * `SECTIONS` behind a condition nobody notices is exactly how the desk would survive its own
 * deletion.
 */
describe('the archive tabs', () => {
  it('has exactly three: Programmes, Blueprints and Reimagining', async () => {
    stub();
    open();
    const strip = await screen.findByTestId('research-tabs');
    const tabs = within(strip).getAllByRole('link');
    expect(tabs.map((tab) => tab.getAttribute('data-testid'))).toEqual([
      'research-tab-programmes',
      'research-tab-blueprints',
      'research-tab-reimagining',
    ]);
  });

  /** Rungs done out of rungs there are: the one count on the strip the maintainer kept. */
  it('carries the rung count on Programmes', async () => {
    stub();
    open();
    const done = F.research.technologies.filter((tech) => tech.known).length;
    // Waited on: the strip is drawn before the read lands and says 0/0 until it does.
    await waitFor(() =>
      expect(screen.getByTestId('research-tab-programmes')).toHaveTextContent(
        `${done}/${F.research.technologies.length}`,
      ),
    );
  });

  /**
   * The board's 2026-09-10 call: the other two tabs print no number at all.
   *
   * Two assertions, because either alone is weak. The text is what a player sees, and an empty
   * count element would pass it; the second is that the strip never asks for the inventory, which is
   * where both dropped counts came from, and it fails the moment somebody wires one back up.
   */
  it('prints no count on Blueprints or Reimagining, and does not read the inventory for one', async () => {
    stub();
    open();
    const done = F.research.technologies.filter((tech) => tech.known).length;
    await waitFor(() =>
      expect(screen.getByTestId('research-tab-programmes')).toHaveTextContent(
        `${done}/${F.research.technologies.length}`,
      ),
    );
    expect(screen.getByTestId('research-tab-blueprints').textContent).toBe('Blueprints');
    expect(screen.getByTestId('research-tab-reimagining').textContent).toBe('Reimagining');
    const inventory = fetchMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].endsWith('/market'),
    );
    expect(inventory, 'the strip read the inventory for a count it no longer prints').toHaveLength(
      0,
    );
  });

  it('opens on Programmes, and the other workspaces are not rendered behind it', async () => {
    stub();
    open();
    expect(await screen.findByTestId('research-tracks')).toBeInTheDocument();
    expect(screen.queryByTestId('blueprints-section')).toBeNull();
    expect(screen.queryByTestId('reimagining-section')).toBeNull();
  });

  /** §I1d: the section is the URL, so a deep link into the documents lands on the documents. */
  it('opens on Blueprints when the URL says blueprints', async () => {
    stub();
    open('/game/research/blueprints');
    expect(await screen.findByTestId('blueprints-section')).toBeInTheDocument();
    expect(screen.queryByTestId('research-tracks')).toBeNull();
    expect(screen.getByTestId('research-tab-blueprints')).toHaveAttribute('aria-current', 'page');
  });

  it('opens on Reimagining when the URL says reimagining', async () => {
    stub();
    open('/game/research/reimagining');
    expect(await screen.findByTestId('reimagine-machine')).toBeInTheDocument();
    expect(screen.queryByTestId('research-tracks')).toBeNull();
    expect(screen.getByTestId('research-tab-reimagining')).toHaveAttribute('aria-current', 'page');
  });

  it('walks from one tab to the next and back', async () => {
    stub();
    open();
    fireEvent.click(await screen.findByTestId('research-tab-blueprints'));
    expect(await screen.findByTestId('blueprints-section')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('research-tab-reimagining'));
    expect(await screen.findByTestId('reimagining-section')).toBeInTheDocument();
    expect(screen.queryByTestId('blueprints-section')).toBeNull();
    fireEvent.click(screen.getByTestId('research-tab-programmes'));
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

  /**
   * §I1d again, one level down: the open trade is the URL too.
   *
   * It was component state, and the shut Reimagining bench needs to send a player to one rung on
   * one trade. A link that can only reach the tab lands them on the first row of nineteen.
   */
  it('opens the trade the URL names rather than the first on the rail', async () => {
    stub();
    open('/game/research?track=cartographer');
    const panel = await screen.findByTestId('tech-track-cartographer');
    expect(
      within(panel).getByRole('heading', { name: OFFICER_ROLE_LABELS.cartographer }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('research-track-cartographer')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // ...and the first trade on the rail, which is what a page ignoring the URL would have shown.
    const first = OFFICER_ROLES[0];
    if (!first) throw new Error('need a role');
    expect(screen.queryByTestId(`tech-track-${first}`)).toBeNull();
  });

  it('ignores a track nobody has, rather than drawing an empty panel', async () => {
    stub();
    open('/game/research?track=chief_of_vibes');
    const first = OFFICER_ROLES[0];
    if (!first) throw new Error('need a role');
    expect(await screen.findByTestId(`tech-track-${first}`)).toBeInTheDocument();
  });

  it('switches the whole panel when another trade is chosen', async () => {
    stub();
    const rail = await openTracks();
    fireEvent.click(within(rail).getByTestId('research-track-cartographer'));
    const panel = await screen.findByTestId('tech-track-cartographer');
    expect(
      within(panel).getByRole('heading', { name: OFFICER_ROLE_LABELS.cartographer }),
    ).toBeInTheDocument();
    const cartographerRungs = F.research.technologies.filter(
      (tech) => tech.track === 'cartographer',
    );
    expect(cartographerRungs).toHaveLength(RESEARCH_TRACK_STEPS);
    for (const item of cartographerRungs) {
      expect(within(panel).getByTestId(`tech-${item.id}`)).toBeInTheDocument();
    }
  });

  it('prints the server blocker on a shut rung rather than a button', async () => {
    stub();
    const rail = await openTracks();
    const shut = F.research.technologies.find(
      (tech) => tech.blocker !== null && !tech.known && tech.track === 'cartographer',
    );
    if (!shut) throw new Error('the fixture has no shut cartographer rung');
    fireEvent.click(within(rail).getByTestId('research-track-cartographer'));
    const card = within(await screen.findByTestId(`tech-${shut.id}`));
    const button = card.getByRole('button');
    expect(button).toHaveTextContent(shut.blocker ?? '');
    expect(button).toBeDisabled();
  });

  it('shows both marks a rung asks for, and only the Head one where there is one', async () => {
    stub();
    const rail = await openTracks();
    fireEvent.click(within(rail).getByTestId('research-track-cartographer'));
    const rungs = F.research.technologies.filter((tech) => tech.track === 'cartographer');
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
    // Whichever track the fixture leaves a rung startable on: the test is about the route, not
    // about one chair, and the fixture's chairs are the fixture's business.
    const open = F.research.technologies.find((tech) => tech.blocker === null && !tech.known);
    if (!open) throw new Error('the fixture has no startable rung on any track');
    fireEvent.click(within(rail).getByTestId(`research-track-${open.track}`));

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

/**
 * The rail is in two groups: chairs with somebody in them, then the empty ones (maintainer,
 * 2026-09-22).
 *
 * Nineteen trades in catalogue order scattered the empty chairs through the list, so the question
 * the rail is actually asked, "which trades is nobody covering", meant scanning nineteen rows for
 * a red line. Order is the answer rather than a filter, because every trade still has to be
 * reachable in one press.
 */
describe('the rail puts the empty chairs together, underneath', () => {
  /** Where each row sits in the rendered list, by role. */
  const order = (rail: HTMLElement): string[] =>
    [...rail.querySelectorAll('[data-testid^="research-track-"]')].map((node) =>
      (node.getAttribute('data-testid') ?? '').replace('research-track-', ''),
    );

  it('draws every filled chair above every empty one, and loses none of them', async () => {
    stub();
    const rail = await openTracks();
    const rows = order(rail);
    // Nothing is dropped by the grouping: the rail is still the whole catalogue.
    expect(rows).toHaveLength(OFFICER_ROLES.length);
    expect([...rows].sort()).toEqual([...OFFICER_ROLES].sort());

    const emptyRoles = new Set<string>(
      F.research.tracks.filter((track) => track.mark === null).map((track) => track.role),
    );
    // The precondition that makes this test mean anything: the fixture has some of each, and the
    // catalogue order does **not** already put them this way round.
    expect(emptyRoles.size).toBeGreaterThan(0);
    expect(emptyRoles.size).toBeLessThan(OFFICER_ROLES.length);

    const firstEmpty = rows.findIndex((role) => emptyRoles.has(role));
    const lastFilled = rows.reduce(
      (last, role, index) => (emptyRoles.has(role) ? last : index),
      -1,
    );
    expect(firstEmpty).toBeGreaterThan(lastFilled - 1);
    expect(lastFilled).toBeLessThan(firstEmpty);
  });

  it('marks the break, and counts what is under it', async () => {
    stub();
    const rail = await openTracks();
    const divider = within(rail).getByTestId('research-empty-chairs');
    const empties = F.research.tracks.filter((track) => track.mark === null).length;
    expect(divider).toHaveTextContent(String(empties));
    expect(divider).toHaveTextContent(/nobody in the chair/i);
  });

  it('draws no break at all when every chair is filled', async () => {
    const allSeated: ResearchResponse = {
      ...F.research,
      tracks: F.research.tracks.map((track) => ({
        ...track,
        mark: track.mark ?? 'B',
        officerName: track.officerName ?? 'Somebody',
      })),
    };
    stub(allSeated);
    const rail = await openTracks();
    expect(within(rail).queryByTestId('research-empty-chairs')).toBeNull();
    expect(order(rail)).toHaveLength(OFFICER_ROLES.length);
  });
});
