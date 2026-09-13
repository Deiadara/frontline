import {
  MAX_MODIFICATION_SLOTS,
  MODIFICATION_SLOT_LEVELS,
  STARTING_RESOURCES,
  findModification,
  modificationsFor,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  type Base,
  type MeResponse,
  type ScrapyardResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '../../store/session';
import { ScrapyardPage } from './ScrapyardPage';

/**
 * §I3b: the bracket rack at the head of every structure's bench.
 *
 * It was the Workshop's Modifications view until the two pages became one (2026-09-10). It builds
 * nothing; everything on it is read off `/me`, so the property worth testing is that it reports
 * what the district actually holds: what is bolted into which bracket, what the yard has cut and
 * left on the shelf, and which brackets a structure's level has not opened yet.
 */

const NOW = '2026-08-13T10:00:00.000Z';

const LAB_MODS = modificationsFor('lab');
const FITTED = LAB_MODS[0];
const SHELVED = LAB_MODS[1];
const GENERATOR_MOD = modificationsFor('generator')[0];
if (!FITTED || !SHELVED || !GENERATOR_MOD) throw new Error('the catalogue lost a modification');

/** The level that opens every bracket, so "not open yet" is a state the fixture can also show. */
const ALL_SLOTS = MODIFICATION_SLOT_LEVELS[MODIFICATION_SLOT_LEVELS.length - 1]!;

const base: Base = {
  id: 'base-1',
  ownerId: 'user-1',
  name: 'The Ninth Street Crew',
  districtId: 'sector-7',
  level: 20,
  isBot: false,
  resources: STARTING_RESOURCES,
  economy: startingEconomy(NOW),
  progression: startingProgression(),
  research: startingResearch(),
  buildings: [
    { id: 'b-nexus', kind: 'nexus', level: 20, modifications: [], damage: 0 },
    { id: 'b-yard', kind: 'scrapyard', level: 3, modifications: [], damage: 0 },
    // One bracket filled and the rest open, so the rack has all three slot states on screen.
    { id: 'b-lab', kind: 'lab', level: ALL_SLOTS, modifications: [FITTED.id], damage: 0 },
    // Standing, but below the level that opens its first bracket.
    { id: 'b-generator', kind: 'generator', level: 1, modifications: [], damage: 0 },
  ],
  // Two cut: one already in the Lab's wall, one still on the shelf.
  addons: { researched: [], built: [FITTED.id, SHELVED.id, GENERATOR_MOD.id] },
  buildQueue: [],
  army: {},
  trainingQueue: [],
  training: startingTraining('2026-08-16T00:00:00.000Z'),
  inventory: {},
  fittedUpgrades: [],
  unitLoadouts: {},
  fleet: {},
  commanders: [],
  createdAt: NOW,
};

const me: MeResponse = {
  admin: false,
  user: {
    id: 'user-1',
    username: 'operator',
    overseerId: 'ov-1',
    createdAt: NOW,
    displayName: null,
    icon: 'shield',
    timezone: 'Europe/Athens',
    soundVolume: 60,
  },
  overseer: null,
  base,
};

/** A yard with nothing on the board: the rack is the thing under test, not the rows. */
const scrapyard: ScrapyardResponse = {
  scrapyardLevel: 3,
  discountPercent: 4,
  resources: STARTING_RESOURCES,
  entries: [],
};

const fetchMock = vi.fn();

function stubApi(): void {
  const reply = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve(body),
    } as Response);

  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/scrapyard')) return reply(scrapyard);
    if (path.endsWith('/me')) return reply(me);
    throw new Error(`unstubbed request: ${path}`);
  });
}

/** A stand-in that prints where it was reached from, query string included. */
function Landed({ name }: { name: string }) {
  return <p>{`${name}${useLocation().search}`}</p>;
}

