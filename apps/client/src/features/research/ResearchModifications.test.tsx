import { MAX_MODIFICATION_SLOTS, type MeResponse, type ResearchResponse } from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as F from '../../../e2e/fixtures';
import { ResearchPage } from './ResearchPage';
import { useSession } from '../../store/session';

/**
 * Owning a drawing and having the thing in the wall are two different states.
 *
 * A Lab project produces a **blueprint** (§B9): the Scrapyard builds it and the structure's own
 * dialog bolts it in. `ModificationOption.installed` is the server's `isModificationDrawn`, which
 * is `addons.researched.includes(id) || buildings.some(b => b.modifications.includes(id))`, so it
 * answers "the crew owns the paper".
 *
 * Counting that against `MAX_MODIFICATION_SLOTS` printed "3 of 3 fitted" for a crew that had fitted
 * nothing, and "5 of 3 fitted" once they had drawn all five of a structure's modifications, which
 * is not a state the game has. What is actually in the brackets is on the district.
 */

const NEXUS_MODS = F.research.modifications.filter((option) => option.building === 'nexus');

/** Every Nexus drawing owned, and `fitted` however many of them are bolted into the Nexus. */
function researchWithAllDrawn(): ResearchResponse {
  return {
    ...F.research,
    modifications: F.research.modifications.map((option) =>
      option.building === 'nexus' ? { ...option, installed: true, blocker: null } : option,
    ),
  };
}

function meWithFitted(fitted: string[]): MeResponse {
  const base = F.me.base;
  if (!base) throw new Error('the fixture has no district');
  return {
    ...F.me,
    base: {
      ...base,
      buildings: base.buildings.map((building) =>
        building.kind === 'nexus' ? { ...building, modifications: fitted } : building,
      ),
    },
  };
}

const fetchMock = vi.fn();

const reply = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response);

function stub(me: MeResponse): void {
  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/research')) return reply(researchWithAllDrawn());
    if (path.endsWith('/me')) return reply(me);
    if (path.endsWith('/bar')) return reply(F.bar);
    throw new Error(`unstubbed request: ${path}`);
  });
}

/** Open the modification bench, which is not the section the page lands on. */
async function openModifyBench() {
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
  fireEvent.click(await screen.findByTestId('research-bench-modify'));
  return screen.getByTestId('modification-tally');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('the modification bench tally', () => {
  it('is a precondition that the Nexus has more drawings than it has slots', () => {
    expect(NEXUS_MODS.length).toBeGreaterThan(MAX_MODIFICATION_SLOTS);
  });

  it('counts nothing as fitted when every drawing is owned and none is bolted in', async () => {
    stub(meWithFitted([]));
    const tally = await openModifyBench();

    await waitFor(() => expect(tally).toHaveTextContent(`0 of ${MAX_MODIFICATION_SLOTS} fitted`));
    expect(tally).toHaveTextContent(`${NEXUS_MODS.length} of ${NEXUS_MODS.length} drawn`);
    // ...and the cards say which of the two they mean.
    const cards = within(screen.getByTestId('modification-options'));
    expect(cards.getAllByText('Drawn')).toHaveLength(NEXUS_MODS.length);
    expect(cards.queryByText('Fitted')).toBeNull();
  });

  it('counts the ones the district actually has in its brackets', async () => {
    const bolted = NEXUS_MODS.slice(0, 2).map((option) => option.id);
    stub(meWithFitted(bolted));
    const tally = await openModifyBench();

    await waitFor(() => expect(tally).toHaveTextContent(`2 of ${MAX_MODIFICATION_SLOTS} fitted`));
    const cards = within(screen.getByTestId('modification-options'));
    expect(cards.getAllByText('Fitted')).toHaveLength(2);
    expect(cards.getAllByText('Drawn')).toHaveLength(NEXUS_MODS.length - 2);
  });
});
