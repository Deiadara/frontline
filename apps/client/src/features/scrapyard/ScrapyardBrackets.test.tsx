import {
  MAX_MODIFICATION_SLOTS,
  MODIFICATION_SLOT_LEVELS,
  SCRAPYARD_LEVEL_FOR_RARITY,
  STARTING_RESOURCES,
  UNIT_MODIFICATIONS,
  findModification,
  isAdvancedModification,
  modificationPrice,
  modificationsFor,
  scrapyardLevelForModification,
  scrapyardLevelForUpgrade,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  upgradePrice,
  type Base,
  type MeResponse,
  type ModificationSpec,
  type ScrapyardEntry,
  type ScrapyardResponse,
  type UnitModificationSpec,
} from '@frontline/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    { id: 'b-nexus', kind: 'nexus', level: 20, modifications: [] },
    { id: 'b-yard', kind: 'scrapyard', level: 3, modifications: [] },
    // One bracket filled and the rest open, so the rack has all three slot states on screen.
    { id: 'b-lab', kind: 'lab', level: ALL_SLOTS, modifications: [FITTED.id] },
    // Standing, but below the level that opens its first bracket.
    { id: 'b-generator', kind: 'generator', level: 1, modifications: [] },
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

function stubApi(board: ScrapyardResponse = scrapyard): void {
  const reply = (body: unknown) =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: '',
      json: () => Promise.resolve(body),
    } as Response);

  fetchMock.mockImplementation((path: string) => {
    if (path.endsWith('/scrapyard')) return reply(board);
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

  it('names what is in a bracket and what has not opened', async () => {
    stubApi();
    renderYard('/game/scrapyard?bench=lab');
    const lab = within(await screen.findByTestId('scrapyard-bench-lab'));
    // Bolted in: the first bracket says which one.
    expect(within(lab.getByTestId('scrapyard-slot-lab-0')).getByText(FITTED.name)).toBeVisible();
    expect(lab.getByTestId('scrapyard-slot-lab-1')).toHaveTextContent('Empty');
    /*
     * And nothing about a shelf, because there is not one (maintainer rule, 2026-09-16).
     *
     * The yard used to cut a card onto a shelf and the district used to bolt it in, so the head of
     * the bench had a column for what was "cut for it and waiting". One press does both now, so
     * there is no such state and no such column: what a player owns for a structure is what is in
     * its brackets.
     */
    expect(lab.queryByTestId('scrapyard-shelf-lab')).toBeNull();

    // A structure too low for its first bracket says which level opens it rather than "Empty".
    fireEvent.click(screen.getByTestId('scrapyard-bench-the-generator'));
    const generator = within(await screen.findByTestId('scrapyard-bench-generator'));
    expect(generator.getByTestId('scrapyard-slot-generator-0')).toHaveTextContent(
      `Opens at level ${MODIFICATION_SLOT_LEVELS[0]}`,
    );
  });

  /**
   * The bench is where a card is bolted in now, so it does not send anybody anywhere to do it.
   *
   * This used to assert a "Fit in the district" link at the head of every bench, which was the
   * other half of the two-step the maintainer removed: the yard cut it, the district bolted it in.
   * The link is gone and the press is here.
   */
  it('does not send a player to the district to bolt one in', async () => {
    stubApi();
    renderYard('/game/scrapyard?bench=lab');
    await screen.findByTestId('scrapyard-bench-lab');
    expect(screen.queryByTestId('scrapyard-fit-lab')).toBeNull();
    expect(screen.queryByText('Fit in the district')).toBeNull();
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
    // ...and no structure has a shelf at all any more: see the bracket test above.
    expect(screen.queryByTestId('scrapyard-shelf-nexus')).toBeNull();
  });

  /**
   * A trap's stamp names its bill, not a grade.
   *
   * The unit bench one tab over grades its cards BASIC to MASTERPIECE, so a trap stamped
   * "Advanced" read as the same ladder while it meant "wants high-quality metal". The stamp now
   * says the metal, and a trap that wants none wears no stamp at all.
   */
  it('stamps a trap that wants good metal, and nothing on one that does not', async () => {
    const trap = (id: string, advanced: boolean): ScrapyardEntry => ({
      id,
      kind: 'trap',
      name: id,
      description: 'A hole with an opinion.',
      building: null,
      effect: 'Slows the approach.',
      cost: { caps: 40 },
      advanced,
      rarity: null,
      blueprint: null,
      owned: 0,
      requiresLevel: 1,
      documentHeld: true,
      blocker: null,
      // A trap belongs to no structure and asks for none of the four gates.
      targets: [],
      requirement: [],
    });
    stubApi({
      ...scrapyard,
      entries: [trap('trap_fuel_fougasse', true), trap('trap_collapse', false)],
    });
    renderYard('/game/scrapyard?view=traps');

    const metal = within(await screen.findByTestId('addon-trap_fuel_fougasse'));
    expect(metal.getByText('Good metal')).toBeInTheDocument();
    const plain = within(screen.getByTestId('addon-trap_collapse'));
    expect(plain.queryByText('Good metal')).toBeNull();
    for (const card of [metal, plain]) {
      expect(card.queryByText('Advanced')).toBeNull();
      expect(card.queryByText('Basic')).toBeNull();
    }
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

/**
 * The heading over each grade says the level *its own cards* open at.
 *
 * The two benches climb the yard's ladder differently: a unit card opens at its grade's rung
 * (`SCRAPYARD_LEVEL_FOR_RARITY`), a building card with the yard or at the advanced rung
 * (`scrapyardLevelForModification`). The heading read the unit ladder over both, so the Nexus
 * bench said "INTRICATE · opens at yard level 3" above cards a level-1 yard was cutting, with no
 * "Yard 3" stamp on any of them. The rows are built here the way the server builds them, off the
 * same shared functions, so the heading is measured against what the server actually gates with.
 */
describe('the head of the page', () => {
  /*
   * Two groups on one line: the benches, then the filter and the yard's plate pushed to the right
   * edge (maintainer request, 2026-09-15). It was two stacked rows, and the line that change gives
   * back goes to the bench below, which is the thing a player is actually reading.
   *
   * The grouping is what is pinned here rather than the geometry: the filter and the plate have to
   * stay in one box together, or the `ml-auto` that pushes them right pushes only one of them and
   * the other is left stranded mid-row. Where the two groups actually land at each supported width
   * is measured in the browser, in `scrapyard.spec.ts`.
   */
  it('keeps the filter and the yard plate together in one box beside the benches', async () => {
    stubApi();
    renderYard();

    const info = await screen.findByTestId('scrapyard-info');
    const head = screen.getByTestId('scrapyard-head');
    const [benches, boxes] = head.children;
    expect(head.children).toHaveLength(2);
    expect(benches).toHaveAttribute('role', 'tablist');
    expect(boxes).toContainElement(screen.getByTestId('scrapyard-ready-only'));
    expect(boxes).toContainElement(info);
    expect(benches).not.toContainElement(info);
  });
});

describe('the grade headings say the level their own cards open at', () => {
  const NEXUS = modificationsFor('nexus');

  const bracketRow = (spec: ModificationSpec): ScrapyardEntry => ({
    id: spec.id,
    kind: 'modification',
    name: spec.name,
    description: spec.description,
    building: spec.building,
    effect: '',
    cost: modificationPrice(spec),
    advanced: isAdvancedModification(spec),
    rarity: null,
    blueprint: null,
    owned: 0,
    requiresLevel: scrapyardLevelForModification(spec),
    documentHeld: true,
    blocker: null,
    // Open on its own structure, which is the state these tests are about.
    targets: [{ id: spec.building, name: spec.building, fitted: false, blocker: null }],
    requirement: [],
  });
  const unitRow = (spec: UnitModificationSpec): ScrapyardEntry => ({
    id: spec.id,
    kind: 'upgrade',
    name: spec.name,
    description: spec.description,
    building: null,
    effect: '',
    cost: upgradePrice(spec),
    advanced: spec.rarity !== 'basic',
    rarity: spec.rarity,
    blueprint: null,
    owned: 0,
    requiresLevel: scrapyardLevelForUpgrade(spec),
    documentHeld: true,
    blocker: null,
    targets: [{ id: 'razors', name: 'Razors', fitted: false, blocker: null }],
    requirement: [],
  });

  const board: ScrapyardResponse = {
    ...scrapyard,
    entries: [...NEXUS.map(bracketRow), ...UNIT_MODIFICATIONS.map(unitRow)],
  };

  /** A grade whose building cards open at a different rung from its unit cards, or the test is moot. */
  const split = NEXUS.find(
    (spec) => scrapyardLevelForModification(spec) !== SCRAPYARD_LEVEL_FOR_RARITY[spec.rarity],
  );

  it('is a precondition that the two ladders disagree somewhere on the Nexus bench', () => {
    expect(split, 'no Nexus card opens at a rung other than its grade’s').toBeDefined();
  });

  it('reads a building grade off its cards, not off the unit ladder', async () => {
    if (!split) throw new Error('precondition: see the test above');
    stubApi(board);
    renderYard('/game/scrapyard?bench=nexus');
    const tray = within(await screen.findByTestId('scrapyard-nexus'));
    const heading = tray.getByTestId(`scrapyard-rarity-${split.rarity}`);
    expect(heading).toHaveTextContent(
      `opens at yard level ${scrapyardLevelForModification(split)}`,
    );
    expect(heading).not.toHaveTextContent(
      `opens at yard level ${SCRAPYARD_LEVEL_FOR_RARITY[split.rarity]}`,
    );
  });

  it('still reads the unit ladder over the unit bench, where the two agree', async () => {
    if (!split) throw new Error('precondition: see the test above');
    stubApi(board);
    renderYard('/game/scrapyard?view=refits');
    const tray = within(await screen.findByTestId('scrapyard-unit-modifications'));
    expect(tray.getByTestId(`scrapyard-rarity-${split.rarity}`)).toHaveTextContent(
      `opens at yard level ${SCRAPYARD_LEVEL_FOR_RARITY[split.rarity]}`,
    );
  });

  it('tells the two ladders apart in the tip on the yard plate', async () => {
    stubApi(board);
    renderYard();
    const tip = (await screen.findByTestId('scrapyard-level-tip')).getAttribute('data-tip') ?? '';
    expect(tip).toContain(`INTRICATE at ${SCRAPYARD_LEVEL_FOR_RARITY.intricate}`);
    expect(tip).toContain('Building cards: BASIC and INTRICATE at 1');
    expect(tip).not.toContain('alike');
  });
});

/**
 * "Go out there and find some more blueprints." is the empty state of a bench, not a running count.
 *
 * It used to be drawn whenever any row was withheld, so a crew holding thirty refits still got
 * told to go and find some (maintainer report, 2026-09-16). The rule is now about what the bench
 * holds rather than about what it is keeping back: the line is for the player who opened a bench
 * and found nothing on it, and it goes the moment the first card lands there.
 */
describe('the line under a bench is an empty state', () => {
  const trap = (
    id: string,
    documentHeld: boolean,
    blocker: string | null = null,
  ): ScrapyardEntry => ({
    id,
    kind: 'trap',
    name: id,
    description: 'A hole with an opinion.',
    building: null,
    effect: 'Slows the approach.',
    cost: { caps: 40 },
    advanced: false,
    rarity: null,
    blueprint: null,
    owned: 0,
    requiresLevel: 1,
    documentHeld,
    blocker: documentHeld ? blocker : 'Needs the drawings',
    targets: [],
    requirement: [],
  });

  const unit = (
    id: string,
    documentHeld: boolean,
    blocker: string | null = null,
  ): ScrapyardEntry => ({
    ...trap(id, documentHeld, blocker),
    kind: 'upgrade',
    rarity: 'basic',
    // The unit bench is per sheet now, so a row needs a sheet to be about.
    targets: [
      {
        id: 'razors',
        name: 'Razors',
        fitted: false,
        blocker: documentHeld ? blocker : 'Needs the drawings',
      },
    ],
  });

  /** A bracket for one structure, optionally one the crew could not cut today. */
  const bracket = (
    spec: ModificationSpec,
    documentHeld: boolean,
    blocker: string | null = null,
  ): ScrapyardEntry => ({
    id: spec.id,
    kind: 'modification',
    name: spec.name,
    description: spec.description,
    building: spec.building,
    effect: '',
    cost: modificationPrice(spec),
    advanced: isAdvancedModification(spec),
    rarity: null,
    blueprint: null,
    owned: 0,
    requiresLevel: 1,
    documentHeld,
    blocker: null,
    targets: [
      {
        id: spec.building,
        name: spec.building,
        fitted: false,
        blocker: documentHeld ? blocker : 'Needs the drawings',
      },
    ],
    requirement: [],
  });

  it('says nothing on a traps bench that has a card on it', async () => {
    stubApi({ ...scrapyard, entries: [trap('trap_held', true), trap('trap_locked', false)] });
    renderYard('/game/scrapyard?view=traps');
    expect(await screen.findByTestId('addon-trap_held')).toBeVisible();
    expect(screen.queryByTestId('scrapyard-hidden-traps')).toBeNull();
  });

  it('says it on a traps bench the crew holds nothing for', async () => {
    stubApi({ ...scrapyard, entries: [trap('trap_locked', false), trap('trap_other', false)] });
    renderYard('/game/scrapyard?view=traps');
    expect(await screen.findByTestId('scrapyard-hidden-traps')).toHaveTextContent(
      'find some more blueprints',
    );
  });

  /** A bench with nothing behind a document either has nothing to go and find. */
  it('says nothing on a bare bench with no withheld rows behind it', async () => {
    stubApi({ ...scrapyard, entries: [] });
    renderYard('/game/scrapyard?view=traps');
    expect(await screen.findByTestId('scrapyard-view-traps')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByTestId('scrapyard-hidden-traps')).toBeNull();
  });

  it('keeps the same rule on the refits bench', async () => {
    stubApi({ ...scrapyard, entries: [unit('unit_held', true), unit('unit_locked', false)] });
    renderYard('/game/scrapyard?view=refits');
    expect(await screen.findByTestId('addon-unit_held')).toBeVisible();
    expect(screen.queryByTestId('scrapyard-hidden-refits')).toBeNull();

    stubApi({ ...scrapyard, entries: [unit('unit_locked', false)] });
    renderYard('/game/scrapyard?view=refits');
    expect(await screen.findByTestId('scrapyard-hidden-refits')).toBeVisible();
  });

  /**
   * ...and per structure on the add-ons bench, because that is the bench a player is looking at.
   *
   * The Lab holds one of its two; the Generator holds none of its one. A rule read over the whole
   * `modification` kind would print the line on both or on neither.
   */
  it('reads the rule off the structure whose bench is open, not off the whole kind', async () => {
    const lab = modificationsFor('lab');
    const generator = modificationsFor('generator');
    const board: ScrapyardResponse = {
      ...scrapyard,
      entries: [
        bracket(lab[0]!, true),
        bracket(lab[1]!, false),
        bracket(generator[0]!, false),
        bracket(generator[1]!, false),
      ],
    };
    stubApi(board);
    renderYard('/game/scrapyard?bench=lab');
    expect(await screen.findByTestId('scrapyard-lab')).toBeVisible();
    expect(screen.queryByTestId('scrapyard-hidden-lab')).toBeNull();

    fireEvent.click(screen.getByTestId('scrapyard-bench-the-generator'));
    expect(await screen.findByTestId('scrapyard-hidden-generator')).toHaveTextContent(
      'find some more blueprints',
    );
  });

  /**
   * The same, over the two benches whose held count is worked out by the page above them.
   *
   * The refits and the traps are handed rows the filter has already been through, so their count
   * of what is held is passed separately. A count taken after the filter would light the line on
   * both of these benches the moment a player pressed Ready to build.
   */
  it('stays away on the refits and traps benches the filter has emptied', async () => {
    stubApi({
      ...scrapyard,
      entries: [
        unit('unit_held', true, 'Not enough scrap'),
        unit('unit_locked', false),
        trap('trap_held', true, 'Not enough scrap'),
        trap('trap_locked', false),
      ],
    });
    renderYard('/game/scrapyard?view=refits');
    expect(await screen.findByTestId('addon-unit_held')).toBeVisible();

    fireEvent.click(screen.getByTestId('scrapyard-ready-only'));
    expect(screen.queryByTestId('addon-unit_held')).toBeNull();
    expect(screen.queryByTestId('scrapyard-hidden-refits')).toBeNull();

    fireEvent.click(screen.getByTestId('scrapyard-view-traps'));
    expect(await screen.findByTestId('scrapyard-view-traps')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByTestId('addon-trap_held')).toBeNull();
    expect(screen.queryByTestId('scrapyard-hidden-traps')).toBeNull();
  });

  /**
   * The Ready-to-build filter cannot turn the line on.
   *
   * The filter hides rows the crew *does* hold, so a bench emptied by it is not a bench with
   * nothing on it: the line is read off what is held, before the filter runs.
   */
  it('stays away when the ready filter is what emptied the bench', async () => {
    const lab = modificationsFor('lab');
    stubApi({
      ...scrapyard,
      entries: [bracket(lab[0]!, true, 'Not enough scrap'), bracket(lab[1]!, false)],
    });
    renderYard('/game/scrapyard?bench=lab');
    expect(await screen.findByTestId(`addon-${lab[0]!.id}`)).toBeVisible();

    fireEvent.click(screen.getByTestId('scrapyard-ready-only'));
    expect(screen.queryByTestId(`addon-${lab[0]!.id}`)).toBeNull();
    expect(screen.queryByTestId('scrapyard-hidden-lab')).toBeNull();
  });
});

/**
 * §E as the maintainer rewrote it on 2026-09-16: one press cuts the card and bolts it in.
 *
 * The bench used to say Build, put the card on a shelf, and send the player to the district to fit
 * it. Now the press names the structure the bench is open on, the button on a card already in that
 * structure reads Dismantle, and dismantling is asked for first because nothing comes back.
 */
describe('bolting a card in from the bench', () => {
  const posted = () =>
    fetchMock.mock.calls
      .filter(([path, init]) => String(path).endsWith('/scrapyard/build') && init !== undefined)
      .map(
        ([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, string>,
      );

  const card = (over: Partial<ScrapyardEntry> = {}): ScrapyardEntry => ({
    id: 'nexus_priority_bus',
    kind: 'modification',
    name: 'Priority Bus',
    description: 'The Nexus decides which job goes first.',
    building: 'nexus',
    effect: '+8% off how long a build takes',
    cost: { scrap: 100 },
    advanced: false,
    rarity: 'basic',
    blueprint: null,
    owned: 0,
    requiresLevel: 1,
    documentHeld: true,
    blocker: null,
    targets: [{ id: 'nexus', name: 'The Nexus', fitted: false, blocker: null }],
    requirement: ['The Nexus at level 2', 'District level 2', 'Lead Engineer at F+ or better'],
    ...over,
  });

  it('asks first, then sends the structure the bench is open on with the press', async () => {
    stubApi({ ...scrapyard, entries: [card()] });
    renderYard('/game/scrapyard?bench=nexus');
    fireEvent.click(await screen.findByTestId('addon-build-nexus_priority_bus'));

    // The bill is spent on the press and taking it out again destroys it, so it is asked for.
    const asked = await screen.findByTestId('scrapyard-bolt');
    expect(asked).toHaveTextContent('The Nexus');
    expect(posted(), 'the yard cut it before anybody said yes').toHaveLength(0);

    fireEvent.click(screen.getByTestId('scrapyard-bolt-yes'));
    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]).toEqual({
      kind: 'modification',
      id: 'nexus_priority_bus',
      target: 'nexus',
    });
  });

  it('reads Dismantle on a structure already wearing it, and asks before it does', async () => {
    stubApi({
      ...scrapyard,
      entries: [
        card({
          targets: [{ id: 'nexus', name: 'The Nexus', fitted: true, blocker: null }],
          owned: 1,
        }),
      ],
    });
    renderYard('/game/scrapyard?bench=nexus');
    fireEvent.click(await screen.findByTestId('addon-dismantle-nexus_priority_bus'));
    // Nothing is posted until the player says yes: taking one out destroys it.
    expect(await screen.findByTestId('scrapyard-dismantle')).toBeVisible();
    expect(screen.getByTestId('scrapyard-dismantle')).toHaveTextContent('Nothing is refunded');
    expect(screen.queryByTestId('addon-build-nexus_priority_bus')).toBeNull();
  });

  it('says what the card asks for, not only what is in the way', async () => {
    stubApi({
      ...scrapyard,
      entries: [
        card({
          targets: [{ id: 'nexus', name: 'The Nexus', fitted: false, blocker: 'District level 2' }],
        }),
      ],
    });
    renderYard('/game/scrapyard?bench=nexus');
    const requires = within(await screen.findByTestId('addon-requires-nexus_priority_bus'));
    expect(requires.getByText('The Nexus at level 2')).toBeVisible();
    expect(requires.getByText('Lead Engineer at F+ or better')).toBeVisible();
    // ...and the one gate that is actually shut is the sentence under the dead button.
    expect(screen.getByTestId('addon-blocker-nexus_priority_bus')).toHaveTextContent(
      'District level 2',
    );
  });
});
