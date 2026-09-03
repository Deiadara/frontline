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
    if (path.endsWith('/bar')) return reply(F.bar);
    throw new Error(`unstubbed request: ${path}`);
  });
}

async function openTracks() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={['/game/research']}>
        <ResearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByTestId('research-section-programmes'));
  return screen.getByTestId('research-tracks');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

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
