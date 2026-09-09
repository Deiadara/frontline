import {
  BUILDING_KINDS,
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
  type WorkshopResponse,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkshopPage } from './WorkshopPage';
import { useSession } from '../../store/session';

/**
 * §I3b: the Workshop's Modifications view.
 *
 * It builds nothing. Everything on it is read off `/me`, so the property worth testing is that it
 * reports what the district actually holds: what is bolted into which bracket, what the yard has
 * cut and left on the shelf, and which brackets a structure's level has not opened yet. The two
 * doors are followed rather than read off an attribute.
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
    // One bracket filled and the rest open, so the view has all three slot states on screen.
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

const workshop: WorkshopResponse = {
  resources: STARTING_RESOURCES,
  inventory: {},
  upgrades: [],
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
    if (path.endsWith('/workshop')) return reply(workshop);
    if (path.endsWith('/me')) return reply(me);
    throw new Error(`unstubbed request: ${path}`);
  });
}

/** A stand-in that prints where it was reached from, query string included. */
function Landed({ name }: { name: string }) {
  return <p>{`${name}${useLocation().search}`}</p>;
}

/** The workshop, with stand-ins at the two places the Modifications view can send a player. */
function renderWorkshop() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/game/workshop']}>
        <Routes>
          <Route path="/game/workshop" element={<WorkshopPage />} />
          <Route path="/game/scrapyard" element={<Landed name="the scrapyard" />} />
          <Route path="/game/base" element={<Landed name="the district" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Opens the second view and hands back the panel for one structure. */
async function openModifications() {
  renderWorkshop();
  fireEvent.click(await screen.findByTestId('workshop-view-modifications'));
  return await screen.findByTestId('workshop-modifications');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  useSession.setState({ token: 'session-token', user: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('§I3b: the whole modifications picture, in one place', () => {
  it('opens on the refits and swaps the page for the modifications', async () => {
    stubApi();
    renderWorkshop();
    expect(await screen.findByTestId('workshop-view-refits')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByTestId('workshop-modifications')).toBeNull();

    fireEvent.click(screen.getByTestId('workshop-view-modifications'));
    expect(await screen.findByTestId('workshop-modifications')).toBeInTheDocument();
  });

  it('lists every structure that has modifications', async () => {
    stubApi();
    const view = within(await openModifications());
    for (const kind of BUILDING_KINDS) {
      expect(modificationsFor(kind).length, kind).toBeGreaterThan(0);
      expect(view.getByTestId(`workshop-addons-${kind}`), kind).toBeInTheDocument();
    }
  });

  it('names what is in a bracket, what is waiting, and what has not opened', async () => {
    stubApi();
    const view = within(await openModifications());

    const lab = within(view.getByTestId('workshop-addons-lab'));
    // Bolted in: the first bracket says which one.
    expect(within(lab.getByTestId('workshop-slot-lab-0')).getByText(FITTED.name)).toBeVisible();
    expect(lab.getByTestId('workshop-slot-lab-1')).toHaveTextContent('Empty');
    // Cut and not bolted in anywhere: on the shelf, and not confused with the fitted one.
    const shelf = within(lab.getByTestId('workshop-shelf-lab'));
    expect(shelf.getByText(SHELVED.name)).toBeVisible();
    expect(shelf.queryByText(FITTED.name)).toBeNull();

    // A structure too low for its first bracket says which level opens it rather than "Empty".
    const generator = within(view.getByTestId('workshop-addons-generator'));
    expect(generator.getByTestId('workshop-slot-generator-0')).toHaveTextContent(
      `Opens at level ${MODIFICATION_SLOT_LEVELS[0]}`,
    );
    // ...and the one cut for it is still on its shelf, waiting for the level.
    expect(
      within(generator.getByTestId('workshop-shelf-generator')).getByText(GENERATOR_MOD.name),
    ).toBeVisible();
  });

  /**
   * The count is of *brackets filled*, not of things owned.
   *
   * The Generator is the control: it has one modification cut for it and none bolted in, because
   * its level has not opened a bracket yet. A counter that read the shelf would print `1 of 3` for
   * a structure with nothing in it, which is the reading the research page used to ship.
   */
  it('counts the brackets a structure has filled, not what it owns for it', async () => {
    stubApi();
    const view = within(await openModifications());

    expect(screen.getByTestId('workshop-fitted-lab')).toHaveTextContent(
      `1 of ${MAX_MODIFICATION_SLOTS}`,
    );
    expect(screen.getByTestId('workshop-fitted-generator')).toHaveTextContent(
      `0 of ${MAX_MODIFICATION_SLOTS}`,
    );
    expect(screen.getByTestId('workshop-fitted-nexus')).toHaveTextContent(
      `0 of ${MAX_MODIFICATION_SLOTS}`,
    );
    // ...and a structure with nothing cut for it says so rather than drawing an empty list.
    expect(
      within(view.getByTestId('workshop-addons-nexus')).queryByTestId('workshop-shelf-nexus'),
    ).toBeNull();
  });

  it('sends a player to that structure’s own bench in the yard', async () => {
    stubApi();
    const view = within(await openModifications());
    fireEvent.click(view.getByTestId('workshop-yard-lab'));
    // The bench, not just the yard: the yard reads `?bench` and its bench ids are `BuildingKind`.
    expect(await screen.findByText('the scrapyard?bench=lab')).toBeInTheDocument();
  });

  it('sends a player to the district to bolt one in', async () => {
    stubApi();
    const view = within(await openModifications());
    fireEvent.click(view.getByTestId('workshop-fit-lab'));
    expect(await screen.findByText('the district')).toBeInTheDocument();
  });

  /** A fixture that could not tell the two apart would pass the shelf assertion for free. */
  it('is a precondition that the fitted and shelved modifications are different things', () => {
    expect(FITTED.id).not.toBe(SHELVED.id);
    expect(findModification(SHELVED.id)?.building).toBe('lab');
  });
});