function renderYard(path = '/game/scrapyard') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/game/scrapyard" element={<ScrapyardPage />} />
          <Route path="/game/base" element={<Landed name="the district" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('§I3b: the bracket rack at the head of a bench', () => {
  it('opens on the structures, the Nexus first, with the yard plate reading the level', async () => {
    stubApi();
    renderYard();
    expect(await screen.findByTestId('scrapyard-view-modifications')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('scrapyard-bench-nexus')).toBeInTheDocument();
    expect(screen.getByTestId('scrapyard-level')).toHaveTextContent('Level 3');
    expect(screen.getByTestId('scrapyard-discount')).toHaveTextContent('4% off');
  });

  it('names what is in a bracket, what is waiting, and what has not opened', async () => {
    stubApi();
    renderYard('/game/scrapyard?bench=lab');
    const lab = within(await screen.findByTestId('scrapyard-bench-lab'));
    // Bolted in: the first bracket says which one.
    expect(within(lab.getByTestId('scrapyard-slot-lab-0')).getByText(FITTED.name)).toBeVisible();
    expect(lab.getByTestId('scrapyard-slot-lab-1')).toHaveTextContent('Empty');
    // Cut and not bolted in anywhere: on the shelf, and not confused with the fitted one.
    const shelf = within(lab.getByTestId('scrapyard-shelf-lab'));
    expect(shelf.getByText(SHELVED.name)).toBeVisible();
    expect(shelf.queryByText(FITTED.name)).toBeNull();

    // A structure too low for its first bracket says which level opens it rather than "Empty".
    fireEvent.click(screen.getByTestId('scrapyard-bench-the-generator'));
    const generator = within(await screen.findByTestId('scrapyard-bench-generator'));
    expect(generator.getByTestId('scrapyard-slot-generator-0')).toHaveTextContent(
      `Opens at level ${MODIFICATION_SLOT_LEVELS[0]}`,
    );
    // ...and the one cut for it is still on its shelf, waiting for the level.
    expect(
      within(generator.getByTestId('scrapyard-shelf-generator')).getByText(GENERATOR_MOD.name),
    ).toBeVisible();
  });

  /**
   * The count on the door is of *brackets filled*, not of things owned.
   *
   * The Generator is the control: it has one modification cut for it and none bolted in, because
   * its level has not opened a bracket yet. A counter that read the shelf would print `1 of 3` for
   * a structure with nothing in it.
   */
  it('counts the brackets a structure has filled on its door, not what it owns for it', async () => {
    stubApi();
    renderYard();
    await screen.findByTestId('scrapyard-menu');
    expect(screen.getByTestId('scrapyard-fitted-lab')).toHaveTextContent(
      `1 of ${MAX_MODIFICATION_SLOTS}`,
    );
    expect(screen.getByTestId('scrapyard-fitted-generator')).toHaveTextContent(
      `0 of ${MAX_MODIFICATION_SLOTS}`,
    );
    // A structure that is not standing says so rather than counting brackets it does not have.
    expect(screen.getByTestId('scrapyard-fitted-gate')).toHaveTextContent('Not built yet');
    // ...and a structure with nothing cut for it says so rather than drawing an empty list.
    expect(screen.queryByTestId('scrapyard-shelf-nexus')).toBeNull();
  });

  it('sends a player to the district to bolt one in', async () => {
    stubApi();
    renderYard('/game/scrapyard?bench=lab');
    fireEvent.click(await screen.findByTestId('scrapyard-fit-lab'));
    expect(await screen.findByText('the district')).toBeInTheDocument();
  });

  it('honours the old ?bench= deep links to the refits and the traps', async () => {
    stubApi();
    renderYard('/game/scrapyard?bench=traps');
    expect(await screen.findByTestId('scrapyard-view-traps')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  /** A fixture that could not tell the two apart would pass the shelf assertion for free. */
  it('is a precondition that the fitted and shelved modifications are different things', () => {
    expect(FITTED.id).not.toBe(SHELVED.id);
    expect(findModification(SHELVED.id)?.building).toBe('lab');
  });
});
